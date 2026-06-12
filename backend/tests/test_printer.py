"""Tests for the printer telemetry parser and the snapshot/degradation logic.

No real printer or MQTT broker is needed: we exercise the pure `parse_state`
mapper and drive `PrinterClient` by setting its cached state directly, the same
way an incoming MQTT message would.
"""

import json
import time

import pytest

from app import db
from app.printer import (
    PrinterClient,
    _deep_merge,
    build_print_record,
    next_finished_at,
    parse_state,
)

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
    assert m["stage"] is None  # stg_cur 0 = plain printing → no redundant label
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


def test_parse_state_labels_special_stage():
    # Noteworthy sub-states (not 0/-1) get a friendly label.
    assert parse_state({**SAMPLE_PRINT, "stg_cur": 2})["stage"] == "Heatbed preheating"
    # Idle / nominal codes stay unlabeled.
    assert parse_state({**SAMPLE_PRINT, "stg_cur": -1})["stage"] is None


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
    # Carries the last-known state so an alerter can tell mid-print death apart.
    assert snap["last_state"] == "RUNNING"


def test_snapshot_available_with_fresh_data():
    c = PrinterClient(host="10.0.0.5", serial="ABC", access_code="x")
    c._connected = True
    c._state = dict(SAMPLE_PRINT)
    c._last_message_at = time.time()
    snap = c.snapshot()
    assert snap["available"] is True
    assert snap["printer"]["progress"] == 42
    assert snap["printer"]["state"] == "RUNNING"
    # No finish stamp while printing → no elapsed field.
    assert "finished_ago_seconds" not in snap["printer"]


def test_snapshot_reports_finished_elapsed():
    c = PrinterClient(host="10.0.0.5", serial="ABC", access_code="x")
    c._connected = True
    c._state = {**SAMPLE_PRINT, "gcode_state": "FINISH"}
    c._last_message_at = time.time()
    c._finished_at = time.time() - 7200  # finished 2h ago
    snap = c.snapshot()
    assert snap["available"] is True
    assert snap["printer"]["state"] == "FINISH"
    assert 7195 <= snap["printer"]["finished_ago_seconds"] <= 7205


# --- finish-time tracking (drives the "finished N ago" UI) ---


def test_next_finished_at_stamps_on_entry_and_holds():
    # Enters FINISH → stamped now; stays FINISH → preserved.
    t0 = 1000.0
    stamped = next_finished_at("RUNNING", "FINISH", None, t0)
    assert stamped == t0
    held = next_finished_at("FINISH", "FINISH", stamped, t0 + 500)
    assert held == t0  # not re-stamped while it sits there


def test_next_finished_at_clears_when_leaving_terminal():
    assert next_finished_at("FINISH", "PREPARE", 1000.0, 2000.0) is None
    assert next_finished_at("FINISH", "RUNNING", 1000.0, 2000.0) is None


def test_next_finished_at_covers_failed_too():
    assert next_finished_at("RUNNING", "FAILED", None, 1234.0) == 1234.0


# --- print history recording ---


def test_build_print_record_success_with_duration():
    state = {"subtask_name": "benchy", "layer_num": 200, "total_layer_num": 200}
    rec = build_print_record("RUNNING", "FINISH", state, started_at=1000.0, now=4600.0)
    assert rec["result"] == "success"
    assert rec["file"] == "benchy"
    assert rec["duration_s"] == 3600
    assert rec["layers"] == 200 and rec["total_layers"] == 200


def test_build_print_record_failed_from_pause():
    rec = build_print_record("PAUSE", "FAILED", {"subtask_name": "x"}, 1000.0, 1500.0)
    assert rec["result"] == "failed" and rec["duration_s"] == 500


def test_build_print_record_ignores_unwatched_and_non_terminal():
    # Restart that only observes an already-finished print (prev None) → no log.
    assert build_print_record(None, "FINISH", {}, None, 10.0) is None
    # A pause mid-print isn't a completion.
    assert build_print_record("RUNNING", "PAUSE", {}, 1.0, 2.0) is None


def test_build_print_record_tolerates_unknown_start():
    rec = build_print_record("RUNNING", "FINISH", {"subtask_name": "y"}, None, 50.0)
    assert rec["result"] == "success" and rec["duration_s"] is None


def test_print_history_db_and_stats():
    db.record_print(build_print_record("RUNNING", "FINISH", {"subtask_name": "a"}, 0.0, 100.0))
    db.record_print(build_print_record("RUNNING", "FAILED", {"subtask_name": "b"}, 0.0, 40.0))
    stats = db.print_stats()
    assert stats["total"] == 2 and stats["successes"] == 1 and stats["failures"] == 1
    assert stats["success_rate"] == 0.5
    assert stats["total_print_seconds"] == 140
    # recent_prints is newest-first by ended_at.
    assert [p["file"] for p in db.recent_prints()] == ["a", "b"]


def test_print_stats_empty():
    s = db.print_stats()
    assert s["total"] == 0 and s["success_rate"] is None


def test_history_endpoint(client):
    db.record_print(build_print_record("RUNNING", "FINISH", {"subtask_name": "z"}, 0.0, 10.0))
    body = client.get("/api/printer/history").json()
    assert body["available"] is True
    assert body["stats"]["total"] == 1
    assert body["prints"][0]["file"] == "z"


def test_endpoint_degrades_when_unconfigured(client):
    # With no printer env set, the endpoint must never error — just report
    # unavailable. (get_client() is None or an unconfigured client.)
    body = client.get("/api/printer").json()
    assert body["available"] is False
    assert body["reason"] == "not_configured"


# --- control commands ---


class _FakeMqtt:
    def __init__(self):
        self.published = []

    def publish(self, topic, payload):
        self.published.append((topic, payload))


def _connected_client():
    c = PrinterClient(host="10.0.0.5", serial="SER", access_code="x")
    c._client = _FakeMqtt()
    c._connected = True
    return c


def test_send_command_pause_publishes_to_request_topic():
    c = _connected_client()
    assert c.send_command("pause") is True
    topic, payload = c._client.published[0]
    assert topic == "device/SER/request"
    assert json.loads(payload)["print"]["command"] == "pause"


def test_send_command_light_toggles_ledctrl():
    c = _connected_client()
    c.send_command("light_off")
    body = json.loads(c._client.published[0][1])
    assert body["system"]["command"] == "ledctrl"
    assert body["system"]["led_node"] == "chamber_light"
    assert body["system"]["led_mode"] == "off"


def test_send_command_returns_false_when_not_connected():
    c = PrinterClient(host="10.0.0.5", serial="SER", access_code="x")  # no _client
    assert c.send_command("pause") is False


def test_send_command_rejects_unknown_action():
    c = _connected_client()
    with pytest.raises(ValueError):
        c.send_command("self_destruct")


def test_command_endpoint_rejects_unknown_action(client):
    assert client.post("/api/printer/command", json={"action": "boom"}).status_code == 400


def test_command_endpoint_503_when_not_connected(client):
    # Unconfigured client (blanked env) can't send → 503, never a 500.
    assert client.post("/api/printer/command", json={"action": "pause"}).status_code == 503
