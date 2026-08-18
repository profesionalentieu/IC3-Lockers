'use strict';
/**
 * =====================================================================
 *  MAPA DE LA API v2 - Panol inteligente UNRaf
 * =====================================================================
 *
 *  PUBLICO
 *  POST   /api/auth/admin/login             { usuario, password }         -> { token }
 *  POST   /api/auth/usuario/login           { legajo, pin }               -> { token }
 *  GET    /api/salud                                                       -> { ok, version }
 *
 *  USUARIOS: alumnos y docentes  (Bearer JWT rol=usuario)
 *  GET    /api/usuario/catalogo                                            -> { items[], limitePorRetiro }
 *  POST   /api/usuario/prestamos            { casilleroId, cantidad }      -> 202 { prestamo } (pendiente)
 *  GET    /api/usuario/prestamos                                           -> { pendientes[], activos[], historial[] }
 *  GET    /api/usuario/prestamos/:id                                       -> { prestamo }
 *  POST   /api/usuario/prestamos/:id/devolucion  { cantidad? }             -> 202 { prestamo, comandoId }
 *  GET    /api/usuario/comandos/:id                                        -> { estado }
 *
 *  PANEL DE ALUMNADO  (Bearer JWT rol=admin)
 *  GET    /api/admin/casilleros                                            -> { casilleros[], resumen }
 *  GET    /api/admin/items                                                 -> { items[] }
 *  POST   /api/admin/items                  { codigo, nombre, ... }        -> 201 { item }
 *  PUT    /api/admin/casilleros/:id/inventario  { itemId, stockTotal, umbralBajo }
 *  POST   /api/admin/casilleros/:id/reposicion  { delta }                  -> { casillero }
 *  POST   /api/admin/casilleros/:id/apertura-emergencia                    -> 202 { comandoId }
 *  POST   /api/admin/casilleros/:id/reponer-servicio                       -> { casillero }
 *  GET    /api/admin/solicitudes                                           -> { solicitudes[], resumen }
 *  POST   /api/admin/solicitudes/:id/aprobar                               -> 202 { prestamo, comandoId }
 *  POST   /api/admin/solicitudes/:id/rechazar   { motivo? }                -> { prestamo }
 *  GET    /api/admin/prestamos?estado=&buscar=&limite=                     -> { prestamos[], resumen }
 *  POST   /api/admin/prestamos/:id/devolucion   { cantidad? }              -> 202
 *  GET    /api/admin/eventos?limite=30                                     -> { eventos[] }
 *  GET    /api/admin/usuarios?buscar=                                      -> { usuarios[] }
 *  POST   /api/admin/usuarios               { legajo, nombre, pin, rol }   -> 201 { usuario }
 *  POST   /api/admin/usuarios/importar      { texto }                      -> { creados, errores[] }
 *  PATCH  /api/admin/usuarios/:id           { nombre, pin, rol }           -> { usuario }
 *  DELETE /api/admin/usuarios/:id                                          -> baja logica
 *
 *  GATEWAY LORA  (header x-api-key)
 *  GET    /api/gateway/comandos?limite=10                                  -> { comandos[] }
 *  POST   /api/gateway/comandos/:id/ack     { ok, detalle }                -> { estado }
 *  POST   /api/gateway/telemetria           { nodo, lecturas[], rssi }     -> { actualizados }
 *  POST   /api/gateway/heartbeat            { nodo, rssi, bateriaMv }      -> { ok }
 *
 *  TIEMPO REAL
 *  WS     /ws?token=<jwt>    navegadores   (casillero.actualizado,
 *  WS     /ws?apiKey=<key>   gateway        comando.nuevo, comando.actualizado)
 *
 *  NOTA 1: un retiro y una devolucion generan el MISMO comando fisico (ABRIR).
 *  Lo unico que cambia es el campo 'motivo', que solo existe para la bitacora.
 *
 *  NOTA 2: POST /usuario/prestamos NO abre nada. Solo crea una solicitud
 *  'pendiente' que reserva stock. El comando de apertura nace unicamente en
 *  POST /admin/solicitudes/:id/aprobar.
 * =====================================================================
 */
const express = require('express');
const { requiereRol, requiereGateway } = require('../middleware/auth');
const auth = require('../controllers/auth.controller');
const admin = require('../controllers/admin.controller');
const usuario = require('../controllers/usuario.controller');
const gateway = require('../controllers/gateway.controller');

const router = express.Router();

// ---------- Publico ----------
router.get('/salud', (req, res) => res.json({ ok: true, version: '2.0.0' }));
router.post('/auth/admin/login', auth.loginAdmin);
router.post('/auth/usuario/login', auth.loginUsuario);

// ---------- Alumnos y docentes ----------
const soloUsuario = requiereRol('usuario');
router.get('/usuario/catalogo', soloUsuario, usuario.catalogo);
router.get('/usuario/prestamos', soloUsuario, usuario.misPrestamos);
router.post('/usuario/prestamos', soloUsuario, usuario.solicitar);
router.get('/usuario/prestamos/:id', soloUsuario, usuario.estadoPrestamo);
router.post('/usuario/prestamos/:id/devolucion', soloUsuario, usuario.devolver);
router.get('/usuario/comandos/:id', soloUsuario, usuario.estadoComando);

// ---------- Panel de Alumnado ----------
const soloAdmin = requiereRol('admin');
router.get('/admin/casilleros', soloAdmin, admin.listarCasilleros);
router.get('/admin/items', soloAdmin, admin.listarItems);
router.post('/admin/items', soloAdmin, admin.crearItem);
router.put('/admin/casilleros/:id/inventario', soloAdmin, admin.configurarInventario);
router.post('/admin/casilleros/:id/reposicion', soloAdmin, admin.reponer);
router.post('/admin/casilleros/:id/apertura-emergencia', soloAdmin, admin.aperturaEmergencia);
router.post('/admin/casilleros/:id/reponer-servicio', soloAdmin, admin.reponerServicio);
router.get('/admin/solicitudes', soloAdmin, admin.listarSolicitudes);
router.post('/admin/solicitudes/:id/aprobar', soloAdmin, admin.aprobarSolicitud);
router.post('/admin/solicitudes/:id/rechazar', soloAdmin, admin.rechazarSolicitud);
router.get('/admin/prestamos', soloAdmin, admin.listarPrestamos);
router.post('/admin/prestamos/:id/devolucion', soloAdmin, admin.devolucionForzada);
router.get('/admin/eventos', soloAdmin, admin.listarEventos);
router.get('/admin/usuarios', soloAdmin, admin.listarUsuarios);
router.post('/admin/usuarios', soloAdmin, admin.crearUsuario);
router.post('/admin/usuarios/importar', soloAdmin, admin.importarUsuarios);
router.patch('/admin/usuarios/:id', soloAdmin, admin.editarUsuario);
router.delete('/admin/usuarios/:id', soloAdmin, admin.bajaUsuario);

// ---------- Gateway LoRa ----------
router.get('/gateway/comandos', requiereGateway, gateway.obtenerComandos);
router.post('/gateway/comandos/:id/ack', requiereGateway, gateway.confirmarComando);
router.post('/gateway/telemetria', requiereGateway, gateway.recibirTelemetria);
router.post('/gateway/heartbeat', requiereGateway, gateway.heartbeat);

module.exports = router;
