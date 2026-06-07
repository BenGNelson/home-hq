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

from app.config import settings

router = APIRouter()


@router.get("/disk")
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
