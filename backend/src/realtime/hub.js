'use strict';
/**
 * Hub de tiempo real (WebSocket).
 *
 * Dos tipos de cliente se conectan aca:
 *   - Los navegadores (panel de Alumnado y WebApp de usuarios) -> reciben eventos.
 *   - El Gateway LoRa (opcional) -> recibe los comandos apenas se crean,
 *     sin esperar al proximo poll. Ver gateway/gateway_lora.py.
 *
 * El hub NO tiene logica de negocio: solo reparte mensajes.
 */
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const log = require('../utils/logger');

let wss = null;

/** Mensaje estandar: { evento: 'casillero.actualizado', datos: {...}, ts } */
function armarMensaje(evento, datos) {
  return JSON.stringify({ evento, datos, ts: new Date().toISOString() });
}

/**
 * Inicializa el servidor WebSocket sobre el mismo puerto HTTP.
 * Autenticacion por query string:
 *   ws://host/ws?token=<jwt>        -> panel o usuario
 *   ws://host/ws?apiKey=<gatewayKey> -> gateway LoRa
 */
function iniciar(servidorHttp) {
  wss = new WebSocketServer({ server: servidorHttp, path: '/ws' });

  wss.on('connection', (socket, req) => {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const apiKey = url.searchParams.get('apiKey');

    if (apiKey && apiKey === env.gatewayApiKey) {
      socket.rol = 'gateway';
    } else if (token) {
      try {
        const payload = jwt.verify(token, env.jwt.secreto);
        socket.rol = payload.rol;          // 'admin' | 'usuario'
        socket.legajo = payload.legajo || null;
      } catch {
        socket.close(4001, 'Token invalido');
        return;
      }
    } else {
      socket.close(4001, 'Falta credencial');
      return;
    }

    log.info(`WS conectado (${socket.rol})`);
    socket.send(armarMensaje('conexion.ok', { rol: socket.rol }));

    socket.on('close', () => log.info(`WS desconectado (${socket.rol})`));
    socket.on('error', (e) => log.aviso('WS error:', e.message));
  });

  log.info('WebSocket escuchando en /ws');
}

/**
 * Emite un evento a los clientes cuyo rol este en `roles`.
 * @param {string} evento  nombre del evento
 * @param {object} datos   payload
 * @param {string[]} roles roles destinatarios
 */
function emitir(evento, datos, roles = ['admin', 'usuario', 'gateway']) {
  if (!wss) return;
  const mensaje = armarMensaje(evento, datos);
  for (const socket of wss.clients) {
    if (socket.readyState === socket.OPEN && roles.includes(socket.rol)) {
      socket.send(mensaje);
    }
  }
}

/**
 * Emite solo a los sockets de UNA persona (por legajo).
 * Se usa para avisarle "te aprobaron el pedido" sin que el mensaje le llegue
 * a todos los usuarios conectados.
 */
function emitirA(legajo, evento, datos) {
  if (!wss || !legajo) return;
  const mensaje = armarMensaje(evento, datos);
  for (const socket of wss.clients) {
    if (socket.readyState === socket.OPEN && socket.rol === 'usuario' && socket.legajo === legajo) {
      socket.send(mensaje);
    }
  }
}

module.exports = { iniciar, emitir, emitirA };
