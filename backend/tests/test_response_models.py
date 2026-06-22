"""End-to-end checks for the Tier-4 response models.

The other router tests call the route functions directly, which bypasses
FastAPI's response_model serialization. These go over the TestClient so the
models actually run, guarding two things: (1) the returned dicts satisfy their
models (a mismatch would 500), and (2) response_model_exclude_none is in effect,
so explicitly-null fields are omitted rather than sent as null — the on-the-wire
contract the frontend relies on (it treats absent and null identically).
"""

import pytest

from app.config import settings
from app.routers import vpn as V


@pytest.fixture(autouse=True)
def _isolate_plex(monkeypatch):
    """Clear the Plex token so the plex endpoints return their deterministic
    not-configured shape instead of hitting (and leaking data from) a real
    server that happens to be configured in the ambient .env."""
    monkeypatch.setattr(settings, "plex_token", "")

# Every endpoint that got a typed model with exclude_none. In the test sandbox
# the real host sources (/host/proc, /smart/*.json, the RAID mount) are absent,
# so each degrades to a minimal available:false body — which still has to
# validate against its superset model.
MODELED_ENDPOINTS = [
    "/api/disk",
    "/api/network",
    "/api/diskio",
    "/api/raid",
    "/api/backups",
    "/api/drive-watchdog",
    "/api/vpn",
    "/api/tailscale",
    "/api/containers",
    "/api/smart",
    "/api/smart/sda/attributes",
    "/api/storage/space",
    "/api/printer",
    "/api/plex",
    "/api/plex/now-playing",
    "/api/plex/recently-added",
    "/api/plex/libraries",
    "/api/plex/watch-stats",
    "/api/alerts",
    "/api/readme",
    "/api/server-guide",
]


def _assert_no_nulls(obj, path=""):
    """Recursively assert no value is None — exclude_none should have dropped it."""
    if obj is None:
        raise AssertionError(f"null value survived at {path!r}")
    if isinstance(obj, dict):
        for k, v in obj.items():
            _assert_no_nulls(v, f"{path}/{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            _assert_no_nulls(v, f"{path}[{i}]")


@pytest.mark.parametrize("path", MODELED_ENDPOINTS)
def test_modeled_endpoint_validates_and_omits_nulls(client, path):
    res = client.get(path)
    assert res.status_code == 200, res.text
    body = res.json()
    assert isinstance(body, dict)  # validated against its response_model
    _assert_no_nulls(body)


def test_exclude_none_drops_null_keys_but_keeps_data(client, monkeypatch):
    """A populated payload with a null field: the null is dropped, the rest (incl.
    a nested object) is preserved verbatim. Uses VPN's 'down' shape (vpn=None,
    home populated) — exactly the live case the model has to handle."""
    payload = {
        "available": True,
        "status": "down",
        "leak": False,
        "stale": False,
        "container": "gluetun",
        "container_running": True,
        "vpn": None,  # down -> no exit endpoint; must be omitted, not sent as null
        "home": {"ip": "203.0.•.•", "org": "AS1 Home ISP", "country": "US"},
        "forwarded_port": 34525,
        "updated": 1_000_000,
    }
    monkeypatch.setattr(V, "get_vpn", lambda: payload)

    body = client.get("/api/vpn").json()
    assert "vpn" not in body  # the null field is gone
    assert body["leak"] is False  # a real False is NOT dropped
    assert body["home"] == {"ip": "203.0.•.•", "org": "AS1 Home ISP", "country": "US"}
    assert body["forwarded_port"] == 34525


def test_trends_keeps_nulls_and_validates(client):
    """/storage/trends is the one modeled endpoint that does NOT exclude nulls:
    its metric points keep value:null and the projection can be null, which must
    survive the model (no exclude_none) so the graphs/projection stay intact."""
    body = client.get("/api/storage/trends").json()
    assert body["available"] is True
    # The full shape is always present (empty history degrades to empty series).
    for key in ("days", "smart", "capacity", "projection"):
        assert key in body
    assert isinstance(body["smart"], dict) and isinstance(body["capacity"], list)


def test_printer_history_keeps_null_success_rate(client):
    """/printer/history is always-full and keeps success_rate:null (no prints
    yet), so it deliberately doesn't exclude nulls."""
    body = client.get("/api/printer/history").json()
    assert body["available"] is True
    assert "stats" in body and "prints" in body
    assert "success_rate" in body["stats"]  # present even when null


def test_plex_insights_and_sync_status_keep_nulls(client):
    """Both are always-full and don't exclude nulls — their stat fields must stay
    present (and validate) even when null on a fresh/empty install."""
    ins = client.get("/api/plex/insights").json()
    assert ins["hours"] > 0 and "stats" in ins and isinstance(ins["samples"], list)
    assert "busiest_hour" in ins["stats"]  # null but present

    sync = client.get("/api/plex/sync/status").json()
    for key in ("running", "status", "last_synced", "item_count", "error"):
        assert key in sync


def test_db_stats_and_uptime_validate(client, monkeypatch, tmp_path):
    """Both always-full (keep nulls) — validate over HTTP and keep their shape."""
    dbs = client.get("/api/storage/db")
    assert dbs.status_code == 200
    body = dbs.json()
    assert "size_bytes" in body and isinstance(body["tables"], list)

    # Point at a guaranteed-absent prober file (don't depend on the host's real
    # /smart/uptime.json, which exists once the timer is installed) → not
    # configured, but the full shape must still validate.
    monkeypatch.setattr(settings, "uptime_json_path", str(tmp_path / "nope.json"))
    up = client.get("/api/uptime")
    assert up.status_code == 200
    ub = up.json()
    assert ub["configured"] is False and ub["targets"] == []
    assert "stale" in ub and "interval" in ub
