"""
/api/containers — list the host's Docker containers, and per-container detail.

How it reaches Docker: the backend does NOT mount the raw socket. Compose sets
DOCKER_HOST to a read-only docker-socket-proxy that only permits GET /containers
endpoints (list, inspect, stats), so `docker.from_env()` talks to that proxy.
We therefore stick to container endpoints only — e.g. we read each container's
image NAME from the container data we already have (attrs["Image"] /
Config.Image) rather than calling the (forbidden) image-inspect endpoint.

SECURITY: the detail endpoint deliberately exposes only operational facts
(state, health, ports, resource usage). It NEVER returns environment variables,
bind-mount host paths, or command args — those routinely contain secrets
(tokens, passwords, VPN creds) and host paths.

Container LOGS are served by a separate endpoint (/containers/{name}/logs).
Logs capture an app's raw stdout/stderr, so they CAN contain whatever it prints
(an accidentally-logged secret, or other sensitive activity). This is an
informed reversal of the original "never expose logs" stance, sound only because
the whole UI is reachable only over the LAN/tailnet (UFW drops public traffic;
no Tailscale funnel) and the tailnet is single-user. As a guard, CONTAINER_LOGS_
EXCLUDE lists containers whose logs are withheld (e.g. a VPN gateway or a
download client — the most sensitive, and the ones you'd debug over SSH instead).

This router only READS, and the proxy enforces that at the API level.
"""

import re
import time
from datetime import datetime, timezone

import docker
from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.config import settings

router = APIRouter()


# All three endpoints degrade to a smaller dict ({available:false} / {found:false}),
# so each uses a superset model + response_model_exclude_none: the Optionals are
# dropped where they don't apply, leaving every shape exactly as before.
class ContainerSummaryModel(BaseModel):
    name: str
    status: str = Field(description="running / exited / paused / ...")
    image: str
    uptime_seconds: int | None = None


class ContainersModel(BaseModel):
    available: bool = Field(description="False when Docker can't be reached")
    error: str | None = None
    count: int | None = None
    containers: list[ContainerSummaryModel] = []


class ContainerDetailModel(BaseModel):
    found: bool | None = None
    available: bool | None = None
    error: str | None = None
    time: float | None = None
    name: str | None = None
    image: str | None = None
    status: str | None = None
    state: str | None = None
    health: str | None = None
    started_at: str | None = None
    uptime_seconds: int | None = None
    restart_count: int | None = None
    restart_policy: str | None = None
    ports: list[str] | None = None
    networks: list[str] | None = None
    cpu_percent: float | None = None
    mem_used_bytes: int | None = None
    mem_limit_bytes: int | None = None
    mem_percent: float | None = None
    net_rx_bytes: int | None = None
    net_tx_bytes: int | None = None


class ContainerLogsModel(BaseModel):
    available: bool | None = None
    found: bool | None = None
    excluded: bool | None = None
    name: str | None = None
    reason: str | None = None
    error: str | None = None
    tail: int | None = None
    lines: list[str] | None = None


# Bounds for the logs endpoint's tail length.
_LOGS_TAIL_DEFAULT = 200
_LOGS_TAIL_MAX = 2000

# Many apps colorize their logs with ANSI escapes; a browser <pre> can't render
# them, so they'd show as literal "[31m" noise. Strip them server-side.
_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")


def _excluded_log_names() -> set[str]:
    """Container names (lowercased) whose logs are withheld, from config."""
    return {n.strip().lower() for n in (settings.container_logs_exclude or "").split(",") if n.strip()}


def _clamp_tail(tail) -> int:
    """Coerce a requested tail length into [1, _LOGS_TAIL_MAX], default on junk."""
    try:
        n = int(tail)
    except (TypeError, ValueError):
        return _LOGS_TAIL_DEFAULT
    return max(1, min(n, _LOGS_TAIL_MAX))


def _decode_log_lines(raw) -> list[str]:
    """Bytes from the Docker logs API -> a list of text lines, with ANSI color
    escapes stripped (a browser <pre> can't render them)."""
    text = raw.decode("utf-8", "replace") if isinstance(raw, (bytes, bytearray)) else str(raw)
    return _ANSI_RE.sub("", text).splitlines()


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


def _cpu_percent(stats: dict) -> float | None:
    """Compute CPU% from a Docker stats snapshot, the way `docker stats` does."""
    try:
        cpu = stats["cpu_stats"]
        pre = stats["precpu_stats"]
        cpu_delta = cpu["cpu_usage"]["total_usage"] - pre["cpu_usage"]["total_usage"]
        sys_delta = cpu.get("system_cpu_usage", 0) - pre.get("system_cpu_usage", 0)
        online = cpu.get("online_cpus") or len(
            cpu["cpu_usage"].get("percpu_usage") or [1]
        )
        if cpu_delta > 0 and sys_delta > 0:
            return round((cpu_delta / sys_delta) * online * 100, 1)
        return 0.0
    except (KeyError, TypeError, ZeroDivisionError):
        return None


def _mem_usage(stats: dict) -> tuple[int | None, int | None, float | None]:
    """Return (used_bytes, limit_bytes, percent), matching `docker stats`."""
    try:
        mem = stats["memory_stats"]
        usage = mem.get("usage")
        limit = mem.get("limit")
        # Subtract page cache so it reflects real working set (cgroup v2).
        inactive = mem.get("stats", {}).get("inactive_file", 0)
        if usage is not None:
            used = max(usage - inactive, 0)
            percent = round(used / limit * 100, 1) if limit else None
            return used, limit, percent
    except (KeyError, TypeError):
        pass
    return None, None, None


def _ports(attrs: dict) -> list[str]:
    """Published ports as 'containerport/proto -> hostport' (no host IPs)."""
    out = []
    ports = (attrs.get("NetworkSettings", {}) or {}).get("Ports", {}) or {}
    for container_port, bindings in sorted(ports.items()):
        if bindings:
            host_ports = sorted({b.get("HostPort") for b in bindings if b.get("HostPort")})
            for hp in host_ports:
                out.append(f"{container_port} -> {hp}")
        else:
            out.append(f"{container_port} (exposed)")
    return out


@router.get("/containers", response_model=ContainersModel, response_model_exclude_none=True)
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
                # Image name straight from /containers/json — no image-inspect call.
                "image": c.attrs.get("Image") or "unknown",
                "uptime_seconds": _uptime_seconds(started_at) if c.status == "running" else None,
            }
        )

    # Running first, then alphabetical — nicest for a dashboard.
    result.sort(key=lambda x: (x["status"] != "running", x["name"].lower()))
    return {"available": True, "count": len(result), "containers": result}


@router.get("/containers/{name}", response_model=ContainerDetailModel,
            response_model_exclude_none=True)
def get_container_detail(name: str):
    """Operational detail for one container. Secret-free by design (see module
    docstring): no env vars, no mount paths, no command, no logs."""
    try:
        client = docker.from_env()
        c = client.containers.get(name)
    except docker.errors.NotFound:
        return {"found": False}
    except docker.errors.DockerException as exc:
        return {"available": False, "error": str(exc)}

    attrs = c.attrs
    state = attrs.get("State", {}) or {}
    host_config = attrs.get("HostConfig", {}) or {}
    networks = list((attrs.get("NetworkSettings", {}) or {}).get("Networks", {}).keys())

    # One-shot live stats. May briefly read 0% CPU on a cold first sample.
    cpu_percent = mem_used = mem_limit = mem_percent = None
    net_rx = net_tx = None
    try:
        stats = c.stats(stream=False)
        cpu_percent = _cpu_percent(stats)
        mem_used, mem_limit, mem_percent = _mem_usage(stats)
        # Sum rx/tx across the container's interfaces (cumulative byte counts;
        # the frontend turns successive samples into a live rate + graph).
        nets = stats.get("networks") or {}
        if nets:
            net_rx = sum(v.get("rx_bytes", 0) for v in nets.values())
            net_tx = sum(v.get("tx_bytes", 0) for v in nets.values())
    except docker.errors.DockerException:
        pass

    return {
        "found": True,
        "time": time.time(),
        "name": c.name,
        # Image name from the inspect data we already have (Config.Image),
        # avoiding the image-inspect endpoint the proxy doesn't permit.
        "image": (attrs.get("Config", {}) or {}).get("Image") or "unknown",
        "status": c.status,
        "state": state.get("Status"),
        "health": (state.get("Health", {}) or {}).get("Status"),
        "started_at": state.get("StartedAt"),
        "uptime_seconds": _uptime_seconds(state.get("StartedAt")) if c.status == "running" else None,
        "restart_count": attrs.get("RestartCount"),
        "restart_policy": (host_config.get("RestartPolicy", {}) or {}).get("Name"),
        "ports": _ports(attrs),
        "networks": networks,
        "cpu_percent": cpu_percent,
        "mem_used_bytes": mem_used,
        "mem_limit_bytes": mem_limit,
        "mem_percent": mem_percent,
        "net_rx_bytes": net_rx,
        "net_tx_bytes": net_tx,
    }


@router.get("/containers/{name}/logs", response_model=ContainerLogsModel,
            response_model_exclude_none=True)
def get_container_logs(name: str, tail: int = _LOGS_TAIL_DEFAULT):
    """Recent stdout/stderr for one container (last `tail` lines, timestamped).

    Read-only and tail-limited. Containers named in CONTAINER_LOGS_EXCLUDE are
    withheld (see the module docstring) — sensitive ones like a VPN gateway or
    download client. Reachable only over the LAN/tailnet, never the public internet.
    """
    tail = _clamp_tail(tail)

    if name.lower() in _excluded_log_names():
        return {
            "available": False,
            "excluded": True,
            "name": name,
            "reason": "Logs are disabled for this container.",
        }

    try:
        client = docker.from_env()
        c = client.containers.get(name)
        # timestamps=True prefixes each line with an RFC3339 time; tail caps it so
        # we never stream a whole history. stream=False returns the bytes at once.
        raw = c.logs(tail=tail, timestamps=True, stdout=True, stderr=True, stream=False)
    except docker.errors.NotFound:
        return {"found": False}
    except docker.errors.DockerException as exc:
        return {"available": False, "error": str(exc)}

    return {
        "available": True,
        "found": True,
        "name": c.name,
        "tail": tail,
        "lines": _decode_log_lines(raw),
    }
