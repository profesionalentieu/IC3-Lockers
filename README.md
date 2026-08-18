# Pañol inteligente — UNRaf

Plataforma web para administrar el material compartido de la universidad: catálogo, stock por
casillero, préstamos con trazabilidad y apertura remota sin llaves.
Prototipo de 4 casilleros para **Ingeniería en Computación 3**, Universidad Nacional de Rafaela.

> **v2** — La v1 prestaba casilleros vacíos a personas. Ahora los casilleros guardan material y
> lo que se presta es el ítem. Ver `MODELO-DE-DATOS.md` para el modelo completo y las decisiones.

---

## 1. Arquitectura de carpetas

```
lockers-unraf/
├── backend/                       API REST + WebSocket + SQLite
│   ├── src/
│   │   ├── server.js              punto de entrada (HTTP + WS + watchdog)
│   │   ├── app.js                 Express: API + los dos frontends como estáticos
│   │   ├── config/
│   │   │   ├── env.js             toda la configuración, en un solo lugar
│   │   │   └── database.js        conexión SQLite (singleton)
│   │   ├── db/
│   │   │   ├── schema.sql         esquema v2, comentado
│   │   │   └── seed.js            nodo, catálogo, inventario inicial y personas de prueba
│   │   ├── middleware/
│   │   │   ├── auth.js            JWT (admin / usuario) + API key (gateway)
│   │   │   └── errorHandler.js
│   │   ├── routes/index.js        mapa completo de la API, documentado arriba del archivo
│   │   ├── controllers/           auth · admin · usuario · gateway
│   │   ├── services/              lógica de negocio (sin Express adentro)
│   │   │   ├── casillero.service.js    estado e inventario DERIVADOS
│   │   │   ├── prestamo.service.js     retiro, devolución, trazabilidad
│   │   │   ├── inventario.service.js   catálogo de ítems y carga de stock
│   │   │   ├── usuario.service.js      padrón de alumnos y docentes
│   │   │   ├── comando.service.js      cola de órdenes hacia LoRa
│   │   │   ├── telemetria.service.js   lecturas de los microswitches
│   │   │   ├── evento.service.js       bitácora de auditoría
│   │   │   └── watchdog.service.js     préstamos vencidos, puertas trabadas, reintentos
│   │   ├── realtime/hub.js        WebSocket: empuja cambios a navegadores y gateway
│   │   └── utils/                 logger · errores de negocio
│   ├── data/                      la base .db se crea acá (no versionar)
│   └── package.json
├── frontend/
│   ├── admin/index.html           Panel de Alumnado (stock · movimientos · personas)
│   └── usuario/index.html         WebApp de alumnos y docentes (catálogo · mis préstamos)
├── gateway/
│   ├── gateway_lora.py            puente serie ↔ HTTP/WS entre backend y red LoRa
│   ├── simulador_nodo.js          hace de gateway Y de nodo: sistema completo sin hardware
│   └── simulador_nodo.py          lo mismo, para quien prefiera Python
├── firmware/
│   ├── PROTOCOLO.md               contrato de tramas firmware ↔ servidor
│   ├── nodo/nodo.ino              XIAO del gabinete: LoRa + SN74HC595 + microswitches
│   └── gateway/gateway.ino        XIAO puente: serie ↔ LoRa
├── ARRANCAR-HOY.md                paso a paso detallado para dejarlo funcionando hoy
├── PUESTA-EN-MARCHA.md            plan por etapas, de la demo al sistema real
└── MODELO-DE-DATOS.md             entidades, relaciones, JSON y decisiones de diseño
```

Los frontends son **un archivo cada uno**, sin build ni CDN: el pañol puede no tener buena señal,
y una interfaz que depende de descargar Tailwind falla justo cuando más se la necesita.

---

## 2. Puesta en marcha

Requiere **Node 22.5 o superior**. El proyecto no tiene dependencias nativas: usa el SQLite
incluido en Node (`node:sqlite`), así que `npm install` no puede fallar por falta de compilador.
En Node más viejo cae solo en `better-sqlite3`, que es dependencia opcional.

```bash
cd backend
cp .env.example .env          # cambiá JWT_SECRET y GATEWAY_API_KEY
npm install                   # en PowerShell: npm.cmd install
rm -rf data                   # el esquema cambió: hay que rehacer la base
npm run seed
npm start
```

| URL | Para quién |
|---|---|
| `http://localhost:3000/` | WebApp de alumnos y docentes |
| `http://localhost:3000/admin` | Panel de Alumnado |
| `http://localhost:3000/api` | API REST |

Credenciales de prueba:

| Quién | Acceso | Puede |
|---|---|---|
| Alumnado | `alumnado` / `unraf2025` | todo |
| Alumno | legajo `10234` / PIN `4821` | 5 unidades por retiro, 24 h |
| Docente | legajo `20011` / PIN `1145` | 25 unidades por retiro, 7 días |

Inventario inicial: A-01 → 25 notebooks · A-02 → 10 zapatillas · A-03 → 50 fibrones · A-04 → 12 kits Arduino.

Gateway:

```bash
pip install requests pyserial websocket-client
python gateway/gateway_lora.py --puerto /dev/ttyACM0 --backend http://192.168.0.10:3000
```

> Los dos HTML funcionan abriéndolos con doble clic: si no encuentran el backend entran en
> **modo demo** con datos simulados, incluido el descuento de stock al retirar.

**Para probar el circuito completo sin hardware**, con el backend corriendo, en otra terminal:

```bash
node gateway/simulador_nodo.js
```

Hace de gateway y de nodo: toma los comandos, manda el ACK y reporta el microswitch. En el panel
vas a ver el casillero abrirse y cerrarse solo. Con `--trabar A-03` o `--perder 30` se ensayan los
escenarios de falla. El paso a paso completo está en **`PUESTA-EN-MARCHA.md`**.

---

## 3. Los circuitos

**Retiro, en dos etapas.** El usuario abre el catálogo, elige la cantidad y toca *Solicitar
material*. El servidor valida el stock, registra la solicitud como **pendiente** y **reserva** esas
unidades, pero **no abre nada**: el pedido queda en la cola de Alumnado.

En el panel aparece al instante (por WebSocket, con un aviso sonoro) con dos botones:
*Aprobar y abrir* o *Rechazar*. Recién al aprobar se encola la orden de apertura hacia el
casillero, y la app del estudiante —que estaba en "En revisión"— pasa sola a "Abriendo". Si lo
rechazan, le llega el motivo y la reserva se libera.

Una solicitud que nadie resuelve **caduca a los 15 minutos** y libera el stock. Sin eso, un
pedido olvidado bloquearía material para siempre.

**Devolución, en una sola etapa.** En *Mis préstamos* cada préstamo activo tiene su botón
*Devolver material*. Al tocarlo el préstamo se cierra, el stock vuelve a sumar y el casillero se
abre para guardar. Se admite devolución parcial (retiró 5, trae 3): el préstamo queda activo por
las 2 restantes.

La devolución **no requiere aprobación**, a propósito: trabar la devolución solo lograría que la
gente se quede con el material. Lo que hay que controlar es la salida, no la vuelta.

**Control de stock.** La cola de aprobación va arriba de todo, porque es lo que hay que resolver
ahora: los pedidos que esperan más de 5 minutos se marcan en rojo, porque hay alguien parado
frente al casillero. Más abajo, Alumnado ve las cuatro puertas con su medidor de disponible /
prestado / reservado (el reservado va rayado),
carga qué material guarda cada casillero y repone unidades. La solapa *Movimientos* es la
trazabilidad completa: quién pidió, qué, cuánto, cuándo lo retiró y cuándo lo devolvió, con
filtro por estado y búsqueda por legajo, nombre o material, incluida la columna de quién aprobó
cada movimiento.

**Padrón.** La solapa *Personas* da de alta alumnos y docentes de a uno o pegando una lista
(`legajo, nombre, PIN, rol` por línea). Las bajas son lógicas: se conserva el historial.

### Los cuatro estados del casillero

| Estado | De dónde sale |
|---|---|
| `ERROR` | el watchdog: puerta abierta más de 120 s, o comando sin ACK tras 3 intentos |
| `PUERTA_ABIERTA` | el microswitch reportó apertura |
| `SIN_STOCK` | el disponible llegó a 0 (contando lo reservado por solicitudes pendientes) |
| `DISPONIBLE` | ninguna de las anteriores |

### El ciclo de vida de un préstamo

```
                    ┌──────────► rechazado   (Alumnado lo deniega, libera la reserva)
                    │
solicitud ──► pendiente ──► activo ──► devuelto
   (reserva stock) │        (aprobado,
                   │         abre la puerta)
                   └──────────► caducado    (nadie lo aprobó en 15 min, libera la reserva)
```

Ni el estado ni el stock se guardan en una columna: se derivan en cada consulta. El detalle y el
porqué están en `MODELO-DE-DATOS.md`.

---

## 4. Cómo conversan el backend y el gateway LoRa

**Polling HTTP cada 2 s como camino principal, WebSocket como acelerador.** Los dos están
implementados en `gateway_lora.py`; el WS se puede apagar y el sistema sigue funcionando, solo
más lento.

LoRa no es un canal de request/response: es half-duplex, lento y sin entrega garantizada. Si la
petición HTTP del usuario esperara el ACK de la cerradura, se colgaría cada vez que se pierde una
trama. Por eso el backend **nunca abre un casillero: encola una orden**.

```
Usuario toca "Solicitar material" (o "Devolver material")
   │
   ├── el préstamo se registra en la base       → responde 202 al instante
   ├── se encola el comando ABRIR                 (motivo: RETIRO | DEVOLUCION)
   │        ├── push por WS al gateway (camino rápido)
   │        └── o el gateway lo levanta en el próximo poll (≤ 2 s)
   │
   │        gateway → serie → XIAO → LoRa → nodo
   │        nodo pulsa el bit del SN74HC595 → MOSFET IRLZ44N → solenoide
   │
   ├── ACK ───────────► comando confirmado
   └── microswitch ───► PUERTA_ABIERTA → (al cerrar) PUERTA_CERRADA
```

Las tres piezas que lo hacen confiable:

- **Reintentos con `id`**: un comando sin ACK en 15 s se reenvía, hasta 3 veces. El `id` va y
  vuelve, así un ACK tardío no confirma el comando equivocado.
- **Un solo consumidor**: `GET /api/gateway/comandos` entrega y marca como enviado en la misma
  operación, así dos gateways no transmiten la misma orden.
- **El microswitch manda**: el ACK confirma que el nodo accionó la cerradura, no que la puerta se
  abrió. Un ACK sin apertura posterior es el síntoma exacto de un solenoide trabado, y el
  watchdog lo convierte en la alerta roja del panel.

MQTT sería lo correcto si el pañol creciera a varios gabinetes en distintos edificios. Para 4
puertas y un gateway, un broker suma una pieza más que puede fallar durante la defensa.

---

## 5. Límites conocidos

**El sistema registra lo declarado, no lo que salió de la caja.** Si alguien pide 5 notebooks y
se lleva 6, el software no se entera: el microswitch solo informa que la puerta se abrió y se
cerró. Es el supuesto acordado para el prototipo. Las salidas posibles (auditoría por conteo,
sensor de peso, RFID por unidad) están al final de `MODELO-DE-DATOS.md`.

**Seguridad pendiente antes de una instalación real**, en orden de importancia:

1. **HTTPS.** Hoy el JWT viaja en claro por la red de la facultad.
2. **Firmar el enlace LoRa.** Las tramas van sin autenticar: cualquiera con una placa del mismo
   tipo puede emitir un `ABRIR`, y una orden grabada y retransmitida abre la puerta de nuevo.
   Lo mínimo es un HMAC con clave precompartida más un contador anti-replay.
3. **Reemplazar el PIN por el SSO de la facultad.** Cuatro dígitos alcanzan para el prototipo.
4. Rate limiting en login y en apertura.
