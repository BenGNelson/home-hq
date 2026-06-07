"""
/api/containers — list the host's Docker containers (name, status, uptime).

How it reaches Docker: docker-compose mounts the host's Docker socket into this
container at the conventional path /var/run/docker.sock. `docker.from_env()`
connects to that socket by default, so the SDK talks to the host's Docker daemon
and sees every container on the host.

This endpoint only READS (lists) containers. See compose notes on hardening the
socket with a docker-socket-proxy later.
"""

from datetime import datetime, timezone

import docker
from fastapi import APIRouter

router = APIRouter()


def _uptime_seconds(started_at: str) -> int | None:
    """Convert Docker's StartedAt ISO timestamp into seconds of uptime.

    Docker reports nanosecond precision (e.g. 2025-..T..:..:..123456789Z),
    which datetime can't parse directly, so we trim the fractional part to
    microseconds and normalize the trailing 'Z' to +00:00.
    """
    if not started_at or started_at.startswith("0001-01-01"):
        return None  # container never started
    try:
        # Normalize trailing 'Z' to a +00:00 offset.
        ts = started_at.replace("Z", "+00:00")
        # Trim nanosecond fraction down to microseconds, keeping any tz offset.
        if "." in ts:
            head, rest = ts.split(".", 1)
            tz = ""
            for sign in ("+", "-"):
                if sign in rest:
                    frac, off = rest.split(sign, 1)
                    tz = sign + off
                    break
            else:
                frac = rest
            ts = f"{head}.{frac[:6]}{tz}"
        started = datetime.fromisoformat(ts)
        return int((datetime.now(timezone.utc) - started).total_seconds())
    except (ValueError, TypeError):
        return None


@router.get("/containers")
def get_containers():
    try:
        client = docker.from_env()
        containers = client.containers.list(all=True)  # all=True includes stopped
    except docker.errors.DockerException as exc:
        return {"available": False, "error": str(exc), "containers": []}

    result = []
    for c in containers:
        started_at = c.attrs.get("State", {}).get("StartedAt", "")
        result.append(
            {
                "name": c.name,
                "status": c.status,  # running / exited / paused / ...
                "image": (c.image.tags[0] if c.image.tags else c.image.short_id),
                "uptime_seconds": _uptime_seconds(started_at) if c.status == "running" else None,
            }
        )

    # Running first, then alphabetical — nicest for a dashboard.
    result.sort(key=lambda x: (x["status"] != "running", x["name"].lower()))
    return {"available": True, "count": len(result), "containers": result}
