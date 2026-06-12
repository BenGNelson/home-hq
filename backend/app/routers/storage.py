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
from pydantic import BaseModel, Field

from app import db
from app.storage_history import project_capacity

router = APIRouter()


# --- /storage/space (degrades to {available:false} → superset + exclude_none) ---
class SpaceEntryModel(BaseModel):
    name: str = Field(description="Top-level child of the scanned root")
    bytes: int = Field(description="Bytes used by that child")


class SpaceModel(BaseModel):
    available: bool = Field(description="False until the first daily du scan has run")
    scanned_at: float | None = Field(default=None, description="Unix time of the scan")
    root: str | None = None
    total_bytes: int | None = None
    entries: list[SpaceEntryModel] | None = None


# --- /storage/trends (always full; modeled WITHOUT exclude_none so the null
#     metric points and a null projection stay byte-for-byte) ---
class TrendPointModel(BaseModel):
    day: str = Field(description="UTC day, YYYY-MM-DD")
    ts: float = Field(description="Unix time of the sample")
    value: int | None = Field(description="Metric value (null when not applicable to the drive)")


class CapacityRowModel(BaseModel):
    day: str
    ts: float
    subject: str = Field(description="The mount this capacity sample is for")
    # Free-form: whatever metric keys the sampler recorded (typically total/used/
    # free_bytes + percent). Kept as a dict so no recorded key is ever filtered.
    metrics: dict


class ProjectionModel(BaseModel):
    bytes_per_day: float
    used_bytes: float
    total_bytes: float
    span_days: float
    samples: int
    days_until_full: float | None = Field(description="None when usage is flat/shrinking")


class TrendsModel(BaseModel):
    available: bool
    days: int = Field(description="Query window in days")
    # drive -> metric -> time series. Dynamic keys, so typed as nested dicts.
    smart: dict[str, dict[str, list[TrendPointModel]]]
    capacity: list[CapacityRowModel]
    projection: ProjectionModel | None = Field(default=None, description="Growth projection, or null when there isn't enough signal")


# --- /storage/db (SQLite size + per-table row counts; growth visibility) ---
class DbTableModel(BaseModel):
    name: str
    rows: int
    cap: int | None = Field(default=None, description="Hard row cap, if the table has one")


class DbStatsModel(BaseModel):
    size_bytes: int | None = Field(default=None, description="Size of the SQLite file")
    path: str
    tables: list[DbTableModel]


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


@router.get("/storage/space", response_model=SpaceModel, response_model_exclude_none=True)
def get_space():
    """Cached top-level usage breakdown of the storage mount (daily du scan).
    available:false until the first background scan has run."""
    latest = db.latest_space_usage()
    if not latest:
        return {"available": False}
    return {
        "available": True,
        "scanned_at": latest["scanned_at"],
        "root": latest["root"],
        "total_bytes": latest["total_bytes"],
        "entries": latest["entries"],
    }


@router.get("/storage/db", response_model=DbStatsModel)
def get_db_stats():
    """SQLite file size + per-table row counts, so the Storage page can show how
    much the local DB is using and whether any sampler table is near its cap."""
    return db.db_stats()


@router.get("/storage/trends", response_model=TrendsModel)
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
