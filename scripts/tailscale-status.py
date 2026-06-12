#!/usr/bin/env python3
"""
Record Tailscale device status into a JSON file the Home HQ backend reads.

Runs on the HOST via a systemd timer — see home-hq-tailscale.{service,timer}.
example. The backend runs in a container with no `tailscale` binary or socket,
so (exactly like SMART, the VPN check, and the drive watchdog) a small
privileged host script gathers the facts and writes them where the app can read
them read-only. Nothing here is secret or host-specific, so it's safe to commit.

It shells out to `tailscale status --json` and trims the large blob down to the
fields the dashboard shows: the tailnet, this node, and each peer's hostname,
OS, online state, Tailscale IP, exit-node role, and last-seen time. Config (all
optional) comes from the environment:

  TAILSCALE_BIN   path to the tailscale CLI  (default: tailscale, found on PATH)
  TAILSCALE_JSON  output path  (default: /var/lib/home-hq/tailscale.json)
"""

import json
import os
import subprocess
import time
from datetime import datetime

TAILSCALE_BIN = os.environ.get("TAILSCALE_BIN", "tailscale")
OUT = os.environ.get("TAILSCALE_JSON", "/var/lib/home-hq/tailscale.json")

# Tailscale marks a device offline but still lists it for a while; LastSeen far
# in the past is normal. We keep the raw epoch and let the UI render "Nd ago".


def _epoch(rfc3339):
    """Parse Tailscale's RFC3339 LastSeen ('2023-08-01T12:00:00.123456789Z')
    into a unix epoch int. Best-effort — returns None on anything unexpected."""
    if not rfc3339 or not isinstance(rfc3339, str):
        return None
    # A zero/never timestamp shows up as year 0001; treat it as "no value".
    if rfc3339.startswith("0001"):
        return None
    s = rfc3339.replace("Z", "+00:00")
    # datetime.fromisoformat rejects sub-second precision beyond microseconds,
    # so trim the fractional part down if it's there.
    if "." in s:
        head, _, tail = s.partition(".")
        frac = "".join(ch for ch in tail if ch.isdigit())[:6]
        offset = tail[len(frac):] if not tail[:1].isdigit() else ""
        # Re-attach any timezone offset that followed the fractional seconds.
        for sep in ("+", "-"):
            if sep in tail:
                offset = sep + tail.split(sep, 1)[1]
                break
        s = f"{head}.{frac}{offset}" if frac else head + offset
    try:
        return int(datetime.fromisoformat(s).timestamp())
    except ValueError:
        return None


def _shape(node, is_self=False):
    """Pull the non-sensitive subset we display out of a Tailscale node blob."""
    if not isinstance(node, dict):
        return None
    ips = node.get("TailscaleIPs") or []
    dns = (node.get("DNSName") or "").rstrip(".")
    short = dns.split(".")[0] if dns else ""
    # iOS reports HostName as the useless "localhost"; the MagicDNS label (the
    # device's tailnet name) is far friendlier. Prefer it when HostName is generic.
    name = node.get("HostName") or ""
    if not name or name.lower() == "localhost":
        name = short or name or "?"
    return {
        "hostname": name,
        "dns_name": dns,
        "os": node.get("OS") or "",
        "online": bool(node.get("Online")),
        "ip": ips[0] if ips else None,
        # ExitNode = this node is the exit node currently routing our traffic;
        # ExitNodeOption = it merely offers to be one.
        "exit_node": bool(node.get("ExitNode")),
        "exit_node_option": bool(node.get("ExitNodeOption")),
        "last_seen": _epoch(node.get("LastSeen")),
        "self": is_self,
    }


def run_status():
    """`tailscale status --json` -> parsed dict, or None if it can't be read."""
    try:
        res = subprocess.run(
            [TAILSCALE_BIN, "status", "--json"],
            capture_output=True, text=True, timeout=15,
        )
        if res.returncode != 0:
            return None
        return json.loads(res.stdout)
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def main():
    raw = run_status()
    if raw is None:
        # Tailscale not installed / not running / not logged in. Write a minimal
        # state file so the backend can distinguish "down" from "never ran".
        data = {"updated": int(time.time()), "available": False}
    else:
        tailnet = raw.get("CurrentTailnet") or {}
        peers = raw.get("Peer") or {}
        data = {
            "updated": int(time.time()),
            "available": True,
            # The tailnet's MagicDNS domain (e.g. tailXXXX.ts.net) — the useful,
            # non-PII label. We deliberately skip CurrentTailnet.Name, which on a
            # personal tailnet is the login email.
            "tailnet": tailnet.get("MagicDNSSuffix") or raw.get("MagicDNSSuffix"),
            "magicdns": bool(tailnet.get("MagicDNSEnabled")),
            "backend_state": raw.get("BackendState"),
            "self": _shape(raw.get("Self") or {}, is_self=True),
            "peers": [s for s in (_shape(p) for p in peers.values()) if s],
        }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(data, fh)
    os.replace(tmp, OUT)  # atomic swap so the reader never sees a half-written file
    os.chmod(OUT, 0o644)


if __name__ == "__main__":
    main()
