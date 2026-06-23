"""Tests for the Home Catalog summarizer (pure, no real file)."""

from app.routers.catalog import _norm_item, _prettify, summarize

SAMPLE = {
    "meta": {"last_updated": "2026-06-23", "scope": "devices, tools", "ha_summary": "x"},
    "floors": {
        "basement": {
            "finished_side": {
                "items": [
                    {"name": "Home server", "category": "infrastructure"},
                    {"name": "TV", "category": "device", "brand": "TCL"},
                ]
            },
            "unfinished_side": {
                "items": [
                    {
                        "name": "3D printer",
                        "category": "tool",
                        "brand": "Bambu Lab",
                        "model": "P1S",
                    },
                ]
            },
        },
        "first_floor": {
            "kitchen": {
                "items": [
                    {
                        "name": "Thermostat",
                        "category": "device",
                        "in_ha": True,
                        "entity": "climate.kitchen",
                    },
                ]
            },
            "dining_room": {"items": []},
        },
    },
    "outside": {"items": [{"name": "Car", "category": "vehicle", "in_ha": True}]},
    "spares": {"items": [{"name": "Plug", "category": "device", "qty": 2}]},
    "infrastructure": {
        "network_topology": "Router  is\n   hardwired.",
        "mobile_devices": [{"name": "Phone", "category": "device", "in_ha": True}],
    },
}


def test_available_and_structure():
    out = summarize(SAMPLE)
    assert out["available"] is True
    assert out["reason"] is None
    # Floors preserved in file order, with prettified labels.
    assert [f["id"] for f in out["floors"]] == ["basement", "first_floor"]
    assert out["floors"][0]["label"] == "Basement"
    rooms = out["floors"][0]["rooms"]
    assert [r["label"] for r in rooms] == ["Finished Side", "Unfinished Side"]


def test_empty_room_kept_with_empty_items():
    out = summarize(SAMPLE)
    first = next(f for f in out["floors"] if f["id"] == "first_floor")
    dining = next(r for r in first["rooms"] if r["id"] == "dining_room")
    assert dining["items"] == []


def test_stats_count_in_ha_and_categories():
    s = summarize(SAMPLE)["stats"]
    # 2 + 1 + 1 (floors) + 1 outside + 1 spares + 1 infra = 7
    assert s["total"] == 7
    # thermostat + car + phone
    assert s["in_ha"] == 3
    assert s["by_category"]["device"] == 4
    assert s["by_category"]["tool"] == 1
    assert s["flagged"] == 0


def test_infrastructure_topology_whitespace_collapsed():
    infra = summarize(SAMPLE)["infrastructure"]
    assert infra["topology"] == "Router is hardwired."
    assert [i["name"] for i in infra["items"]] == ["Phone"]


def test_flag_set_when_notes_have_warning():
    item = _norm_item({"name": "Printer", "notes": "⚠️ network or USB?"})
    assert item["flag"] is True
    assert _norm_item({"name": "X", "notes": "fine"})["flag"] is False


def test_norm_item_drops_nameless_and_coerces_qty():
    assert _norm_item({"category": "device"}) is None
    assert _norm_item("not a dict") is None
    assert _norm_item({"name": "X", "qty": 3})["qty"] == "3"


def test_non_string_category_is_coerced_not_crashing():
    # Malformed YAML: category as an int or a list must not crash (it's a stats
    # dict key + a frontend label). It becomes a string; empty stays None.
    assert _norm_item({"name": "X", "category": 2})["category"] == "2"
    assert _norm_item({"name": "X", "category": ["a", "b"]})["category"] == "['a', 'b']"
    assert _norm_item({"name": "X", "category": ""})["category"] is None
    # summarize() must survive a list category end-to-end (stats tally).
    out = summarize({"floors": {"f": {"r": {"items": [{"name": "X", "category": ["a"]}]}}}})
    assert out["available"] is True
    assert out["stats"]["total"] == 1


def test_unavailable_on_garbage():
    for bad in (None, {}, [], "nope", 5):
        out = summarize(bad)
        assert out["available"] is False
        assert out["reason"] == "no_data"
        assert out["floors"] == []


def test_prettify():
    assert _prettify("main_bedroom") == "Main Bedroom"
    assert _prettify("first_floor") == "First Floor"
