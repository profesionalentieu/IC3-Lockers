'use strict';
/**
 * Carga y normaliza la configuracion del sistema.
 * Toda la app lee de aca: nunca se usa process.env directo en otro archivo.
 */
require('dotenv').config();

const num = (valor, porDefecto) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : porDefecto;
};

module.exports = {
  puerto: num(process.env.PORT, 3000),

  jwt: {
    secreto: process.env.JWT_SECRET || 'dev-secret-no-usar-en-produccion',
    expiraAlumno: process.env.JWT_EXPIRA_ALUMNO || '2h',
    expiraAdmin: process.env.JWT_EXPIRA_ADMIN || '8h',
  },

  // El gateway LoRa se autentica con una API key fija (header x-api-key)
  gatewayApiKey: process.env.GATEWAY_API_KEY || 'gw-lora-unraf-2025',

  reglas: {
    puertaAbiertaMaxSeg: num(process.env.PUERTA_ABIERTA_MAX_SEG, 120),
    comandoTimeoutSeg: num(process.env.COMANDO_TIMEOUT_SEG, 15),
    comandoMaxIntentos: num(process.env.COMANDO_MAX_INTENTOS, 3),
    nodoOfflineSeg: num(process.env.NODO_OFFLINE_SEG, 180),
    // Minutos que espera una solicitud sin aprobar antes de caducar sola.
    // Mientras espera reserva stock, por eso no puede quedar viva para siempre.
    solicitudCaducaMin: num(process.env.SOLICITUD_CADUCA_MIN, 15),
    // Cada cuanto corre el watchdog que revisa vencimientos y puertas trabadas
    watchdogIntervaloMs: 5000,
  },
};
