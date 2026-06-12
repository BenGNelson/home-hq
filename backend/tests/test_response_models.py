"""End-to-end checks for the Tier-4 response models.

The other router tests call the route functions directly, which bypasses
FastAPI's response_model serialization. These go over the TestClient so the
models actually run, guarding two things: (1) the returned dicts satisfy their
models (a mismatch would 500), and (2) response_model_exclude_none is in effect,
so explicitly-null fields are omitted rather than sent as null — the on-the-wire
contract the frontend relies on (it treats absent and null identically).
"""

import pytest

from app.routers import vpn as V

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
    assert "available" in body
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
