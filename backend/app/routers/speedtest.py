"""
/api/speedtest — internet speed (ISP) monitor.

The backend runs the Ookla `speedtest` CLI on a schedule (see speedtest.py),
stores each result in SQLite, and serves the trend here. A manual /run lets you
kick off a test on demand (it's async — the result lands a run later).

Endpoints:
  GET  /speedtest      : latest result + recent history (for charting) + stats
  POST /speedtest/run  : trigger a one-off test in the background

Degrades gracefully: when the module is disabled and there's no data it reports
available:false; right after the first manual trigger (no rows yet) it reports
available:false with reason "no_data" + running:true so the UI can show a
"running…" state instead of an empty page.
"""

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app import db, speedtest
from app.config import settings

router = APIRouter()


# --- response models --------------------------------------------------------

# Newest stored result (the headline numbers + the shareable link).
class LatestModel(BaseModel):
    ts: int
    download_mbps: float | None = None
    upload_mbps: float | None = None
    ping_ms: float | None = None
    jitter_ms: float | None = None
    packet_loss: float | None = None
    server: str | None = None
    isp: str | None = None
    result_url: str | None = None


# A trimmed point for the trend chart (oldest-first).
class HistoryPointModel(BaseModel):
    ts: int
    download_mbps: float | None = None
    upload_mbps: float | None = None
    ping_ms: float | None = None


class StatsModel(BaseModel):
    samples: int
    avg_download: float | None = None
    min_download: float | None = None
    avg_upload: float | None = None


class SpeedtestModel(BaseModel):
    available: bool
    reason: str | None = Field(default=None, description="not_enabled | no_data")
    running: bool | None = None
    latest: LatestModel | None = None
    history: list[HistoryPointModel] | None = None
    stats: StatsModel | None = None


class RunModel(BaseModel):
    started: bool


@router.get("/speedtest", response_model=SpeedtestModel, response_model_exclude_none=True)
def get_speedtest():
    """Latest internet speed + recent history (for charting) + headline stats.

    Reads only SQLite, so it works regardless of whether a test is in flight.
    """
    latest = db.latest_speedtest_sample()
    running = speedtest.is_running()

    if latest is None:
        # No data yet. If the module is off entirely it's "not_enabled"; if it's
        # on (or a manual test was just triggered) it's "no_data" — the UI uses
        # `running` to decide between "no data" and "running…".
        if not settings.speedtest_enabled:
            return {"available": False, "reason": "not_enabled"}
        return {"available": False, "reason": "no_data", "running": running}

    history = db.recent_speedtest_samples(limit=30)  # oldest-first for charting
    return {
        "available": True,
        "running": running,
        "latest": latest,
        "history": [
            {
                "ts": h["ts"],
                "download_mbps": h.get("download_mbps"),
                "upload_mbps": h.get("upload_mbps"),
                "ping_ms": h.get("ping_ms"),
            }
            for h in history
        ],
        "stats": db.speedtest_stats(),
    }


@router.post("/speedtest/run", response_model=RunModel)
def run_speedtest():
    """Kick off a one-off speedtest in the background (no-op if one's running).

    Returns immediately; the result shows up in GET /speedtest a run later.
    Allowed even when scheduled tests are disabled (manual-only is a valid mode).
    """
    started = speedtest.trigger_async()
    return {"started": started}
