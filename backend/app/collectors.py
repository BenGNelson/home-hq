"""Shared read side of the file-backed collector pattern.

A privileged host script (SMART, VPN, Tailscale, HA, GPU, the drive watchdog, …)
writes a small JSON file; the unprivileged backend container only READS it. Every
such reader needs the same defensive load — a missing file, bad permissions, or
corrupt/half-written JSON must degrade, never raise — so it lives here once
instead of being copy-pasted (and drifting) across the routers.
"""

import json


def read_collector_json(path):
    """Return a collector file's parsed JSON, or None if it's missing,
    unreadable, or corrupt. Catches OSError (missing file / permissions) and
    ValueError (JSON + unicode decode errors). Callers map None to their own
    degraded shape (`available: false` / `configured: false`)."""
    try:
        with open(path) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None
