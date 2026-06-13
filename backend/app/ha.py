"""
app.ha — read-only Home Assistant bridge.

Home Assistant owns the smart-home devices; Home HQ surfaces a read-only slice.
This module talks to HA's REST API with a Long-Lived Access Token (config
ha_url / ha_token) and provides:

  - the list of camera entities (for the camera wall), and
  - a relay of HA's MJPEG camera stream / snapshot, so the browser never needs
    the HA token and there's no mixed-content / CORS problem (the page is
    same-origin with our backend; the backend adds the bearer token upstream).

HA's port is firewalled to the LAN, so this container reaches it only because a
narrow firewall rule allows the compose network → HA (see SERVER_GUIDE). That's
also why ha_url points at the bridge gateway rather than localhost.

Everything here is read-only — no control commands are ever sent to HA.
"""

import json
import re
import urllib.request

from app.config import settings

# A camera entity_id goes into the upstream URL, so constrain it tightly: a
# well-formed HA camera id and nothing else. This is the guard that stops the
# path from being used to reach other HA endpoints.
_CAMERA_ID = re.compile(r"^camera\.[a-z0-9_]+$")


def configured() -> bool:
    """True when both the HA URL and a token are set."""
    return bool(settings.ha_url and settings.ha_token)


def _allowlist() -> set[str]:
    """Optional curated set of camera entity_ids (empty = allow all cameras)."""
    return {e.strip() for e in settings.ha_camera_entities.split(",") if e.strip()}


def is_allowed_camera(entity_id: str) -> bool:
    """May this entity be streamed? Pure (unit-tested): a well-formed camera id,
    and — when an allowlist is configured — one that's on it."""
    if not _CAMERA_ID.match(entity_id):
        return False
    allow = _allowlist()
    return entity_id in allow if allow else True


def select_cameras(states: list[dict]) -> list[dict]:
    """Pure: pick camera entities out of a /api/states payload, apply the
    optional allowlist, and shape each for the API (entity_id, name, state).
    Sorted by display name so the wall is stable."""
    allow = _allowlist()
    out = []
    for s in states:
        eid = s.get("entity_id", "")
        if not eid.startswith("camera."):
            continue
        if allow and eid not in allow:
            continue
        attrs = s.get("attributes", {})
        out.append(
            {
                "entity_id": eid,
                "name": attrs.get("friendly_name") or eid,
                "state": s.get("state"),
            }
        )
    out.sort(key=lambda c: c["name"].lower())
    return out


def _request(path: str, timeout: float = 10):
    """Open an authenticated GET against HA. Caller closes the response."""
    req = urllib.request.Request(
        f"{settings.ha_url}{path}",
        headers={"Authorization": f"Bearer {settings.ha_token}"},
    )
    return urllib.request.urlopen(req, timeout=timeout)


def fetch_states() -> list[dict]:
    with _request("/api/states") as r:
        return json.load(r)


def list_cameras() -> dict:
    """{available, reason?, cameras[]}. Degrades gracefully like every endpoint:
    not_configured when there's no token, unreachable when HA can't be reached."""
    if not configured():
        return {"available": False, "reason": "not_configured", "cameras": []}
    try:
        states = fetch_states()
    except Exception:
        return {"available": False, "reason": "unreachable", "cameras": []}
    return {"available": True, "cameras": select_cameras(states)}


def open_stream(entity_id: str):
    """Open HA's live MJPEG stream for a camera. Returns (response, content_type);
    the caller relays chunks and must close the response."""
    r = _request(f"/api/camera_proxy_stream/{entity_id}", timeout=30)
    ct = r.headers.get("Content-Type", "multipart/x-mixed-replace; boundary=--frameboundary")
    return r, ct


def open_snapshot(entity_id: str):
    """Fetch a single still (placeholder when the camera is asleep). Returns
    (bytes, content_type)."""
    with _request(f"/api/camera_proxy/{entity_id}", timeout=15) as r:
        return r.read(), r.headers.get("Content-Type", "image/jpeg")
