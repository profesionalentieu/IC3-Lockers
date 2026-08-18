'use strict';
/**
 * Manejador central de errores.
 * Los servicios lanzan ErrorNegocio con un codigo HTTP; cualquier otra
 * excepcion se reporta como 500 y se loguea completa para debug.
 */
const log = require('../utils/logger');

function noEncontrado(req, res) {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
function manejadorErrores(err, req, res, _next) {
  const codigo = err.codigo || 500;
  if (codigo >= 500) log.error(err.stack || err.message);
  res.status(codigo).json({ error: err.message || 'Error interno del servidor' });
}

module.exports = { noEncontrado, manejadorErrores };
