'use strict';
/**
 * Cola de comandos hacia los nodos LoRa.
 *
 * Por que una COLA y no una llamada directa al hardware:
 * LoRa es half-duplex, lento (~1-2 s por trama) y sin garantia de entrega.
 * Si el backend intentara "abrir y esperar", la request HTTP del alumno
 * quedaria colgada. En su lugar:
 *
 *   1. El alumno pide abrir  -> se ENCOLA un comando (estado 'pendiente')
 *      y la API responde 202 al instante con el id del comando.
 *   2. El gateway lo toma    -> pasa a 'enviado' (marcarEnviados)
 *   3. El nodo responde ACK  -> pasa a 'confirmado' (confirmar)
 *   4. Si no hay ACK a tiempo -> reintento, y a los N intentos 'fallido'
 *
 * El frontend sigue el progreso por WebSocket o consultando el comando.
 */
const { db, ahora } = require('../config/database');
const env = require('../config/env');
const hub = require('../realtime/hub');
const eventos = require('./evento.service');

/**
 * Encola una orden de apertura.
 * @returns {{id:number, estado:string}} comando creado
 */
function encolarApertura(casilleroId, { origen, solicitadoPor, motivo = 'RETIRO', prestamoId = null }) {
  const info = db
    .prepare(
      `INSERT INTO comandos
         (casillero_id, prestamo_id, tipo, motivo, origen, solicitado_por, estado, creado_en)
       VALUES (?, ?, 'ABRIR', ?, ?, ?, 'pendiente', ?)`
    )
    .run(casilleroId, prestamoId, motivo, origen, solicitadoPor, ahora());

  const comando = obtener(info.lastInsertRowid);

  // El retiro y la devolucion ya se registran en prestamo.service con su
  // detalle (item y cantidad). Aca solo queda la apertura sin prestamo detras.
  if (motivo === 'EMERGENCIA') {
    eventos.registrar(eventos.TIPOS.APERTURA_EMERGENCIA, {
      casilleroId, actor: solicitadoPor, detalle: `comando #${comando.id}`,
    });
  }

  // Push inmediato al gateway si esta conectado por WebSocket:
  // le ahorra hasta un ciclo de polling completo.
  hub.emitir('comando.nuevo', paraGateway(comando), ['gateway']);
  hub.emitir('comando.actualizado', comando, ['admin', 'usuario']);

  return comando;
}

const obtener = (id) =>
  db.prepare(
    `SELECT co.*, c.codigo AS casillero_codigo, c.bit_registro, n.codigo AS nodo
     FROM comandos co
     JOIN casilleros c ON c.id = co.casillero_id
     JOIN nodos n      ON n.id = c.nodo_id
     WHERE co.id = ?`
  ).get(id);

/**
 * Formato compacto que consume el gateway y viaja por LoRa.
 * Se mantiene chico a proposito: la trama LoRa tiene pocos bytes utiles.
 */
const paraGateway = (c) => ({
  id: c.id,
  nodo: c.nodo,
  bit: c.bit_registro,       // que salida del SN74HC595 pulsar
  accion: c.tipo,            // 'ABRIR' | 'PING'
  motivo: c.motivo,          // RETIRO | DEVOLUCION | EMERGENCIA (solo para logs)
  casillero: c.casillero_codigo,
});

/** Comandos que el gateway todavia debe transmitir (pendientes o vencidos sin ACK). */
function pendientes(limite = 10) {
  const limiteReintento = new Date(
    Date.now() - env.reglas.comandoTimeoutSeg * 1000
  ).toISOString();

  return db
    .prepare(
      `SELECT co.*, c.codigo AS casillero_codigo, c.bit_registro, n.codigo AS nodo
       FROM comandos co
       JOIN casilleros c ON c.id = co.casillero_id
       JOIN nodos n      ON n.id = c.nodo_id
       WHERE co.estado = 'pendiente'
          OR (co.estado = 'enviado' AND co.enviado_en < ? AND co.intentos < ?)
       ORDER BY co.creado_en ASC
       LIMIT ?`
    )
    .all(limiteReintento, env.reglas.comandoMaxIntentos, limite)
    .map(paraGateway);
}

/** El gateway confirma que tomo los comandos: los pasa a 'enviado' y suma intento. */
function marcarEnviados(ids) {
  if (!ids.length) return;
  const stmt = db.prepare(
    `UPDATE comandos
     SET estado = 'enviado', enviado_en = ?, intentos = intentos + 1
     WHERE id = ?`
  );
  const tx = db.transaction((lista) => lista.forEach((id) => stmt.run(ahora(), id)));
  tx(ids);
}

/** ACK del nodo: la cerradura se acciono. */
function confirmar(id, { ok = true, detalle = null } = {}) {
  const comando = obtener(id);
  if (!comando) return null;

  db.prepare(
    `UPDATE comandos SET estado = ?, confirmado_en = ?, detalle = ? WHERE id = ?`
  ).run(ok ? 'confirmado' : 'fallido', ahora(), detalle, id);

  eventos.registrar(
    ok ? eventos.TIPOS.COMANDO_CONFIRMADO : eventos.TIPOS.COMANDO_FALLIDO,
    { casilleroId: comando.casillero_id, detalle: detalle || `comando #${id}`, actor: 'gateway' }
  );

  const actualizado = obtener(id);
  hub.emitir('comando.actualizado', actualizado, ['admin', 'usuario']);
  return actualizado;
}

/** Watchdog: comandos que agotaron los reintentos. */
function caducarVencidos() {
  const limite = new Date(Date.now() - env.reglas.comandoTimeoutSeg * 1000).toISOString();
  const vencidos = db
    .prepare(
      `SELECT id, casillero_id FROM comandos
       WHERE estado = 'enviado' AND enviado_en < ? AND intentos >= ?`
    )
    .all(limite, env.reglas.comandoMaxIntentos);

  for (const c of vencidos) {
    confirmar(c.id, { ok: false, detalle: 'Sin ACK del nodo tras agotar reintentos' });
  }
  return vencidos;
}

module.exports = {
  encolarApertura,
  obtener,
  pendientes,
  marcarEnviados,
  confirmar,
  caducarVencidos,
};
