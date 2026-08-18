'use strict';
/**
 * Carga inicial del panol: 1 nodo, 4 casilleros con material,
 * el catalogo de items, un usuario de Alumnado y personas de prueba.
 *
 *   npm run seed
 */
const bcrypt = require('bcryptjs');
const { db, inicializarEsquema, ahora } = require('../config/database');
const log = require('../utils/logger');

inicializarEsquema();

const cargar = db.transaction(() => {
  // --- Nodo del prototipo (la placa XIAO ESP32S3 del gabinete) ---
  db.prepare(
    `INSERT OR IGNORE INTO nodos (codigo, ubicacion, ultimo_contacto)
     VALUES ('NODO-A', 'Panol - Planta baja', ?)`
  ).run(ahora());
  const nodo = db.prepare(`SELECT id FROM nodos WHERE codigo = 'NODO-A'`).get();

  // --- Catalogo de materiales ---
  const insItem = db.prepare(
    `INSERT OR IGNORE INTO items (codigo, nombre, categoria, unidad, descripcion)
     VALUES (?, ?, ?, ?, ?)`
  );
  [
    ['NB-14', 'Notebook Lenovo 14"', 'Informatica', 'unidad', 'Con cargador. Devolver con bateria cargada.'],
    ['ZAP-5M', 'Zapatilla 5 tomas 5 m', 'Electricidad', 'unidad', 'Alargue con proteccion termica.'],
    ['FIB-PIZ', 'Fibron para pizarra', 'Aula', 'unidad', 'Surtido de colores.'],
    ['KIT-ARD', 'Kit Arduino UNO', 'Electronica', 'kit', 'Placa, protoboard, cables y sensores basicos.'],
  ].forEach((i) => insItem.run(...i));

  const item = (codigo) => db.prepare(`SELECT id FROM items WHERE codigo = ?`).get(codigo).id;

  // --- 4 casilleros: cada uno un bit del SN74HC595 y un tipo de material ---
  const insCasillero = db.prepare(
    `INSERT OR IGNORE INTO casilleros
       (codigo, nodo_id, bit_registro, item_id, stock_total, umbral_bajo, estado_puerta)
     VALUES (?, ?, ?, ?, ?, ?, 'cerrada')`
  );
  [
    ['A-01', 0, item('NB-14'), 25, 5],
    ['A-02', 1, item('ZAP-5M'), 10, 2],
    ['A-03', 2, item('FIB-PIZ'), 50, 10],
    ['A-04', 3, item('KIT-ARD'), 12, 3],
  ].forEach(([codigo, bit, itemId, total, umbral]) =>
    insCasillero.run(codigo, nodo.id, bit, itemId, total, umbral)
  );

  // --- Usuario de Alumnado ---
  db.prepare(
    `INSERT OR IGNORE INTO administrativos (usuario, nombre, password_hash)
     VALUES ('alumnado', 'Mesa de Alumnado', ?)`
  ).run(bcrypt.hashSync('unraf2025', 10));

  // --- Personas de prueba (PIN = ultimos 4 del DNI) ---
  const insUsuario = db.prepare(
    `INSERT OR IGNORE INTO usuarios (legajo, nombre, pin, rol) VALUES (?, ?, ?, ?)`
  );
  [
    ['10234', 'Bertola, Juan', '4821', 'alumno'],
    ['10235', 'Gimenez, Lucia', '7390', 'alumno'],
    ['20011', 'Ing. Sosa, Martin', '1145', 'docente'],
  ].forEach((u) => insUsuario.run(...u));
});

cargar();

log.info('Panol cargado:');
log.info('  Alumnado -> usuario: alumnado / clave: unraf2025');
log.info('  Alumno   -> legajo: 10234 / PIN: 4821   (hasta 5 unidades, 24 h)');
log.info('  Docente  -> legajo: 20011 / PIN: 1145   (hasta 25 unidades, 7 dias)');
log.info('  A-01 25 notebooks | A-02 10 zapatillas | A-03 50 fibrones | A-04 12 kits Arduino');
