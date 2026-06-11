"""Tests for the drive-watchdog state summarizer (pure, no real file)."""

from app.routers.watchdog import _STALE_AFTER_SECONDS, summarize

NOW = 1_000_000.0

FRESH_HEALTHY = {
    "label": "external-drive",
    "mount": "/mnt/external",
    "fstype": "ntfs",
    "healthy": True,
    "last_check": NOW - 10,
    "last_recovery": None,
    "recovery_count": 0,
    "note": "ok",
}


def test_fresh_healthy_state():
    out = summarize(FRESH_HEALTHY, now=NOW)
    assert out["available"] is True
    assert out["healthy"] is True
    assert out["stale"] is False
    assert out["label"] == "external-drive"
    assert out["recovery_count"] == 0


def test_recovered_state_carries_history():
    data = {**FRESH_HEALTHY, "healthy": True, "recovery_count": 3,
            "last_recovery": NOW - 120, "note": "recovered"}
    out = summarize(data, now=NOW)
    assert out["recovery_count"] == 3
    assert out["last_recovery"] == NOW - 120
    assert out["stale"] is False


def test_stale_when_last_check_too_old():
    data = {**FRESH_HEALTHY, "last_check": NOW - (_STALE_AFTER_SECONDS + 60)}
    out = summarize(data, now=NOW)
    assert out["stale"] is True


def test_stale_when_no_last_check():
    data = {**FRESH_HEALTHY}
    del data["last_check"]
    out = summarize(data, now=NOW)
    assert out["stale"] is True


def test_unhealthy_state():
    data = {**FRESH_HEALTHY, "healthy": False, "note": "recovery-failed"}
    out = summarize(data, now=NOW)
    assert out["healthy"] is False
    assert out["note"] == "recovery-failed"
