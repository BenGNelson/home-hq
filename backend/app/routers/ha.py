"""
/api/ha — a thin, read-only glance at a curated handful of Home Assistant
entities, from a state file.

Guiding principle: HA is the brain, Home HQ is the cockpit. HA owns every device
integration, automation, history and the full *control* surface; HQ just
surfaces a few entities at a glance and deep-links into HA for control. This is
NOT a second smart-home UI.

A host timer (scripts/ha-state.py) calls HA's REST `/api/states` with a
Long-Lived Access Token, trims the response to the `.env` allowlist, and writes a
small JSON file. The backend container holds no HA token or URL — exactly like
SMART / VPN / Tailscale, the privileged host script gathers the facts and we
just read + shape them here. The token never enters the repo or the container.

The shaping (entity normalization, domain split, stale check) lives in the pure
`summarize()` so it stays unit-tested; the route is a thin wrapper.
"""

import json
import time

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.config import settings

router = APIRouter()


class HaEntityModel(BaseModel):
    entity_id: str = Field(description="HA entity id, e.g. sensor.dryer_time_remaining")
    domain: str = Field(description="The entity_id prefix, e.g. sensor / climate / lock")
    name: str = Field(description="Friendly name (falls back to a prettified id)")
    state: str = Field(description="Raw state string, e.g. 'on', '72', 'Running'")
    unit: str | None = Field(default=None, description="Unit of measurement, if any")
    device_class: str | None = Field(default=None, description="HA device_class, if any")


# Superset model. summarize() always returns the full key set; Optionals
# (reason/updated, a null unit/device_class) are dropped by
# response_model_exclude_none, which the frontend reads identically.
class HaModel(BaseModel):
    available: bool = Field(description="True when the collector fetched HA states OK")
    reason: str | None = Field(
        default=None,
        description="When unavailable: not_configured | unreachable | no_data",
    )
    stale: bool = Field(description="True when the snapshot is older than the freshness window")
    count: int = Field(description="Number of curated entities")
    entities: list[HaEntityModel] = []
    updated: int | None = Field(default=None, description="Unix time the snapshot was written")


# The host timer refreshes every few minutes; older than this and the values may
# be wrong, so we mark the snapshot stale rather than presenting it as current.
_STALE_AFTER_SECONDS = 900


def _shape_entity(e):
    """Normalize one raw entity dict from the state file. Pure + defensive —
    a non-dict or one missing an entity_id is dropped (returns None)."""
    if not isinstance(e, dict):
        return None
    entity_id = e.get("entity_id")
    if not entity_id or not isinstance(entity_id, str):
        return None
    domain = entity_id.split(".", 1)[0]
    name = e.get("name") or entity_id.split(".", 1)[-1].replace("_", " ").title()
    state = e.get("state")
    return {
        "entity_id": entity_id,
        "domain": domain,
        "name": name,
        "state": "" if state is None else str(state),
        "unit": e.get("unit") or None,
        "device_class": e.get("device_class") or None,
    }


def summarize(data, now=None):
    """Map the raw state file into the API model. Pure + defensive.

    The collector writes available:false with a reason when it can't fetch
    (not_configured = no URL/token; unreachable = the HTTP call failed). We pass
    that through so the widget can hide vs. show 'unavailable' appropriately.
    """
    now = time.time() if now is None else now
    updated = data.get("updated")
    stale = updated is None or (now - updated) > _STALE_AFTER_SECONDS

    if not data.get("available", False):
        return {
            "available": False,
            "reason": data.get("reason") or "no_data",
            "stale": stale,
            "count": 0,
            "entities": [],
            "updated": updated,
        }

    # Preserve the collector's order (it follows the .env allowlist order, which
    # is the order Ben wants them read), just dropping anything unparseable.
    entities = [s for s in (_shape_entity(e) for e in (data.get("entities") or [])) if s]
    return {
        "available": True,
        "reason": None,
        "stale": stale,
        "count": len(entities),
        "entities": entities,
        "updated": updated,
    }


def get_ha():
    """Read + summarize the HA state file. Missing/garbage -> available:false,
    reason no_data (collector never ran / not installed)."""
    try:
        with open(settings.ha_json_path) as fh:
            data = json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        # Delegate the shaping to summarize() (rather than hand-building the dict)
        # so the unavailable shape can't drift from the available one.
        data = {"available": False, "reason": "no_data"}
    return summarize(data)


@router.get("/ha", response_model=HaModel, response_model_exclude_none=True)
def ha():
    return get_ha()
