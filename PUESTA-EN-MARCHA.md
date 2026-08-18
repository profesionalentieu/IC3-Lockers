# Puesta en marcha — de la demo al sistema real

Cinco etapas. Cada una funciona sola y agrega una pieza, así siempre sabés qué rompiste.
Las tres primeras no necesitan una sola placa.

---

## Etapa 1 — El backend real en una PC (30 minutos)

Ya está todo escrito; hay que instalarlo.

```bash
cd backend
cp .env.example .env      # Windows: copy .env.example .env
npm install
npm run seed
npm start
```

Abrí `http://localhost:3000/admin` (alumnado / unraf2025) y `http://localhost:3000/` (legajo 10234,
PIN 4821). Pedí 3 notebooks desde una pestaña y mirá bajar el stock en la otra.

**Ya no es una demo**: los datos se guardan en `backend/data/lockers.db`, sobreviven al reinicio y
el WebSocket sincroniza las dos pantallas. Lo único que falta es que se abra una puerta de verdad.

**Si algo falla acá**, es casi siempre una de estas tres:

| Síntoma | Causa |
|---|---|
| `node-gyp` falla en `npm install` | Faltan las build tools. En Windows: instalar Visual Studio Build Tools. |
| `SQLITE_ERROR: no such table` | Falta correr `npm run seed`. |
| `no such column` o errores raros de SQL | Base de la v1. Borrá `backend/data/lockers.db` y volvé a sembrar. |

---

## Etapa 2 — Los celulares contra el servidor (10 minutos)

Hasta acá todo corre en `localhost`, que desde el celular no existe. Necesitás la IP de la PC en la
red de la facultad:

- Windows: `ipconfig` → "Dirección IPv4", algo como `192.168.0.15`
- Mac / Linux: `ip addr` o `ifconfig`

Desde el celular, conectado **al mismo WiFi**, abrí `http://192.168.0.15:3000`. El frontend usa
`location.origin`, así que se conecta solo a la API sin tocar nada.

Si no carga, el firewall de la PC está bloqueando el puerto 3000: en Windows, "Permitir una
aplicación a través del Firewall" → Node.js, red privada.

**Esto es lo que hay que probar antes de la demostración.** El día de la defensa, la PC y el
celular tienen que estar en la misma red, y conviene tener la IP anotada en un papel.

---

## Etapa 3 — El circuito completo sin hardware (5 minutos)

Acá está la pieza que vuelve el proyecto demostrable aunque las placas no estén listas.

Con el backend corriendo, en **otra terminal**:

```bash
node gateway/simulador_nodo.js
```

El simulador hace de gateway y de nodo: consulta comandos al backend real, espera medio segundo
como si accionara el solenoide, manda el ACK y reporta el microswitch. En el panel de Alumnado vas
a ver el casillero pasar a **PUERTA_ABIERTA** y volver a **DISPONIBLE** unos segundos después.

Dos escenarios que conviene ensayar, porque son las preguntas que va a hacer la cátedra:

```bash
node gateway/simulador_nodo.js --trabar A-03
# esa puerta nunca cierra -> a los 120 s el watchdog la marca ERROR

node gateway/simulador_nodo.js --perder 30
# se pierde el 30% de las tramas -> se ven los reintentos automáticos
```

Cuando el hardware esté listo, se apaga el simulador y se prende `gateway_lora.py`. El backend no
se entera de la diferencia: habla el mismo protocolo con los dos.

---

## Etapa 4 — El hardware (el trabajo de Bertola)

Cuatro pasos, en este orden. Saltearse el primero es la causa número uno de días perdidos.

### 4.1 Confirmar el enlace LoRa, sin nada más conectado

Cargá el ejemplo `SX126x_Transmit` de RadioLib en una placa y `SX126x_Receive` en la otra. Hasta
que dos placas peladas no se hablen, no tiene sentido sumar registros ni solenoides.

**El problema más probable es el pinout.** Hay dos placas distintas vendidas como
"Wio-SX1262 for XIAO V1.0": la del kit usa un conector B2B de 30 pines, y la que se compra suelta
usa headers de borde con otro pinout. Si `radio.begin()` devuelve algo distinto de 0, es esto.

Anotá los pines que te funcionaron y ponelos arriba de los dos `.ino`.

### 4.2 Gateway

Cargá `firmware/gateway/gateway.ino`. Conectá la placa por USB a la PC y probá:

```bash
pip install pyserial websocket-client
python gateway/gateway_lora.py --puerto /dev/ttyACM0 --backend http://localhost:3000
```

En Windows el puerto es `COM3`, `COM4`, etc. (Administrador de dispositivos → Puertos).

### 4.3 Nodo, primero en el escritorio

Cargá `firmware/nodo/nodo.ino` en la otra placa. Antes de conectar nada de potencia, probalo con un
**LED con su resistencia** en cada salida del SN74HC595: pedí una apertura desde la web y mirá el
LED prenderse medio segundo. Es la prueba más barata de que toda la cadena funciona.

Los microswitches se prueban igual de simple: `INPUT_PULLUP`, un extremo a GND, y en el monitor
serie tenés que ver el cambio al apretarlos.

### 4.4 Potencia

Recién ahora el 12 V. Tres cosas que queman prototipos:

- **Diodo flyback** en paralelo con cada solenoide (1N4007, cátodo al positivo). Un solenoide es una
  bobina: al cortar la corriente genera un pico inverso que se lleva puesto al MOSFET.
- **Masa común** entre la fuente de 12 V y el ESP32. Sin eso el MOSFET no tiene referencia y hace
  cosas impredecibles.
- **Pull-down de 10 k** en cada salida del 595 hacia el gate. Durante el arranque del ESP32 las
  salidas quedan en alta impedancia, y sin el pull-down un solenoide puede dispararse solo al
  energizar el equipo. Es un susto feo en la demostración.

Medí el consumo real del solenoide antes de elegir la fuente: los de 12 V suelen pedir entre 0,5 y
1 A durante el pulso. El firmware acciona **de a uno por vez** justamente por esto.

---

## Etapa 5 — Que quede prendido (opcional)

Para el prototipo alcanza con dejar la notebook corriendo `npm start`. Si quieren algo permanente:

**Una Raspberry Pi** es la opción natural: consume poco, se deja enchufada en el pañol, y el mismo
gateway USB va conectado ahí. Se instala Node igual, y con `pm2` el servidor levanta solo al
reiniciar:

```bash
npm install -g pm2
pm2 start src/server.js --name panol
pm2 startup && pm2 save
```

**IP fija.** Si la PC cambia de IP, los celulares dejan de encontrarla. Pedile a Sistemas de la
facultad una reserva DHCP por MAC, o configurá IP estática.

**Antes de una instalación real** (no para la entrega, pero sí para el informe): HTTPS, firmar las
tramas LoRa con HMAC más contador anti-replay, y reemplazar el PIN por el SSO de la facultad. Están
detallados al final del README.

---

## Orden sugerido de trabajo

| Cuándo | Vos | Bertola |
|---|---|---|
| Esta semana | Etapas 1, 2 y 3 | Etapa 4.1: confirmar el enlace LoRa |
| Próxima | Cargar el catálogo real del pañol y el padrón | 4.2 y 4.3: gateway y nodo con LEDs |
| Después | Ensayar la demostración con el simulador | 4.4: potencia y montaje en el gabinete |

Lo importante es que las etapas 1 a 3 **no dependen del hardware**. Si las placas se atrasan,
igual tienen un sistema funcionando para mostrar, y el simulador hace de nodo mientras tanto.
