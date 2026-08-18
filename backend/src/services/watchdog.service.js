'use strict';
/**
 * Watchdog del sistema. Corre cada pocos segundos y hace tres cosas:
 *   0. Caduca las solicitudes que Alumnado no aprobo a tiempo, liberando el
 *      stock que tenian reservado.
 *   1. Marca los prestamos fuera de plazo (NO los da por devueltos: el
 *      material sigue afuera, solo queda señalado para que Alumnado reclame).
 *   2. Detecta puertas que quedaron abiertas demasiado tiempo -> ERROR/TRABADA.
 *   3. Caduca comandos que agotaron los reintentos sin ACK.
 *
 * Es lo que convierte la columna "estado" del dashboard en algo confiable
 * aunque se pierdan paquetes LoRa.
 */
const { db } = require('../config/database');
const env = require('../config/env');
const log = require('../utils/logger');
const hub = require('../realtime/hub');
const casilleros = require('./casillero.service');
const prestamos = require('./prestamo.service');
const comandos = require('./comando.service');
const eventos = require('./evento.service');

function detectarPuertasTrabadas() {
  const limite = new Date(Date.now() - env.reglas.puertaAbiertaMaxSeg * 1000).toISOString();
  const trabadas = db
    .prepare(
      `SELECT id, codigo FROM casilleros
       WHERE estado_puerta = 'abierta'
         AND abierta_desde IS NOT NULL
         AND abierta_desde < ?
         AND estado_operativo = 'ok'`
    )
    .all(limite);

  for (const c of trabadas) {
    casilleros.marcarOperativo(
      c.id,
      false,
      `Puerta abierta hace mas de ${env.reglas.puertaAbiertaMaxSeg} s`
    );
    eventos.registrar(eventos.TIPOS.PUERTA_TRABADA, { casilleroId: c.id, actor: 'watchdog' });
    hub.emitir('casillero.actualizado', casilleros.obtener(c.id), ['admin', 'usuario']);
    log.aviso(`Casillero ${c.codigo} marcado como TRABADO`);
  }
}

let temporizador = null;

function iniciar() {
  temporizador = setInterval(() => {
    try {
      const caducadas = prestamos.caducarSolicitudes();
      if (caducadas) log.aviso(`${caducadas} solicitud(es) caducada(s) sin aprobar`);
      const vencidos = prestamos.marcarVencidos();
      if (vencidos) log.aviso(`${vencidos} prestamo(s) fuera de plazo`);
      detectarPuertasTrabadas();
      comandos.caducarVencidos();
    } catch (e) {
      log.error('Watchdog:', e.message);
    }
  }, env.reglas.watchdogIntervaloMs);

  temporizador.unref?.();
  log.info(`Watchdog activo cada ${env.reglas.watchdogIntervaloMs} ms`);
}

const detener = () => clearInterval(temporizador);

module.exports = { iniciar, detener, detectarPuertasTrabadas };
