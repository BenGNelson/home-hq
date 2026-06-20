#!/usr/bin/env python3
"""
Record a curated handful of Home Assistant entity states into a JSON file the
Home HQ backend reads.

Runs on the HOST via a systemd timer — see home-hq-ha.{service,timer}.example.
The backend runs in a container that holds no HA URL or token; exactly like
SMART, the VPN check, and the Tailscale collector, a small privileged host
script gathers the facts and writes them where the app can read them read-only.

It calls HA's REST API `GET /api/states` with a Long-Lived Access Token, keeps
only the allowlisted entities (in allowlist order), and trims each to the few
fields the dashboard shows. This is a READ-ONLY glance — no service calls, no
control. Config comes from the environment (the systemd unit can pull it from
the repo .env):

  HA_URL        base URL of Home Assistant, e.g. http://localhost:8123  (required)
  HA_TOKEN      a Long-Lived Access Token (HA profile page)             (required)
  HA_ENTITIES   comma-separated entity ids to surface, in display order (required)
  HA_JSON       output path  (default: /var/lib/home-hq/ha.json)
  HA_TIMEOUT    HTTP timeout in seconds (default: 15)

The token is the one secret here, so — unlike the other collectors — nothing in
this file is committed with a real value; HA_TOKEN lives only in the gitignored
.env. Nothing host-specific is hard-coded, so the script itself is safe to commit.
"""

import json
import os
import time
import urllib.error
import urllib.request

HA_URL = (os.environ.get("HA_URL") or "").rstrip("/")
HA_TOKEN = os.environ.get("HA_TOKEN") or ""
HA_ENTITIES = os.environ.get("HA_ENTITIES") or ""
OUT = os.environ.get("HA_JSON", "/var/lib/home-hq/ha.json")
try:
    TIMEOUT = int(os.environ.get("HA_TIMEOUT", "15"))
except ValueError:
    # A typo'd timeout shouldn't hard-crash the collector before it can write a
    # state file (which would leave the dashboard silently empty) — fall back.
    TIMEOUT = 15


def _allowlist():
    """Parse HA_ENTITIES into an ordered, de-duplicated list of entity ids."""
    seen = set()
    ids = []
    for raw in HA_ENTITIES.split(","):
        eid = raw.strip()
        if eid and eid not in seen:
            seen.add(eid)
            ids.append(eid)
    return ids


def fetch_states():
    """GET /api/states -> list of state dicts, or None on any failure."""
    req = urllib.request.Request(
        f"{HA_URL}/api/states",
        headers={"Authorization": f"Bearer {HA_TOKEN}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError):
        return None


def _shape(state):
    """Trim a raw HA state object to the non-sensitive subset we display."""
    attrs = state.get("attributes") or {}
    return {
        "entity_id": state.get("entity_id"),
        "name": attrs.get("friendly_name") or state.get("entity_id"),
        "state": state.get("state"),
        "unit": attrs.get("unit_of_measurement"),
        "device_class": attrs.get("device_class"),
    }


def main():
    allow = _allowlist()
    # No URL/token, or nothing to show, is "not configured" — skip the request
    # entirely (no point authenticating to HA just to discard every entity).
    if not HA_URL or not HA_TOKEN or not allow:
        data = {"updated": int(time.time()), "available": False, "reason": "not_configured"}
    else:
        raw = fetch_states()
        if raw is None or not isinstance(raw, list):
            data = {"updated": int(time.time()), "available": False, "reason": "unreachable"}
        else:
            by_id = {s.get("entity_id"): s for s in raw if isinstance(s, dict)}
            # Keep allowlist order; skip ids HA doesn't know about.
            entities = [_shape(by_id[eid]) for eid in allow if eid in by_id]
            data = {"updated": int(time.time()), "available": True, "entities": entities}

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(data, fh)
    os.replace(tmp, OUT)  # atomic swap so the reader never sees a half-written file
    os.chmod(OUT, 0o644)


if __name__ == "__main__":
    main()
