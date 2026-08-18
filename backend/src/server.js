'use strict';
/**
 * Punto de entrada. Levanta HTTP + WebSocket sobre el mismo puerto
 * y arranca el watchdog.
 */
const http = require('http');
const app = require('./app');
const env = require('./config/env');
const log = require('./utils/logger');
const { inicializarEsquema, RUTA_DB } = require('./config/database');
const hub = require('./realtime/hub');
const watchdog = require('./services/watchdog.service');

inicializarEsquema();
log.info(`Base SQLite lista: ${RUTA_DB}`);

const servidor = http.createServer(app);
hub.iniciar(servidor);
watchdog.iniciar();

servidor.listen(env.puerto, () => {
  log.info(`API      -> http://localhost:${env.puerto}/api`);
  log.info(`Alumnado -> http://localhost:${env.puerto}/admin`);
  log.info(`Alumnos  -> http://localhost:${env.puerto}/`);
});

// Cierre ordenado (util cuando se prueba junto al gateway).
for (const senal of ['SIGINT', 'SIGTERM']) {
  process.on(senal, () => {
    log.info('Cerrando servidor...');
    watchdog.detener();
    servidor.close(() => process.exit(0));
  });
}
