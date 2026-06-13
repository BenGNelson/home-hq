"""
/api/ha — read-only Home Assistant bridge (cameras first).

  GET /ha/cameras                     list of camera entities for the wall
  GET /ha/camera/{entity_id}/stream   relay HA's live MJPEG for one camera
  GET /ha/camera/{entity_id}/snapshot relay a single still (poster/fallback)

The stream relay opens an upstream connection to HA only while a client is
reading, and closes it when the client disconnects — so a battery camera goes
back to sleep once nobody is watching, the same on-demand behaviour as the
3D-printer chamber camera. Read-only: no control is ever proxied to HA.
"""

from fastapi import APIRouter, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app import ha

router = APIRouter()


class CameraModel(BaseModel):
    entity_id: str
    name: str
    state: str | None = None


class CamerasModel(BaseModel):
    available: bool = Field(description="False when HA is unconfigured or unreachable")
    reason: str | None = Field(default=None, description="not_configured | unreachable")
    cameras: list[CameraModel] = []


@router.get("/ha/cameras", response_model=CamerasModel, response_model_exclude_none=True)
def get_cameras():
    return ha.list_cameras()


@router.get("/ha/camera/{entity_id}/stream")
def stream_camera(entity_id: str):
    if not ha.configured():
        return Response(status_code=503)
    if not ha.is_allowed_camera(entity_id):
        return Response(status_code=404)
    try:
        upstream, content_type = ha.open_stream(entity_id)
    except Exception:
        return Response(status_code=502)

    def relay():
        try:
            while True:
                chunk = upstream.read(8192)
                if not chunk:
                    break
                yield chunk
        finally:
            upstream.close()

    return StreamingResponse(
        relay(),
        media_type=content_type,
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@router.get("/ha/camera/{entity_id}/snapshot")
def snapshot_camera(entity_id: str):
    if not ha.configured():
        return Response(status_code=503)
    if not ha.is_allowed_camera(entity_id):
        return Response(status_code=404)
    try:
        data, content_type = ha.open_snapshot(entity_id)
    except Exception:
        return Response(status_code=502)
    return Response(content=data, media_type=content_type, headers={"Cache-Control": "no-store"})
