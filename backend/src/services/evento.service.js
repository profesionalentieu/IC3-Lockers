'use strict';
/**
 * Bitacora de auditoria del panol. Es el reemplazo digital del cuaderno
 * donde se anotaba a mano quien se llevaba que material.
 */
const { db, ahora } = require('../config/database');

const TIPOS = {
  SOLICITUD: 'SOLICITUD',
  SOLICITUD_APROBADA: 'SOLICITUD_APROBADA',
  SOLICITUD_RECHAZADA: 'SOLICITUD_RECHAZADA',
  SOLICITUD_CADUCADA: 'SOLICITUD_CADUCADA',
  RETIRO: 'RETIRO',
  DEVOLUCION: 'DEVOLUCION',
  DEVOLUCION_PARCIAL: 'DEVOLUCION_PARCIAL',
  DEVOLUCION_FORZADA: 'DEVOLUCION_FORZADA',
  INVENTARIO_ACTUALIZADO: 'INVENTARIO_ACTUALIZADO',
  APERTURA_EMERGENCIA: 'APERTURA_EMERGENCIA',
  COMANDO_CONFIRMADO: 'COMANDO_CONFIRMADO',
  COMANDO_FALLIDO: 'COMANDO_FALLIDO',
  PUERTA_ABIERTA: 'PUERTA_ABIERTA',
  PUERTA_CERRADA: 'PUERTA_CERRADA',
  PUERTA_TRABADA: 'PUERTA_TRABADA',
  PRESTAMO_VENCIDO: 'PRESTAMO_VENCIDO',
};

function registrar(tipo, { casilleroId = null, prestamoId = null, detalle = null, actor = null } = {}) {
  db.prepare(
    `INSERT INTO eventos (casillero_id, prestamo_id, tipo, detalle, actor, creado_en)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(casilleroId, prestamoId, tipo, detalle, actor, ahora());
}

function ultimos(limite = 30) {
  return db
    .prepare(
      `SELECT e.id, e.tipo, e.detalle, e.actor, e.creado_en, e.prestamo_id,
              c.codigo AS casillero
       FROM eventos e
       LEFT JOIN casilleros c ON c.id = e.casillero_id
       ORDER BY e.id DESC LIMIT ?`
    )
    .all(limite);
}

module.exports = { TIPOS, registrar, ultimos };
