"""Tests for the read-only Home Assistant bridge helpers (app.ha).

Pure logic only — entity-id validation, camera selection/sorting, the optional
allowlist, and the configured() gate. No network: fetch is never called."""

from app import ha
from app.config import settings


def test_camera_id_validation(monkeypatch):
    monkeypatch.setattr(settings, "ha_camera_entities", "")
    assert ha.is_allowed_camera("camera.backyard")
    assert ha.is_allowed_camera("camera.front_doorbell")
    # Wrong domain, bad characters, and path-abuse attempts are all rejected.
    assert not ha.is_allowed_camera("sensor.temperature")
    assert not ha.is_allowed_camera("camera.Backyard")  # uppercase
    assert not ha.is_allowed_camera("camera.back/../api")
    assert not ha.is_allowed_camera("camera.")


def test_allowlist_enforced(monkeypatch):
    monkeypatch.setattr(settings, "ha_camera_entities", "camera.backyard, camera.front_doorbell")
    assert ha.is_allowed_camera("camera.backyard")
    assert ha.is_allowed_camera("camera.front_doorbell")
    assert not ha.is_allowed_camera("camera.garage")  # valid id, not on the list


def test_select_cameras_filters_and_sorts(monkeypatch):
    monkeypatch.setattr(settings, "ha_camera_entities", "")
    states = [
        {"entity_id": "camera.zed", "state": "streaming", "attributes": {"friendly_name": "Zed"}},
        {"entity_id": "sensor.x", "state": "1", "attributes": {}},
        {"entity_id": "camera.abe", "state": "idle", "attributes": {"friendly_name": "Abe"}},
    ]
    out = ha.select_cameras(states)
    assert [c["entity_id"] for c in out] == ["camera.abe", "camera.zed"]
    assert out[0]["name"] == "Abe"
    assert out[1]["state"] == "streaming"


def test_select_cameras_respects_allowlist(monkeypatch):
    monkeypatch.setattr(settings, "ha_camera_entities", "camera.abe")
    states = [
        {"entity_id": "camera.zed", "attributes": {"friendly_name": "Zed"}},
        {"entity_id": "camera.abe", "attributes": {"friendly_name": "Abe"}},
    ]
    out = ha.select_cameras(states)
    assert [c["entity_id"] for c in out] == ["camera.abe"]


def test_select_cameras_falls_back_to_entity_id(monkeypatch):
    monkeypatch.setattr(settings, "ha_camera_entities", "")
    out = ha.select_cameras([{"entity_id": "camera.no_name", "attributes": {}}])
    assert out[0]["name"] == "camera.no_name"


def test_configured(monkeypatch):
    monkeypatch.setattr(settings, "ha_url", "")
    monkeypatch.setattr(settings, "ha_token", "")
    assert not ha.configured()
    monkeypatch.setattr(settings, "ha_url", "http://gateway:8123")
    monkeypatch.setattr(settings, "ha_token", "tok")
    assert ha.configured()


def test_list_cameras_not_configured(monkeypatch):
    monkeypatch.setattr(settings, "ha_url", "")
    monkeypatch.setattr(settings, "ha_token", "")
    res = ha.list_cameras()
    assert res == {"available": False, "reason": "not_configured", "cameras": []}
