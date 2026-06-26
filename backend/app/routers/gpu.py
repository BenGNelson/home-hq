"""
/api/gpu — NVIDIA GPU stats, from a state file.

A host timer (scripts/gpu-stats.py) runs `nvidia-smi` and writes a small JSON
snapshot. The backend container has no GPU passthrough or nvidia-smi binary, so
— exactly like SMART, the VPN check, and Tailscale — the host script gathers the
facts and we just read + shape them here. The dashboard System widget renders
the result and self-hides when it's unavailable, so installs without an NVIDIA
GPU show nothing (the open-source default).

The shaping (memory %, staleness) lives in the pure `summarize()` so it stays
unit-tested; the route is a thin wrapper.
"""

import time

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.config import settings
from app.collectors import read_collector_json

router = APIRouter()


class GpuDeviceModel(BaseModel):
    name: str = Field(description="Adapter name, e.g. NVIDIA GeForce GTX 1080")
    utilization_percent: int | None = Field(default=None, description="GPU busy %")
    memory_used_mb: int | None = None
    memory_total_mb: int | None = None
    memory_percent: float | None = Field(default=None, description="VRAM used %")
    temperature_c: int | None = None
    encoder_sessions: int | None = Field(default=None, description="Active NVENC encode sessions")
    power_watts: float | None = None


class GpuModel(BaseModel):
    available: bool = Field(description="False when there's no GPU / the timer hasn't run")
    stale: bool | None = Field(default=None, description="True if the snapshot is too old to trust")
    gpus: list[GpuDeviceModel] = []
    updated: int | None = None


# The timer refreshes every minute; older than this and the load/VRAM numbers
# are no longer trustworthy, so we flag the snapshot stale rather than lying.
_STALE_AFTER_SECONDS = 300


def summarize(data, now=None):
    """Map the raw state file into the API model. Pure + defensive.

    available is False when the host reported no GPU (nvidia-smi absent/failed)
    or there are no usable rows — the widget hides itself in that case.
    """
    now = time.time() if now is None else now
    if not data.get("available", False):
        return {"available": False}

    updated = data.get("updated")
    stale = updated is None or (now - updated) > _STALE_AFTER_SECONDS

    gpus = []
    for g in data.get("gpus") or []:
        used = g.get("memory_used_mb")
        total = g.get("memory_total_mb")
        mem_pct = round(used / total * 100, 1) if used is not None and total else None
        gpus.append({
            "name": g.get("name") or "GPU",
            "utilization_percent": g.get("utilization_percent"),
            "memory_used_mb": used,
            "memory_total_mb": total,
            "memory_percent": mem_pct,
            "temperature_c": g.get("temperature_c"),
            "encoder_sessions": g.get("encoder_sessions"),
            "power_watts": g.get("power_watts"),
        })

    if not gpus:
        return {"available": False}

    return {"available": True, "stale": stale, "gpus": gpus, "updated": updated}


def get_gpu():
    """Read + summarize the GPU state file. Missing/garbage -> available:false."""
    data = read_collector_json(settings.gpu_json_path)
    if data is None:
        return {"available": False}
    return summarize(data)


@router.get("/gpu", response_model=GpuModel, response_model_exclude_none=True)
def gpu():
    return get_gpu()
