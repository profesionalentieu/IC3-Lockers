/**
 * ============================================================
 *  NODO DEL PAÑOL — XIAO ESP32S3 + Wio-SX1262
 *  Prototipo UNRaf · Ingeniería en Computación 3
 * ============================================================
 *
 *  Qué hace:
 *    1. Escucha por LoRa órdenes de apertura del gateway.
 *    2. Pulsa el bit correspondiente del SN74HC595, que dispara el
 *       gate del IRLZ44N y acciona el solenoide de 12 V.
 *    3. Responde ACK con el mismo id (para que el backend sepa cuál
 *       comando se ejecutó y no confunda un ACK tardío).
 *    4. Vigila los finales de carrera y reporta cada cambio, más un
 *       reporte completo periódico que resincroniza si se perdió una trama.
 *
 *  Librerías (Gestor de librerías del Arduino IDE):
 *    - RadioLib      (jgromes)  — probado con 6.6.0 y posteriores
 *    - ArduinoJson   (bblanchon) v7
 *
 *  ⚠ PINES DEL MÓDULO LoRa: hay DOS placas distintas vendidas como
 *    "Wio-SX1262 for XIAO V1.0". La del kit usa un conector B2B de 30
 *    pines; la que se compra suelta usa headers de borde con OTRO pinout.
 *    Verificá cuál tenés antes de dar por buenos estos valores: si
 *    radio.begin() devuelve un código distinto de 0, casi siempre es esto.
 *    El primer paso del proyecto debería ser correr el ejemplo
 *    SX126x_Transmit de RadioLib y confirmar que hay enlace, antes de
 *    sumarle registros de desplazamiento y solenoides.
 * ============================================================
 */

#include <RadioLib.h>
#include <ArduinoJson.h>

// ---------- Identidad ----------
const char* NODO_ID = "NODO-A";      // tiene que coincidir con la tabla nodos
const uint8_t CANT_PUERTAS = 4;      // el prototipo tiene 4

// ---------- Pines del SX1262 (VERIFICAR con tu módulo) ----------
#define PIN_LORA_CS    41
#define PIN_LORA_DIO1  39
#define PIN_LORA_RESET 42
#define PIN_LORA_BUSY  40
SX1262 radio = new Module(PIN_LORA_CS, PIN_LORA_DIO1, PIN_LORA_RESET, PIN_LORA_BUSY);

// ---------- Parámetros de radio ----------
// 915 MHz es la banda libre en Argentina (ENACOM). Los dos extremos del
// enlace tienen que tener EXACTAMENTE los mismos parámetros o no se escuchan.
const float FRECUENCIA   = 915.0;    // MHz
const float ANCHO_BANDA  = 125.0;    // kHz
const uint8_t SPREADING  = 9;        // SF9: buen equilibrio alcance/latencia en interiores
const uint8_t CODING     = 7;
const int8_t POTENCIA    = 14;       // dBm

// ---------- Pines del registro de desplazamiento SN74HC595 ----------
#define PIN_SR_DATOS  D1   // SER   (pin 14)
#define PIN_SR_RELOJ  D2   // SRCLK (pin 11)
#define PIN_SR_LATCH  D3   // RCLK  (pin 12)
// OE (pin 13) va a GND y SRCLR (pin 10) a VCC.
// Importante: un pull-DOWN de 10k en cada salida del 595 hacia el gate del
// MOSFET. Durante el arranque del ESP32 las salidas quedan en alta impedancia
// y sin el pull-down un solenoide puede dispararse solo al energizar el equipo.

// ---------- Finales de carrera (microswitch) ----------
// INPUT_PULLUP: en reposo leen HIGH. Puerta cerrada = switch presionado = LOW.
const uint8_t PIN_MICROSWITCH[CANT_PUERTAS] = { D4, D5, D6, D7 };

// ---------- Tiempos ----------
const uint16_t MS_PULSO_SOLENOIDE = 500;   // medir con la cerradura real
const uint16_t MS_ANTIRREBOTE     = 50;
const uint32_t MS_REPORTE_COMPLETO = 60000;
const uint32_t MS_HEARTBEAT        = 60000;

// ---------- Estado ----------
bool puertaAbierta[CANT_PUERTAS];
uint32_t ultimoCambio[CANT_PUERTAS];
uint32_t ultimoReporte = 0;
uint32_t ultimoHeartbeat = 0;
volatile bool hayTrama = false;

// El SX1262 avisa por interrupción que llegó algo. La ISR solo levanta una
// bandera: leer la radio adentro de una interrupción cuelga el micro.
ICACHE_RAM_ATTR void alRecibir() { hayTrama = true; }

/* ============================================================
   SETUP
   ============================================================ */
void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println(F("\n=== Nodo del pañol UNRaf ==="));

  // --- Salidas hacia el registro de desplazamiento ---
  pinMode(PIN_SR_DATOS, OUTPUT);
  pinMode(PIN_SR_RELOJ, OUTPUT);
  pinMode(PIN_SR_LATCH, OUTPUT);
  escribirRegistro(0);   // todo apagado antes que nada

  // --- Finales de carrera ---
  for (uint8_t i = 0; i < CANT_PUERTAS; i++) {
    pinMode(PIN_MICROSWITCH[i], INPUT_PULLUP);
    puertaAbierta[i] = (digitalRead(PIN_MICROSWITCH[i]) == HIGH);
    ultimoCambio[i] = millis();
  }

  // --- Radio ---
  Serial.print(F("Iniciando SX1262... "));
  int estado = radio.begin(FRECUENCIA, ANCHO_BANDA, SPREADING, CODING);
  if (estado != RADIOLIB_ERR_NONE) {
    Serial.print(F("ERROR "));
    Serial.println(estado);
    Serial.println(F("Casi siempre es el pinout del módulo. Ver el comentario de arriba."));
    while (true) delay(1000);   // sin radio no hay nada que hacer
  }
  radio.setOutputPower(POTENCIA);
  radio.setPacketReceivedAction(alRecibir);
  radio.startReceive();
  Serial.println(F("OK. Escuchando."));

  reportarTodas();
}

/* ============================================================
   LOOP
   ============================================================ */
void loop() {
  if (hayTrama) {
    hayTrama = false;
    procesarTrama();
    radio.startReceive();
  }

  revisarMicroswitches();

  if (millis() - ultimoReporte > MS_REPORTE_COMPLETO) reportarTodas();
  if (millis() - ultimoHeartbeat > MS_HEARTBEAT) enviarHeartbeat();
}

/* ============================================================
   RECEPCIÓN DE ÓRDENES
   ============================================================ */
void procesarTrama() {
  String recibido;
  int estado = radio.readData(recibido);
  if (estado != RADIOLIB_ERR_NONE) return;

  JsonDocument doc;
  if (deserializeJson(doc, recibido)) {
    Serial.println(F("Trama ilegible, descartada"));
    return;
  }

  // El gateway emite a todos los nodos: cada uno filtra lo suyo.
  if (strcmp(doc["nodo"] | "", NODO_ID) != 0) return;

  uint32_t id = doc["id"] | 0;
  uint8_t bit = doc["bit"] | 255;
  const char* accion = doc["accion"] | "";

  // OJO: el campo "motivo" (RETIRO / DEVOLUCION) se ignora a propósito.
  // Sacar material y guardarlo son la MISMA acción física. Si el firmware
  // hiciera algo distinto según el motivo, sería un bug.

  if (strcmp(accion, "ABRIR") == 0 && bit < CANT_PUERTAS) {
    Serial.printf("Abriendo puerta %u (comando #%u)\n", bit, id);
    accionarSolenoide(bit);
    enviarAck(id, true);
  } else if (strcmp(accion, "PING") == 0) {
    enviarAck(id, true);
  }
}

/* ============================================================
   POTENCIA: registro de desplazamiento + MOSFET + solenoide
   ============================================================ */

/** Vuelca un byte al SN74HC595 y lo late a las salidas. */
void escribirRegistro(uint8_t valor) {
  digitalWrite(PIN_SR_LATCH, LOW);
  shiftOut(PIN_SR_DATOS, PIN_SR_RELOJ, MSBFIRST, valor);
  digitalWrite(PIN_SR_LATCH, HIGH);
}

/**
 * Pulso de apertura. Solo un bit en alto a la vez: dos solenoides de 12 V
 * juntos son un pico de corriente que la fuente del prototipo no banca.
 * Y el registro vuelve a cero SIEMPRE: si el solenoide queda energizado se
 * calienta, consume y termina quemándose.
 */
void accionarSolenoide(uint8_t bit) {
  escribirRegistro(1 << bit);
  delay(MS_PULSO_SOLENOIDE);
  escribirRegistro(0);
}

/* ============================================================
   TELEMETRÍA: finales de carrera
   ============================================================ */

/** Antirrebote por software: el contacto mecánico "castañea" al cambiar. */
void revisarMicroswitches() {
  for (uint8_t i = 0; i < CANT_PUERTAS; i++) {
    bool lectura = (digitalRead(PIN_MICROSWITCH[i]) == HIGH);   // HIGH = abierta
    if (lectura == puertaAbierta[i]) {
      ultimoCambio[i] = millis();
      continue;
    }
    if (millis() - ultimoCambio[i] < MS_ANTIRREBOTE) continue;

    puertaAbierta[i] = lectura;
    ultimoCambio[i] = millis();
    Serial.printf("Puerta %u -> %s\n", i, lectura ? "ABIERTA" : "cerrada");
    reportarPuerta(i, lectura);
  }
}

void reportarPuerta(uint8_t bit, bool abierta) {
  JsonDocument doc;
  doc["tipo"] = "telemetria";
  doc["nodo"] = NODO_ID;
  JsonArray lecturas = doc["lecturas"].to<JsonArray>();
  JsonObject lectura = lecturas.add<JsonObject>();
  lectura["bit"] = bit;
  lectura["puertaAbierta"] = abierta;
  doc["rssi"] = (int)radio.getRSSI();
  transmitir(doc);
}

/** Reporte completo periódico: resincroniza el tablero si se perdió un cambio. */
void reportarTodas() {
  JsonDocument doc;
  doc["tipo"] = "telemetria";
  doc["nodo"] = NODO_ID;
  JsonArray lecturas = doc["lecturas"].to<JsonArray>();
  for (uint8_t i = 0; i < CANT_PUERTAS; i++) {
    JsonObject lectura = lecturas.add<JsonObject>();
    lectura["bit"] = i;
    lectura["puertaAbierta"] = puertaAbierta[i];
  }
  doc["rssi"] = (int)radio.getRSSI();
  transmitir(doc);
  ultimoReporte = millis();
}

void enviarAck(uint32_t id, bool ok) {
  JsonDocument doc;
  doc["tipo"] = "ack";
  doc["id"] = id;
  doc["ok"] = ok;
  doc["rssi"] = (int)radio.getRSSI();
  transmitir(doc);
}

void enviarHeartbeat() {
  JsonDocument doc;
  doc["tipo"] = "heartbeat";
  doc["nodo"] = NODO_ID;
  doc["rssi"] = (int)radio.getRSSI();
  doc["bateriaMv"] = 4000;   // reemplazar por lectura real del divisor resistivo
  transmitir(doc);
  ultimoHeartbeat = millis();
}

/** Transmite y vuelve a escuchar: LoRa es half-duplex, no hace las dos a la vez. */
void transmitir(JsonDocument& doc) {
  String salida;
  serializeJson(doc, salida);
  int estado = radio.transmit(salida);
  if (estado != RADIOLIB_ERR_NONE) {
    Serial.printf("Error al transmitir: %d\n", estado);
  }
  radio.startReceive();
}
