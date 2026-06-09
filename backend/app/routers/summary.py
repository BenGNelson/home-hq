"""
/api/summary — a compact health rollup for the dashboard's at-a-glance bar.

Calls the other routers' functions in-process and reduces each subsystem to a
status (ok / warn / down / unknown) plus a short detail string, so the frontend
makes one call instead of six. The `summarize_*` helpers are pure (dict in,
dict out) and unit-tested; the endpoint just wires them together, guarding each
source so one failure never blanks the whole bar.
"""

from fastapi import APIRouter

from app.routers import containers as containers_r
from app.routers import disk as disk_r
from app.routers import plex as plex_r
from app.routers import raid as raid_r
from app.routers import smart as smart_r
from app.routers import system as system_r

router = APIRouter()


def _round(n):
    return round(n or 0)


def summarize_system(data):
    data = data or {}
    cpu = (data.get("cpu") or {}).get("percent")
    mem = (data.get("memory") or {}).get("percent")
    status = "warn" if (mem is not None and mem >= 90) else "ok"
    return {"status": status, "detail": f"CPU {_round(cpu)}% · RAM {_round(mem)}%"}


def summarize_storage(disk, raid):
    disk = disk or {}
    if not disk.get("available"):
        status, detail = "unknown", "—"
    else:
        p = disk.get("percent") or 0
        status = "down" if p >= 95 else "warn" if p >= 85 else "ok"
        detail = f"{_round(p)}%"
    arrays = (raid or {}).get("arrays") or []
    if arrays:
        if any(a.get("healthy") is False for a in arrays):
            status, detail = "down", f"{detail} · RAID degraded"
        else:
            detail = f"{detail} · RAID ok"
    return {"status": status, "detail": detail}


def summarize_drives(smart):
    smart = smart or {}
    if not smart.get("available"):
        return {"status": "unknown", "detail": "no data"}
    drives = [d for d in smart.get("drives", []) if d.get("role") != "other"]
    failed = [d for d in drives if d.get("passed") is False]
    warned = [d for d in drives if d.get("warnings")]
    if failed:
        return {"status": "down", "detail": f"{len(failed)} failing"}
    if warned:
        return {"status": "warn", "detail": f"{len(warned)} warning"}
    return {"status": "ok", "detail": f"{len(drives)} OK"}


def summarize_plex(data):
    data = data or {}
    if not data.get("configured"):
        return {"status": "unknown", "detail": "not configured"}
    if not data.get("reachable"):
        return {"status": "down", "detail": "unreachable"}
    n = data.get("streams") or 0
    return {"status": "ok", "detail": f"{n} stream{'' if n == 1 else 's'}"}


def summarize_containers(data):
    data = data or {}
    if not data.get("available"):
        return {"status": "unknown", "detail": "—"}
    conts = data.get("containers") or []
    total = len(conts)
    up = sum(1 for c in conts if c.get("status") == "running")
    if up < total:
        return {"status": "warn", "detail": f"{up}/{total} up"}
    return {"status": "ok", "detail": f"{total} up"}


def _safe(fn):
    try:
        return fn()
    except Exception:
        return None


@router.get("/summary")
def get_summary():
    return {
        "system": summarize_system(_safe(system_r.get_system)),
        "storage": summarize_storage(_safe(disk_r.get_disk), _safe(raid_r.get_raid)),
        "drives": summarize_drives(_safe(smart_r.get_smart)),
        "plex": summarize_plex(_safe(plex_r.get_plex)),
        "containers": summarize_containers(_safe(containers_r.get_containers)),
    }
