"""
Home HQ backend — FastAPI application entry point.

This file creates the app, sets up CORS (so the frontend can call it from the
browser), and mounts each feature router under the /api prefix. As we add more
endpoints (disk, containers, plex) we just include their routers here.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.alerting import init_manager
from app.camera import init_camera
from app.config import settings
from app.db import init_db
from app.printer import init_client
from app.plex_history import init_sampler as init_plex_sampler
from app.speedtest import init_sampler as init_speedtest_sampler
from app.storage_history import init_sampler
from app.space_usage import init_scanner
from app.book_sync import init_indexer
from app.routers import (
    alerts,
    backups,
    containers,
    disk,
    diskio,
    gpu,
    ha,
    library,
    network,
    plex,
    printer,
    raid,
    readme,
    smart,
    solar,
    speedtest,
    storage,
    system,
    tailscale,
    uptime,
    vpn,
    watchdog,
    weather,
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
    # Alerting engine: evaluates rules in the background and pushes notifications
    # on state changes (no-op unless ALERTS_ENABLED). Started last so its first
    # pass sees the other subsystems already up.
    alerter = init_manager(settings.alert_interval)
    alerter.start()
    # Storage trend sampler: records a daily SMART + capacity snapshot to SQLite
    # so the Storage page can chart trends and project when the array fills up.
    sampler = init_sampler(settings.storage_history_interval, settings.storage_history_days)
    sampler.start()
    # Plex activity sampler: records concurrent streams / transcodes / bandwidth
    # while Plex is reachable, powering the Plex insights page's trend charts.
    plex_sampler = init_plex_sampler(settings.plex_history_interval, settings.plex_history_days)
    plex_sampler.start()
    # Speedtest / ISP monitor: runs the Ookla CLI on a schedule (no-op when
    # SPEEDTEST_INTERVAL=0 = manual-only) and stores each result for the trend.
    speedtest_sampler = init_speedtest_sampler(
        settings.speedtest_interval if settings.speedtest_enabled else 0,
        settings.speedtest_retention_days,
    )
    speedtest_sampler.start()
    # What's-eating-space: a background thread runs a niced daily `du` of the
    # storage mount (cached in SQLite); /api/storage/space reads the cache.
    scanner = init_scanner(
        settings.raid_mount,
        settings.space_scan_enabled,
        settings.space_scan_interval,
        settings.space_scan_timeout,
    )
    scanner.start()
    # Book indexer: parses each ebook's embedded title/author into the search
    # cache so the Books section is searchable (no-op unless Books is configured).
    book_indexer = init_indexer(settings.books_index_enabled, settings.books_index_interval)
    book_indexer.start()
    try:
        yield
    finally:
        client.stop()
        camera.stop()
        alerter.stop()
        sampler.stop()
        plex_sampler.stop()
        speedtest_sampler.stop()
        scanner.stop()
        book_indexer.stop()


# Tag metadata groups the auto-generated API docs (/api/docs, /api/redoc) by
# domain instead of one flat list. The order here is the order sections appear
# in Swagger UI; each router is tagged at include_router() below.
tags_metadata = [
    {"name": "System", "description": "Host vitals — CPU/memory/uptime, Docker containers, and config backups."},
    {"name": "Storage", "description": "Disks, capacity, RAID health, SMART data + trends, disk I/O, and the external-drive watchdog."},
    {"name": "Network", "description": "Per-interface throughput read from the host network counters."},
    {"name": "Plex", "description": "Plex server status, now-playing sessions, and the cached library browser."},
    {"name": "Library", "description": "Owned-content hub — games (and later comics/books/papers) listed + streamed from disk."},
    {"name": "Printer", "description": "3D-printer telemetry, controls, chamber camera, and print history."},
    {"name": "Alerts", "description": "Push-notification engine — rule status, history, and a test trigger."},
    {"name": "Monitoring", "description": "Service-availability probing — per-target uptime % and latency."},
    {"name": "Devices", "description": "Home Assistant bridge — a curated, read-only glance at home devices."},
    {"name": "Solar", "description": "Solar / energy production read from the Enphase Envoy gateway."},
    {"name": "Weather", "description": "Current conditions and a multi-day forecast for the configured location."},
    {"name": "Docs", "description": "In-app document sources (project README) served as markdown."},
]

app = FastAPI(
    title="Home HQ API",
    description=(
        "Backend for **Home HQ**, a self-hosted home-server dashboard. Almost "
        "every endpoint is read-only telemetry — the exceptions are the "
        "explicitly-marked printer controls and the alert test trigger. All "
        "routes are mounted under `/api`; these interactive docs and the raw "
        "schema live alongside them at `/api/docs`, `/api/redoc`, and "
        "`/api/openapi.json`."
    ),
    version="1.0.0",
    openapi_tags=tags_metadata,
    # Serve the docs under /api so they ride the same nginx reverse-proxy as the
    # API itself (the frontend only proxies /api) — reachable over the tailnet
    # with no extra proxy rules.
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

# Allow the browser-based frontend to call this API. In a homelab we keep it
# permissive; tighten to specific origins if this ever leaves the tailnet.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class HealthModel(BaseModel):
    status: str = Field(description="'ok' when the API process is responding")
    server: str = Field(description="Configured display name for the host")


@app.get("/api/health", tags=["System"], response_model=HealthModel)
def health():
    """Liveness check — is the API process up and responding?"""
    return {"status": "ok", "server": settings.server_name}


# Mount feature routers. Each router's routes get the /api prefix here,
# so system.py's "/system" becomes "/api/system".
app.include_router(system.router, prefix="/api", tags=["System"])
app.include_router(gpu.router, prefix="/api", tags=["System"])
app.include_router(disk.router, prefix="/api", tags=["Storage"])
app.include_router(diskio.router, prefix="/api", tags=["Storage"])
app.include_router(containers.router, prefix="/api", tags=["System"])
app.include_router(network.router, prefix="/api", tags=["Network"])
app.include_router(vpn.router, prefix="/api", tags=["Network"])
app.include_router(tailscale.router, prefix="/api", tags=["Network"])
app.include_router(speedtest.router, prefix="/api", tags=["Network"])
app.include_router(backups.router, prefix="/api", tags=["System"])
app.include_router(plex.router, prefix="/api", tags=["Plex"])
app.include_router(library.router, prefix="/api", tags=["Library"])
app.include_router(printer.router, prefix="/api", tags=["Printer"])
app.include_router(raid.router, prefix="/api", tags=["Storage"])
app.include_router(readme.router, prefix="/api", tags=["Docs"])
app.include_router(smart.router, prefix="/api", tags=["Storage"])
app.include_router(storage.router, prefix="/api", tags=["Storage"])
app.include_router(watchdog.router, prefix="/api", tags=["Storage"])
app.include_router(alerts.router, prefix="/api", tags=["Alerts"])
app.include_router(uptime.router, prefix="/api", tags=["Monitoring"])
app.include_router(ha.router, prefix="/api", tags=["Devices"])
app.include_router(solar.router, prefix="/api", tags=["Solar"])
app.include_router(weather.router, prefix="/api", tags=["Weather"])
