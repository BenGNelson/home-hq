"""
/api/uptime — service-availability monitoring, from the host prober's state file.

A host script (scripts/uptime-probe.py, run by a systemd timer) probes each
configured service via localhost — reaching even the LAN-restricted ones the
firewalled backend container can't — and writes uptime.json. The backend reads
it via the same /smart mount as SMART/VPN/Tailscale and shapes it here (pure
summarize, unit-tested). Missing file → not configured / prober not installed.
"""

import json

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app import uptime
from app.config import settings
from app.collectors import read_collector_json

router = APIRouter()


class UptimeHistoryPoint(BaseModel):
    ts: float | None = None
    up: bool
    ms: int | None = None


class UptimeTargetModel(BaseModel):
    label: str | None = None
    kind: str | None = Field(default=None, description="http | tcp")
    status: str = Field(description="up | down | unknown")
    last_response_ms: int | None = None
    last_checked: float | None = None
    uptime_24h: float | None = Field(default=None, description="Uptime % over the last 24h")
    uptime_7d: float | None = Field(default=None, description="Uptime % over the last 7 days")
    history: list[UptimeHistoryPoint]


class UptimeModel(BaseModel):
    configured: bool = Field(description="False when no prober data exists yet")
    stale: bool = Field(description="True when the prober hasn't written recently")
    interval: int | None = Field(default=None, description="Probe interval (seconds)")
    targets: list[UptimeTargetModel]


@router.get("/uptime", response_model=UptimeModel)
def get_uptime():
    data = read_collector_json(settings.uptime_json_path)
    if data is None:
        return {"configured": False, "stale": True, "interval": None, "targets": []}

    import time

    updated = data.get("updated")
    stale = updated is None or (time.time() - updated) > uptime.STALE_AFTER_SECONDS
    targets = uptime.summarize_uptime(data)
    return {
        "configured": bool(targets),
        "stale": stale,
        "interval": data.get("interval"),
        "targets": targets,
    }
