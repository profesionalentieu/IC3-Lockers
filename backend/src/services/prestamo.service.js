'use strict';
/**
 * Prestamos: solicitud, aprobacion, retiro y devolucion.
 *
 * CIRCUITO (lo que cambia respecto de la version anterior):
 *
 *   1. El usuario SOLICITA        -> prestamo 'pendiente'. NO se abre nada.
 *                                    El stock queda RESERVADO.
 *   2. Alumnado APRUEBA           -> pasa a 'activo', recien ahi se encola
 *                                    el comando de apertura hacia el casillero.
 *      o RECHAZA                  -> 'rechazado', se libera la reserva.
 *      o nadie contesta a tiempo  -> 'caducado' por watchdog, se libera.
 *   3. El usuario DEVUELVE        -> suma cantidad_devuelta y se abre la puerta.
 *
 * La devolucion NO necesita aprobacion, a proposito: trabar la devolucion solo
 * lograria que la gente se quede con el material. Lo que hay que controlar es
 * la salida, no la vuelta.
 *
 * La unica fuente de verdad del stock sigue siendo esta tabla: no hay ninguna
 * columna de stock que actualizar, asi que stock e historial no pueden
 * contradecirse (ver casillero.service.js).
 */
const { db, ahora } = require('../config/database');
const env = require('../config/env');
const { ErrorNegocio } = require('../utils/errores');
const hub = require('../realtime/hub');
const casilleros = require('./casillero.service');
const comandos = require('./comando.service');
const eventos = require('./evento.service');

/** Limite de unidades por solicitud segun el rol. Evita que uno vacie el panol. */
const LIMITE_POR_RETIRO = { alumno: 5, docente: 25 };

/** Cuantas solicitudes sin resolver puede tener una persona a la vez. */
const MAX_SOLICITUDES_ABIERTAS = 3;

const buscarUsuarioPorLegajo = (legajo) =>
  db.prepare(`SELECT * FROM usuarios WHERE legajo = ? AND activo = 1`).get(String(legajo).trim());

/* ============================================================
   LECTURA
   ============================================================ */

const SQL_PRESTAMOS = `
  SELECT p.*, i.nombre AS item_nombre, i.codigo AS item_codigo, i.unidad,
         c.codigo AS casillero_codigo, c.id AS casillero_id_real,
         u.legajo, u.nombre AS usuario_nombre, u.rol
  FROM prestamos p
  JOIN items i      ON i.id = p.item_id
  JOIN casilleros c ON c.id = p.casillero_id
  JOIN usuarios u   ON u.id = p.usuario_id
`;

const mapear = (fila) => ({
  id: fila.id,
  estado: fila.estado,
  vencido: Boolean(fila.vencido),
  cantidad: fila.cantidad,
  cantidadDevuelta: fila.cantidad_devuelta,
  pendiente: fila.cantidad - fila.cantidad_devuelta,
  solicitadoEn: fila.solicitado_en,
  retiradoEn: fila.retirado_en,
  vencimiento: fila.vencimiento,
  devueltoEn: fila.devuelto_en,
  resueltoPor: fila.resuelto_por,
  resueltoEn: fila.resuelto_en,
  motivoRechazo: fila.motivo_rechazo,
  // Minutos que lleva esperando: le sirve a Alumnado para priorizar la cola.
  minutosEsperando:
    fila.estado === 'pendiente'
      ? Math.round((Date.now() - Date.parse(fila.solicitado_en)) / 60000)
      : null,
  horasRestantes: fila.vencimiento
    ? Math.round((Date.parse(fila.vencimiento) - Date.now()) / 36e5)
    : null,
  item: { id: fila.item_id, nombre: fila.item_nombre, codigo: fila.item_codigo, unidad: fila.unidad },
  casillero: { id: fila.casillero_id, codigo: fila.casillero_codigo },
  usuario: { legajo: fila.legajo, nombre: fila.usuario_nombre, rol: fila.rol },
});

const obtener = (id) => {
  const fila = db.prepare(`${SQL_PRESTAMOS} WHERE p.id = ?`).get(id);
  return fila ? mapear(fila) : null;
};

/** Cola de aprobacion: lo que Alumnado tiene que resolver, mas viejo primero. */
const pendientesDeAprobacion = () =>
  db.prepare(`${SQL_PRESTAMOS} WHERE p.estado = 'pendiente' ORDER BY p.solicitado_en ASC`)
    .all()
    .map(mapear);

/* ============================================================
   1. SOLICITUD
   ============================================================ */

/**
 * Registra una solicitud de retiro. NO abre ningun casillero.
 *
 * La validacion de stock y el INSERT van en la MISMA transaccion: si dos
 * personas piden la ultima notebook con medio segundo de diferencia, la
 * segunda encuentra el stock ya reservado y recibe el error, en vez de que
 * las dos queden con una solicitud valida sobre una notebook que no existe.
 *
 * @returns {{prestamo:object}}
 */
function solicitar({ legajo, casilleroId, cantidad }) {
  const usuario = buscarUsuarioPorLegajo(legajo);
  if (!usuario) throw new ErrorNegocio('Usuario no encontrado', 404);

  const pedido = Number(cantidad);
  if (!Number.isInteger(pedido) || pedido <= 0)
    throw new ErrorNegocio('La cantidad tiene que ser un numero entero mayor a cero', 400);

  const limite = LIMITE_POR_RETIRO[usuario.rol] ?? 5;
  if (pedido > limite)
    throw new ErrorNegocio(`Podes pedir hasta ${limite} unidades por vez`, 400);

  const transaccion = db.transaction(() => {
    // Tope de solicitudes abiertas: sin esto, alguien puede reservar todo el
    // panol con pedidos que nunca va a retirar.
    const abiertas = db
      .prepare(`SELECT COUNT(*) AS n FROM prestamos WHERE usuario_id = ? AND estado = 'pendiente'`)
      .get(usuario.id).n;
    if (abiertas >= MAX_SOLICITUDES_ABIERTAS)
      throw new ErrorNegocio(
        `Ya tenes ${abiertas} solicitudes esperando aprobacion. Espera a que Alumnado las resuelva.`,
        409
      );

    const casillero = casilleros.obtener(casilleroId);
    if (!casillero) throw new ErrorNegocio('El casillero no existe', 404);
    if (!casillero.item) throw new ErrorNegocio('Ese casillero no tiene material cargado', 409);
    if (casillero.estado === casilleros.ESTADOS.ERROR)
      throw new ErrorNegocio(`${casillero.codigo} esta fuera de servicio`, 409);
    if (pedido > casillero.inventario.disponible)
      throw new ErrorNegocio(
        `Quedan ${casillero.inventario.disponible} ${casillero.item.unidad}(s) de ${casillero.item.nombre}`,
        409
      );

    const info = db
      .prepare(
        `INSERT INTO prestamos
           (usuario_id, casillero_id, item_id, cantidad, estado, solicitado_en)
         VALUES (?, ?, ?, ?, 'pendiente', ?)`
      )
      .run(usuario.id, casillero.id, casillero.item.id, pedido, ahora());

    return { prestamoId: Number(info.lastInsertRowid), casillero };
  });

  const { prestamoId, casillero } = transaccion();
  const prestamo = obtener(prestamoId);

  eventos.registrar(eventos.TIPOS.SOLICITUD, {
    casilleroId: casillero.id,
    prestamoId,
    actor: usuario.legajo,
    detalle: `${pedido} x ${casillero.item.nombre}`,
  });

  // El panel de Alumnado tiene que ver la solicitud sin refrescar.
  hub.emitir('solicitud.nueva', prestamo, ['admin']);
  casilleros.notificar(casillero.id);

  return { prestamo };
}

/* ============================================================
   2. APROBACION / RECHAZO
   ============================================================ */

/**
 * Alumnado aprueba: recien ahora se abre el casillero.
 * @returns {{prestamo:object, comandoId:number}}
 */
function aprobar(prestamoId, { actor }) {
  const transaccion = db.transaction(() => {
    const prestamo = obtener(prestamoId);
    if (!prestamo) throw new ErrorNegocio('La solicitud no existe', 404);
    if (prestamo.estado !== 'pendiente')
      throw new ErrorNegocio(`Esa solicitud ya estaba ${prestamo.estado}`, 409);

    const casillero = casilleros.obtener(prestamo.casillero.id);
    if (casillero.estado === casilleros.ESTADOS.ERROR)
      throw new ErrorNegocio(`${casillero.codigo} esta fuera de servicio`, 409);

    // El stock ya estaba reservado por esta solicitud, asi que no hace falta
    // volver a validarlo: solo confirmamos que el total no se haya recortado.
    if (casillero.inventario.total < casillero.inventario.prestado + prestamo.cantidad)
      throw new ErrorNegocio('El stock del casillero cambio: revisa el inventario', 409);

    const horas = prestamo.usuario.rol === 'docente' ? 168 : 24;
    db.prepare(
      `UPDATE prestamos
       SET estado = 'activo', retirado_en = ?, vencimiento = ?, resuelto_por = ?, resuelto_en = ?
       WHERE id = ?`
    ).run(
      ahora(),
      new Date(Date.now() + horas * 36e5).toISOString(),
      actor,
      ahora(),
      prestamoId
    );

    return prestamo;
  });

  const previo = transaccion();

  eventos.registrar(eventos.TIPOS.SOLICITUD_APROBADA, {
    casilleroId: previo.casillero.id,
    prestamoId,
    actor,
    detalle: `${previo.cantidad} x ${previo.item.nombre} para ${previo.usuario.legajo}`,
  });

  // La orden fisica se crea SOLO aca: sin aprobacion no hay apertura.
  const comando = comandos.encolarApertura(previo.casillero.id, {
    origen: 'admin',
    solicitadoPor: actor,
    motivo: 'RETIRO',
    prestamoId,
  });

  const prestamo = obtener(prestamoId);
  avisarAlUsuario(prestamo, 'solicitud.resuelta', { comandoId: comando.id });
  hub.emitir('solicitud.resuelta', prestamo, ['admin']);
  casilleros.notificar(previo.casillero.id);

  return { prestamo, comandoId: comando.id };
}

/** Alumnado rechaza: se libera la reserva y el usuario se entera al instante. */
function rechazar(prestamoId, { actor, motivo = null }) {
  const prestamo = obtener(prestamoId);
  if (!prestamo) throw new ErrorNegocio('La solicitud no existe', 404);
  if (prestamo.estado !== 'pendiente')
    throw new ErrorNegocio(`Esa solicitud ya estaba ${prestamo.estado}`, 409);

  db.prepare(
    `UPDATE prestamos
     SET estado = 'rechazado', resuelto_por = ?, resuelto_en = ?, motivo_rechazo = ?
     WHERE id = ?`
  ).run(actor, ahora(), motivo, prestamoId);

  eventos.registrar(eventos.TIPOS.SOLICITUD_RECHAZADA, {
    casilleroId: prestamo.casillero.id,
    prestamoId,
    actor,
    detalle: motivo || `${prestamo.cantidad} x ${prestamo.item.nombre}`,
  });

  const actualizado = obtener(prestamoId);
  avisarAlUsuario(actualizado, 'solicitud.resuelta', {});
  hub.emitir('solicitud.resuelta', actualizado, ['admin']);
  casilleros.notificar(prestamo.casillero.id);   // se libero la reserva

  return { prestamo: actualizado };
}

/**
 * Watchdog: caduca las solicitudes que nadie resolvio.
 * Es lo que impide que una reserva olvidada bloquee material para siempre.
 */
function caducarSolicitudes() {
  const limite = new Date(Date.now() - env.reglas.solicitudCaducaMin * 60000).toISOString();
  const viejas = db
    .prepare(`SELECT id FROM prestamos WHERE estado = 'pendiente' AND solicitado_en < ?`)
    .all(limite);

  for (const fila of viejas) {
    const prestamo = obtener(fila.id);
    db.prepare(
      `UPDATE prestamos SET estado = 'caducado', resuelto_por = 'sistema', resuelto_en = ?
       WHERE id = ?`
    ).run(ahora(), fila.id);

    eventos.registrar(eventos.TIPOS.SOLICITUD_CADUCADA, {
      casilleroId: prestamo.casillero.id,
      prestamoId: fila.id,
      actor: 'watchdog',
      detalle: `sin aprobar por mas de ${env.reglas.solicitudCaducaMin} min`,
    });

    const actualizado = obtener(fila.id);
    avisarAlUsuario(actualizado, 'solicitud.resuelta', {});
    hub.emitir('solicitud.resuelta', actualizado, ['admin']);
    casilleros.notificar(prestamo.casillero.id);
  }
  return viejas.length;
}

/* ============================================================
   3. DEVOLUCION
   ============================================================ */

/**
 * Registra una devolucion (total o parcial) y abre el casillero para guardar.
 * No requiere aprobacion: ver la nota del encabezado.
 */
function devolver(prestamoId, { legajo = null, cantidad = null, actor = null } = {}) {
  const transaccion = db.transaction(() => {
    const prestamo = obtener(prestamoId);
    if (!prestamo) throw new ErrorNegocio('El prestamo no existe', 404);
    if (prestamo.estado === 'pendiente')
      throw new ErrorNegocio('Esa solicitud todavia no fue aprobada', 409);
    if (prestamo.estado !== 'activo') throw new ErrorNegocio('Ese prestamo ya fue devuelto', 409);

    // Un usuario solo puede devolver lo suyo; el admin puede devolver cualquiera.
    if (legajo && prestamo.usuario.legajo !== legajo)
      throw new ErrorNegocio('Ese prestamo no es tuyo', 403);

    const aDevolver = cantidad === null ? prestamo.pendiente : Number(cantidad);
    if (!Number.isInteger(aDevolver) || aDevolver <= 0)
      throw new ErrorNegocio('La cantidad a devolver tiene que ser mayor a cero', 400);
    if (aDevolver > prestamo.pendiente)
      throw new ErrorNegocio(`Solo tenes ${prestamo.pendiente} sin devolver`, 400);

    const totalDevuelto = prestamo.cantidadDevuelta + aDevolver;
    const completo = totalDevuelto === prestamo.cantidad;

    db.prepare(
      `UPDATE prestamos SET cantidad_devuelta = ?, estado = ?, devuelto_en = ? WHERE id = ?`
    ).run(totalDevuelto, completo ? 'devuelto' : 'activo', completo ? ahora() : null, prestamoId);

    return { prestamo, devuelto: aDevolver, completo };
  });

  const { prestamo, devuelto, completo } = transaccion();

  eventos.registrar(completo ? eventos.TIPOS.DEVOLUCION : eventos.TIPOS.DEVOLUCION_PARCIAL, {
    casilleroId: prestamo.casillero.id,
    prestamoId,
    actor: actor || prestamo.usuario.legajo,
    detalle: `${devuelto} x ${prestamo.item.nombre}`,
  });

  const comando = comandos.encolarApertura(prestamo.casillero.id, {
    origen: actor && !legajo ? 'admin' : 'usuario',
    solicitadoPor: actor || prestamo.usuario.legajo,
    motivo: 'DEVOLUCION',
    prestamoId,
  });

  casilleros.notificar(prestamo.casillero.id);
  return { prestamo: obtener(prestamoId), comandoId: comando.id };
}

/* ============================================================
   CONSULTAS
   ============================================================ */

/** Avisa por WebSocket a la persona duena del prestamo, no a todos. */
function avisarAlUsuario(prestamo, evento, extra) {
  hub.emitirA(prestamo.usuario.legajo, evento, { ...prestamo, ...extra });
}

/** Prestamos de una persona. `estado`: 'pendiente' | 'activo' | 'devuelto' | 'todos'. */
function porUsuario(legajo, estado = 'todos') {
  const filtro = estado === 'todos' ? '' : ' AND p.estado = ?';
  const parametros = estado === 'todos' ? [legajo] : [legajo, estado];
  return db
    .prepare(`${SQL_PRESTAMOS} WHERE u.legajo = ?${filtro} ORDER BY p.solicitado_en DESC`)
    .all(...parametros)
    .map(mapear);
}

/** Trazabilidad para Alumnado: quien, que, cuanto, cuando y quien lo aprobo. */
function historial({ estado = 'todos', buscar = '', limite = 100 } = {}) {
  const condiciones = [];
  const parametros = [];

  if (estado !== 'todos') { condiciones.push('p.estado = ?'); parametros.push(estado); }
  if (buscar.trim()) {
    condiciones.push('(u.legajo LIKE ? OR u.nombre LIKE ? OR i.nombre LIKE ?)');
    const patron = `%${buscar.trim()}%`;
    parametros.push(patron, patron, patron);
  }

  const where = condiciones.length ? ` WHERE ${condiciones.join(' AND ')}` : '';
  parametros.push(limite);

  return db
    .prepare(`${SQL_PRESTAMOS}${where} ORDER BY p.solicitado_en DESC LIMIT ?`)
    .all(...parametros)
    .map(mapear);
}

/** Resumen para el encabezado del panel. */
function resumen() {
  const fila = db
    .prepare(
      `SELECT
         COUNT(*) FILTER (WHERE estado = 'pendiente')              AS solicitudes,
         COUNT(*) FILTER (WHERE estado = 'activo')                 AS prestamos_activos,
         COALESCE(SUM(CASE WHEN estado = 'activo'
                           THEN cantidad - cantidad_devuelta END), 0) AS unidades_afuera,
         COUNT(*) FILTER (WHERE estado = 'activo' AND vencido = 1) AS vencidos
       FROM prestamos`
    )
    .get();
  return {
    solicitudesPendientes: fila.solicitudes,
    prestamosActivos: fila.prestamos_activos,
    unidadesAfuera: fila.unidades_afuera,
    vencidos: fila.vencidos,
  };
}

/**
 * Watchdog: marca vencidos los prestamos fuera de plazo.
 * No los cierra solo: hay material fisico afuera, y darlo por devuelto seria
 * inventar stock que no volvio. Se marca y Alumnado reclama.
 */
function marcarVencidos() {
  const info = db
    .prepare(
      `UPDATE prestamos SET vencido = 1
       WHERE estado = 'activo' AND vencido = 0 AND vencimiento IS NOT NULL AND vencimiento < ?`
    )
    .run(ahora());
  return info.changes;
}

module.exports = {
  LIMITE_POR_RETIRO, MAX_SOLICITUDES_ABIERTAS,
  solicitar, aprobar, rechazar, devolver,
  obtener, pendientesDeAprobacion, porUsuario, historial, resumen,
  marcarVencidos, caducarSolicitudes, buscarUsuarioPorLegajo,
};
