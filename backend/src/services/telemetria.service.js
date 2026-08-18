'use strict';
/**
 * Telemetria entrante desde los nodos (via gateway LoRa).
 *
 * El final de carrera (microswitch) de cada puerta es la unica fuente de
 * verdad sobre el estado fisico. El backend nunca "asume" que una puerta
 * se abrio porque mando el comando: espera el reporte del microswitch.
 */
const { db, ahora } = require('../config/database');
const hub = require('../realtime/hub');
const casilleros = require('./casillero.service');
const eventos = require('./evento.service');

/**
 * Procesa una lectura de puerta.
 * @param {{nodo:string, bit:number, puertaAbierta:boolean, rssi?:number}} lectura
 */
function registrarPuerta({ nodo, bit, puertaAbierta, rssi = null }) {
  const casillero = db
    .prepare(
      `SELECT c.id, c.codigo, c.estado_puerta
       FROM casilleros c JOIN nodos n ON n.id = c.nodo_id
       WHERE n.codigo = ? AND c.bit_registro = ?`
    )
    .get(nodo, bit);

  if (!casillero) return null;

  const estadoNuevo = puertaAbierta ? 'abierta' : 'cerrada';
  const cambio = casillero.estado_puerta !== estadoNuevo;

  db.prepare(
    `UPDATE casilleros
     SET estado_puerta = ?,
         abierta_desde = CASE WHEN ? = 'abierta' THEN COALESCE(abierta_desde, ?) ELSE NULL END,
         ultima_telemetria = ?,
         -- Al cerrarse correctamente se limpia una eventual marca de trabada
         estado_operativo = CASE WHEN ? = 'cerrada' THEN 'ok' ELSE estado_operativo END,
         detalle_error    = CASE WHEN ? = 'cerrada' THEN NULL ELSE detalle_error END
     WHERE id = ?`
  ).run(estadoNuevo, estadoNuevo, ahora(), ahora(), estadoNuevo, estadoNuevo, casillero.id);

  if (rssi !== null) {
    db.prepare(`UPDATE nodos SET rssi = ?, ultimo_contacto = ? WHERE codigo = ?`)
      .run(rssi, ahora(), nodo);
  }

  if (cambio) {
    eventos.registrar(
      puertaAbierta ? eventos.TIPOS.PUERTA_ABIERTA : eventos.TIPOS.PUERTA_CERRADA,
      { casilleroId: casillero.id, actor: 'microswitch' }
    );
  }

  const actualizado = casilleros.obtener(casillero.id);
  hub.emitir('casillero.actualizado', actualizado, ['admin', 'usuario']);
  return actualizado;
}

/** Heartbeat del nodo: mantiene vivo el indicador de enlace LoRa. */
function heartbeat({ nodo, rssi = null, bateriaMv = null }) {
  db.prepare(
    `UPDATE nodos
     SET ultimo_contacto = ?,
         rssi = COALESCE(?, rssi),
         bateria_mv = COALESCE(?, bateria_mv)
     WHERE codigo = ?`
  ).run(ahora(), rssi, bateriaMv, nodo);
}

module.exports = { registrarPuerta, heartbeat };
