'use strict';
/**
 * Catalogo de items y carga de inventario en los casilleros.
 * Lo usa unicamente el panel de Alumnado.
 */
const { db } = require('../config/database');
const { ErrorNegocio } = require('../utils/errores');
const casilleros = require('./casillero.service');
const eventos = require('./evento.service');

/* ---------- Items ---------- */

const listarItems = () =>
  db.prepare(`SELECT * FROM items WHERE activo = 1 ORDER BY categoria, nombre`).all();

function crearItem({ codigo, nombre, categoria, unidad, descripcion }) {
  const datos = {
    codigo: String(codigo ?? '').trim().toUpperCase(),
    nombre: String(nombre ?? '').trim(),
    categoria: String(categoria ?? 'General').trim(),
    unidad: String(unidad ?? 'unidad').trim(),
    descripcion: String(descripcion ?? '').trim() || null,
  };
  if (!datos.codigo) throw new ErrorNegocio('Cargá un codigo para el item', 400);
  if (datos.nombre.length < 2) throw new ErrorNegocio('Cargá el nombre del item', 400);

  const existe = db.prepare(`SELECT id FROM items WHERE codigo = ?`).get(datos.codigo);
  if (existe) throw new ErrorNegocio(`Ya existe un item con el codigo ${datos.codigo}`, 409);

  const info = db
    .prepare(
      `INSERT INTO items (codigo, nombre, categoria, unidad, descripcion, activo)
       VALUES (?, ?, ?, ?, ?, 1)`
    )
    .run(datos.codigo, datos.nombre, datos.categoria, datos.unidad, datos.descripcion);
  return { id: info.lastInsertRowid, ...datos };
}

/* ---------- Inventario de un casillero ---------- */

/**
 * Asigna que material guarda un casillero y cuanto deberia haber adentro.
 *
 * No se permite bajar el stock total por debajo de lo que ya esta prestado:
 * eso dejaria el disponible en negativo, o peor, ocultaria unidades que estan
 * afuera. Si Alumnado necesita corregir eso, primero cierra los prestamos.
 */
function configurar(casilleroId, { itemId, stockTotal, umbralBajo = 0 }, actor) {
  const casillero = casilleros.obtener(casilleroId);
  if (!casillero) throw new ErrorNegocio('El casillero no existe', 404);

  const total = Number(stockTotal);
  if (!Number.isInteger(total) || total < 0)
    throw new ErrorNegocio('El stock total tiene que ser un entero mayor o igual a cero', 400);

  if (total < casillero.inventario.prestado)
    throw new ErrorNegocio(
      `Hay ${casillero.inventario.prestado} unidades prestadas: el total no puede ser menor`,
      409
    );

  const item = db.prepare(`SELECT * FROM items WHERE id = ? AND activo = 1`).get(itemId);
  if (!item) throw new ErrorNegocio('El item no existe', 404);

  // Cambiar el item con material afuera romperia la trazabilidad del historico.
  if (casillero.item && casillero.item.id !== item.id && casillero.inventario.prestado > 0)
    throw new ErrorNegocio(
      'No se puede cambiar el material mientras haya prestamos activos de este casillero',
      409
    );

  db.prepare(`UPDATE casilleros SET item_id = ?, stock_total = ?, umbral_bajo = ? WHERE id = ?`)
    .run(item.id, total, Number(umbralBajo) || 0, casilleroId);

  eventos.registrar(eventos.TIPOS.INVENTARIO_ACTUALIZADO, {
    casilleroId,
    actor,
    detalle: `${item.nombre}: total ${total}`,
  });

  casilleros.notificar(casilleroId);
  return casilleros.obtener(casilleroId);
}

/**
 * Reposicion: suma (o descuenta) unidades al total.
 * Es el atajo del uso diario, cuando llegan 10 fibrones nuevos y nadie
 * quiere recalcular el total a mano.
 */
function reponer(casilleroId, delta, actor) {
  const casillero = casilleros.obtener(casilleroId);
  if (!casillero) throw new ErrorNegocio('El casillero no existe', 404);
  if (!casillero.item) throw new ErrorNegocio('Primero asigná un material al casillero', 409);

  const cambio = Number(delta);
  if (!Number.isInteger(cambio) || cambio === 0)
    throw new ErrorNegocio('Indicá cuantas unidades sumar o restar', 400);

  return configurar(
    casilleroId,
    {
      itemId: casillero.item.id,
      stockTotal: casillero.inventario.total + cambio,
      umbralBajo: casillero.inventario.umbralBajo,
    },
    actor
  );
}

module.exports = { listarItems, crearItem, configurar, reponer };
