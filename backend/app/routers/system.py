"""
/api/system — live system stats for the host the backend runs on.

We use `psutil`, which reads the kernel's live metrics from /proc.
Note on Docker: containers share the host's kernel, so CPU%, total/used RAM,
and boot_time already reflect the *host*, not some isolated VM. Disk
usage is the exception — that needs the host path mounted into the container,
which is why docker-compose mounts ${RAID_MOUNT} (used later by /api/disk).
"""

import time

import psutil
from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.config import settings

# A router is a group of related endpoints. main.py mounts it under /api.
router = APIRouter()


# Response models. These don't change the data — the endpoint still returns a
# plain dict — but they give the OpenAPI docs (/api/docs) typed fields with
# descriptions instead of a generic object. /system has a stable shape, so a
# strict model is safe here (unlike the endpoints that degrade to
# {available: false}). This is the template for typing more endpoints over time.
class CpuModel(BaseModel):
    percent: float = Field(description="Busy % across all cores, sampled briefly")
    cores: int = Field(description="Logical CPU count")


class MemoryModel(BaseModel):
    total_bytes: int
    used_bytes: int
    available_bytes: int
    percent: float = Field(description="Used memory as a percentage")


# Distinct from disk.py's DiskModel (the storage mount, which degrades to
# {available:false}); this is the always-required OS/root usage shape.
class SystemDiskModel(BaseModel):
    total_bytes: int
    used_bytes: int
    free_bytes: int
    percent: float = Field(description="Used space as a percentage")


class SystemModel(BaseModel):
    server_name: str = Field(description="Configured display name for the host")
    cpu: CpuModel
    memory: MemoryModel
    disk: SystemDiskModel | None = Field(
        default=None, description="OS/root filesystem usage; omitted if the mount can't be read"
    )
    uptime_seconds: int = Field(description="Seconds since the kernel booted")


@router.get("/system", response_model=SystemModel, response_model_exclude_none=True)
def get_system():
    # CPU: percent busy across all cores, sampled over a short interval.
    # interval=0.3 means "watch for 0.3s and report the busy %". Without an
    # interval the first call returns 0.0, so we take a quick sample.
    cpu_percent = psutil.cpu_percent(interval=0.3)

    # Memory: total/used/available in bytes, plus a handy percent.
    mem = psutil.virtual_memory()

    # OS/root disk: total/used/free for the filesystem the host boots from.
    # Inside the container "/" is the overlay backed by the host OS disk, so
    # this matches the host root (see SYSTEM_DISK_MOUNT in config). Wrapped so a
    # bad/missing mount degrades to a null disk block instead of 500-ing the
    # whole endpoint (which would also drop CPU/RAM/uptime) — same graceful
    # stance as /api/disk.
    try:
        usage = psutil.disk_usage(settings.system_disk_mount)
        disk = {
            "total_bytes": usage.total,
            "used_bytes": usage.used,
            "free_bytes": usage.free,
            "percent": usage.percent,
        }
    except OSError:
        disk = None

    # Uptime: now minus the kernel boot time.
    uptime_seconds = int(time.time() - psutil.boot_time())

    return {
        "server_name": settings.server_name,
        "cpu": {
            "percent": cpu_percent,
            "cores": psutil.cpu_count(logical=True),
        },
        "memory": {
            "total_bytes": mem.total,
            "used_bytes": mem.used,
            "available_bytes": mem.available,
            "percent": mem.percent,
        },
        "disk": disk,
        "uptime_seconds": uptime_seconds,
    }
