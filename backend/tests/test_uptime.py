"""Tests for the uptime summarizer (reads the host prober's JSON) and the DB
growth guardrails (row caps + the size/stats view + the DB-size alert)."""

from app import db, uptime

NOW = 1_000_000.0
HOUR = 3600


def _bucket(hours_ago, up, total):
    return {"h": int((NOW - hours_ago * HOUR) // HOUR * HOUR), "up": up, "total": total}


def test_pct_over_window():
    assert uptime._pct([], NOW - 86400) is None
    buckets = [_bucket(1, 5, 5), _bucket(2, 3, 6)]  # 8 up of 11
    assert uptime._pct(buckets, NOW - 86400) == round(8 / 11 * 100, 2)
    # A bucket outside the window is excluded.
    old = [_bucket(200, 0, 10)]  # 200h ago, outside 24h
    assert uptime._pct(buckets + old, NOW - 86400) == round(8 / 11 * 100, 2)


DATA = {
    "updated": NOW,
    "interval": 120,
    "targets": [
        {
            "label": "Plex", "kind": "http",
            "last": {"ts": NOW - 30, "up": True, "ms": 12},
            "samples": [{"ts": NOW - 90, "up": False, "ms": None},
                        {"ts": NOW - 30, "up": True, "ms": 12}],
            "hourly": [_bucket(1, 4, 4), _bucket(30, 0, 2)],  # 30h-ago bucket = outside 24h
        },
        {"label": "NAS", "kind": "tcp"},  # never probed yet
    ],
}


def test_summarize_status_latency_and_windows():
    out = uptime.summarize_uptime(DATA, now=NOW)
    plex, nas = out
    assert plex["label"] == "Plex" and plex["status"] == "up"
    assert plex["last_response_ms"] == 12 and plex["last_checked"] == NOW - 30
    assert plex["uptime_24h"] == 100.0           # only the 1h-ago bucket (4/4)
    assert plex["uptime_7d"] == round(4 / 6 * 100, 2)  # both buckets (4/6)
    assert [p["up"] for p in plex["history"]] == [False, True]
    # A target with no `last` reads as unknown with null figures + empty history.
    assert nas["status"] == "unknown"
    assert nas["uptime_24h"] is None and nas["history"] == []


def test_summarize_keeps_file_order_and_empty():
    assert uptime.summarize_uptime({}, now=NOW) == []
    out = uptime.summarize_uptime(DATA, now=NOW)
    assert [t["label"] for t in out] == ["Plex", "NAS"]


# --- DB growth guardrails ---------------------------------------------------

def test_cap_table_trims_oldest(monkeypatch):
    monkeypatch.setitem(db._SAMPLE_TABLE_CAPS, "plex_samples", 5)
    for i in range(12):
        db.record_plex_sample(NOW + i, i, 0, None)  # streams = i, so we can check survivors
    rows = db.plex_samples()
    assert len(rows) == 5
    assert [r["streams"] for r in rows] == [7, 8, 9, 10, 11]  # newest 5 survive


def test_db_stats_reports_size_and_caps():
    db.record_plex_sample(NOW, 1, 0, None)
    stats = db.db_stats()
    assert stats["size_bytes"] is None or stats["size_bytes"] > 0
    by_name = {t["name"]: t for t in stats["tables"]}
    assert by_name["plex_samples"]["rows"] >= 1
    assert by_name["plex_samples"]["cap"] == db._SAMPLE_TABLE_CAPS["plex_samples"]
    assert by_name["media_items"]["cap"] is None  # uncapped table reports null cap


def test_check_db_fires_over_limit():
    from app.alerting import _check_db
    from app.config import settings

    key, msg = _check_db({"db": {"size_bytes": (settings.alert_db_max_mb + 50) * 1024 * 1024}})
    assert key and key.startswith("big:") and "MB" in msg
    assert _check_db({"db": {"size_bytes": 1024}}) == (None, "")
    assert _check_db({"db": {"size_bytes": None}}) == (None, "")
