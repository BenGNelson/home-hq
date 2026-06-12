"""
/api/tailscale — Tailscale mesh status, from a state file.

A host timer (scripts/tailscale-status.py) runs `tailscale status --json` and
writes a trimmed snapshot to a small JSON file. The backend container has no
`tailscale` binary or socket, so — exactly like SMART and the VPN check — the
privileged host script gathers the facts and we just read + shape them here.

The shaping (counts, sorting, exit-node detection, stale check) lives in the
pure `summarize()` so it stays unit-tested; the route is a thin wrapper.
"""

import json
import time

from fastapi import APIRouter

from app.config import settings

router = APIRouter()

# The host timer refreshes every few minutes; older than this and we can't trust
# the online/offline flags, so we mark the snapshot stale rather than lying.
_STALE_AFTER_SECONDS = 900


def _peer_sort_key(p):
    """Online devices first, then alphabetical by hostname (case-insensitive)."""
    return (not p.get("online"), (p.get("hostname") or "").lower())


def summarize(data, now=None):
    """Map the raw state file into the API model. Pure + defensive.

    status: up | down | unavailable.
      * unavailable — the host script ran but Tailscale isn't installed/up.
      * down — the local backend reports a non-Running state.
      * up   — the tailnet is connected.
    """
    now = time.time() if now is None else now
    updated = data.get("updated")
    stale = updated is None or (now - updated) > _STALE_AFTER_SECONDS

    if not data.get("available", False):
        return {
            "available": True,
            "status": "unavailable",
            "stale": stale,
            "self": None,
            "peers": [],
            "online_count": 0,
            "peer_count": 0,
            "tailnet": None,
            "magicdns": False,
            "exit_node": None,
            "updated": updated,
        }

    self_node = data.get("self") or None
    peers = sorted((data.get("peers") or []), key=_peer_sort_key)
    online = sum(1 for p in peers if p.get("online"))

    # The peer (or self) currently acting as our exit node, if any.
    exit_node = next(
        (n.get("hostname") for n in ([self_node] if self_node else []) + peers
         if n and n.get("exit_node")),
        None,
    )

    backend_state = data.get("backend_state")
    status = "up" if backend_state in (None, "Running") else "down"

    return {
        "available": True,
        "status": status,
        "stale": stale,
        "self": self_node,
        "peers": peers,
        "online_count": online,
        "peer_count": len(peers),
        "tailnet": data.get("tailnet"),
        "magicdns": bool(data.get("magicdns")),
        "exit_node": exit_node,
        "updated": updated,
    }


def get_tailscale():
    """Read + summarize the Tailscale state file. Missing/garbage -> available:false."""
    try:
        with open(settings.tailscale_json_path) as fh:
            data = json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {"available": False}
    return summarize(data)


@router.get("/tailscale")
def tailscale():
    return get_tailscale()
