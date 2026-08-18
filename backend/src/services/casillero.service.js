'use strict';
/**
 * Casilleros + inventario.
 *
 * DOS DERIVACIONES, ninguna guardada como columna:
 *
 * 1) STOCK DISPONIBLE
 *      disponible = stock_total - prestado - reservado
 *
 *      prestado  = lo que esta afuera (prestamos 'activo')
 *      reservado = lo que pidieron y Alumnado todavia no aprobo ('pendiente')
 *
 *    Las solicitudes pendientes RESERVAN stock. Si no lo hicieran, dos
 *    personas podrian pedir las ultimas 5 notebooks, Alumnado aprobaria las
 *    dos y quedarian 5 unidades comprometidas que no existen.
 *    La contracara: una solicitud que nadie aprueba bloquea material, por eso
 *    el watchdog las caduca a los N minutos (ver watchdog.service.js).
 *
 * 2) ESTADO VISIBLE   (prioridad de arriba hacia abajo)
 *      ERROR          -> watchdog: puerta trabada o nodo sin responder
 *      PUERTA_ABIERTA -> lo dice el microswitch, no el comando
 *      SIN_STOCK      -> disponible == 0
 *      DISPONIBLE     -> hay material para retirar
 */
const { db } = require('../config/database');
const env = require('../config/env');
const hub = require('../realtime/hub');

const ESTADOS = {
  DISPONIBLE: 'DISPONIBLE',
  SIN_STOCK: 'SIN_STOCK',
  PUERTA_ABIERTA: 'PUERTA_ABIERTA',
  ERROR: 'ERROR',
};

/** Consulta base: casillero + nodo + item + stock derivado. */
const SQL_CASILLEROS = `
  SELECT
    c.id, c.codigo, c.bit_registro, c.stock_total, c.umbral_bajo,
    c.estado_puerta, c.estado_operativo, c.detalle_error,
    c.abierta_desde, c.ultima_telemetria,
    n.codigo AS nodo, n.ubicacion, n.rssi, n.ultimo_contacto,
    i.id AS item_id, i.codigo AS item_codigo, i.nombre AS item_nombre,
    i.categoria, i.unidad, i.descripcion,
    COALESCE((
      SELECT SUM(p.cantidad - p.cantidad_devuelta)
      FROM prestamos p
      WHERE p.casillero_id = c.id AND p.estado = 'activo'
    ), 0) AS prestado,
    COALESCE((
      SELECT SUM(p.cantidad)
      FROM prestamos p
      WHERE p.casillero_id = c.id AND p.estado = 'pendiente'
    ), 0) AS reservado
  FROM casilleros c
  JOIN nodos n      ON n.id = c.nodo_id
  LEFT JOIN items i ON i.id = c.item_id
`;

/** Traduce la fila cruda al objeto que consumen los dos frontends. */
function mapear(fila) {
  const prestado = fila.prestado || 0;
  const reservado = fila.reservado || 0;
  const disponible = Math.max(0, fila.stock_total - prestado - reservado);

  let estado = ESTADOS.DISPONIBLE;
  if (fila.estado_operativo === 'error') estado = ESTADOS.ERROR;
  else if (fila.estado_puerta === 'abierta') estado = ESTADOS.PUERTA_ABIERTA;
  else if (disponible === 0) estado = ESTADOS.SIN_STOCK;

  const offline =
    !fila.ultimo_contacto ||
    (Date.now() - Date.parse(fila.ultimo_contacto)) / 1000 > env.reglas.nodoOfflineSeg;

  return {
    id: fila.id,
    codigo: fila.codigo,
    estado,
    estadoPuerta: fila.estado_puerta,
    detalleError: fila.detalle_error || null,
    bitRegistro: fila.bit_registro,
    ultimaTelemetria: fila.ultima_telemetria,
    nodo: { codigo: fila.nodo, ubicacion: fila.ubicacion, rssi: fila.rssi, offline },
    item: fila.item_id
      ? {
          id: fila.item_id,
          codigo: fila.item_codigo,
          nombre: fila.item_nombre,
          categoria: fila.categoria,
          unidad: fila.unidad,
          descripcion: fila.descripcion,
        }
      : null,
    inventario: {
      total: fila.stock_total,
      prestado,
      reservado,
      disponible,
      umbralBajo: fila.umbral_bajo,
      // Bandera aparte y no un estado propio: un casillero con poco stock
      // sigue siendo operable, solo necesita reposicion.
      stockBajo: disponible > 0 && disponible <= fila.umbral_bajo,
    },
  };
}

const listar = () =>
  db.prepare(`${SQL_CASILLEROS} ORDER BY c.codigo`).all().map(mapear);

const obtener = (id) => {
  const fila = db.prepare(`${SQL_CASILLEROS} WHERE c.id = ?`).get(id);
  return fila ? mapear(fila) : null;
};

/** Catalogo para la vista de usuario: solo lo que se puede pedir. */
const catalogo = () =>
  db
    .prepare(`${SQL_CASILLEROS} WHERE c.item_id IS NOT NULL ORDER BY i.categoria, i.nombre`)
    .all()
    .map(mapear);

/** Marca el casillero fuera de servicio (o lo repone). */
function marcarOperativo(casilleroId, ok, detalle = null) {
  db.prepare(`UPDATE casilleros SET estado_operativo = ?, detalle_error = ? WHERE id = ?`)
    .run(ok ? 'ok' : 'error', ok ? null : detalle, casilleroId);
}

/** Empuja el estado nuevo a los navegadores conectados. */
function notificar(casilleroId) {
  hub.emitir('casillero.actualizado', obtener(casilleroId), ['admin', 'usuario']);
}

module.exports = {
  ESTADOS, listar, obtener, catalogo, mapear,
  marcarOperativo, notificar, SQL_CASILLEROS,
};
