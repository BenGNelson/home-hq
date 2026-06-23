#!/usr/bin/env python3
"""
Probe a list of services and record their availability for the Home HQ Uptime
page.

Runs on the HOST via a systemd timer (see home-hq-uptime.{service,timer}.example)
because the backend container is firewalled away from LAN-restricted services
(e.g. Home Assistant, a download client) — the host reaches them all via localhost.
Same privileged-host / unprivileged-app split as the SMART, VPN, and Tailscale
checks: this gathers the facts, the backend just reads + shapes uptime.json.

Each run probes every target once and updates a small rolling state per target:
a `last` result, a short raw `samples` history (the page's sparkline), and
`hourly` {h, up, total} buckets the backend turns into 24h / 7d uptime %. The
file is bounded — samples are capped and hourly buckets pruned to the retention
window — so it never grows without limit. Nothing host-specific is committed.

Config (all optional) from the environment:

  UPTIME_TARGETS    comma-separated "Label|target"; target is an http(s):// URL
                    (up = any HTTP response, even 401) or host:port (TCP connect)
  UPTIME_TIMEOUT    per-probe timeout seconds        (default: 5)
  UPTIME_INTERVAL   probe cadence, for display only  (default: 120)
  UPTIME_SAMPLES    raw sparkline points kept/target (default: 60)
  UPTIME_RETENTION_DAYS  hourly-bucket retention     (default: 7)
  UPTIME_JSON       output path  (default: /var/lib/home-hq/uptime.json)
"""

import json
import os
import socket
import time
import urllib.error
import urllib.request

TIMEOUT = float(os.environ.get("UPTIME_TIMEOUT", "5"))
INTERVAL = int(os.environ.get("UPTIME_INTERVAL", "120"))
MAX_SAMPLES = int(os.environ.get("UPTIME_SAMPLES", "60"))
RETENTION_DAYS = int(os.environ.get("UPTIME_RETENTION_DAYS", "7"))
OUT = os.environ.get("UPTIME_JSON", "/var/lib/home-hq/uptime.json")


def parse_targets(spec):
    """"Label|target" entries -> [{label, kind, target}], skipping malformed."""
    targets = []
    for entry in (spec or "").split(","):
        entry = entry.strip()
        if not entry or "|" not in entry:
            continue
        label, _, target = entry.partition("|")
        label, target = label.strip(), target.strip()
        if not label or not target:
            continue
        kind = "http" if target.startswith(("http://", "https://")) else "tcp"
        targets.append({"label": label, "kind": kind, "target": target})
    return targets


def probe(kind, target):
    """Probe one target. (up, response_ms). For HTTP any status (even 4xx/5xx)
    is up — the port served a response; only a connection failure is down."""
    start = time.monotonic()
    try:
        if kind == "http":
            try:
                urllib.request.urlopen(urllib.request.Request(target, method="GET"),
                                       timeout=TIMEOUT).close()
            except urllib.error.HTTPError:
                pass  # answered with a status = up
        else:
            host, _, port = target.rpartition(":")
            with socket.create_connection((host, int(port)), timeout=TIMEOUT):
                pass
        return True, int((time.monotonic() - start) * 1000)
    except (urllib.error.URLError, OSError, ValueError):
        return False, None


def _load_state():
    try:
        with open(OUT) as fh:
            return {t["label"]: t for t in json.load(fh).get("targets", []) if "label" in t}
    except (FileNotFoundError, json.JSONDecodeError, OSError, TypeError):
        return {}


def main():
    targets = parse_targets(os.environ.get("UPTIME_TARGETS", ""))
    prev = _load_state()
    now = time.time()
    hour = int(now // 3600 * 3600)
    cutoff = hour - RETENTION_DAYS * 86400

    out = []
    for t in targets:
        rec = prev.get(t["label"], {})
        up, ms = probe(t["kind"], t["target"])

        samples = (rec.get("samples") or []) + [{"ts": now, "up": up, "ms": ms}]
        hourly = rec.get("hourly") or []
        if hourly and hourly[-1].get("h") == hour:
            hourly[-1]["total"] += 1
            hourly[-1]["up"] += 1 if up else 0
        else:
            hourly.append({"h": hour, "up": 1 if up else 0, "total": 1})

        out.append({
            "label": t["label"],
            "kind": t["kind"],
            "last": {"ts": now, "up": up, "ms": ms},
            "samples": samples[-MAX_SAMPLES:],
            "hourly": [b for b in hourly if b.get("h", 0) >= cutoff],
        })

    data = {"updated": int(now), "interval": INTERVAL, "targets": out}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(data, fh)
    os.replace(tmp, OUT)  # atomic swap so the reader never sees a half-written file
    os.chmod(OUT, 0o644)


if __name__ == "__main__":
    main()
