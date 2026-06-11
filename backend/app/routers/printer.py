"""
/api/printer — live 3D-printer telemetry (Bambu P1S over LAN MQTT) + chamber cam.

Thin read layer: the persistent MQTT client (app.printer) holds the latest
snapshot; this just returns it. Like every other endpoint it degrades
gracefully — when the printer is unconfigured, unreachable, or asleep it
returns available:false with a reason, never an error.

/api/printer/camera returns the latest JPEG frame from the chamber camera
(app.camera), which only connects while frames are actually being requested.
"""

from fastapi import APIRouter, Response

from app.camera import get_camera
from app.config import settings
from app.printer import get_client

router = APIRouter()


@router.get("/printer")
def get_printer():
    client = get_client()
    snap = client.snapshot() if client else {"available": False, "reason": "not_configured"}
    # Tell the UI whether the chamber camera is wired up, so it can show the panel.
    cam = get_camera()
    snap["camera"] = bool(cam and cam.configured)
    return snap


@router.get("/printer/camera")
def get_printer_camera():
    cam = get_camera()
    if cam is None or not cam.configured:
        return Response(status_code=404)
    frame, _ = cam.get_frame()
    if frame is None:
        # Configured but no frame yet (connecting, or printer asleep).
        return Response(status_code=503)
    return Response(
        content=frame,
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store"},
    )
