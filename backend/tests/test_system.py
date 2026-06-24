"""Tests for /api/system — exercises the route over the TestClient so the
SystemModel response_model actually serializes (a shape mismatch would 500).
CPU/memory come from psutil on the host the tests run on; we assert the stable
contract the System widget relies on, with focus on the OS/root disk block."""

from fastapi.testclient import TestClient

from app.config import settings
from app.main import app

client = TestClient(app)


def test_system_reports_disk_block():
    r = client.get("/api/system")
    assert r.status_code == 200
    body = r.json()

    # The disk block the System widget renders as a usage bar.
    disk = body["disk"]
    for key in ("total_bytes", "used_bytes", "free_bytes", "percent"):
        assert key in disk
    assert disk["total_bytes"] > 0
    assert 0 <= disk["percent"] <= 100
    # used + free should never exceed the reported total (reserved blocks aside).
    assert disk["used_bytes"] + disk["free_bytes"] <= disk["total_bytes"]


def test_system_keeps_core_blocks():
    body = client.get("/api/system").json()
    assert body["cpu"]["cores"] >= 1
    assert "percent" in body["memory"]
    assert body["uptime_seconds"] >= 0


def test_system_degrades_when_disk_mount_unreadable(monkeypatch):
    # A bad SYSTEM_DISK_MOUNT must not 500 the whole endpoint — the disk block is
    # simply omitted (exclude_none), and CPU/memory/uptime still come through.
    monkeypatch.setattr(settings, "system_disk_mount", "/no/such/mount/xyz")
    r = client.get("/api/system")
    assert r.status_code == 200
    body = r.json()
    assert "disk" not in body
    assert "cpu" in body and "memory" in body and "uptime_seconds" in body
