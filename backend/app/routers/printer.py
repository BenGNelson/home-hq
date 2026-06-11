"""
/api/printer — live 3D-printer telemetry (Bambu P1S over LAN MQTT) + chamber cam.

Thin read layer: the persistent MQTT client (app.printer) holds the latest
snapshot; this just returns it. Like every other endpoint it degrades
gracefully — when the printer is unconfigured, unreachable, or asleep it
returns available:false with a reason, never an error.

The chamber camera (app.camera) connects only while frames are being requested.
Two endpoints consume it: /api/printer/camera/stream is the live MJPEG feed
(one connection, frames pushed as they arrive — what the UI uses); the older
/api/printer/camera returns a single latest JPEG, handy as a fallback/snapshot.
"""

from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.camera import BOUNDARY, get_camera
from app.config import settings
from app.printer import get_client

router = APIRouter()

# Allowlisted control actions. light_* are harmless; pause/resume/stop act on a
# live print, so the frontend guards stop behind a confirm step.
_ALLOWED_ACTIONS = {"pause", "resume", "stop", "light_on", "light_off"}


class PrinterCommand(BaseModel):
    action: str


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


@router.get("/printer/camera/stream")
def stream_printer_camera():
    cam = get_camera()
    if cam is None or not cam.configured:
        return Response(status_code=404)
    return StreamingResponse(
        cam.mjpeg_frames(),
        media_type=f"multipart/x-mixed-replace; boundary={BOUNDARY}",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@router.post("/printer/command")
def post_printer_command(cmd: PrinterCommand):
    if cmd.action not in _ALLOWED_ACTIONS:
        raise HTTPException(status_code=400, detail="unknown action")
    client = get_client()
    if client is None:
        raise HTTPException(status_code=503, detail="printer not configured")
    if not client.send_command(cmd.action):
        raise HTTPException(status_code=503, detail="printer not connected")
    return {"ok": True}
