"""
/api/diskio — per-disk read/write throughput, from /proc/diskstats.

Same shape as /api/network: the kernel exposes cumulative byte counters and the
frontend samples this endpoint to compute live rates client-side, so the backend
stays stateless. /proc/diskstats is global (block devices aren't namespaced), and
docker-compose already mounts the host's /proc read-only at /host/proc.

Each /proc/diskstats line is:  major minor name  reads_completed reads_merged
sectors_read ms_reading  writes_completed writes_merged sectors_written ...
A "sector" here is fixed at 512 bytes regardless of the device's real block size.
"""

import re
import time

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter()


class DiskStatModel(BaseModel):
    name: str = Field(description="Block device name (e.g. sda, nvme0n1, md0)")
    read_bytes: int = Field(description="Cumulative bytes read")
    write_bytes: int = Field(description="Cumulative bytes written")


# Same superset/exclude_none convention as /network — error/time omitted on the
# path where they don't apply so the on-the-wire shape is unchanged.
class DiskIoModel(BaseModel):
    available: bool = Field(description="False when host /proc isn't mounted")
    error: str | None = None
    time: float | None = Field(default=None, description="Unix time of this sample")
    disks: list[DiskStatModel] = []

HOST_DISKSTATS = "/host/proc/diskstats"

# A sector in /proc/diskstats is always 512 bytes (a kernel convention, not the
# device's physical sector size).
_SECTOR_BYTES = 512

# Keep whole disks and md arrays; drop partitions (sda1), LVM/dm, loop, ram, etc.
# Partitions carry a trailing digit (sda1, nvme0n1p1) so the anchored patterns
# exclude them.
_DISK_RE = re.compile(r"^(sd[a-z]+|nvme\d+n\d+|vd[a-z]+|hd[a-z]+|md\d+)$")


def parse_diskstats(text: str) -> list[dict]:
    disks = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) < 10:
            continue
        name = parts[2]
        if not _DISK_RE.match(name):
            continue
        try:
            sectors_read = int(parts[5])
            sectors_written = int(parts[9])
        except ValueError:
            continue
        disks.append(
            {
                "name": name,
                "read_bytes": sectors_read * _SECTOR_BYTES,
                "write_bytes": sectors_written * _SECTOR_BYTES,
            }
        )
    return disks


@router.get("/diskio", response_model=DiskIoModel, response_model_exclude_none=True)
def get_diskio():
    try:
        with open(HOST_DISKSTATS) as fh:
            disks = parse_diskstats(fh.read())
    except FileNotFoundError:
        return {"available": False, "error": "host /proc not mounted", "disks": []}
    except Exception as exc:  # pragma: no cover - defensive
        return {"available": False, "error": str(exc), "disks": []}
    return {"available": True, "time": time.time(), "disks": disks}
