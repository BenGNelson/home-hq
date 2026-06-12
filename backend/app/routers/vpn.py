"""
/api/vpn — egress health of a VPN-protected container, from a state file.

A host timer (scripts/vpn-health.py) looks up two public IPs: the host's own
(your "home" connection) and the one seen from *inside* the VPN container's
network namespace. It writes them to a small JSON file. The backend can't see
into that namespace itself (and reaches Docker only through a read-only socket
proxy, so it can't `docker exec`), which is exactly why the privileged host
script does the lookup — the same split as SMART, backups, and the watchdog.

The leak verdict is computed *here* (so the logic stays unit-tested): if the
VPN egress IP equals the home IP, traffic isn't being masked — a leak. If the
container isn't running or the lookup failed, it's just "down" (with the
kill-switch that means no traffic at all, so it's not alarmed on).
"""

import json
import time

from fastapi import APIRouter

from app.config import settings

router = APIRouter()

# The host timer writes every few minutes; if the file is older than this the
# state is unknown (timer stopped), so we flag it stale rather than trusting it.
_STALE_AFTER_SECONDS = 900


def _mask_ip(ip):
    """Redact the host portion of the home IP so the page can show 'exit ≠ home'
    contrast without ever sending the real address to the browser. The leak check
    still uses the full IP (server-side, before this runs).
    203.0.113.7 -> 203.0.•.•   |   IPv6 keeps only the first hextet."""
    if not ip:
        return ip
    if ip.count(".") == 3:
        a, b, _, _ = ip.split(".")
        return f"{a}.{b}.•.•"
    if ":" in ip:
        return ip.split(":")[0] + ":•"
    return "•"


def _redact_home(home, home_ip):
    """Strip the home endpoint down to non-identifying bits: a masked IP, the
    ISP org, and country — dropping the precise city/region (the hometown is the
    most identifying part). Returns None when there's no home data."""
    if not home:
        return None
    return {
        "ip": _mask_ip(home_ip),
        "org": home.get("org"),
        "country": home.get("country"),
    }


def summarize(data, now=None):
    """Map the raw state file into the API model. Pure + defensive.

    status: protected | leak | down. `leak` is the security-relevant one
    (egress == home IP). `down` = container not running / no tunnel; benign on
    its own because the kill-switch drops traffic when the tunnel is gone.
    """
    now = time.time() if now is None else now
    updated = data.get("updated")
    stale = updated is None or (now - updated) > _STALE_AFTER_SECONDS

    vpn = data.get("vpn") or {}
    home = data.get("home") or {}
    vpn_ip = vpn.get("ip")
    home_ip = home.get("ip")
    container_running = bool(data.get("container_running"))

    if not container_running or not vpn_ip:
        status = "down"
    elif home_ip and vpn_ip == home_ip:
        status = "leak"
    else:
        status = "protected"

    return {
        "available": True,
        "status": status,
        "leak": status == "leak",
        "stale": stale,
        "container": data.get("container"),
        "container_running": container_running,
        "vpn": vpn or None,
        # Home IP is masked here so the real address never reaches the browser;
        # the leak verdict above was computed from the full IP.
        "home": _redact_home(home, home_ip),
        "forwarded_port": data.get("forwarded_port"),
        "updated": updated,
    }


def get_vpn():
    """Read + summarize the VPN state file. Missing/garbage -> available:false."""
    try:
        with open(settings.vpn_json_path) as fh:
            data = json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {"available": False}
    return summarize(data)


@router.get("/vpn")
def vpn():
    return get_vpn()
