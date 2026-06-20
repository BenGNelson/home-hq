"""Tests for the Home Assistant bridge summarizer (pure, no real file)."""

from app.routers.ha import _STALE_AFTER_SECONDS, _shape_entity, summarize

NOW = 1_000_000.0

OK = {
    "updated": NOW - 30,
    "available": True,
    "entities": [
        {
            "entity_id": "sensor.dryer_time_remaining",
            "name": "Dryer time remaining",
            "state": "42",
            "unit": "min",
            "device_class": "duration",
        },
        {
            "entity_id": "sensor.phone_battery",
            "name": "Phone battery",
            "state": "15",
            "unit": "%",
            "device_class": "battery",
        },
    ],
}


def test_ok_shapes_entities_in_order():
    out = summarize(OK, now=NOW)
    assert out["available"] is True
    assert out["reason"] is None
    assert out["stale"] is False
    assert out["count"] == 2
    # Order is preserved (the collector follows the allowlist order).
    assert [e["entity_id"] for e in out["entities"]] == [
        "sensor.dryer_time_remaining",
        "sensor.phone_battery",
    ]


def test_domain_is_derived_from_entity_id():
    out = summarize(OK, now=NOW)
    assert out["entities"][0]["domain"] == "sensor"


def test_stale_when_old():
    old = {**OK, "updated": NOW - _STALE_AFTER_SECONDS - 1}
    assert summarize(old, now=NOW)["stale"] is True


def test_not_configured_passes_through():
    out = summarize({"updated": NOW, "available": False, "reason": "not_configured"}, now=NOW)
    assert out["available"] is False
    assert out["reason"] == "not_configured"
    assert out["count"] == 0
    assert out["entities"] == []


def test_unreachable_passes_through():
    out = summarize({"updated": NOW, "available": False, "reason": "unreachable"}, now=NOW)
    assert out["reason"] == "unreachable"


def test_unavailable_without_reason_defaults_to_no_data():
    out = summarize({"available": False}, now=NOW)
    assert out["reason"] == "no_data"
    assert out["stale"] is True  # no updated -> stale


def test_empty_entities_is_available_with_zero_count():
    out = summarize({"updated": NOW, "available": True, "entities": []}, now=NOW)
    assert out["available"] is True
    assert out["count"] == 0


def test_shape_entity_is_defensive():
    # Non-dict, missing id, and a None state are all handled.
    assert _shape_entity("nope") is None
    assert _shape_entity({"state": "on"}) is None
    e = _shape_entity({"entity_id": "lock.front_door", "state": None})
    assert e["state"] == ""
    assert e["domain"] == "lock"
    # Name falls back to a prettified id when friendly_name is absent.
    assert e["name"] == "Front Door"
    assert e["unit"] is None


def test_garbage_entities_dropped_but_good_kept():
    data = {
        "updated": NOW,
        "available": True,
        "entities": [
            {"entity_id": "sensor.good", "state": "1"},
            "bogus",
            {"no_id": True},
        ],
    }
    out = summarize(data, now=NOW)
    assert out["count"] == 1
    assert out["entities"][0]["entity_id"] == "sensor.good"
