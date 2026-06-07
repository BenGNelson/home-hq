"""
/api/plex — is the Plex server reachable, and how many streams are active?

Reads PLEX_URL and PLEX_TOKEN from config (env). The token is a secret and
lives only in .env, never in code or git.

Three possible states, each reported gracefully so the dashboard can show a
sensible widget instead of erroring:
  - not configured : no PLEX_TOKEN set yet
  - reachable      : connected; includes active stream count
  - unreachable    : token set but the server didn't answer (down / wrong url)
"""

from fastapi import APIRouter
from plexapi.server import PlexServer

from app.config import settings

router = APIRouter()


@router.get("/plex")
def get_plex():
    if not settings.plex_token:
        return {"configured": False, "reachable": False, "streams": None}

    try:
        # timeout keeps the dashboard snappy if Plex is down.
        server = PlexServer(settings.plex_url, settings.plex_token, timeout=5)
        sessions = server.sessions()  # currently playing streams
        return {
            "configured": True,
            "reachable": True,
            "server_name": server.friendlyName,
            "version": server.version,
            "streams": len(sessions),
        }
    except Exception as exc:  # plexapi raises a variety of network/auth errors
        return {
            "configured": True,
            "reachable": False,
            "streams": None,
            "error": str(exc),
        }
