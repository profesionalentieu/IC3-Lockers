# Arrancar hoy — guía paso a paso

De cero a sistema funcionando en unos 25 minutos, sin hardware.
Al final vas a tener el servidor corriendo, los dos frontends contra ese servidor, y un nodo
simulado abriendo y cerrando puertas de verdad en el tablero.

Los comandos están para Windows y para Mac/Linux. Donde no aclaro nada, son iguales en los dos.

---

## Antes de empezar: qué vas a tener abierto

Al final del proceso vas a tener **tres ventanas de terminal abiertas al mismo tiempo**:

| Terminal | Qué corre | Se puede cerrar |
|---|---|---|
| 1 | El servidor (`npm start`) | No, mientras uses el sistema |
| 2 | El simulador del nodo | Sí, pero entonces las puertas no se abren |
| 3 | Comandos sueltos | Sí |

Es normal que las dos primeras queden "colgadas" mostrando mensajes: eso significa que están
funcionando. Se cierran con `Ctrl+C`.

---

## Paso 1 — Instalar Node.js

Andá a **nodejs.org** y bajá la versión **LTS** (el botón de la izquierda, dice algo como
"20.x.x LTS" o superior).

El proyecto **no tiene dependencias nativas**: usa el SQLite que Node trae incluido
(`node:sqlite`). Así que no hace falta compilador ni herramientas extra, y el checkbox
*"Tools for Native Modules"* que aparece durante la instalación podés dejarlo como venga.

Necesitás **Node 22.5 o superior**. Si tenés uno más viejo, el proyecto igual funciona: cae
automáticamente en la librería `better-sqlite3`, pero ahí sí vas a necesitar el compilador.

**Verificá que quedó bien.** Abrí una terminal:

- Windows: tecla Windows → escribí `powershell` → Enter
- Mac: Spotlight (Cmd+Espacio) → `Terminal`
- Linux: Ctrl+Alt+T

Escribí:

```bash
node -v
```

Tiene que responder algo como `v20.11.0`. Si dice "no se reconoce el comando" o "command not
found", cerrá la terminal, abrí una nueva y probá otra vez (el instalador no actualiza las
terminales que ya estaban abiertas). Si sigue igual, Node no quedó instalado.

---

## Paso 2 — Descomprimir el proyecto

Bajá `panol-unraf.zip` y descomprimilo. **Importante: descomprimilo de verdad**, no lo abras desde
adentro del zip — en Windows se puede navegar un zip como si fuera una carpeta, pero los comandos
no funcionan ahí.

Dejalo en un lugar de ruta corta y sin espacios ni acentos, por ejemplo:

- Windows: `C:\panol`
- Mac/Linux: `~/panol`

Adentro tenés que ver la carpeta `lockers-unraf` con `backend`, `frontend`, `gateway` y `firmware`.

---

## Paso 3 — Abrir la terminal en la carpeta correcta

Este paso es el que más confusión genera. Todos los comandos que siguen se corren **parado en la
carpeta `backend`**.

**Windows (la forma fácil):** abrí el Explorador, entrá a `C:\panol\lockers-unraf\backend`, hacé
clic derecho en un espacio vacío de la ventana y elegí *"Abrir en Terminal"* (en Windows 10 puede
decir *"Abrir ventana de PowerShell aquí"*, a veces con Shift + clic derecho).

**Cualquier sistema:** desde una terminal ya abierta,

```bash
cd C:\panol\lockers-unraf\backend      # Windows
cd ~/panol/lockers-unraf/backend       # Mac / Linux
```

**Verificá que estás bien parado:**

```bash
dir        # Windows
ls         # Mac / Linux
```

Tenés que ver `package.json` y la carpeta `src`. Si no los ves, estás en otra carpeta.

---

## Paso 4 — Crear el archivo de configuración

```bash
copy .env.example .env     # Windows
cp .env.example .env       # Mac / Linux
```

No devuelve nada, o dice "1 archivo copiado". Para probar en tu máquina podés dejar el contenido
tal cual está; cuando lo instalen en la facultad hay que cambiar `JWT_SECRET` y `GATEWAY_API_KEY`.

Si el archivo no existe, el servidor igual arranca con valores por defecto, pero mejor tenerlo.

---

## Paso 5 — Instalar las dependencias

```bash
npm install
```

Tarda **uno a tres minutos** la primera vez y escupe bastante texto. Es normal que aparezcan
mensajes amarillos de `npm warn`: eso no es un error. Terminó bien si al final dice algo como
`added 87 packages`.

**Si falla**:

| Lo que dice | Qué hacer |
|---|---|
| `npm : No se puede cargar el archivo ... npm.ps1 porque la ejecución de scripts está deshabilitada` | PowerShell bloquea los scripts por defecto. Usá `npm.cmd install` en lugar de `npm install` (y `npm.cmd` en todos los pasos siguientes). O abrí CMD en vez de PowerShell, donde no existe esa restricción. |
| `EACCES` o permisos (Mac/Linux) | Estás en una carpeta del sistema. Movelo a tu carpeta personal (`~/panol`). |
| Avisos `npm warn deprecated` o `allow-scripts` | No son errores. Como el proyecto ya no depende de better-sqlite3, podés ignorarlos. |

---

## Paso 6 — Crear la base de datos

```bash
npm run seed
```

Tiene que responder algo así:

```
[19:12:04] INFO  Base SQLite lista: .../backend/data/lockers.db
[19:12:04] INFO  Pañol cargado:
[19:12:04] INFO    Alumnado -> usuario: alumnado / clave: unraf2025
[19:12:04] INFO    Alumno   -> legajo: 10234 / PIN: 4821   (hasta 5 unidades, 24 h)
[19:12:04] INFO    Docente  -> legajo: 20011 / PIN: 1145   (hasta 25 unidades, 7 días)
[19:12:04] INFO    A-01 25 notebooks | A-02 10 zapatillas | A-03 50 fibrones | A-04 12 kits Arduino
```

Esto crea el archivo `backend/data/lockers.db` con los 4 casilleros, el catálogo de materiales y
las personas de prueba.

> **Si ya habías corrido una versión anterior del proyecto**, borrá la carpeta `backend/data`
> entera antes de este paso — no solo el archivo `lockers.db`, porque al lado quedan `lockers.db-wal`
> y `lockers.db-shm`:
>
> ```powershell
> Remove-Item -Recurse -Force data     # Windows
> rm -rf data                          # Mac / Linux
> ```
>
> Si te olvidás, el sistema te lo dice con un mensaje que explica exactamente qué hacer: el código
> lleva un número de versión de esquema y compara contra el de la base.

Este comando se corre **una sola vez**. Si lo corrés de nuevo no rompe nada (no duplica datos),
pero tampoco hace falta.

---

## Paso 7 — Levantar el servidor

```bash
npm start
```

Tiene que quedar así, y **quedarse ahí**:

```
[19:14:22] INFO  Base SQLite lista: .../backend/data/lockers.db
[19:14:22] INFO  WebSocket escuchando en /ws
[19:14:22] INFO  Watchdog activo cada 5000 ms
[19:14:22] INFO  API      -> http://localhost:3000/api
[19:14:22] INFO  Alumnado -> http://localhost:3000/admin
[19:14:22] INFO  Alumnos  -> http://localhost:3000/
```

**No cierres esta ventana.** Mientras esté abierta, el sistema está prendido. Si la cerrás o hacés
`Ctrl+C`, se apaga todo.

**Si dice `EADDRINUSE`**, el puerto 3000 ya está ocupado por otro programa. O cerrás ese programa,
o cambiás el puerto: abrí `.env` y poné `PORT=3001` (después usá 3001 en todas las direcciones).

---

## Paso 8 — Entrar por primera vez

Abrí el navegador en **http://localhost:3000/admin** y entrá con:

- Usuario: `alumnado`
- Contraseña: `unraf2025`

Tenés que ver el gabinete con las 4 puertas y su stock: 25 notebooks, 10 zapatillas, 50 fibrones,
12 kits. Arriba a la derecha dice "Enlace LoRa" con un puntito.

**Cómo saber que estás contra el servidor real y no en modo demo:** si arriba dijera "Modo demo ·
sin backend", el servidor no está respondiendo. Volvé al paso 7.

Ahora abrí **otra pestaña** en **http://localhost:3000/** y entrá con:

- Legajo: `10234`
- PIN: `4821`

Vas a ver el catálogo con los cuatro materiales y cuántas unidades quedan de cada uno.

---

## Paso 9 — Probar el circuito

En la pestaña del alumno, en la tarjeta de las notebooks, tocá **+** hasta 3 y apretá
**Solicitar material**.

El cartel va a decir **"En revisión"** y se va a quedar ahí. **Eso está bien**: el pedido no abre
nada por sí solo, necesita que alguien de Alumnado lo apruebe.

Andá a la pestaña de Alumnado (**sin refrescar**): arriba de todo apareció la solicitud, con el
nombre, qué pidió y cuánto hace que espera. Llegó sola, por WebSocket, con un aviso sonoro.

Fijate también en el gabinete: las notebooks ya dicen **22 / 25**. La solicitud pendiente
**reserva** el stock aunque todavía no esté aprobada, así dos personas no pueden pedir las mismas
unidades.

Tocá **Aprobar y abrir**. En la pestaña del alumno el cartel pasa solo de "En revisión" a
"Abriendo el casillero…" y se queda esperando: la orden ya está en cola, pero todavía no hay
ningún nodo que la ejecute. Eso es el paso siguiente.

---

## Paso 10 — Prender el nodo simulado

No necesitás instalar nada: el simulador está escrito en Node, que ya tenés.

Abrí una **terminal nueva** (no cierres la del servidor) y pará en la carpeta del proyecto, la de
arriba de `backend`:

```bash
cd C:\panol\lockers-unraf        # Windows
cd ~/panol/lockers-unraf          # Mac / Linux

node gateway/simulador_nodo.js
```

Tiene que decir:

```
Simulador de NODO-A contra http://localhost:3000
Ctrl+C para salir.

  -> comando #1 A-01 · motivo RETIRO
  <- ACK #1
  <- microswitch: A-01 ABIERTA
  <- microswitch: A-01 cerrada
```

**Eso que acabás de ver es el circuito completo funcionando.** Tomó la orden que quedó encolada en
el paso 9, "accionó el solenoide", confirmó con el ACK y reportó el microswitch.

Mirá la pestaña de Alumnado sin refrescar: el casillero A-01 se puso celeste con la puerta
entreabierta, y unos segundos después volvió a verde. Eso llegó solo, por WebSocket.

> Hay una versión equivalente en Python (`simulador_nodo.py`) por si preferís ese entorno; necesita
> `python -m pip install requests`. Las dos hablan el mismo protocolo y hacen exactamente lo mismo.

## Paso 11 — Ahora sí, el circuito completo

Con las tres ventanas prendidas (servidor, simulador, navegador), probá esto:

1. **Retiro completo.** En la pestaña del alumno pedí 2 zapatillas, aprobalo desde Alumnado, y
   mirá cómo el cartel del alumno se completa en verde y dice "Casillero abierto". En Alumnado,
   A-02 pasa a 8 disponibles.
2. **Rechazo.** Pedí 5 kits Arduino y en Alumnado tocá *Rechazar*, escribiendo un motivo. Al
   alumno le llega el motivo al instante y las 5 unidades vuelven al stock.
3. **Devolución.** Andá a *Mis préstamos*, tocá **Devolver material** en las notebooks. La puerta
   se abre otra vez y el stock vuelve a 25. La devolución no necesita aprobación.
4. **Trazabilidad.** En Alumnado, solapa *Movimientos*: están todos los movimientos con quién,
   qué, cuánto, cuándo, y quién lo aprobó o rechazó.
5. **Reiniciá el servidor** (`Ctrl+C` en la terminal 1, después `npm start` de nuevo) y volvé a
   entrar. Todo sigue ahí: eso es lo que diferencia esto de la demo.

---

## Paso 12 — Desde el celular

Averiguá la IP de la PC:

```bash
ipconfig       # Windows -> buscá "Dirección IPv4", ej: 192.168.0.15
ifconfig       # Mac
ip addr        # Linux
```

Desde el celular, **conectado al mismo WiFi**, abrí `http://192.168.0.15:3000` (con tu IP). Entrá
con el legajo 10234 y pedí material: lo vas a ver aparecer en la pantalla de la PC al instante.

**Si no carga**, es el firewall. En Windows: Panel de control → Firewall → "Permitir una aplicación
a través del Firewall" → buscá Node.js y tildá "Privada". Como prueba rápida podés desactivar el
firewall un minuto para confirmar que el problema es ese; si con eso anda, volvé a prenderlo y creá
la excepción.

---

## Ensayar los escenarios de falla

Estos son los que conviene tener practicados para la defensa. Cortá el simulador con `Ctrl+C` y
volvé a arrancarlo así:

```bash
# Una puerta que queda trabada abierta
node gateway/simulador_nodo.js --trabar A-03
```

Pedí fibrones (A-03). La puerta se abre y **nunca cierra**. A los 120 segundos el watchdog la marca
en rojo como *Trabado / Error*, y el material deja de poder pedirse. Para arreglarlo, en Alumnado
tocás *Dar de alta* en esa puerta.

```bash
# Red LoRa con pérdida de paquetes
node gateway/simulador_nodo.js --perder 40
```

Pedí material varias veces. Vas a ver líneas `~ comando #N PERDIDO en el aire` y, unos segundos
después, el mismo comando entregado de nuevo: son los reintentos automáticos. Si se pierden tres
seguidos, el préstamo queda registrado pero la app avisa que el casillero no respondió.

---

## Resumen para tenerlo a mano

Una vez instalado todo, para arrancar el sistema en el futuro son solo dos comandos en dos
terminales:

```bash
# Terminal 1
cd C:\panol\lockers-unraf\backend
npm start

# Terminal 2
cd C:\panol\lockers-unraf
node gateway/simulador_nodo.js
```

Y el navegador en `http://localhost:3000/admin` y `http://localhost:3000/`.

---

## Si algo no anda

| Síntoma | Causa más probable |
|---|---|
| La web dice "Modo demo · sin backend" | El servidor no está corriendo, o lo abriste como archivo (`file://`) en vez de `http://localhost:3000` |
| El botón gira y nunca termina | El simulador no está prendido (paso 10) |
| `npm no se reconoce` | Node no está instalado, o la terminal es vieja: abrí una nueva |
| `npm.ps1 ... ejecución de scripts está deshabilitada` | Usá `npm.cmd` en vez de `npm`, o abrí CMD en lugar de PowerShell |
| `Assertion failed: (env) != nullptr` con un stack trace nativo | Versión vieja del proyecto con better-sqlite3 incompatible con tu Node. Actualizá al paquete nuevo: ya no usa librerías nativas. |
| `Cannot find module` | Faltó `npm install`, o lo corriste parado en otra carpeta |
| `no such table` | Faltó `npm run seed` |
| "La base de datos es de una versión anterior" | Borrá la carpeta `backend/data` entera y volvé a sembrar |
| `no such column: ...` | Base vieja de antes del control de versión: `Remove-Item -Recurse -Force data` y `npm.cmd run seed` |
| `EADDRINUSE` | El puerto 3000 está ocupado: cambiá `PORT` en `.env` |
| El celular no abre la página | Firewall de la PC, o no están en la misma red WiFi |
| El simulador dice "el backend no responde" | La terminal 1 se cerró, o usaste otro puerto |
| `pip no se reconoce` | Usá el simulador de Node (`node gateway/simulador_nodo.js`), que no necesita instalar nada. Si querés el de Python: `python -m pip install requests` |
