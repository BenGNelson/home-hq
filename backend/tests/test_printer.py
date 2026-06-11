"""Tests for the printer telemetry parser and the snapshot/degradation logic.

No real printer or MQTT broker is needed: we exercise the pure `parse_state`
mapper and drive `PrinterClient` by setting its cached state directly, the same
way an incoming MQTT message would.
"""

import time

from app.printer import PrinterClient, _deep_merge, parse_state

# A representative merged `print` object (what we hold after pushall + deltas).
SAMPLE_PRINT = {
    "gcode_state": "RUNNING",
    "stg_cur": 0,
    "subtask_name": "benchy",
    "gcode_file": "benchy.gcode.3mf",
    "mc_percent": 42,
    "layer_num": 84,
    "total_layer_num": 200,
    "mc_remaining_time": 37,
    "nozzle_temper": 219.5,
    "nozzle_target_temper": 220.0,
    "bed_temper": 60.0,
    "bed_target_temper": 60.0,
    "chamber_temper": 31.0,
    "cooling_fan_speed": "100",
    "big_fan1_speed": "20",
    "big_fan2_speed": "0",
    "spd_lvl": 2,
    "lights_report": [{"node": "chamber_light", "mode": "on"}],
    "ams": {
        "tray_now": "0",
        "ams": [
            {
                "id": "0",
                "humidity": "5",
                "temp": "28.0",
                "tray": [
                    {"id": "0", "tray_type": "PLA", "tray_color": "FF6A13FF", "remain": 80},
                    {"id": "1", "tray_type": "PETG", "tray_color": "0A7E07FF", "remain": 35},
                ],
            }
        ],
    },
    "hms": [],
}


def test_parse_state_maps_core_fields():
    m = parse_state(SAMPLE_PRINT)
    assert m["state"] == "RUNNING"
    assert m["stage"] == "Printing"
    assert m["file"] == "benchy"
    assert m["progress"] == 42
    assert m["layer"] == 84 and m["total_layers"] == 200
    assert m["remaining_min"] == 37
    assert m["nozzle"] == {"current": 219.5, "target": 220.0}
    assert m["bed"] == {"current": 60.0, "target": 60.0}
    assert m["chamber"] == 31.0
    assert m["fans"] == {"part": 100, "aux": 20, "chamber": 0}
    assert m["speed_level"] == 2
    assert m["light"] is True
    assert m["hms"] == []


def test_parse_state_maps_ams():
    ams = parse_state(SAMPLE_PRINT)["ams"]
    assert len(ams) == 1
    unit = ams[0]
    assert unit["id"] == 0 and unit["humidity"] == 5
    assert len(unit["trays"]) == 2
    first = unit["trays"][0]
    assert first["type"] == "PLA"
    assert first["color"] == "FF6A13"  # alpha stripped for CSS
    assert first["remain"] == 80
    assert first["active"] is True  # tray_now == "0"
    assert unit["trays"][1]["active"] is False


def test_parse_state_is_defensive_on_empty():
    m = parse_state({})
    assert m["state"] is None
    assert m["progress"] is None
    assert m["nozzle"] == {"current": None, "target": None}
    assert m["ams"] == [] and m["hms"] == []
    assert m["light"] is None


def test_deep_merge_applies_partial_deltas():
    base = {"a": 1, "nest": {"x": 1, "y": 2}}
    _deep_merge(base, {"a": 9, "nest": {"y": 5, "z": 3}})
    assert base == {"a": 9, "nest": {"x": 1, "y": 5, "z": 3}}


def test_snapshot_not_configured():
    c = PrinterClient(host="", serial="", access_code="")
    assert c.snapshot() == {"available": False, "reason": "not_configured"}


def test_snapshot_no_data_when_connected_but_silent():
    c = PrinterClient(host="10.0.0.5", serial="ABC", access_code="x")
    c._connected = True  # connected but no report received yet
    snap = c.snapshot()
    assert snap["available"] is False and snap["reason"] == "no_data"


def test_snapshot_offline_when_stale():
    c = PrinterClient(host="10.0.0.5", serial="ABC", access_code="x")
    c._connected = True
    c._state = dict(SAMPLE_PRINT)
    c._last_message_at = time.time() - 3600  # an hour ago
    snap = c.snapshot()
    assert snap["available"] is False and snap["reason"] == "offline"


def test_snapshot_available_with_fresh_data():
    c = PrinterClient(host="10.0.0.5", serial="ABC", access_code="x")
    c._connected = True
    c._state = dict(SAMPLE_PRINT)
    c._last_message_at = time.time()
    snap = c.snapshot()
    assert snap["available"] is True
    assert snap["printer"]["progress"] == 42
    assert snap["printer"]["state"] == "RUNNING"


def test_endpoint_degrades_when_unconfigured(client):
    # With no printer env set, the endpoint must never error — just report
    # unavailable. (get_client() is None or an unconfigured client.)
    body = client.get("/api/printer").json()
    assert body["available"] is False
    assert body["reason"] == "not_configured"
