/**
 * ============================================================
 *  GATEWAY DEL PAÑOL — XIAO ESP32S3 + Wio-SX1262
 *  Prototipo UNRaf · Ingeniería en Computación 3
 * ============================================================
 *
 *  Esta placa no piensa: es un cable. Traduce entre el puerto serie
 *  (que lee gateway_lora.py en la PC) y la radio LoRa.
 *
 *      PC  --serie-->  esta placa  --LoRa-->  nodo
 *      PC  <--serie--  esta placa  <--LoRa--  nodo
 *
 *  Toda la lógica (cola de comandos, reintentos, estados) vive en el
 *  backend. Si mañana cambian las reglas del pañol, esta placa no se toca.
 *
 *  ⚠ Los parámetros de radio tienen que ser IDÉNTICOS a los del nodo:
 *    frecuencia, ancho de banda, spreading factor y coding rate. Si uno
 *    solo difiere, las placas no se escuchan y parece que está rota.
 *
 *  Librerías: RadioLib (jgromes) · ArduinoJson (bblanchon) v7
 * ============================================================
 */

#include <RadioLib.h>
#include <ArduinoJson.h>

// ---------- Pines del SX1262 (VERIFICAR con tu módulo, ver nodo.ino) ----------
#define PIN_LORA_CS    41
#define PIN_LORA_DIO1  39
#define PIN_LORA_RESET 42
#define PIN_LORA_BUSY  40
SX1262 radio = new Module(PIN_LORA_CS, PIN_LORA_DIO1, PIN_LORA_RESET, PIN_LORA_BUSY);

// ---------- Parámetros de radio (los mismos que el nodo) ----------
const float FRECUENCIA  = 915.0;
const float ANCHO_BANDA = 125.0;
const uint8_t SPREADING = 9;
const uint8_t CODING    = 7;
const int8_t POTENCIA   = 14;

volatile bool hayTrama = false;
ICACHE_RAM_ATTR void alRecibir() { hayTrama = true; }

void setup() {
  Serial.begin(115200);
  delay(1500);

  int estado = radio.begin(FRECUENCIA, ANCHO_BANDA, SPREADING, CODING);
  if (estado != RADIOLIB_ERR_NONE) {
    // Se avisa por serie en formato JSON para que el script de la PC lo loguee.
    Serial.printf("{\"tipo\":\"error\",\"detalle\":\"radio.begin %d\"}\n", estado);
    while (true) delay(1000);
  }
  radio.setOutputPower(POTENCIA);
  radio.setPacketReceivedAction(alRecibir);
  radio.startReceive();

  Serial.println("{\"tipo\":\"listo\",\"detalle\":\"gateway operativo\"}");
}

void loop() {
  // ---------- BAJADA: PC -> LoRa ----------
  // Una línea JSON por comando, tal como la manda gateway_lora.py.
  if (Serial.available()) {
    String linea = Serial.readStringUntil('\n');
    linea.trim();
    if (linea.length() > 0) {
      radio.transmit(linea);
      radio.startReceive();   // volver a escuchar: LoRa es half-duplex
    }
  }

  // ---------- SUBIDA: LoRa -> PC ----------
  if (hayTrama) {
    hayTrama = false;
    String recibido;
    if (radio.readData(recibido) == RADIOLIB_ERR_NONE && recibido.length() > 0) {
      // Se reenvía tal cual: el gateway no interpreta el contenido.
      Serial.println(recibido);
    }
    radio.startReceive();
  }
}
