'use strict';
/**
 * SIMULADOR DE NODO (version Node.js) — el sistema completo sin hardware.
 *
 * Hace de gateway y de nodo a la vez: consulta comandos al backend real,
 * "acciona" el solenoide (espera medio segundo), manda el ACK y reporta el
 * microswitch como si la puerta se hubiera abierto y cerrado de verdad.
 *
 * No necesita instalar NADA: usa el fetch que ya trae Node.
 * (Hay una version equivalente en Python, simulador_nodo.py, para quien
 *  prefiera ese entorno. Las dos hablan el mismo protocolo.)
 *
 * Uso, con el backend corriendo en otra terminal:
 *     node gateway/simulador_nodo.js
 *
 * Opciones:
 *     --trabar A-03        esa puerta nunca cierra -> el watchdog la marca ERROR
 *     --perder 30          descarta el 30% de los comandos, como una red LoRa real
 *     --backend http://192.168.0.10:3000
 */

const API_KEY = 'gw-lora-unraf-2025';   // tiene que coincidir con GATEWAY_API_KEY del .env
const NODO = 'NODO-A';
const INTERVALO_POLL = 2000;            // ms entre consultas, igual que el gateway real
const DEMORA_SOLENOIDE = 500;           // lo que tarda en accionar la cerradura
const MS_PUERTA_ABIERTA = 6000;         // cuanto tarda la persona en cerrar la puerta
const INTERVALO_HEARTBEAT = 30000;

// Mapa bit -> casillero, igual que en el seed. Solo para los mensajes en pantalla.
const CASILLEROS = { 0: 'A-01', 1: 'A-02', 2: 'A-03', 3: 'A-04' };

/* ---------- Argumentos de linea de comandos ---------- */
function leerArgumentos(argv) {
  const opciones = { backend: 'http://localhost:3000', trabar: new Set(), perder: 0 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--backend') opciones.backend = argv[++i];
    else if (argv[i] === '--perder') opciones.perder = Number(argv[++i]) || 0;
    else if (argv[i] === '--trabar') {
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) opciones.trabar.add(argv[++i]);
    }
  }
  opciones.backend = opciones.backend.replace(/\/$/, '');
  return opciones;
}

const opciones = leerArgumentos(process.argv.slice(2));
const puertasAbiertas = new Map();      // bit -> momento en que se abrio
let ultimoHeartbeat = 0;

/* ---------- Helpers ---------- */
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const azar = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/** RSSI verosimil para que el panel muestre algo creible. */
const rssi = () => azar(-95, -60);

const cabeceras = { 'x-api-key': API_KEY, 'Content-Type': 'application/json' };

async function enviar(ruta, cuerpo) {
  try {
    await fetch(opciones.backend + ruta, {
      method: 'POST', headers: cabeceras, body: JSON.stringify(cuerpo),
    });
  } catch (e) {
    console.log(`  ! no pude hablar con el backend: ${e.message}`);
  }
}

/* ---------- El circuito ---------- */
async function procesarComando(comando) {
  const casillero = CASILLEROS[comando.bit] ?? `bit ${comando.bit}`;

  // Perdida de paquetes simulada: el backend va a reintentar solo.
  if (azar(1, 100) <= opciones.perder) {
    console.log(`  ~ comando #${comando.id} (${casillero}) PERDIDO en el aire`);
    return;
  }

  console.log(`  -> comando #${comando.id} ${casillero} · motivo ${comando.motivo ?? '—'}`);

  // 1. El nodo pulsa el bit del SN74HC595 -> MOSFET -> solenoide
  await dormir(DEMORA_SOLENOIDE);

  // 2. ACK: confirma que acciono la cerradura (no que la puerta se abrio)
  await enviar(`/api/gateway/comandos/${comando.id}/ack`, { ok: true, detalle: 'simulador' });
  console.log(`  <- ACK #${comando.id}`);

  // 3. El microswitch detecta que la puerta se abrio
  await enviar('/api/gateway/telemetria', {
    nodo: NODO,
    lecturas: [{ bit: comando.bit, puertaAbierta: true }],
    rssi: rssi(),
  });
  puertasAbiertas.set(comando.bit, Date.now());
  console.log(`  <- microswitch: ${casillero} ABIERTA`);
}

/** Cierra las puertas que llevan abiertas el tiempo de una persona normal. */
async function revisarPuertas() {
  for (const [bit, momento] of [...puertasAbiertas]) {
    const casillero = CASILLEROS[bit] ?? `bit ${bit}`;
    if (opciones.trabar.has(casillero)) continue;   // trabada a proposito
    if (Date.now() - momento < MS_PUERTA_ABIERTA) continue;

    await enviar('/api/gateway/telemetria', {
      nodo: NODO,
      lecturas: [{ bit: Number(bit), puertaAbierta: false }],
      rssi: rssi(),
    });
    puertasAbiertas.delete(bit);
    console.log(`  <- microswitch: ${casillero} cerrada`);
  }
}

async function heartbeat() {
  if (Date.now() - ultimoHeartbeat < INTERVALO_HEARTBEAT) return;
  await enviar('/api/gateway/heartbeat', { nodo: NODO, rssi: rssi(), bateriaMv: azar(3900, 4150) });
  ultimoHeartbeat = Date.now();
}

/* ---------- Bucle principal ---------- */
async function arrancar() {
  console.log(`Simulador de ${NODO} contra ${opciones.backend}`);
  if (opciones.trabar.size) console.log(`  puertas trabadas a proposito: ${[...opciones.trabar].join(', ')}`);
  if (opciones.perder) console.log(`  perdida de paquetes simulada: ${opciones.perder}%`);
  console.log('Ctrl+C para salir.\n');

  for (;;) {
    try {
      const respuesta = await fetch(`${opciones.backend}/api/gateway/comandos`, { headers: cabeceras });
      const datos = await respuesta.json();
      for (const comando of datos.comandos ?? []) await procesarComando(comando);
      await revisarPuertas();
      await heartbeat();
    } catch (e) {
      console.log(`  ! el backend no responde (¿npm start esta corriendo?)`);
    }
    await dormir(INTERVALO_POLL);
  }
}

process.on('SIGINT', () => { console.log('\nSimulador detenido.'); process.exit(0); });

arrancar();
