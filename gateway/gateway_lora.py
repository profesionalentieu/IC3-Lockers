#!/usr/bin/env python3
"""
Puente entre el backend web y la red LoRa.

Corre en la PC o Raspberry Pi que tiene conectada por USB la placa
XIAO ESP32S3 que hace de gateway. Tiene dos mitades:

    BAJADA  backend  --HTTP/WS-->  gateway  --serie-->  XIAO  --LoRa-->  nodo
    SUBIDA  nodo     --LoRa------>  XIAO   --serie-->  gateway --HTTP--> backend

Protocolo por el puerto serie (una linea JSON por trama, facil de
depurar con el monitor serie del Arduino IDE):

    PC  -> XIAO :  {"id":12,"nodo":"NODO-A","bit":0,"accion":"ABRIR"}
    XIAO -> PC  :  {"tipo":"ack","id":12,"ok":true,"rssi":-74}
                   {"tipo":"telemetria","nodo":"NODO-A","lecturas":[{"bit":0,"puertaAbierta":true}],"rssi":-74}
                   {"tipo":"heartbeat","nodo":"NODO-A","rssi":-74,"bateriaMv":4020}

Uso:
    pip install requests pyserial websocket-client
    python gateway_lora.py --puerto /dev/ttyACM0 --backend http://192.168.0.10:3000
"""

import argparse
import json
import threading
import time

import requests
import serial

API_KEY = "gw-lora-unraf-2025"      # debe coincidir con GATEWAY_API_KEY del backend
INTERVALO_POLL = 2.0                # segundos entre consultas de comandos
TIMEOUT_HTTP = 5


class Gateway:
    def __init__(self, backend: str, puerto_serie: str, baudios: int = 115200):
        self.backend = backend.rstrip("/")
        self.sesion = requests.Session()
        self.sesion.headers.update({"x-api-key": API_KEY, "Content-Type": "application/json"})
        self.serie = serial.Serial(puerto_serie, baudios, timeout=1)
        self.corriendo = True
        time.sleep(2)  # el ESP32S3 se reinicia al abrir el puerto

    # ---------- BAJADA: comandos del backend hacia los nodos ----------

    def transmitir(self, comando: dict) -> None:
        """Manda un comando por serie al XIAO gateway, que lo emite por LoRa."""
        trama = {
            "id": comando["id"],
            "nodo": comando["nodo"],
            "bit": comando["bit"],          # salida del SN74HC595 -> MOSFET IRLZ44N
            "accion": comando["accion"],
        }
        self.serie.write((json.dumps(trama) + "\n").encode())
        print(f"-> LoRa {trama}")

    def bucle_polling(self) -> None:
        """
        Consulta periodica de comandos pendientes.
        Es el camino confiable: aunque se caiga el WebSocket, el gateway
        sigue tomando trabajo cada INTERVALO_POLL segundos.
        """
        while self.corriendo:
            try:
                respuesta = self.sesion.get(
                    f"{self.backend}/api/gateway/comandos", timeout=TIMEOUT_HTTP
                )
                for comando in respuesta.json().get("comandos", []):
                    self.transmitir(comando)
            except Exception as e:
                print(f"[poll] sin backend: {e}")
            time.sleep(INTERVALO_POLL)

    def bucle_websocket(self) -> None:
        """
        Camino rapido (opcional): el backend empuja el comando apenas el
        alumno toca el boton, sin esperar al proximo poll. Si el WS no
        conecta, no pasa nada: el polling cubre igual.
        """
        try:
            import websocket  # websocket-client
        except ImportError:
            print("[ws] websocket-client no instalado, uso solo polling")
            return

        url = self.backend.replace("http", "ws") + f"/ws?apiKey={API_KEY}"

        def al_recibir(_ws, mensaje):
            datos = json.loads(mensaje)
            if datos.get("evento") == "comando.nuevo":
                self.transmitir(datos["datos"])

        while self.corriendo:
            try:
                ws = websocket.WebSocketApp(url, on_message=al_recibir)
                ws.run_forever()
            except Exception as e:
                print(f"[ws] reconectando: {e}")
            time.sleep(5)

    # ---------- SUBIDA: telemetria de los nodos hacia el backend ----------

    def bucle_serie(self) -> None:
        """Lee las tramas que llegan del XIAO y las reenvia al backend."""
        while self.corriendo:
            linea = self.serie.readline().decode(errors="ignore").strip()
            if not linea:
                continue
            try:
                trama = json.loads(linea)
            except json.JSONDecodeError:
                print(f"[serie] descartada: {linea}")
                continue

            tipo = trama.get("tipo")
            try:
                if tipo == "ack":
                    self.sesion.post(
                        f"{self.backend}/api/gateway/comandos/{trama['id']}/ack",
                        json={"ok": trama.get("ok", True), "detalle": trama.get("detalle")},
                        timeout=TIMEOUT_HTTP,
                    )
                    print(f"<- ACK comando {trama['id']}")

                elif tipo == "telemetria":
                    # Estado de los finales de carrera de cada puerta
                    self.sesion.post(
                        f"{self.backend}/api/gateway/telemetria",
                        json={
                            "nodo": trama["nodo"],
                            "lecturas": trama["lecturas"],
                            "rssi": trama.get("rssi"),
                        },
                        timeout=TIMEOUT_HTTP,
                    )
                    print(f"<- telemetria {trama['nodo']} {trama['lecturas']}")

                elif tipo == "heartbeat":
                    self.sesion.post(
                        f"{self.backend}/api/gateway/heartbeat",
                        json={
                            "nodo": trama["nodo"],
                            "rssi": trama.get("rssi"),
                            "bateriaMv": trama.get("bateriaMv"),
                        },
                        timeout=TIMEOUT_HTTP,
                    )
            except Exception as e:
                # Si el backend esta caido, el nodo seguira reportando:
                # el estado se corrige solo en el proximo heartbeat.
                print(f"[subida] error enviando al backend: {e}")

    def arrancar(self) -> None:
        hilos = [
            threading.Thread(target=self.bucle_polling, daemon=True),
            threading.Thread(target=self.bucle_websocket, daemon=True),
            threading.Thread(target=self.bucle_serie, daemon=True),
        ]
        for h in hilos:
            h.start()
        print("Gateway LoRa en marcha. Ctrl+C para salir.")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            self.corriendo = False
            print("\nCerrando gateway...")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Gateway LoRa <-> backend web")
    parser.add_argument("--puerto", default="/dev/ttyACM0", help="puerto serie del XIAO gateway")
    parser.add_argument("--backend", default="http://localhost:3000", help="URL del backend")
    parser.add_argument("--baudios", type=int, default=115200)
    argumentos = parser.parse_args()

    Gateway(argumentos.backend, argumentos.puerto, argumentos.baudios).arrancar()
