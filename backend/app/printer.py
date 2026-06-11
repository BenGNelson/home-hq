"""
3D-printer telemetry over local MQTT (Bambu Lab P1S in LAN mode).

This is the project's only *push*-based data source. Every other endpoint pulls
on request (psutil, the Docker SDK, a file read). A printer instead publishes a
telemetry blob to a local MQTT broker, so we keep one persistent background
connection alive and cache the latest snapshot; `/api/printer` just hands back
that cache. No cloud, no Bambu account — purely LAN.

How the Bambu LAN protocol works:
  * The printer runs an MQTT broker, TLS on :8883, with a self-signed cert
    (so we verify nothing — it's a LAN device we already trust by IP).
  * Auth is username "bblp" + the printer's LAN *access code* (a secret).
  * It publishes state to   device/<serial>/report
    and accepts commands on device/<serial>/request.
  * On connect we send a "pushall" so the printer dumps its full state once;
    after that it sends *partial* updates, so we deep-merge each message into a
    running state dict.

Everything host-specific (host, serial, access code) comes from config/.env, so
this file is fully generic and safe to commit.
"""

from __future__ import annotations

import json
import logging
import ssl
import threading
import time
from typing import Any

import paho.mqtt.client as mqtt

log = logging.getLogger("home-hq.printer")

# Bambu's fixed LAN MQTT username; the password is the per-printer access code.
_MQTT_USERNAME = "bblp"
# If we haven't heard from the printer in this many seconds, treat the cached
# snapshot as stale (printer powered off / off the network).
_STALE_AFTER_SECONDS = 60

# A few human-readable labels for the printer's "current stage" code. Bambu
# publishes many; we map the common ones and fall back to None for the rest.
_STAGE_LABELS = {
    -1: "Idle",
    0: "Printing",
    1: "Auto bed leveling",
    2: "Heatbed preheating",
    3: "Sweeping XY mech mode",
    4: "Changing filament",
    5: "M400 pause",
    7: "Cleaning nozzle",
    9: "Paused by user",
    10: "Front cover fell off",
    14: "Cleaning nozzle tip",
    16: "Cooling chamber",
    21: "Calibrating extrusion flow",
}


def _deep_merge(base: dict, update: dict) -> dict:
    """Recursively merge `update` into `base` in place (Bambu sends deltas)."""
    for key, value in update.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _deep_merge(base[key], value)
        else:
            base[key] = value
    return base


def _to_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _to_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def parse_state(print_state: dict) -> dict:
    """
    Map the printer's raw merged `print` sub-object into our clean API model.

    Pure and defensive: every field is optional (reports are partial), so each
    lookup tolerates a missing/garbage value and returns None rather than
    raising. This is the unit-tested core — see tests/test_printer.py.
    """
    p = print_state or {}

    # Chamber light state lives in a list of {node, mode} entries.
    light = None
    for entry in p.get("lights_report", []) or []:
        if entry.get("node") == "chamber_light":
            light = entry.get("mode") == "on"

    # AMS: zero or more units, each with up to 4 filament trays.
    ams_units = []
    ams_root = p.get("ams", {}) or {}
    active_tray = ams_root.get("tray_now")
    for unit in ams_root.get("ams", []) or []:
        trays = []
        for tray in unit.get("tray", []) or []:
            color = tray.get("tray_color")  # 8-hex RGBA, e.g. "FF6A13FF"
            trays.append(
                {
                    "slot": _to_int(tray.get("id")),
                    "type": tray.get("tray_type") or None,
                    "color": color[:6] if color else None,  # drop alpha for CSS
                    "remain": _to_int(tray.get("remain")),  # % remaining, -1 = unknown
                    "active": tray.get("id") == active_tray,
                }
            )
        ams_units.append(
            {
                "id": _to_int(unit.get("id")),
                "humidity": _to_int(unit.get("humidity")),
                "temp": _to_float(unit.get("temp")),
                "trays": trays,
            }
        )

    # HMS = the printer's health/error codes (empty list when all is well).
    hms = []
    for item in p.get("hms", []) or []:
        hms.append({"attr": item.get("attr"), "code": item.get("code")})

    stage_code = _to_int(p.get("stg_cur"))

    return {
        "state": p.get("gcode_state"),  # IDLE / PREPARE / RUNNING / PAUSE / FINISH / FAILED
        "stage": _STAGE_LABELS.get(stage_code) if stage_code is not None else None,
        "file": p.get("subtask_name") or p.get("gcode_file") or None,
        "progress": _to_int(p.get("mc_percent")),
        "layer": _to_int(p.get("layer_num")),
        "total_layers": _to_int(p.get("total_layer_num")),
        "remaining_min": _to_int(p.get("mc_remaining_time")),
        "nozzle": {
            "current": _to_float(p.get("nozzle_temper")),
            "target": _to_float(p.get("nozzle_target_temper")),
        },
        "bed": {
            "current": _to_float(p.get("bed_temper")),
            "target": _to_float(p.get("bed_target_temper")),
        },
        "chamber": _to_float(p.get("chamber_temper")),
        "fans": {
            "part": _to_int(p.get("cooling_fan_speed")),
            "aux": _to_int(p.get("big_fan1_speed")),
            "chamber": _to_int(p.get("big_fan2_speed")),
        },
        "speed_level": _to_int(p.get("spd_lvl")),
        "light": light,
        "ams": ams_units,
        "hms": hms,
    }


class PrinterClient:
    """
    Persistent MQTT client that caches the printer's latest state.

    Lives for the process lifetime (started/stopped from the app lifespan).
    paho runs its own network thread, so reads from the request thread are
    guarded by a lock. If nothing is configured, `start()` is a no-op and
    `snapshot()` reports the printer as simply not configured.
    """

    def __init__(
        self,
        host: str,
        serial: str,
        access_code: str,
        port: int = 8883,
        name: str = "3D Printer",
    ):
        self._host = host
        self._serial = serial
        self._access_code = access_code
        self._port = port
        self._name = name
        self._configured = bool(host and serial and access_code)

        self._lock = threading.Lock()
        self._state: dict = {}  # merged raw `print` object
        self._connected = False
        self._last_message_at: float | None = None
        self._client: mqtt.Client | None = None

    # --- lifecycle ---------------------------------------------------------

    def start(self) -> None:
        if not self._configured:
            log.info("printer: not configured (set PRINTER_HOST/SERIAL/ACCESS_CODE) — skipping")
            return

        client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=f"home-hq-{int(time.time())}",
            protocol=mqtt.MQTTv311,
        )
        client.username_pw_set(_MQTT_USERNAME, self._access_code)
        # Bambu uses a self-signed cert on a LAN device we address by IP, so we
        # encrypt but don't verify the chain (there's nothing to verify against).
        client.tls_set(cert_reqs=ssl.CERT_NONE)
        client.tls_insecure_set(True)
        client.on_connect = self._on_connect
        client.on_disconnect = self._on_disconnect
        client.on_message = self._on_message
        # Keep retrying with backoff if the printer is unreachable/asleep.
        client.reconnect_delay_set(min_delay=1, max_delay=30)

        self._client = client
        try:
            client.connect_async(self._host, self._port, keepalive=60)
            client.loop_start()
            log.info("printer: connecting to %s:%s", self._host, self._port)
        except Exception as exc:  # pragma: no cover - network dependent
            log.warning("printer: initial connect failed: %s", exc)

    def stop(self) -> None:
        if self._client is not None:
            try:
                self._client.loop_stop()
                self._client.disconnect()
            except Exception:  # pragma: no cover
                pass
            self._client = None

    # --- MQTT callbacks (run on paho's network thread) ---------------------

    def _report_topic(self) -> str:
        return f"device/{self._serial}/report"

    def _request_topic(self) -> str:
        return f"device/{self._serial}/request"

    def _on_connect(self, client, userdata, flags, reason_code, properties=None):
        if reason_code != 0:
            log.warning("printer: connect refused (reason=%s)", reason_code)
            return
        with self._lock:
            self._connected = True
        client.subscribe(self._report_topic())
        # Ask the printer to dump its full state once; subsequent messages are
        # partial deltas that we merge on top.
        client.publish(
            self._request_topic(),
            json.dumps({"pushing": {"sequence_id": "0", "command": "pushall"}}),
        )
        log.info("printer: connected, subscribed to %s", self._report_topic())

    def _on_disconnect(self, client, userdata, *args):
        with self._lock:
            self._connected = False
        log.info("printer: disconnected")

    def _on_message(self, client, userdata, msg):
        try:
            payload = json.loads(msg.payload)
        except (ValueError, TypeError):
            return
        # Telemetry we care about lives under the "print" key.
        print_update = payload.get("print")
        if not isinstance(print_update, dict):
            return
        with self._lock:
            _deep_merge(self._state, print_update)
            self._last_message_at = time.time()

    # --- read side (request thread) ----------------------------------------

    def snapshot(self) -> dict:
        """Return the API model: {available, ...} with graceful degradation."""
        if not self._configured:
            return {"available": False, "reason": "not_configured"}

        with self._lock:
            connected = self._connected
            last = self._last_message_at
            state_copy = json.loads(json.dumps(self._state)) if self._state else {}

        if not state_copy or last is None:
            return {"available": False, "reason": "no_data", "name": self._name, "connected": connected}

        stale = (time.time() - last) > _STALE_AFTER_SECONDS
        if stale or not connected:
            return {"available": False, "reason": "offline", "name": self._name, "connected": connected}

        return {"available": True, "name": self._name, "printer": parse_state(state_copy)}


# Process-wide singleton, wired up in app lifespan (main.py). Created lazily so
# tests can import parse_state without standing up a client.
_client: PrinterClient | None = None


def init_client(
    host: str, serial: str, access_code: str, port: int = 8883, name: str = "3D Printer"
) -> PrinterClient:
    global _client
    _client = PrinterClient(host, serial, access_code, port, name)
    return _client


def get_client() -> PrinterClient | None:
    return _client
