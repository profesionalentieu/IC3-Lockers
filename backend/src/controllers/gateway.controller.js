'use strict';
/**
 * Endpoints que consume el Gateway LoRa. No los toca ningun navegador.
 * Todos exigen el header x-api-key.
 */
const comandos = require('../services/comando.service');
const telemetria = require('../services/telemetria.service');
const log = require('../utils/logger');

/**
 * GET /api/gateway/comandos
 * El gateway pregunta "que tengo que transmitir?".
 * Devuelve los comandos y los marca como enviados en la misma operacion.
 */
function obtenerComandos(req, res) {
  const lista = comandos.pendientes(Number(req.query.limite) || 10);
  comandos.marcarEnviados(lista.map((c) => c.id));
  if (lista.length) log.lora(`Entregados ${lista.length} comando(s) al gateway`);
  res.json({ comandos: lista });
}

/**
 * POST /api/gateway/comandos/:id/ack   { ok: true, detalle }
 * El nodo confirmo (o no) que acciono la cerradura.
 */
function confirmarComando(req, res) {
  const { ok = true, detalle = null } = req.body || {};
  const comando = comandos.confirmar(Number(req.params.id), { ok, detalle });
  if (!comando) return res.status(404).json({ error: 'El comando no existe' });
  res.json({ id: comando.id, estado: comando.estado });
}

/**
 * POST /api/gateway/telemetria
 * Estado de los finales de carrera. Acepta una lectura o un lote:
 *   { nodo:'NODO-A', lecturas:[ { bit:0, puertaAbierta:true }, ... ], rssi:-72 }
 */
function recibirTelemetria(req, res) {
  const { nodo, lecturas, bit, puertaAbierta, rssi = null } = req.body || {};
  if (!nodo) return res.status(400).json({ error: 'Falta el codigo del nodo' });

  const lote = Array.isArray(lecturas)
    ? lecturas
    : [{ bit, puertaAbierta }].filter((l) => l.bit !== undefined);

  const actualizados = lote
    .map((l) =>
      telemetria.registrarPuerta({
        nodo,
        bit: Number(l.bit),
        puertaAbierta: Boolean(l.puertaAbierta),
        rssi,
      })
    )
    .filter(Boolean);

  telemetria.heartbeat({ nodo, rssi });
  res.json({ actualizados: actualizados.length, casilleros: actualizados });
}

/** POST /api/gateway/heartbeat  { nodo, rssi, bateriaMv } */
function heartbeat(req, res) {
  const { nodo, rssi = null, bateriaMv = null } = req.body || {};
  if (!nodo) return res.status(400).json({ error: 'Falta el codigo del nodo' });
  telemetria.heartbeat({ nodo, rssi, bateriaMv });
  res.json({ ok: true });
}

module.exports = { obtenerComandos, confirmarComando, recibirTelemetria, heartbeat };
