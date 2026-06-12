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
from pydantic import BaseModel, Field

from app import db
from app.camera import BOUNDARY, get_camera
from app.config import settings
from app.printer import get_client

router = APIRouter()

# Allowlisted control actions. light_* are harmless; pause/resume/stop act on a
# live print, so the frontend guards stop behind a confirm step.
_ALLOWED_ACTIONS = {"pause", "resume", "stop", "light_on", "light_off"}


class PrinterCommand(BaseModel):
    action: str


# --- /printer (degrades to {available:false, reason}; superset + exclude_none) ---
class TempModel(BaseModel):
    current: float | None = None
    target: float | None = None


class FansModel(BaseModel):
    part: int | None = None
    aux: int | None = None
    chamber: int | None = None


class AmsTrayModel(BaseModel):
    slot: int | None = None
    type: str | None = None
    color: str | None = Field(default=None, description="RRGGBB hex (alpha dropped)")
    remain: int | None = Field(default=None, description="% filament left, -1 = unknown")
    active: bool | None = None


class AmsUnitModel(BaseModel):
    id: int | None = None
    humidity: int | None = None
    temp: float | None = None
    trays: list[AmsTrayModel] = []


class PrinterTelemetryModel(BaseModel):
    state: str | None = Field(default=None, description="IDLE/PREPARE/RUNNING/PAUSE/FINISH/FAILED")
    stage: str | None = None
    file: str | None = None
    progress: int | None = None
    layer: int | None = None
    total_layers: int | None = None
    remaining_min: int | None = None
    nozzle: TempModel | None = None
    bed: TempModel | None = None
    chamber: float | None = None
    fans: FansModel | None = None
    speed_level: int | None = None
    light: bool | None = None
    ams: list[AmsUnitModel] | None = None
    # HMS fault entries ({attr, code}); kept as dicts so nothing is filtered.
    hms: list[dict] | None = None
    finished_ago_seconds: int | None = Field(default=None, description="Set only just after a print ends")


class PrinterModel(BaseModel):
    available: bool = Field(description="False when unconfigured/no-data/offline")
    reason: str | None = Field(default=None, description="not_configured | no_data | offline")
    name: str | None = None
    connected: bool | None = None
    last_state: str | None = Field(default=None, description="Last gcode_state before going offline")
    printer: PrinterTelemetryModel | None = None
    camera: bool | None = Field(default=None, description="Whether a chamber camera is configured")


# --- /printer/history (always full → modeled WITHOUT exclude_none) ---
class PrintStatsModel(BaseModel):
    total: int | None = None
    successes: int | None = None
    failures: int | None = None
    success_rate: float | None = Field(description="None when no prints logged yet")
    total_print_seconds: int | None = None


class PrinterHistoryModel(BaseModel):
    available: bool
    stats: PrintStatsModel
    # Completed-print rows from SQLite; passed through as dicts.
    prints: list[dict]


@router.get("/printer", response_model=PrinterModel, response_model_exclude_none=True)
def get_printer():
    client = get_client()
    snap = client.snapshot() if client else {"available": False, "reason": "not_configured"}
    # Tell the UI whether the chamber camera is wired up, so it can show the panel.
    cam = get_camera()
    snap["camera"] = bool(cam and cam.configured)
    return snap


@router.get("/printer/history", response_model=PrinterHistoryModel)
def get_printer_history(limit: int = 50):
    """Completed-print history + aggregate stats. Independent of the printer being
    online — it's read from the local log, so it works even when the printer's off."""
    limit = max(1, min(limit, 200))
    return {"available": True, "stats": db.print_stats(), "prints": db.recent_prints(limit)}


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
