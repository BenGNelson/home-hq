"""
Home HQ backend — FastAPI application entry point.

This file creates the app, sets up CORS (so the frontend can call it from the
browser), and mounts each feature router under the /api prefix. As we add more
endpoints (disk, containers, plex) we just include their routers here.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.camera import init_camera
from app.config import settings
from app.db import init_db
from app.printer import init_client
from app.routers import (
    backups,
    containers,
    disk,
    network,
    plex,
    printer,
    raid,
    readme,
    smart,
    system,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create the SQLite cache tables if they don't exist yet (used by the
    # Plex library browser). Idempotent. Runs once on startup.
    init_db()
    # Start the persistent printer MQTT client (a no-op if unconfigured). It
    # connects in the background and caches telemetry for /api/printer.
    client = init_client(
        host=settings.printer_host,
        serial=settings.printer_serial,
        access_code=settings.printer_access_code,
        port=settings.printer_mqtt_port,
        name=settings.printer_name,
    )
    client.start()
    # Chamber camera reader (no-op unless PRINTER_CAMERA is enabled). Connects
    # on demand and only while frames are being requested.
    camera = init_camera(
        host=settings.printer_host,
        access_code=settings.printer_access_code,
        port=settings.printer_camera_port,
        enabled=settings.printer_camera,
        idle_timeout=settings.printer_camera_idle_timeout,
    )
    camera.start()
    try:
        yield
    finally:
        client.stop()
        camera.stop()


app = FastAPI(title="Home HQ API", lifespan=lifespan)

# Allow the browser-based frontend to call this API. In a homelab we keep it
# permissive; tighten to specific origins if this ever leaves the tailnet.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    """Liveness check — is the API process up and responding?"""
    return {"status": "ok", "server": settings.server_name}


# Mount feature routers. Each router's routes get the /api prefix here,
# so system.py's "/system" becomes "/api/system".
app.include_router(system.router, prefix="/api")
app.include_router(disk.router, prefix="/api")
app.include_router(containers.router, prefix="/api")
app.include_router(network.router, prefix="/api")
app.include_router(backups.router, prefix="/api")
app.include_router(plex.router, prefix="/api")
app.include_router(printer.router, prefix="/api")
app.include_router(raid.router, prefix="/api")
app.include_router(readme.router, prefix="/api")
app.include_router(smart.router, prefix="/api")
