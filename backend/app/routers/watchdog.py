"""
/api/drive-watchdog — health of a watched external drive, from a state file.

The host drive-watchdog daemon (scripts/drive-watchdog.sh) probes a flaky USB
drive and auto-recovers a wedged bridge, writing a small JSON state file each
loop. SMART can't see through many USB enclosures, so this fills that gap: the
backend just reads + summarizes the file — the same privileged-host /
unprivileged-app split as SMART and backups.

Missing/unreadable file -> available:false (watchdog not configured or no data).
If the file exists but is older than the stale window, the watchdog isn't
running, so we flag it stale (the drive's state is unknown, not necessarily bad).
"""

import json
import time

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.config import settings

router = APIRouter()


# Superset model. A missing/garbage state file returns just {available:false};
# a present one adds the summarized fields + recovery log. The Optionals are
# dropped by response_model_exclude_none so both shapes match the prior output.
# `recoveries` stays a plain list of dicts so the event records pass through
# verbatim (a typed model would silently filter any extra event keys).
class WatchdogModel(BaseModel):
    available: bool = Field(description="False when no watchdog state file exists")
    label: str | None = Field(default=None, description="Drive label being watched")
    mount: str | None = None
    fstype: str | None = None
    healthy: bool | None = None
    stale: bool | None = Field(default=None, description="True if the watchdog hasn't reported recently")
    last_check: int | None = None
    last_recovery: int | None = None
    recovery_count: int | None = None
    note: str | None = None
    recoveries: list[dict] | None = Field(default=None, description="Recent recovery events, newest first")

# If the watchdog hasn't written in this long, treat its state as stale (it
# writes every probe interval, ~30s by default, so a few minutes means it's off).
_STALE_AFTER_SECONDS = 180


def read_events(path, limit=10):
    """Last `limit` recovery events from the watchdog's append-only JSONL log,
    newest first. Missing/garbage lines are skipped; missing file → []."""
    try:
        with open(path) as fh:
            lines = fh.readlines()
    except (FileNotFoundError, OSError):
        return []
    events = []
    for line in lines[-limit:]:
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    events.reverse()  # newest first
    return events


def summarize(data, now=None):
    """Map the raw state file into the API model. Pure + defensive."""
    now = time.time() if now is None else now
    last_check = data.get("last_check")
    stale = last_check is None or (now - last_check) > _STALE_AFTER_SECONDS
    return {
        "available": True,
        "label": data.get("label"),
        "mount": data.get("mount"),
        "fstype": data.get("fstype") or None,
        "healthy": bool(data.get("healthy")),
        "stale": stale,
        "last_check": last_check,
        "last_recovery": data.get("last_recovery"),
        "recovery_count": data.get("recovery_count") or 0,
        "note": data.get("note"),
    }


@router.get("/drive-watchdog", response_model=WatchdogModel, response_model_exclude_none=True)
def get_drive_watchdog():
    try:
        with open(settings.watchdog_state_path) as fh:
            data = json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {"available": False}
    result = summarize(data)
    result["recoveries"] = read_events(settings.watchdog_events_path)
    return result
