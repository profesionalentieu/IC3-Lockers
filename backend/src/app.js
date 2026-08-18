'use strict';
/** Configuracion de la aplicacion Express (sin levantar el servidor). */
const path = require('path');
const express = require('express');
const cors = require('cors');
const rutas = require('./routes');
const { noEncontrado, manejadorErrores } = require('./middleware/errorHandler');

const app = express();

app.use(cors());                       // el prototipo sirve los frontends del mismo origen
app.use(express.json({ limit: '64kb' }));

// Los dos frontends se sirven como estaticos desde el mismo backend:
//   http://<ip>:3000/admin       -> panel de Alumnado
//   http://<ip>:3000/            -> webapp de alumnos y docentes (raiz, la mas usada)
const FRONTEND = path.join(__dirname, '..', '..', 'frontend');
app.use('/admin', express.static(path.join(FRONTEND, 'admin')));
app.use('/shared', express.static(path.join(FRONTEND, 'shared')));
app.use('/', express.static(path.join(FRONTEND, 'usuario')));

app.use('/api', rutas);

app.use(noEncontrado);
app.use(manejadorErrores);

module.exports = app;
