'use strict';
/**
 * Padron de personas que pueden retirar material: alumnos y docentes.
 *
 * Baja logica a proposito: un usuario nunca se borra, se desactiva. Si se
 * borrara, los prestamos historicos apuntarian a un usuario inexistente y la
 * trazabilidad perderia sentido justo cuando mas se la necesita (cuando hay
 * que reconstruir quien se llevo que cosa).
 */
const { db } = require('../config/database');
const { ErrorNegocio } = require('../utils/errores');

const ROLES = ['alumno', 'docente'];

function normalizar({ legajo, nombre, pin, rol }) {
  const limpio = {
    legajo: String(legajo ?? '').trim(),
    nombre: String(nombre ?? '').trim(),
    pin: String(pin ?? '').trim(),
    rol: String(rol ?? 'alumno').trim().toLowerCase(),
  };
  if (!/^\d{3,10}$/.test(limpio.legajo))
    throw new ErrorNegocio('El legajo tiene que ser un numero de 3 a 10 digitos', 400);
  if (limpio.nombre.length < 3)
    throw new ErrorNegocio('Cargá el nombre completo', 400);
  if (!/^\d{4,6}$/.test(limpio.pin))
    throw new ErrorNegocio('El PIN tiene que ser de 4 a 6 digitos', 400);
  if (!ROLES.includes(limpio.rol))
    throw new ErrorNegocio(`El rol tiene que ser ${ROLES.join(' o ')}`, 400);
  return limpio;
}

/** Padron con cuanto material tiene afuera cada persona. */
function listar(buscar = '') {
  const patron = `%${String(buscar).trim()}%`;
  return db
    .prepare(
      `SELECT u.id, u.legajo, u.nombre, u.rol, u.activo,
              COUNT(p.id) FILTER (WHERE p.estado = 'activo') AS prestamos_activos,
              COALESCE(SUM(CASE WHEN p.estado = 'activo'
                                THEN p.cantidad - p.cantidad_devuelta END), 0) AS unidades_afuera
       FROM usuarios u
       LEFT JOIN prestamos p ON p.usuario_id = u.id
       WHERE u.legajo LIKE ? OR u.nombre LIKE ?
       GROUP BY u.id
       ORDER BY u.activo DESC, u.legajo`
    )
    .all(patron, patron);
}

/** Alta individual. Un legajo dado de baja que vuelve se reactiva. */
function crear(datos) {
  const usuario = normalizar(datos);
  const existe = db.prepare(`SELECT id, activo FROM usuarios WHERE legajo = ?`).get(usuario.legajo);

  if (existe) {
    if (existe.activo) throw new ErrorNegocio(`El legajo ${usuario.legajo} ya esta registrado`, 409);
    db.prepare(`UPDATE usuarios SET nombre = ?, pin = ?, rol = ?, activo = 1 WHERE id = ?`)
      .run(usuario.nombre, usuario.pin, usuario.rol, existe.id);
    return { id: existe.id, ...usuario, reactivado: true };
  }

  const info = db
    .prepare(`INSERT INTO usuarios (legajo, nombre, pin, rol, activo) VALUES (?, ?, ?, ?, 1)`)
    .run(usuario.legajo, usuario.nombre, usuario.pin, usuario.rol);
  return { id: info.lastInsertRowid, ...usuario, reactivado: false };
}

/**
 * Alta masiva pegando una linea por persona:
 *   10234, Bertola Juan, 4821, alumno
 * Devuelve el detalle linea por linea para que Alumnado vea que fallo y por que.
 */
function importar(texto) {
  const lineas = String(texto || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const resultado = { creados: 0, reactivados: 0, errores: [] };

  for (const [i, linea] of lineas.entries()) {
    const [legajo, nombre, pin, rol] = linea.split(/[,;\t]/).map((p) => p.trim());
    try {
      const usuario = crear({ legajo, nombre, pin, rol: rol || 'alumno' });
      usuario.reactivado ? resultado.reactivados++ : resultado.creados++;
    } catch (e) {
      resultado.errores.push(`Linea ${i + 1}: ${e.message}`);
    }
  }
  return resultado;
}

function actualizar(id, { nombre, pin, rol }) {
  const usuario = db.prepare(`SELECT * FROM usuarios WHERE id = ?`).get(id);
  if (!usuario) throw new ErrorNegocio('La persona no existe', 404);

  const datos = normalizar({
    legajo: usuario.legajo,
    nombre: nombre ?? usuario.nombre,
    pin: pin ?? usuario.pin,
    rol: rol ?? usuario.rol,
  });
  db.prepare(`UPDATE usuarios SET nombre = ?, pin = ?, rol = ? WHERE id = ?`)
    .run(datos.nombre, datos.pin, datos.rol, id);
  return { id, ...datos };
}

/** Baja logica. Bloqueada si la persona tiene material sin devolver. */
function desactivar(id) {
  const pendiente = db
    .prepare(`SELECT id FROM prestamos WHERE usuario_id = ? AND estado = 'activo'`)
    .get(id);
  if (pendiente)
    throw new ErrorNegocio('Tiene material sin devolver: cerrá esos prestamos primero', 409);

  const info = db.prepare(`UPDATE usuarios SET activo = 0 WHERE id = ?`).run(id);
  if (!info.changes) throw new ErrorNegocio('La persona no existe', 404);
  return { id, activo: 0 };
}

module.exports = { ROLES, listar, crear, importar, actualizar, desactivar };
