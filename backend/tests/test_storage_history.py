"""Tests for storage trend sampling: the pure helpers, the SQLite round-trip,
and the /api/storage/trends shaping. No real disks needed."""

import time

from app import db
from app.storage_history import build_samples, project_capacity


# --- build_samples (pure: live payloads -> rows to persist) ---


SMART_OK = {
    "available": True,
    "drives": [
        {
            "name": "sda",
            "supported": True,
            "temperature_c": 38,
            "power_on_hours": 1000,
            "reallocated": 0,
            "pending": 0,
            "wear_percent": 3,
            "media_errors": 0,
        },
        {"name": "sde", "supported": False},  # USB-bridged, unreadable
    ],
}
DISK_OK = {
    "available": True,
    "mount": "/mnt/storage",
    "total_bytes": 1000,
    "used_bytes": 820,
    "free_bytes": 180,
    "percent": 82.0,
}


def test_build_samples_keeps_supported_drives_and_capacity():
    rows = build_samples(SMART_OK, DISK_OK)
    kinds = [(k, subj) for k, subj, _ in rows]
    assert ("smart", "sda") in kinds
    assert ("capacity", "/mnt/storage") in kinds
    # The unreadable USB drive carries no trend signal — skipped.
    assert ("smart", "sde") not in kinds


def test_build_samples_captures_the_metrics():
    rows = {k + ":" + s: m for k, s, m in build_samples(SMART_OK, DISK_OK)}
    assert rows["smart:sda"]["temperature_c"] == 38
    assert rows["smart:sda"]["wear_percent"] == 3
    assert rows["capacity:/mnt/storage"]["used_bytes"] == 820


def test_build_samples_empty_when_sources_unavailable():
    assert build_samples({"available": False}, {"available": False}) == []
    assert build_samples({}, {}) == []


# --- project_capacity (pure: least-squares days-to-full) ---


def _cap(ts, used, total=1000):
    return {"ts": ts, "metrics": {"used_bytes": used, "total_bytes": total}}


def test_projection_needs_two_points():
    assert project_capacity([]) is None
    assert project_capacity([_cap(0, 100)]) is None


def test_projection_estimates_days_until_full():
    # +100 bytes/day, 800 bytes free → full in 8 days.
    p = project_capacity([_cap(0, 100), _cap(86400, 200)])
    assert round(p["bytes_per_day"]) == 100
    assert round(p["days_until_full"]) == 8
    assert p["total_bytes"] == 1000


def test_projection_flat_usage_has_no_full_date():
    p = project_capacity([_cap(0, 200), _cap(86400, 200)])
    assert p["bytes_per_day"] == 0
    assert p["days_until_full"] is None


def test_projection_none_without_a_total():
    samples = [
        {"ts": 0, "metrics": {"used_bytes": 100}},
        {"ts": 86400, "metrics": {"used_bytes": 200}},
    ]
    assert project_capacity(samples) is None


# --- db round-trip ---


def test_storage_sample_roundtrip_and_upsert():
    db.record_storage_sample("2026-06-01", 100.0, "smart", "sda", {"temperature_c": 38})
    db.record_storage_sample("2026-06-02", 200.0, "smart", "sda", {"temperature_c": 40})
    rows = db.storage_samples("smart")
    assert [r["metrics"]["temperature_c"] for r in rows] == [38, 40]  # ts-ascending

    # Same (day, kind, subject) upserts rather than duplicating.
    db.record_storage_sample("2026-06-02", 250.0, "smart", "sda", {"temperature_c": 41})
    rows = db.storage_samples("smart")
    assert len(rows) == 2
    assert rows[-1]["metrics"]["temperature_c"] == 41


def test_storage_samples_filters_by_since_and_kind():
    db.record_storage_sample("2026-06-01", 100.0, "capacity", "/m", {"used_bytes": 1})
    db.record_storage_sample("2026-06-02", 500.0, "capacity", "/m", {"used_bytes": 2})
    assert len(db.storage_samples("capacity", since_ts=300.0)) == 1
    assert db.storage_samples("smart") == []


def test_prune_storage_samples_drops_old_rows():
    db.record_storage_sample("2026-06-01", 100.0, "smart", "sda", {})
    db.record_storage_sample("2026-06-10", 900.0, "smart", "sda", {})
    db.prune_storage_samples(before_ts=500.0)
    rows = db.storage_samples("smart")
    assert len(rows) == 1 and rows[0]["ts"] == 900.0


# --- endpoint ---


def test_trends_endpoint_empty_db(client):
    body = client.get("/api/storage/trends").json()
    assert body["available"] is True
    assert body["smart"] == {}
    assert body["capacity"] == []
    assert body["projection"] is None


def test_trends_endpoint_shapes_series(client):
    # Recent timestamps so they fall inside the endpoint's default lookback window.
    t1 = time.time() - 2 * 86400
    t2 = time.time() - 1 * 86400
    db.record_storage_sample("2026-06-01", t1, "smart", "sda", {"temperature_c": 38})
    db.record_storage_sample("2026-06-02", t2, "smart", "sda", {"temperature_c": 40})
    db.record_storage_sample("2026-06-01", t1, "capacity", "/m", {"used_bytes": 100, "total_bytes": 1000})
    db.record_storage_sample("2026-06-02", t2, "capacity", "/m", {"used_bytes": 200, "total_bytes": 1000})
    body = client.get("/api/storage/trends").json()
    temps = [pt["value"] for pt in body["smart"]["sda"]["temperature_c"]]
    assert temps == [38, 40]
    assert body["projection"]["days_until_full"] is not None
