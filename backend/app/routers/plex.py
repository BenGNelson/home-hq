"""
/api/plex — Plex status, library counts, and a content-backup export.

Reads PLEX_URL and PLEX_TOKEN from config (env). The token is a secret and
lives only in .env, never in code or git.

Endpoints:
  GET /plex            : reachable? + active stream count (cheap, polled)
  GET /plex/libraries  : each library with its item count (cheap, polled)
  GET /plex/export     : full per-library title manifest (heavy, on demand) —
                         a "what did I have?" backup if the library is ever lost

Each reports its state gracefully (configured / reachable / unreachable) so the
dashboard can render something sensible instead of erroring.
"""

from datetime import datetime, timezone

from fastapi import APIRouter
from plexapi.server import PlexServer

from app.config import settings

router = APIRouter()


def _connect(timeout: int) -> PlexServer:
    """Open a Plex connection. Raises if unreachable/misconfigured."""
    return PlexServer(settings.plex_url, settings.plex_token, timeout=timeout)


@router.get("/plex")
def get_plex():
    if not settings.plex_token:
        return {"configured": False, "reachable": False, "streams": None}

    try:
        # timeout keeps the dashboard snappy if Plex is down.
        server = _connect(timeout=5)
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


@router.get("/plex/libraries")
def get_plex_libraries():
    """Each library section with its top-level item count.

    For a movie library `count` is the number of movies; for a show library it
    is the number of shows, plus `episodes` (total episodes across all shows).
    """
    if not settings.plex_token:
        return {"configured": False, "reachable": False, "libraries": None}

    try:
        server = _connect(timeout=10)
        libraries = []
        for section in server.library.sections():
            entry = {
                "title": section.title,
                "type": section.type,  # movie / show / artist / photo
                "count": section.totalSize,  # fast count query, no full fetch
            }
            if section.type == "show":
                # leafCount at the section level = total episodes.
                entry["episodes"] = section.totalSize  # placeholder; refined below
                try:
                    entry["episodes"] = section.totalViewSize(libtype="episode")
                except Exception:
                    entry.pop("episodes", None)
            libraries.append(entry)
        return {"configured": True, "reachable": True, "libraries": libraries}
    except Exception as exc:
        return {
            "configured": True,
            "reachable": False,
            "libraries": None,
            "error": str(exc),
        }


@router.get("/plex/export")
def export_plex():
    """A full title manifest, per library — a backup of *what* you own.

    Intentionally titles + light metadata only (no file paths, no host detail),
    so it is safe to download and keep. Heavier than the other endpoints because
    it walks every item, so it is on-demand (triggered by a button), not polled.
    """
    if not settings.plex_token:
        return {"configured": False, "reachable": False, "libraries": None}

    try:
        server = _connect(timeout=120)
        libraries = []
        for section in server.library.sections():
            items = []
            if section.type == "movie":
                for m in section.all():
                    items.append({"title": m.title, "year": m.year})
            elif section.type == "show":
                for s in section.all():
                    items.append(
                        {"title": s.title, "year": s.year, "episodes": s.leafCount}
                    )
            else:
                for it in section.all():
                    items.append({"title": it.title})
            libraries.append(
                {
                    "title": section.title,
                    "type": section.type,
                    "count": len(items),
                    "items": items,
                }
            )
        return {
            "configured": True,
            "reachable": True,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "server_name": server.friendlyName,
            "libraries": libraries,
        }
    except Exception as exc:
        return {
            "configured": True,
            "reachable": False,
            "libraries": None,
            "error": str(exc),
        }
