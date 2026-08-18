'use strict';
const bcrypt = require('bcryptjs');
const { db } = require('../config/database');
const env = require('../config/env');
const { firmarToken } = require('../middleware/auth');
const prestamos = require('../services/prestamo.service');

/** POST /api/auth/admin/login  { usuario, password } */
function loginAdmin(req, res) {
  const { usuario, password } = req.body || {};
  if (!usuario || !password)
    return res.status(400).json({ error: 'Ingresa usuario y contrasena' });

  const admin = db
    .prepare(`SELECT * FROM administrativos WHERE usuario = ? AND activo = 1`)
    .get(String(usuario).trim());

  // Mensaje generico a proposito: no revelamos si el usuario existe.
  if (!admin || !bcrypt.compareSync(password, admin.password_hash))
    return res.status(401).json({ error: 'Usuario o contrasena incorrectos' });

  res.json({
    token: firmarToken(
      { rol: 'admin', usuario: admin.usuario, nombre: admin.nombre },
      env.jwt.expiraAdmin
    ),
    usuario: { usuario: admin.usuario, nombre: admin.nombre },
  });
}

/**
 * POST /api/auth/usuario/login  { legajo, pin }
 * Sirve para alumnos y docentes: el rol viaja dentro del token porque
 * define cuantas unidades puede retirar y por cuanto tiempo.
 */
function loginUsuario(req, res) {
  const { legajo, pin } = req.body || {};
  if (!legajo || !pin)
    return res.status(400).json({ error: 'Ingresa tu legajo y tu PIN' });

  const persona = prestamos.buscarUsuarioPorLegajo(legajo);
  if (!persona || persona.pin !== String(pin).trim())
    return res.status(401).json({ error: 'Legajo o PIN incorrectos' });

  res.json({
    token: firmarToken(
      { rol: 'usuario', rolUsuario: persona.rol, legajo: persona.legajo, nombre: persona.nombre },
      env.jwt.expiraAlumno
    ),
    usuario: { legajo: persona.legajo, nombre: persona.nombre, rol: persona.rol },
  });
}

module.exports = { loginAdmin, loginUsuario };
