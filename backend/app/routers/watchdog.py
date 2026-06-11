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

from app.config import settings

router = APIRouter()

# If the watchdog hasn't written in this long, treat its state as stale (it
# writes every probe interval, ~30s by default, so a few minutes means it's off).
_STALE_AFTER_SECONDS = 180


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


@router.get("/drive-watchdog")
def get_drive_watchdog():
    try:
        with open(settings.watchdog_state_path) as fh:
            data = json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {"available": False}
    return summarize(data)
