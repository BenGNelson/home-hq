#!/usr/bin/env python3
"""
Record VPN egress health into a JSON file the Home HQ backend reads.

Runs as root (or any user in the docker group) via a systemd timer — see
home-hq-vpn-health.{service,timer}.example. It looks up two public IPs:

  * the HOST's own public IP (your home connection), and
  * the public IP seen from INSIDE a VPN container's network namespace
    (`docker exec <container> ...`), i.e. the VPN's exit IP.

The backend container can't see into that namespace (and reaches Docker only
through a read-only socket proxy, so it can't exec), which is why this host
script does the lookup — the same privileged-host / unprivileged-app split as
smart-health.py and the drive watchdog. The backend computes the leak verdict
from these facts (so that logic stays unit-tested); we just gather them.

Nothing here is host-specific or secret, so it's safe to commit. Config (all
optional, with sane defaults) comes from the environment:

  VPN_CONTAINER            container whose egress to check   (default: gluetun)
  VPN_IP_CHECK_URL         JSON IP-echo service              (default: ipinfo.io)
  VPN_IP_FALLBACK_URLS     comma-sep plain-text IP echoes used when the JSON
                           service fails (e.g. rate-limits a shared VPN exit)
  VPN_FORWARDED_PORT_FILE  in-container forwarded-port file  (gluetun default)
  VPN_JSON                 output path  (default: /var/lib/home-hq/vpn.json)
"""

import json
import os
import subprocess
import time
import urllib.request

CONTAINER = os.environ.get("VPN_CONTAINER", "gluetun")
IP_CHECK_URL = os.environ.get("VPN_IP_CHECK_URL", "https://ipinfo.io/json")
# Plain-text "what's my IP" services, tried in order when the JSON lookup above
# fails. Popular shared VPN exit IPs get HTTP 429'd by ipinfo's free tier no
# matter how rarely WE ask, which would otherwise read as a false "VPN down".
# These return only the IP (no geo/org), but the IP is all the leak check needs.
_DEFAULT_FALLBACKS = "https://api.ipify.org,https://ifconfig.me/ip,https://icanhazip.com"
FALLBACK_IP_URLS = [
    u.strip() for u in os.environ.get("VPN_IP_FALLBACK_URLS", _DEFAULT_FALLBACKS).split(",")
    if u.strip()
]
PORT_FILE = os.environ.get("VPN_FORWARDED_PORT_FILE", "/tmp/gluetun/forwarded_port")
OUT = os.environ.get("VPN_JSON", "/var/lib/home-hq/vpn.json")


def _shape(raw):
    """Pull the fields we care about out of an ipinfo-style JSON blob."""
    if not isinstance(raw, dict):
        return {}
    return {
        "ip": raw.get("ip"),
        "org": raw.get("org"),
        "city": raw.get("city"),
        "region": raw.get("region"),
        "country": raw.get("country"),
    }


def _looks_like_ip(s):
    s = (s or "").strip()
    return bool(s) and (s.count(".") == 3 or ":" in s) and " " not in s and len(s) <= 45


def _host_fetch(url):
    """GET a URL from the host's own (home) connection. Returns body text or ''."""
    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            return resp.read().decode().strip()
    except Exception:  # noqa: BLE001 — best effort; absence is meaningful
        return ""


def _container_fetch(url):
    """GET a URL from INSIDE the VPN container's network namespace (so the reply
    reflects the VPN exit). Returns body text or '' (wget -q prints nothing and
    exits non-zero on an HTTP error like 429)."""
    try:
        res = subprocess.run(
            ["docker", "exec", CONTAINER, "wget", "-qO-", "-T", "12", url],
            capture_output=True, text=True, timeout=20,
        )
        return res.stdout.strip() if res.returncode == 0 else ""
    except Exception:  # noqa: BLE001
        return ""


def lookup(fetch):
    """Resolve a public IP (with geo when available) using `fetch` to make the
    request. Tries the JSON service first for full geo/org; on failure falls back
    to the plain-text IP echoes so we still capture the exit IP — which is what
    the leak verdict compares. Returns a (possibly IP-only) dict, or {}."""
    body = fetch(IP_CHECK_URL)
    if body:
        try:
            shaped = _shape(json.loads(body))
            if shaped.get("ip"):
                return shaped
        except (ValueError, TypeError):
            pass  # not JSON (e.g. an error page) — fall through to plain echoes
    for url in FALLBACK_IP_URLS:
        ip = fetch(url)
        if _looks_like_ip(ip):
            return {"ip": ip.strip()}
    return {}


def host_ip():
    """The host's own public IP — i.e. the home/ISP connection."""
    return lookup(_host_fetch)


def container_running():
    try:
        res = subprocess.run(
            ["docker", "inspect", "-f", "{{.State.Running}}", CONTAINER],
            capture_output=True, text=True, timeout=15,
        )
        return res.returncode == 0 and res.stdout.strip() == "true"
    except Exception:  # noqa: BLE001
        return False


def vpn_ip():
    """Public IP as seen from inside the container's network namespace."""
    return lookup(_container_fetch)


def forwarded_port():
    try:
        res = subprocess.run(
            ["docker", "exec", CONTAINER, "cat", PORT_FILE],
            capture_output=True, text=True, timeout=15,
        )
        if res.returncode == 0:
            return int(res.stdout.strip())
    except Exception:  # noqa: BLE001
        pass
    return None


def main():
    running = container_running()
    data = {
        "updated": int(time.time()),
        "container": CONTAINER,
        "container_running": running,
        "home": host_ip(),
        # Only ask inside the container if it's actually up (else exec just errors).
        "vpn": vpn_ip() if running else {},
        "forwarded_port": forwarded_port() if running else None,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(data, fh)
    os.replace(tmp, OUT)  # atomic swap so the reader never sees a half-written file
    os.chmod(OUT, 0o644)


if __name__ == "__main__":
    main()
