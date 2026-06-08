"""
Home HQ backend — FastAPI application entry point.

This file creates the app, sets up CORS (so the frontend can call it from the
browser), and mounts each feature router under the /api prefix. As we add more
endpoints (disk, containers, plex) we just include their routers here.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db import init_db
from app.routers import containers, disk, network, plex, system

app = FastAPI(title="Home HQ API")


@app.on_event("startup")
def _startup():
    # Create the SQLite cache tables if they don't exist yet (used by the
    # Plex library browser). Idempotent.
    init_db()

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
app.include_router(plex.router, prefix="/api")
