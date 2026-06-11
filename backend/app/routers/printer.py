"""
/api/printer — live 3D-printer telemetry (Bambu P1S over LAN MQTT).

Thin read layer: the persistent MQTT client (app.printer) holds the latest
snapshot; this just returns it. Like every other endpoint it degrades
gracefully — when the printer is unconfigured, unreachable, or asleep it
returns available:false with a reason, never an error.
"""

from fastapi import APIRouter

from app.printer import get_client

router = APIRouter()


@router.get("/printer")
def get_printer():
    client = get_client()
    if client is None:
        return {"available": False, "reason": "not_configured"}
    return client.snapshot()
