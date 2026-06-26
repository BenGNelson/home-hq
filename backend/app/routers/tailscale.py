"""
/api/tailscale — Tailscale mesh status, from a state file.

A host timer (scripts/tailscale-status.py) runs `tailscale status --json` and
writes a trimmed snapshot to a small JSON file. The backend container has no
`tailscale` binary or socket, so — exactly like SMART and the VPN check — the
privileged host script gathers the facts and we just read + shape them here.

The shaping (counts, sorting, exit-node detection, stale check) lives in the
pure `summarize()` so it stays unit-tested; the route is a thin wrapper.
"""

import time

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.config import settings
from app.collectors import read_collector_json

router = APIRouter()


class TailscaleDeviceModel(BaseModel):
    hostname: str = Field(description="Display name (MagicDNS label when friendlier)")
    dns_name: str = Field(description="Full MagicDNS name")
    os: str = Field(description="Reported OS, e.g. linux/iOS")
    online: bool
    ip: str | None = Field(default=None, description="Tailscale IP (100.x)")
    exit_node: bool = Field(description="True if this device is the exit node in use")
    exit_node_option: bool = Field(description="True if it merely offers to be one")
    last_seen: int | None = Field(default=None, description="Unix time last seen (peers only)")
    self: bool = Field(description="True for the host this backend runs on")


# Superset model. summarize() always returns the full key set; the Optionals
# (self device when Tailscale is down, a null exit_node, a peer's last_seen) are
# dropped by response_model_exclude_none, which the frontend reads identically.
class TailscaleModel(BaseModel):
    available: bool = Field(description="False when no state file exists yet")
    status: str | None = Field(default=None, description="up | down | unavailable")
    stale: bool | None = None
    self: TailscaleDeviceModel | None = None
    peers: list[TailscaleDeviceModel] = []
    online_count: int | None = Field(default=None, description="Online peers only (excludes self)")
    online_total: int | None = Field(default=None, description="Online devices incl. self")
    peer_count: int | None = None
    tailnet: str | None = Field(default=None, description="Tailnet MagicDNS domain")
    magicdns: bool | None = None
    exit_node: str | None = Field(default=None, description="Hostname of the exit node in use, if any")
    updated: int | None = None

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
            "online_total": 0,
            "peer_count": 0,
            "tailnet": None,
            "magicdns": False,
            "exit_node": None,
            "updated": updated,
        }

    self_node = data.get("self") or None
    peers = sorted((data.get("peers") or []), key=_peer_sort_key)
    online = sum(1 for p in peers if p.get("online"))
    # online_count is peers-only (the headline reads "N of M *other* devices");
    # online_total adds self so the all-devices "Devices online" fact is correct.
    online_total = online + (1 if self_node and self_node.get("online") else 0)

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
        "online_total": online_total,
        "peer_count": len(peers),
        "tailnet": data.get("tailnet"),
        "magicdns": bool(data.get("magicdns")),
        "exit_node": exit_node,
        "updated": updated,
    }


def get_tailscale():
    """Read + summarize the Tailscale state file. Missing/garbage -> available:false."""
    data = read_collector_json(settings.tailscale_json_path)
    if data is None:
        return {"available": False}
    return summarize(data)


@router.get("/tailscale", response_model=TailscaleModel, response_model_exclude_none=True)
def tailscale():
    return get_tailscale()
