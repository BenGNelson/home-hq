"""
/api/storage/trends — historical SMART + capacity samples for the Storage page.

The point-in-time view already comes from /api/smart, /api/raid and /api/disk.
This adds the time dimension: a background sampler (storage_history.py) records
one row per UTC day, and here we shape it into per-drive metric series plus a
capacity growth projection. Empty history (sampler hasn't run yet, or a fresh
DB) degrades to empty series — never an error.
"""

import time

from fastapi import APIRouter

from app import db
from app.storage_history import project_capacity

router = APIRouter()


def shape_smart_series(rows):
    """Group flat smart rows into {drive: {metric: [{day, ts, value}]}}."""
    by_drive: dict[str, dict[str, list]] = {}
    for r in rows:
        drive = by_drive.setdefault(r["subject"], {})
        for metric, value in (r["metrics"] or {}).items():
            drive.setdefault(metric, []).append(
                {"day": r["day"], "ts": r["ts"], "value": value}
            )
    return by_drive


@router.get("/storage/trends")
def get_trends(days: int = 180):
    days = max(1, min(days, 730))
    since = time.time() - days * 86400
    smart_rows = db.storage_samples("smart", since)
    capacity_rows = db.storage_samples("capacity", since)
    return {
        "available": True,
        "days": days,
        "smart": shape_smart_series(smart_rows),
        "capacity": capacity_rows,  # [{day, ts, subject, metrics}]
        "projection": project_capacity(capacity_rows),
    }
