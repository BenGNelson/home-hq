"""
/api/disk — usage for the configured storage mount (RAID_MOUNT).

psutil.disk_usage(path) returns total/used/free bytes for whatever filesystem
that path lives on. We point it at settings.raid_mount (from RAID_MOUNT in .env).

Why this works from inside the container: docker-compose mounts the host's
RAID path into the container read-only at the same path, so psutil can stat it.
If the path isn't mounted/available we return an error field instead of crashing,
so the dashboard can show a friendly "unavailable" state.
"""

import psutil
from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.config import settings

router = APIRouter()


# A superset response model: the data fields are Optional because this endpoint
# degrades to {mount, available:false, error} when the mount can't be stat'd.
# With response_model_exclude_none the null fields are omitted, so both the
# success and failure shapes stay exactly as before — the model only types the
# OpenAPI schema. (Same Tier-4 convention used across the degrading endpoints.)
class DiskModel(BaseModel):
    mount: str = Field(description="The storage mount this usage is for")
    available: bool = Field(description="False when the mount couldn't be read")
    error: str | None = Field(default=None, description="Why it was unavailable")
    total_bytes: int | None = None
    used_bytes: int | None = None
    free_bytes: int | None = None
    percent: float | None = Field(default=None, description="Used space as a percentage")


@router.get("/disk", response_model=DiskModel, response_model_exclude_none=True)
def get_disk():
    mount = settings.raid_mount
    try:
        usage = psutil.disk_usage(mount)
    except (FileNotFoundError, PermissionError, OSError) as exc:
        # Path missing inside the container, or not mounted — report gracefully.
        return {"mount": mount, "available": False, "error": str(exc)}

    return {
        "mount": mount,
        "available": True,
        "total_bytes": usage.total,
        "used_bytes": usage.used,
        "free_bytes": usage.free,
        "percent": usage.percent,
    }
