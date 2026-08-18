# Contrato firmware ↔ servidor

Este archivo es el acuerdo entre el software del servidor y el firmware de las XIAO ESP32S3.
Mientras el firmware respete esto, backend y hardware se pueden desarrollar en paralelo.

## Identificación

| Concepto | Significado en el firmware |
|---|---|
| `nodo` | Código del gabinete, fijo en el firmware (`"NODO-A"`). Uno por placa. |
| `bit` | Índice de la salida del **SN74HC595** que dispara el gate del **IRLZ44N** de esa puerta (0…7). |
| `casillero` | Solo etiqueta para humanos (`"A-01"`). El firmware no la necesita. |

En el prototipo: `A-01 → bit 0`, `A-02 → bit 1`, `A-03 → bit 2`, `A-04 → bit 3`, todos en `NODO-A`.

## Tramas que recibe el nodo

```json
{"id": 12, "nodo": "NODO-A", "bit": 0, "accion": "ABRIR", "motivo": "RETIRO"}
```

> `motivo` (RETIRO / DEVOLUCION / EMERGENCIA) viaja solo para los logs del gateway.
> **El firmware lo ignora**: sacar material y guardarlo producen exactamente la misma
> acción física. Si el nodo hiciera algo distinto según el motivo, sería un bug.

Al recibirla, el nodo debe:

1. Cargar el registro con solo ese bit en alto (`shiftOut` + pulso a `RCLK`).
2. Mantener la salida activa el tiempo de pulso del solenoide (≈ 400–600 ms; medirlo con la cerradura real).
3. Volver el registro a cero — el solenoide no debe quedar energizado o se calienta y consume batería.
4. Responder el ACK con el mismo `id`.

> Nota de diseño: el `id` viaja de ida y vuelta para que el servidor pueda distinguir un ACK real
> de un eco tardío. Sin él, un reintento confirmaría el comando equivocado.

## Tramas que emite el nodo

```json
{"tipo":"ack","id":12,"ok":true,"rssi":-74}
{"tipo":"telemetria","nodo":"NODO-A","lecturas":[{"bit":0,"puertaAbierta":true}],"rssi":-74}
{"tipo":"heartbeat","nodo":"NODO-A","rssi":-74,"bateriaMv":4020}
```

- **telemetría**: enviar en cada *cambio* del microswitch (con antirrebote por software,
  ~50 ms) y además un reporte completo de las 4 puertas cada 60 s. El reporte periódico
  es el que resincroniza el tablero si se perdió una trama de cambio.
- **heartbeat**: cada 60 s. El backend marca el nodo como desconectado a los `NODO_OFFLINE_SEG`
  (180 s por defecto), o sea que tolera dos latidos perdidos antes de encender la alarma.

## Por qué el servidor nunca asume que la puerta se abrió

El ACK confirma que el nodo **accionó la cerradura**, no que la puerta se abrió.
El estado `PUERTA_ABIERTA` del tablero sale exclusivamente del microswitch.
Si hay ACK pero nunca llega telemetría de apertura, el caso más probable es un solenoide
trabado: ese es justamente el escenario que detecta Alumnado en el dashboard.
