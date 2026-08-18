'use strict';
/**
 * Autenticacion. Hay tres identidades distintas en el sistema:
 *
 *   admin   -> personal de Alumnado. JWT con rol 'admin'.
 *   alumno  -> estudiante. JWT con rol 'alumno' + legajo.
 *   gateway -> el Raspberry/PC que habla LoRa. API key fija en header.
 *
 * La separacion importa: un token de alumno solo puede abrir SU casillero,
 * y eso se valida en el controlador, no en el frontend.
 */
const jwt = require('jsonwebtoken');
const env = require('../config/env');

function firmarToken(payload, expiracion) {
  return jwt.sign(payload, env.jwt.secreto, { expiresIn: expiracion });
}

/** Extrae y verifica el Bearer token. */
function verificarToken(req) {
  const cabecera = req.headers.authorization || '';
  if (!cabecera.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(cabecera.slice(7), env.jwt.secreto);
  } catch {
    return null;
  }
}

/** Exige un JWT con alguno de los roles indicados. */
const requiereRol = (...roles) => (req, res, next) => {
  const payload = verificarToken(req);
  if (!payload) return res.status(401).json({ error: 'Token ausente o invalido' });
  if (!roles.includes(payload.rol))
    return res.status(403).json({ error: 'No tenes permiso para esta operacion' });
  req.usuario = payload;
  next();
};

/** Exige la API key del gateway LoRa. */
const requiereGateway = (req, res, next) => {
  const clave = req.headers['x-api-key'];
  if (clave !== env.gatewayApiKey)
    return res.status(401).json({ error: 'API key del gateway invalida' });
  next();
};

module.exports = { firmarToken, requiereRol, requiereGateway };
