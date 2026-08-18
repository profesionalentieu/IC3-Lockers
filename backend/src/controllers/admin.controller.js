'use strict';
/** Endpoints del panel de Alumnado: stock, trazabilidad y padron. */
const casilleros = require('../services/casillero.service');
const inventario = require('../services/inventario.service');
const prestamos = require('../services/prestamo.service');
const usuarios = require('../services/usuario.service');
const comandos = require('../services/comando.service');
const eventos = require('../services/evento.service');

/* ---------- Control de stock ---------- */

/** GET /api/admin/casilleros -> inventario y estado de cada casillero */
const listarCasilleros = (req, res) =>
  res.json({ casilleros: casilleros.listar(), resumen: prestamos.resumen() });

/** GET /api/admin/items -> catalogo de materiales */
const listarItems = (req, res) => res.json({ items: inventario.listarItems() });

/** POST /api/admin/items  { codigo, nombre, categoria, unidad, descripcion } */
function crearItem(req, res, next) {
  try {
    res.status(201).json({ item: inventario.crearItem(req.body || {}) });
  } catch (e) { next(e); }
}

/**
 * PUT /api/admin/casilleros/:id/inventario  { itemId, stockTotal, umbralBajo }
 * Define que material guarda el casillero y cuanto deberia haber adentro.
 */
function configurarInventario(req, res, next) {
  try {
    const casillero = inventario.configurar(Number(req.params.id), req.body || {}, req.usuario.usuario);
    res.json({ casillero });
  } catch (e) { next(e); }
}

/** POST /api/admin/casilleros/:id/reposicion  { delta } -> suma o resta unidades */
function reponer(req, res, next) {
  try {
    const casillero = inventario.reponer(Number(req.params.id), Number(req.body?.delta), req.usuario.usuario);
    res.json({ casillero });
  } catch (e) { next(e); }
}

/* ---------- Cola de aprobacion ---------- */

/** GET /api/admin/solicitudes -> lo que Alumnado tiene que resolver */
const listarSolicitudes = (req, res) =>
  res.json({ solicitudes: prestamos.pendientesDeAprobacion(), resumen: prestamos.resumen() });

/**
 * POST /api/admin/solicitudes/:id/aprobar
 * Recien aca se encola la orden de apertura del casillero.
 */
function aprobarSolicitud(req, res, next) {
  try {
    const resultado = prestamos.aprobar(Number(req.params.id), { actor: req.usuario.usuario });
    res.status(202).json(resultado);
  } catch (e) { next(e); }
}

/** POST /api/admin/solicitudes/:id/rechazar  { motivo? } -> libera la reserva */
function rechazarSolicitud(req, res, next) {
  try {
    const resultado = prestamos.rechazar(Number(req.params.id), {
      actor: req.usuario.usuario,
      motivo: req.body?.motivo || null,
    });
    res.json(resultado);
  } catch (e) { next(e); }
}

/* ---------- Trazabilidad ---------- */

/** GET /api/admin/prestamos?estado=activo|devuelto|todos&buscar=&limite= */
const listarPrestamos = (req, res) =>
  res.json({
    prestamos: prestamos.historial({
      estado: req.query.estado || 'todos',
      buscar: req.query.buscar || '',
      limite: Number(req.query.limite) || 100,
    }),
    resumen: prestamos.resumen(),
  });

/**
 * POST /api/admin/prestamos/:id/devolucion  { cantidad? }
 * Devolucion por mostrador: alguien trajo el material en mano, o se
 * recupero de un prestamo vencido.
 */
function devolucionForzada(req, res, next) {
  try {
    const resultado = prestamos.devolver(Number(req.params.id), {
      cantidad: req.body?.cantidad != null ? Number(req.body.cantidad) : null,
      actor: req.usuario.usuario,
    });
    res.status(202).json(resultado);
  } catch (e) { next(e); }
}

/** GET /api/admin/eventos?limite=30 -> bitacora cruda */
const listarEventos = (req, res) =>
  res.json({ eventos: eventos.ultimos(Number(req.query.limite) || 30) });

/* ---------- Casilleros ---------- */

/** POST /api/admin/casilleros/:id/apertura-emergencia */
function aperturaEmergencia(req, res, next) {
  try {
    const casillero = casilleros.obtener(Number(req.params.id));
    if (!casillero) return res.status(404).json({ error: 'El casillero no existe' });

    const comando = comandos.encolarApertura(casillero.id, {
      origen: 'admin',
      solicitadoPor: req.usuario.usuario,
      motivo: 'EMERGENCIA',
    });
    res.status(202).json({ comandoId: comando.id, estado: comando.estado, casillero });
  } catch (e) { next(e); }
}

/** POST /api/admin/casilleros/:id/reponer-servicio -> saca del estado ERROR */
function reponerServicio(req, res, next) {
  try {
    casilleros.marcarOperativo(Number(req.params.id), true);
    casilleros.notificar(Number(req.params.id));
    res.json({ casillero: casilleros.obtener(Number(req.params.id)) });
  } catch (e) { next(e); }
}

/* ---------- Padron de personas ---------- */

/** GET /api/admin/usuarios?buscar= */
const listarUsuarios = (req, res) =>
  res.json({ usuarios: usuarios.listar(req.query.buscar || '') });

/** POST /api/admin/usuarios  { legajo, nombre, pin, rol } */
function crearUsuario(req, res, next) {
  try {
    res.status(201).json({ usuario: usuarios.crear(req.body || {}) });
  } catch (e) { next(e); }
}

/** POST /api/admin/usuarios/importar  { texto } -> alta masiva pegando una lista */
function importarUsuarios(req, res, next) {
  try {
    res.json(usuarios.importar(req.body?.texto));
  } catch (e) { next(e); }
}

/** PATCH /api/admin/usuarios/:id  { nombre, pin, rol } */
function editarUsuario(req, res, next) {
  try {
    res.json({ usuario: usuarios.actualizar(Number(req.params.id), req.body || {}) });
  } catch (e) { next(e); }
}

/** DELETE /api/admin/usuarios/:id -> baja logica */
function bajaUsuario(req, res, next) {
  try {
    res.json(usuarios.desactivar(Number(req.params.id)));
  } catch (e) { next(e); }
}

module.exports = {
  listarCasilleros, listarItems, crearItem, configurarInventario, reponer,
  listarSolicitudes, aprobarSolicitud, rechazarSolicitud,
  listarPrestamos, devolucionForzada, listarEventos,
  aperturaEmergencia, reponerServicio,
  listarUsuarios, crearUsuario, importarUsuarios, editarUsuario, bajaUsuario,
};
