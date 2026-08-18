#!/usr/bin/env python3
"""
SIMULADOR DE NODO — el sistema completo funcionando sin una sola placa.

Hace de gateway y de nodo a la vez: consulta comandos al backend real,
"acciona" el solenoide (espera medio segundo), manda el ACK y reporta el
microswitch como si la puerta se hubiera abierto y cerrado de verdad.

Para que sirve:
  - Probar el circuito completo hoy, antes de tener el hardware.
  - Ver el tablero de Alumnado cambiar a PUERTA_ABIERTA y volver solo.
  - Practicar la demostracion sin depender de que las placas anden.
  - Cuando el hardware este listo, se apaga esto y se prende gateway_lora.py:
    el backend no se entera de la diferencia.

Uso (con el backend ya corriendo en otra terminal):
    pip install requests
    python simulador_nodo.py

Opciones utiles:
    --trabar A-03     esa puerta nunca se cierra -> el watchdog la marca ERROR
    --perder 30       descarta el 30% de los comandos, como una red LoRa real
    --backend http://192.168.0.10:3000
"""

import argparse
import random
import time

import requests

API_KEY = "gw-lora-unraf-2025"      # tiene que coincidir con GATEWAY_API_KEY del .env
NODO = "NODO-A"
INTERVALO_POLL = 2.0                # segundos entre consultas, igual que el gateway real
DEMORA_SOLENOIDE = 0.5              # lo que tarda en accionar la cerradura
SEGUNDOS_PUERTA_ABIERTA = 6         # cuanto tarda la persona en cerrar la puerta
INTERVALO_HEARTBEAT = 30

# Mapa bit -> casillero, igual que en el seed. Solo para los mensajes en pantalla.
CASILLEROS = {0: "A-01", 1: "A-02", 2: "A-03", 3: "A-04"}


class SimuladorNodo:
    def __init__(self, backend: str, trabadas: set, perdida: int):
        self.backend = backend.rstrip("/")
        self.trabadas = trabadas          # casilleros cuya puerta nunca se cierra
        self.perdida = perdida            # % de tramas que se pierden
        self.sesion = requests.Session()
        self.sesion.headers.update({"x-api-key": API_KEY, "Content-Type": "application/json"})
        self.puertas_abiertas = {}        # bit -> momento en que se abrio
        self.ultimo_heartbeat = 0.0

    # ---------- helpers ----------

    def rssi(self) -> int:
        """RSSI verosimil para que el panel muestre algo creible."""
        return random.randint(-95, -60)

    def enviar(self, ruta: str, cuerpo: dict):
        try:
            return self.sesion.post(f"{self.backend}{ruta}", json=cuerpo, timeout=5)
        except Exception as e:
            print(f"  ! no pude hablar con el backend: {e}")
            return None

    # ---------- el circuito ----------

    def procesar_comando(self, comando: dict):
        bit = comando["bit"]
        casillero = CASILLEROS.get(bit, f"bit {bit}")
        motivo = comando.get("motivo", "—")

        # Perdida de paquetes simulada: el backend va a reintentar solo.
        if random.randint(1, 100) <= self.perdida:
            print(f"  ~ comando #{comando['id']} ({casillero}) PERDIDO en el aire")
            return

        print(f"  -> comando #{comando['id']} {casillero} · motivo {motivo}")

        # 1. El nodo pulsa el bit del SN74HC595 -> MOSFET -> solenoide
        time.sleep(DEMORA_SOLENOIDE)

        # 2. ACK: confirma que acciono la cerradura (no que la puerta se abrio)
        self.enviar(f"/api/gateway/comandos/{comando['id']}/ack",
                    {"ok": True, "detalle": "simulador"})
        print(f"  <- ACK #{comando['id']}")

        # 3. El microswitch detecta que la puerta se abrio
        self.enviar("/api/gateway/telemetria", {
            "nodo": NODO,
            "lecturas": [{"bit": bit, "puertaAbierta": True}],
            "rssi": self.rssi(),
        })
        self.puertas_abiertas[bit] = time.time()
        print(f"  <- microswitch: {casillero} ABIERTA")

    def revisar_puertas(self):
        """Cierra las puertas que llevan abiertas el tiempo de una persona normal."""
        ahora = time.time()
        for bit, momento in list(self.puertas_abiertas.items()):
            casillero = CASILLEROS.get(bit, f"bit {bit}")
            if casillero in self.trabadas:
                continue  # trabada a proposito: el watchdog la va a marcar ERROR
            if ahora - momento >= SEGUNDOS_PUERTA_ABIERTA:
                self.enviar("/api/gateway/telemetria", {
                    "nodo": NODO,
                    "lecturas": [{"bit": bit, "puertaAbierta": False}],
                    "rssi": self.rssi(),
                })
                del self.puertas_abiertas[bit]
                print(f"  <- microswitch: {casillero} cerrada")

    def heartbeat(self):
        if time.time() - self.ultimo_heartbeat < INTERVALO_HEARTBEAT:
            return
        self.enviar("/api/gateway/heartbeat",
                    {"nodo": NODO, "rssi": self.rssi(), "bateriaMv": random.randint(3900, 4150)})
        self.ultimo_heartbeat = time.time()

    def arrancar(self):
        print(f"Simulador de {NODO} contra {self.backend}")
        if self.trabadas:
            print(f"  puertas trabadas a proposito: {', '.join(sorted(self.trabadas))}")
        if self.perdida:
            print(f"  perdida de paquetes simulada: {self.perdida}%")
        print("Ctrl+C para salir.\n")

        while True:
            try:
                respuesta = self.sesion.get(f"{self.backend}/api/gateway/comandos", timeout=5)
                for comando in respuesta.json().get("comandos", []):
                    self.procesar_comando(comando)
                self.revisar_puertas()
                self.heartbeat()
            except requests.exceptions.ConnectionError:
                print("  ! el backend no responde (¿npm start esta corriendo?)")
            except Exception as e:
                print(f"  ! {e}")
            time.sleep(INTERVALO_POLL)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Simulador de nodo LoRa para el panol")
    parser.add_argument("--backend", default="http://localhost:3000")
    parser.add_argument("--trabar", nargs="*", default=[],
                        help="casilleros que nunca cierran, ej: --trabar A-03")
    parser.add_argument("--perder", type=int, default=0,
                        help="porcentaje de comandos que se pierden (0-100)")
    argumentos = parser.parse_args()

    try:
        SimuladorNodo(argumentos.backend, set(argumentos.trabar), argumentos.perder).arrancar()
    except KeyboardInterrupt:
        print("\nSimulador detenido.")
