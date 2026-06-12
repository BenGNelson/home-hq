"""Tests for the what's-eating-space scanner: du parsing, daily dedup, endpoint.
No real du runs — _run_du is stubbed."""

import time

from app import db
from app.space_usage import SpaceScanner, parse_du, _utc_day

ROOT = "/mnt/store"
DU_OUTPUT = "\n".join(
    [
        f"5000000000\t{ROOT}/Movies",
        f"3000000000\t{ROOT}/TV",
        f"1000000000\t{ROOT}/downloads",
        f"9000000000\t{ROOT}",  # grand total for the root itself
    ]
)


def test_parse_du_children_sorted_desc_total_dropped():
    entries = parse_du(DU_OUTPUT, ROOT)
    assert [e["name"] for e in entries] == ["Movies", "TV", "downloads"]
    assert entries[0]["bytes"] == 5_000_000_000
    # The root's own total line is excluded (only children remain).
    assert all(e["name"] != ROOT for e in entries)


def test_parse_du_handles_trailing_slash_and_garbage():
    out = f"100\t{ROOT}/A\ngarbage line\n50\t{ROOT}/B\n"
    entries = parse_du(out, ROOT + "/")
    assert [(e["name"], e["bytes"]) for e in entries] == [("A", 100), ("B", 50)]


def _scanner():
    return SpaceScanner(root=ROOT, enabled=True, interval=3600, timeout=900)


def test_scan_records_when_due(monkeypatch):
    s = _scanner()
    monkeypatch.setattr(s, "_run_du", lambda: DU_OUTPUT)
    assert s.scan_if_due(now=1000.0) is True
    latest = db.latest_space_usage()
    assert latest["root"] == ROOT
    assert latest["total_bytes"] == 9_000_000_000  # sum of the three children
    assert latest["entries"][0]["name"] == "Movies"


def test_scan_skips_when_today_already_cached(monkeypatch):
    now = 1000.0
    db.record_space_usage(_utc_day(now), now, ROOT, 1, [{"name": "X", "bytes": 1}])
    s = _scanner()
    called = []
    monkeypatch.setattr(s, "_run_du", lambda: called.append(1) or DU_OUTPUT)
    assert s.scan_if_due(now=now) is False
    assert called == []  # du was never invoked


def test_scan_returns_false_when_du_fails(monkeypatch):
    s = _scanner()
    monkeypatch.setattr(s, "_run_du", lambda: None)
    assert s.scan_if_due(now=time.time()) is False
    assert db.latest_space_usage() is None


def test_space_endpoint_empty(client):
    assert client.get("/api/storage/space").json() == {"available": False}


def test_space_endpoint_returns_breakdown(client):
    db.record_space_usage("2026-06-12", 1234.0, ROOT, 8000, [{"name": "Movies", "bytes": 8000}])
    body = client.get("/api/storage/space").json()
    assert body["available"] is True
    assert body["root"] == ROOT and body["total_bytes"] == 8000
    assert body["entries"][0]["name"] == "Movies"
