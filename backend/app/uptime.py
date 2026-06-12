"""
Service-availability summarizing for the Uptime page.

The actual probing is done by a host script (scripts/uptime-probe.py, run by a
systemd timer) — NOT in this container. The backend is firewalled away from the
host's LAN-restricted services (HA, qBittorrent, etc.) by design, but the host
can reach them all via localhost, so this follows the same privileged-host /
unprivileged-app split as the SMART, VPN, and Tailscale checks. The host script
probes each target, keeps a small rolling history + hourly up/down buckets, and
writes uptime.json; this module just shapes that into the API view.

`summarize_uptime` is pure and unit-tested.
"""

from __future__ import annotations

import time

# If the host probe file is older than this, the prober isn't running, so the
# statuses are unknown rather than trustworthy.
STALE_AFTER_SECONDS = 600


def _pct(buckets, since):
    """Uptime % across hourly buckets at/after `since` (None if no data)."""
    up = total = 0
    for b in buckets:
        if b.get("h", 0) >= since:
            up += b.get("up", 0)
            total += b.get("total", 0)
    if total == 0:
        return None
    return round(up / total * 100, 2)


def summarize_uptime(data, now=None):
    """Shape the host prober's uptime.json into the per-target API view. Pure.

    Each target keeps a `last` probe, a short raw `samples` history (sparkline),
    and `hourly` {h, up, total} buckets. We derive the current status, latency,
    and uptime % over 24h / 7d. One entry per target, in the file's order.
    """
    now = time.time() if now is None else now
    out = []
    for t in data.get("targets", []):
        last = t.get("last") or {}
        samples = t.get("samples") or []
        buckets = t.get("hourly") or []
        has_last = bool(last)
        out.append({
            "label": t.get("label"),
            "kind": t.get("kind"),
            "status": ("up" if last.get("up") else "down") if has_last else "unknown",
            "last_response_ms": last.get("ms") if has_last else None,
            "last_checked": last.get("ts") if has_last else None,
            "uptime_24h": _pct(buckets, now - 86400),
            "uptime_7d": _pct(buckets, now - 7 * 86400),
            "history": [
                {"ts": s.get("ts"), "up": bool(s.get("up")), "ms": s.get("ms")}
                for s in samples
            ],
        })
    return out
