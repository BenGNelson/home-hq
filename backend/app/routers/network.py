"""
/api/network — host network throughput.

The backend runs in its own network namespace, so it can only see its own
interfaces by default. To report the HOST's traffic we read the host's network
counters from PID 1's view of /proc, which docker-compose mounts read-only at
/host/proc (see compose). This exposes only byte/packet counters and interface
names — no IP addresses — so it is safe for a tailnet-facing UI.

Counters are cumulative; the frontend samples this endpoint and computes rates
(and the live graph) client-side, so the backend stays stateless.
"""

import time

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter()


class InterfaceModel(BaseModel):
    name: str = Field(description="Interface name (e.g. eth0)")
    rx_bytes: int = Field(description="Cumulative bytes received")
    tx_bytes: int = Field(description="Cumulative bytes transmitted")


# Superset model; interfaces defaults to [] so it's present in both shapes.
# error/time are Optional and omitted (response_model_exclude_none) on the path
# where they don't apply, keeping the success/failure shapes byte-for-byte.
class NetworkModel(BaseModel):
    available: bool = Field(description="False when host /proc isn't mounted")
    error: str | None = None
    time: float | None = Field(default=None, description="Unix time of this sample")
    interfaces: list[InterfaceModel] = []

# PID 1 lives in the host network namespace, so its net/dev = host counters.
HOST_NET_DEV = "/host/proc/1/net/dev"

# Skip loopback and virtual/bridge/veth interfaces; keep real ones (physical
# NIC, VPN, etc.) that represent actual host traffic.
_SKIP_PREFIXES = ("lo", "veth", "br-", "docker")


def _read_net_dev(path: str) -> list[dict]:
    interfaces = []
    with open(path) as f:
        lines = f.readlines()
    # First two lines are headers.
    for line in lines[2:]:
        if ":" not in line:
            continue
        name, rest = line.split(":", 1)
        name = name.strip()
        if name.startswith(_SKIP_PREFIXES):
            continue
        fields = rest.split()
        # /proc/net/dev columns: rx_bytes is [0], tx_bytes is [8].
        interfaces.append(
            {
                "name": name,
                "rx_bytes": int(fields[0]),
                "tx_bytes": int(fields[8]),
            }
        )
    return interfaces


@router.get("/network", response_model=NetworkModel, response_model_exclude_none=True)
def get_network():
    try:
        interfaces = _read_net_dev(HOST_NET_DEV)
    except FileNotFoundError:
        return {
            "available": False,
            "error": "host /proc not mounted",
            "interfaces": [],
        }
    except Exception as exc:
        return {"available": False, "error": str(exc), "interfaces": []}

    return {"available": True, "time": time.time(), "interfaces": interfaces}
