'use strict';
/**
 * Conexion unica a SQLite (patron singleton).
 *
 * Usa el modulo SQLite que viene INCLUIDO en Node (`node:sqlite`), asi el
 * proyecto no tiene ninguna dependencia nativa que compilar: `npm install`
 * no puede fallar por falta de compilador ni por incompatibilidad de version.
 *
 * Si Node es viejo y no lo trae, cae automaticamente en better-sqlite3.
 * Las dos alternativas se exponen con la MISMA interfaz (`prepare`, `exec`,
 * `transaction`), asi que ningun otro archivo del proyecto se entera de cual
 * de las dos esta usando.
 */
const path = require('path');
const fs = require('fs');

const RUTA_DB = path.join(__dirname, '..', '..', 'data', 'lockers.db');
const RUTA_SCHEMA = path.join(__dirname, '..', 'db', 'schema.sql');

// La carpeta data/ no se versiona; se crea al vuelo.
fs.mkdirSync(path.dirname(RUTA_DB), { recursive: true });

/* ============================================================
   Adaptador sobre node:sqlite
   ============================================================ */

/**
 * node:sqlite solo acepta null, number, bigint, string y Uint8Array como
 * parametros. better-sqlite3 tambien rechaza booleanos y undefined, asi que
 * normalizamos en un solo lugar en vez de en cada llamada.
 */
const normalizar = (valor) => {
  if (valor === undefined) return null;
  if (typeof valor === 'boolean') return valor ? 1 : 0;
  return valor;
};

function adaptarNodeSqlite(DatabaseSync) {
  const conexion = new DatabaseSync(RUTA_DB);

  // WAL mejora la concurrencia entre las peticiones web y el polling del gateway.
  conexion.exec('PRAGMA journal_mode = WAL');
  conexion.exec('PRAGMA foreign_keys = ON');

  // Profundidad de transacciones: si un servicio que ya esta dentro de una
  // transaccion llama a otro que tambien abre una, la interna se suma a la
  // externa en vez de intentar un BEGIN anidado (que SQLite rechaza).
  let profundidad = 0;

  return {
    motor: 'node:sqlite',

    prepare(sql) {
      const sentencia = conexion.prepare(sql);
      return {
        get: (...p) => sentencia.get(...p.map(normalizar)),
        all: (...p) => sentencia.all(...p.map(normalizar)),
        run: (...p) => {
          const resultado = sentencia.run(...p.map(normalizar));
          return {
            changes: Number(resultado.changes),
            lastInsertRowid: Number(resultado.lastInsertRowid),
          };
        },
      };
    },

    exec: (sql) => conexion.exec(sql),

    /** Misma firma que better-sqlite3: devuelve una funcion envuelta. */
    transaction(fn) {
      return (...args) => {
        if (profundidad > 0) return fn(...args);   // ya hay una transaccion abierta
        conexion.exec('BEGIN');
        profundidad++;
        try {
          const resultado = fn(...args);
          conexion.exec('COMMIT');
          return resultado;
        } catch (error) {
          conexion.exec('ROLLBACK');
          throw error;
        } finally {
          profundidad--;
        }
      };
    },

    close: () => conexion.close(),
  };
}

/* ============================================================
   Eleccion del motor
   ============================================================ */
function abrirBase() {
  try {
    const { DatabaseSync } = require('node:sqlite');
    return adaptarNodeSqlite(DatabaseSync);
  } catch {
    // Node sin soporte de SQLite integrado: usamos la libreria externa.
    const Database = require('better-sqlite3');
    const conexion = new Database(RUTA_DB);
    conexion.pragma('journal_mode = WAL');
    conexion.pragma('foreign_keys = ON');
    conexion.motor = 'better-sqlite3';
    return conexion;
  }
}

const db = abrirBase();

/**
 * Version del esquema. SUBIR ESTE NUMERO cada vez que se cambie schema.sql
 * de forma incompatible (columnas nuevas, tablas renombradas, etc).
 *
 * Existe porque `CREATE TABLE IF NOT EXISTS` no modifica una tabla que ya
 * existe: si la base es de una version anterior, el arranque falla mas tarde
 * con un error crudo de SQL ("no such column: X") que no dice que hacer.
 * Preferimos detectarlo aca y decirlo en castellano.
 */
const VERSION_ESQUEMA = 3;

/** Crea las tablas si no existen. Idempotente. */
function inicializarEsquema() {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  const tablas = db
    .prepare(`SELECT COUNT(*) AS n FROM sqlite_master
              WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .get().n;

  if (tablas > 0 && version !== VERSION_ESQUEMA) {
    const error = new Error(
      `La base de datos es de una version anterior del sistema ` +
      `(esquema v${version || 1}, el codigo espera v${VERSION_ESQUEMA}).\n\n` +
      `Este prototipo no migra datos: hay que borrar la base y volver a sembrarla.\n\n` +
      `  Windows:    Remove-Item -Recurse -Force data\n` +
      `  Mac/Linux:  rm -rf data\n\n` +
      `Y despues:    npm run seed\n\n` +
      `(Se pierden los prestamos cargados. Son datos de prueba.)`
    );
    error.codigo = 500;
    throw error;
  }

  db.exec(fs.readFileSync(RUTA_SCHEMA, 'utf8'));
  db.exec(`PRAGMA user_version = ${VERSION_ESQUEMA}`);
}

/** Helper: fecha actual en ISO-8601 UTC (formato unico en toda la app). */
const ahora = () => new Date().toISOString();

module.exports = { db, inicializarEsquema, ahora, RUTA_DB };
