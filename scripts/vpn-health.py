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


def host_ip():
    """The host's own public IP — i.e. the home/ISP connection."""
    try:
        with urllib.request.urlopen(IP_CHECK_URL, timeout=15) as resp:
            return _shape(json.loads(resp.read().decode()))
    except Exception:  # noqa: BLE001 — best effort; absence is meaningful
        return {}


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
    try:
        res = subprocess.run(
            ["docker", "exec", CONTAINER, "wget", "-qO-", "-T", "12", IP_CHECK_URL],
            capture_output=True, text=True, timeout=20,
        )
        if res.returncode != 0:
            return {}
        return _shape(json.loads(res.stdout))
    except Exception:  # noqa: BLE001
        return {}


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
