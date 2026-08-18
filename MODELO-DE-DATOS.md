# Modelo de datos — Pañol inteligente

## 1. Las cuatro entidades y cómo se relacionan

```
                  ┌──────────────┐
                  │    ITEMS     │  qué material existe en el pañol
                  │  id, codigo  │  "Notebook Lenovo 14\"", unidad, categoría
                  │ nombre, ...  │
                  └──────┬───────┘
                         │ 1
              ┌──────────┴──────────┐
              │ N                   │ N
      ┌───────▼────────┐    ┌───────▼────────┐
      │  CASILLEROS    │    │   PRESTAMOS    │
      │ id, codigo     │ 1  │ id, cantidad   │
      │ nodo_id, bit   ├───►│ cantidad_dev.  │
      │ item_id        │  N │ estado, fechas │
      │ stock_total    │    └───────▲────────┘
      └───────┬────────┘            │ N
              │ N                   │
      ┌───────▼────────┐    ┌───────┴────────┐
      │     NODOS      │    │    USUARIOS    │
      │ XIAO ESP32S3   │ 1  │ legajo, nombre │
      │ LoRa, rssi     │    │ pin, rol       │
      └────────────────┘    └────────────────┘
```

En palabras: **un ítem se guarda en uno o más casilleros; un casillero guarda un solo tipo de ítem;
un préstamo une a una persona con una cantidad de un ítem que salió de un casillero puntual.**

Cuatro decisiones que vale la pena defender en la entrega:

**El préstamo guarda `item_id` además de `casillero_id`.** Parece redundante — el casillero ya
sabe qué material tiene. Pero si en marzo Alumnado vacía el casillero A-03 y lo reasigna a otro
material, el histórico tiene que seguir diciendo que en febrero Lucía retiró fibrones, no lo que
haya adentro hoy. Sin esa columna, cambiar un casillero reescribe el pasado.

**El préstamo nace `pendiente`, no `activo`.** Un retiro no lo decide quien pide: lo autoriza
Alumnado. El ciclo completo es `pendiente → activo → devuelto`, con dos salidas laterales
(`rechazado` si Alumnado lo deniega, `caducado` si nadie lo resuelve a tiempo). La consecuencia
más importante está en la sección 3.

**`cantidad` y `cantidad_devuelta` separadas, en vez de una sola columna que baja.** Permite
devoluciones parciales (retiró 5 notebooks, trajo 3) sin perder cuánto se llevó originalmente.
El préstamo pasa a `devuelto` solo cuando las dos son iguales.

**El usuario tiene `rol`, no una tabla aparte para docentes.** Alumnos y docentes hacen exactamente
el mismo circuito; lo único que cambia son los límites (5 unidades por 24 h contra 25 por 7 días).
Dos tablas duplicarían todas las consultas para modelar una diferencia de dos números.

**Baja lógica (`activo = 0`), nunca `DELETE`.** Si se borrara una persona, sus préstamos históricos
quedarían apuntando a un registro inexistente y la trazabilidad se rompe justo cuando más se la
necesita: cuando hay que reconstruir quién se llevó algo que no volvió.

## 2. La decisión central: el stock no se guarda

No existe ninguna columna `stock_disponible`. Se calcula:

```sql
disponible = stock_total − prestado − reservado

prestado  = SUM(cantidad − cantidad_devuelta)  de los préstamos 'activo'
reservado = SUM(cantidad)                      de las solicitudes 'pendiente'
```

La alternativa intuitiva —una columna que se resta al prestar y se suma al devolver— es la fuente
clásica de inventarios corruptos. Basta que una operación falle a mitad de camino, que un
`UPDATE` se ejecute dos veces por un doble click, o que alguien corrija un préstamo a mano en la
base, para que el número deje de coincidir con la realidad. Y cuando eso pasa, no hay forma de
saber cuál de los dos está mal.

Derivándolo, el stock **no puede** contradecir al historial: si el disponible da raro, es porque
hay un préstamo mal cargado, y ese préstamo se ve en la tabla de trazabilidad. Una sola fuente de
verdad, auditable.

El costo es un `SUM` por consulta. Con 4 casilleros y unos miles de préstamos es irrelevante; el
índice `idx_prestamos_activos (casillero_id, estado)` lo cubre. Si algún día el pañol tuviera
cientos de miles de movimientos, la solución no sería agregar la columna sino una vista
materializada, que se puede recalcular desde cero en cualquier momento.

## 3. Por qué una solicitud pendiente reserva stock

Es la consecuencia menos obvia de meter la aprobación en el medio, y la que conviene tener
pensada antes de que la pregunten.

Si la solicitud pendiente **no** descontara stock, dos personas podrían pedir las últimas 5
notebooks cada una. Alumnado vería dos pedidos perfectamente válidos, aprobaría los dos, y
tendría 10 unidades comprometidas sobre 5 que existen. El error aparecería recién cuando la
segunda persona abre el casillero y lo encuentra vacío.

Por eso `pendiente` reserva: `disponible = total − prestado − reservado`.

Y eso obliga a lo inverso: si alguien pide algo y nadie lo aprueba, esas unidades quedan
bloqueadas para siempre. De ahí las dos protecciones:

- **Las solicitudes caducan** (15 minutos por defecto, `SOLICITUD_CADUCA_MIN`). El watchdog las
  cierra y libera la reserva.
- **Tope de solicitudes abiertas por persona** (3). Sin eso, alguien puede reservar medio pañol
  con pedidos que no piensa retirar.

## 4. La condición de carrera que hay que mencionar en la defensa

Dos personas piden la última notebook con medio segundo de diferencia. Si validamos el stock y
después insertamos la solicitud en dos pasos sueltos, ambas ven "queda 1", ambas pasan la
validación, y el pañol termina con dos solicitudes válidas sobre una notebook que no existe.

Por eso la validación y el `INSERT` van dentro de la misma transacción
(`prestamo.service.js`, función `solicitar`):

```js
const transaccion = db.transaction(() => {
  const casillero = casilleros.obtener(casilleroId);       // lee el disponible
  if (pedido > casillero.inventario.disponible)            // valida
    throw new ErrorNegocio(`Quedan ${casillero.inventario.disponible}...`);
  return db.prepare('INSERT INTO prestamos ...').run(...); // escribe
});
```

La segunda persona encuentra el stock ya reservado y recibe el error. Es el mismo problema que
la sobreventa de entradas, y en la materia da bien mostrarlo explícitamente.

## 5. Los objetos JSON que ve el frontend

**Catálogo** — `GET /api/usuario/catalogo`

```json
{
  "items": [
    {
      "casilleroId": 1,
      "casillero": "A-01",
      "ubicacion": "Pañol - Planta baja",
      "item": {
        "id": 1, "codigo": "NB-14", "nombre": "Notebook Lenovo 14\"",
        "categoria": "Informatica", "unidad": "unidad",
        "descripcion": "Con cargador. Devolver con bateria cargada."
      },
      "total": 25,
      "disponible": 20,
      "stockBajo": false,
      "estado": "DISPONIBLE",
      "sePuedePedir": true
    }
  ],
  "limitePorRetiro": 5
}
```

`sePuedePedir` es lo que deshabilita el botón, pero **la validación real está en el servidor**:
nunca confiamos en que el botón estaba gris. Cualquiera puede mandar el POST a mano.

**Solicitud** — respuesta de `POST /api/usuario/prestamos` (HTTP 202)

Fijate en dos cosas: el estado es `pendiente` y `retiradoEn` es `null`. No se puede decir que
alguien retiró algo que todavía no le dieron. Tampoco viene `comandoId`: la orden de apertura
no existe hasta que Alumnado aprueba.

```json
{
  "prestamo": {
    "id": 91, "estado": "pendiente", "vencido": false,
    "cantidad": 5, "cantidadDevuelta": 0, "pendiente": 5,
    "solicitadoEn": "2026-08-18T13:02:11.804Z",
    "retiradoEn": null,
    "vencimiento": null,
    "devueltoEn": null,
    "minutosEsperando": 0,
    "resueltoPor": null,
    "item": { "id": 1, "nombre": "Notebook Lenovo 14\"", "codigo": "NB-14", "unidad": "unidad" },
    "casillero": { "id": 1, "codigo": "A-01" },
    "usuario": { "legajo": "10234", "nombre": "Bertola, Juan", "rol": "alumno" }
  }
}
```

Al aprobar (`POST /api/admin/solicitudes/91/aprobar`) el mismo objeto vuelve con
`estado: "activo"`, `retiradoEn` y `vencimiento` cargados, `resueltoPor: "alumnado"`, y esta vez
sí acompañado de `comandoId`. Es 202 y no 200 porque la puerta todavía no se abrió: esa orden
viaja por LoRa y se sigue con `GET /api/usuario/comandos/42`.

**Casillero para el panel** — `GET /api/admin/casilleros`

```json
{
  "id": 1, "codigo": "A-01",
  "estado": "DISPONIBLE",
  "estadoPuerta": "cerrada",
  "detalleError": null,
  "bitRegistro": 0,
  "nodo": { "codigo": "NODO-A", "ubicacion": "Pañol - Planta baja", "rssi": -74, "offline": false },
  "item": { "id": 1, "nombre": "Notebook Lenovo 14\"", "categoria": "Informatica", "unidad": "unidad" },
  "inventario": { "total": 25, "prestado": 5, "reservado": 4, "disponible": 16, "umbralBajo": 5, "stockBajo": false }
}
```

## 6. Los cuatro estados del casillero, derivados

Igual que el stock, el estado se calcula en cada consulta, con esta prioridad:

| Estado | Condición | Qué significa para Alumnado |
|---|---|---|
| `ERROR` | `estado_operativo = 'error'` | El watchdog detectó puerta trabada o falta de ACK. Hay que ir a mirar. |
| `PUERTA_ABIERTA` | el microswitch reporta apertura | Alguien está retirando o guardando ahora mismo. |
| `SIN_STOCK` | `disponible = 0` | Todo el material está afuera. El botón queda deshabilitado. |
| `DISPONIBLE` | ninguna de las anteriores | Operativo. |

`stockBajo` va aparte como bandera y no como estado propio: un casillero con poco material sigue
siendo perfectamente operable, solo necesita reposición.

## 7. Retiro y devolución son la misma orden física

Es la parte que conecta con el hardware de Bertola. Los dos flujos terminan igual:

```
SOLICITUD   INSERT prestamo (pendiente)      ──► (no genera comando: nadie abre nada)
APROBACION  UPDATE estado = activo           ─┐
DEVOLUCION  UPDATE cantidad_devuelta         ─┤─► INSERT comando ABRIR
                                              │   (motivo: RETIRO | DEVOLUCION)
                                              ▼
                          gateway → XIAO → LoRa → nodo
                          nodo pulsa el bit del SN74HC595 → IRLZ44N → solenoide
                                              │
                          ACK ─► comando confirmado
                          microswitch ─► PUERTA_ABIERTA ... luego PUERTA_CERRADA
```

El campo `motivo` no cambia nada en el firmware: existe solo para que la bitácora pueda decir si
esa apertura fue para sacar o para guardar. El nodo recibe exactamente la misma trama en los dos
casos.

## 8. Lo que este modelo no puede saber (y conviene decirlo antes de que lo pregunten)

El sistema registra **lo que la persona declaró**, no lo que efectivamente sacó de la caja. Si
alguien pide 5 notebooks y se lleva 6, el software no tiene forma de enterarse: el microswitch
informa que la puerta se abrió y se cerró, nada más. Es el supuesto que acordamos, y está bien
para el prototipo, pero es el límite honesto del diseño.

Las tres formas de cerrar esa brecha, de menor a mayor costo:

1. **Auditoría por conteo**: Alumnado hace un recuento periódico y el sistema muestra el desvío
   entre stock teórico y real. Cero hardware nuevo, y ya se puede implementar con lo que hay:
   sería agregar una tabla `recuentos` con la diferencia y quién la registró.
2. **Sensor de peso** en la base del casillero. Sirve bien para ítems homogéneos (fibrones,
   kits) y detecta diferencias grandes, no una unidad.
3. **RFID por unidad**: un tag por notebook y un lector en la puerta. Es la única que da certeza
   real, y es la que justifica una segunda etapa del proyecto.
