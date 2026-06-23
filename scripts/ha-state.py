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
  HA_ENTITIES   comma-separated entity ids to surface, in display order (required).
                Each item may be 'entity_id' or 'entity_id|Custom label';
                the label overrides HA's friendly name in the glance (handy
                when an integration's friendly names are long/verbose).
  HA_JSON       output path  (default: /var/lib/home-hq/ha.json)
  HA_TIMEOUT    HTTP timeout in seconds (default: 15)
  CATALOG_FILE  optional path to the home-catalog YAML; if set, the collector
                ALSO writes the live state of every entity the catalog references
                (so the Home Catalog page can show device state in place).
  CATALOG_STATE_JSON  output path for those catalog states
                (default: /var/lib/home-hq/ha-catalog.json)

Both outputs come from the SAME single /api/states fetch — the catalog states
are just a second slice of it, so this adds no extra HA load.

The token is the one secret here, so — unlike the other collectors — nothing in
this file is committed with a real value; HA_TOKEN lives only in the gitignored
.env. Nothing host-specific is hard-coded, so the script itself is safe to commit.
"""

import json
import os
import re
import time
import urllib.error
import urllib.request

HA_URL = (os.environ.get("HA_URL") or "").rstrip("/")
HA_TOKEN = os.environ.get("HA_TOKEN") or ""
HA_ENTITIES = os.environ.get("HA_ENTITIES") or ""
OUT = os.environ.get("HA_JSON", "/var/lib/home-hq/ha.json")
CATALOG_FILE = os.environ.get("CATALOG_FILE") or ""
CATALOG_OUT = os.environ.get("CATALOG_STATE_JSON", "/var/lib/home-hq/ha-catalog.json")

# Pull entity ids out of the catalog YAML with a regex so the host script needs
# no YAML dependency (it's stdlib-only by design). Matches `entity: domain.id`
# (optionally quoted, optionally as the first key on a `- ` list line); the
# object id may start with a digit (Midea, etc.).
_ENTITY_RE = re.compile(r'(?m)^\s*(?:-\s+)?entity:\s*["\']?([A-Za-z_][\w]*\.[\w]+)')
try:
    TIMEOUT = int(os.environ.get("HA_TIMEOUT", "15"))
except ValueError:
    # A typo'd timeout shouldn't hard-crash the collector before it can write a
    # state file (which would leave the dashboard silently empty) — fall back.
    TIMEOUT = 15


def _allowlist():
    """Parse HA_ENTITIES into ordered, de-duplicated (entity_id, label) pairs.
    Each item is 'entity_id' or 'entity_id|Custom label'; label is None when not
    given (the collector then falls back to HA's friendly name)."""
    seen = set()
    items = []
    for raw in HA_ENTITIES.split(","):
        part = raw.strip()
        if not part:
            continue
        eid, _, label = part.partition("|")
        eid = eid.strip()
        label = label.strip()
        if eid and eid not in seen:
            seen.add(eid)
            items.append((eid, label or None))
    return items


def _catalog_entities():
    """Entity ids referenced in the catalog YAML (CATALOG_FILE), de-duped in
    file order. Empty when CATALOG_FILE is unset or unreadable."""
    if not CATALOG_FILE:
        return []
    try:
        with open(CATALOG_FILE, encoding="utf-8") as fh:
            text = fh.read()
    except OSError:
        return []
    seen = set()
    out = []
    for eid in _ENTITY_RE.findall(text):
        if eid not in seen:
            seen.add(eid)
            out.append(eid)
    return out


def _write(path, data):
    """Atomically write JSON so a reader never sees a half-written file."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(data, fh)
    os.replace(tmp, path)
    os.chmod(path, 0o644)


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


def _shape(state, label=None):
    """Trim a raw HA state object to the non-sensitive subset we display. An
    optional label (from the allowlist) overrides HA's friendly name."""
    attrs = state.get("attributes") or {}
    return {
        "entity_id": state.get("entity_id"),
        "name": label or attrs.get("friendly_name") or state.get("entity_id"),
        "state": state.get("state"),
        "unit": attrs.get("unit_of_measurement"),
        "device_class": attrs.get("device_class"),
    }


def main():
    now = int(time.time())
    allow = _allowlist()
    catalog_ids = _catalog_entities()

    # No URL/token, or nothing wanted by EITHER output, is "not configured" —
    # skip the request entirely (no point authenticating just to discard it).
    if not HA_URL or not HA_TOKEN or not (allow or catalog_ids):
        ha_data = {"updated": now, "available": False, "reason": "not_configured"}
        cat_data = {"updated": now, "available": False, "reason": "not_configured", "states": {}}
    else:
        raw = fetch_states()
        if raw is None or not isinstance(raw, list):
            ha_data = {"updated": now, "available": False, "reason": "unreachable"}
            cat_data = {"updated": now, "available": False, "reason": "unreachable", "states": {}}
        else:
            by_id = {s.get("entity_id"): s for s in raw if isinstance(s, dict)}
            # ha.json: the curated Home-widget allowlist, in allowlist order.
            if allow:
                entities = [_shape(by_id[eid], label) for (eid, label) in allow if eid in by_id]
                ha_data = {"updated": now, "available": True, "entities": entities}
            else:
                ha_data = {"updated": now, "available": False, "reason": "not_configured"}
            # ha-catalog.json: live state keyed by entity id for the catalog's
            # entities (a second slice of the SAME fetch — no extra HA load).
            if catalog_ids:
                states = {eid: _shape(by_id[eid]) for eid in catalog_ids if eid in by_id}
                cat_data = {"updated": now, "available": True, "states": states}
            else:
                cat_data = {"updated": now, "available": False, "reason": "not_configured", "states": {}}

    _write(OUT, ha_data)
    _write(CATALOG_OUT, cat_data)


if __name__ == "__main__":
    main()
