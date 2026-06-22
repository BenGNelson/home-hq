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

import os
import threading
import time
from datetime import datetime, timezone

import requests
from fastapi import APIRouter, Response
from fastapi.responses import FileResponse
from plexapi.server import PlexServer
from pydantic import BaseModel, Field

from app import db, images
from app.db import _like_escape
from app.config import settings

router = APIRouter()


# Response models for the hand-built-shape endpoints. The endpoints returning
# raw dict(r) SQLite rows (library items, episodes, item detail, export) are
# deliberately left untyped: their columns are dynamic, and a response_model
# would *filter* any unlisted one and break the library browser.

# --- /plex (degrades; superset + exclude_none) ---
class PlexStatusModel(BaseModel):
    configured: bool = Field(description="True once a Plex token is set")
    reachable: bool
    streams: int | None = Field(default=None, description="Active stream count")
    server_name: str | None = None
    version: str | None = None
    transcodes: int | None = None
    bandwidth_kbps: int | None = None
    error: str | None = None


# --- /plex/now-playing (degrades) ---
class SessionModel(BaseModel):
    user: str | None = None
    title: str | None = None
    type: str | None = None
    player: str | None = None
    state: str | None = Field(default=None, description="playing / paused / buffering")
    progress_percent: float | None = None
    transcoding: bool | None = None
    resolution: str | None = None


class NowPlayingModel(BaseModel):
    configured: bool
    reachable: bool
    sessions: list[SessionModel] = []
    error: str | None = None


# --- /plex/recently-added (degrades) ---
class RecentItemModel(BaseModel):
    rating_key: str
    title: str
    subtitle: str
    type: str | None = None
    added_at: int


class RecentlyAddedModel(BaseModel):
    configured: bool
    items: list[RecentItemModel] = []
    error: str | None = None


# --- /plex/libraries (degrades) ---
class LibraryModel(BaseModel):
    key: str
    title: str
    type: str = Field(description="movie / show / artist / photo")
    count: int
    episodes: int | None = Field(default=None, description="Total episodes (show libraries only)")


class LibrariesModel(BaseModel):
    configured: bool
    reachable: bool
    libraries: list[LibraryModel] | None = None
    error: str | None = None


# --- /plex/insights (always full → NO exclude_none, keep nulls) ---
class InsightSampleModel(BaseModel):
    ts: float
    streams: int
    transcodes: int
    bandwidth_kbps: int | None


class InsightStatsModel(BaseModel):
    samples: int
    peak_streams: int
    peak_bandwidth_kbps: int | None
    active_share: float | None
    transcode_share: float | None
    stream_hours: float
    busiest_hour: int | None


class PlexInsightsModel(BaseModel):
    hours: int
    samples: list[InsightSampleModel]
    stats: InsightStatsModel


# --- /plex/watch-stats (degrades; exclude_none) ---
class WatchUserModel(BaseModel):
    user: str
    plays: int
    hours: float


class WatchTopModel(BaseModel):
    title: str
    plays: int
    type: str


class WatchPeriodModel(BaseModel):
    total_plays: int
    total_hours: float
    by_user: list[WatchUserModel] = []
    by_type: dict[str, int] = {}
    top: list[WatchTopModel] = []


class WatchPeriodsModel(BaseModel):
    week: WatchPeriodModel
    month: WatchPeriodModel
    year: WatchPeriodModel
    all: WatchPeriodModel


class WatchStatsModel(BaseModel):
    available: bool
    reason: str | None = Field(default=None, description="not_configured | unreachable")
    periods: WatchPeriodsModel | None = None


# --- /plex/sync/status (always full → NO exclude_none) ---
class SyncStatusModel(BaseModel):
    running: bool
    status: str = Field(description="never / running / ok / error")
    last_synced: int | None = None
    item_count: int
    error: str | None = None


def _connect(timeout: int) -> PlexServer:
    """Open a Plex connection. Raises if unreachable/misconfigured."""
    return PlexServer(settings.plex_url, settings.plex_token, timeout=timeout)


@router.get("/plex", response_model=PlexStatusModel, response_model_exclude_none=True)
def get_plex():
    if not settings.plex_token:
        return {"configured": False, "reachable": False, "streams": None}

    try:
        # timeout keeps the dashboard snappy if Plex is down.
        server = _connect(timeout=5)
        sessions = server.sessions()  # currently playing streams

        # Transcodes are the CPU-heavy streams; direct play is nearly free. Sum
        # the reserved stream bandwidth too. Both are derived from the sessions
        # we already fetched — no extra round-trips. Guarded since the session
        # sub-objects vary by media type / client.
        transcodes = 0
        bandwidth_kbps = 0
        for s in sessions:
            try:
                if getattr(s, "transcodeSessions", None):
                    transcodes += 1
            except Exception:
                pass
            try:
                sess = getattr(s, "session", None)
                if sess and getattr(sess, "bandwidth", None):
                    bandwidth_kbps += sess.bandwidth
            except Exception:
                pass

        return {
            "configured": True,
            "reachable": True,
            "server_name": server.friendlyName,
            "version": server.version,
            "streams": len(sessions),
            "transcodes": transcodes,
            "bandwidth_kbps": bandwidth_kbps or None,
        }
    except Exception as exc:  # plexapi raises a variety of network/auth errors
        return {
            "configured": True,
            "reachable": False,
            "streams": None,
            "error": str(exc),
        }


def _session_title(s):
    """A human label for what's playing, varying by media type."""
    kind = getattr(s, "type", None)
    if kind == "episode":
        show = getattr(s, "grandparentTitle", "") or ""
        season = getattr(s, "parentIndex", None)
        episode = getattr(s, "index", None)
        title = getattr(s, "title", "") or ""
        code = f" · S{season:02d}E{episode:02d}" if season and episode else ""
        return f"{show}{code} · {title}".strip(" ·")
    if kind == "track":
        artist = getattr(s, "grandparentTitle", "") or ""
        track = getattr(s, "title", "") or ""
        return f"{artist} · {track}".strip(" ·")
    title = getattr(s, "title", "") or "Unknown"
    year = getattr(s, "year", None)
    return f"{title} ({year})" if year else title


def _session_detail(s):
    """Pull the glanceable per-stream fields, guarded — session sub-objects
    vary a lot by client and media type."""
    user = None
    usernames = getattr(s, "usernames", None)
    if usernames:
        user = usernames[0]

    player = state = None
    players = getattr(s, "players", None)
    if players:
        p = players[0]
        player = getattr(p, "title", None) or getattr(p, "product", None)
        state = getattr(p, "state", None)  # playing / paused / buffering

    offset = getattr(s, "viewOffset", None)
    duration = getattr(s, "duration", None)
    percent = round(offset / duration * 100, 1) if offset and duration else None

    resolution = None
    media = getattr(s, "media", None)
    if media:
        resolution = getattr(media[0], "videoResolution", None)

    return {
        "user": user,
        "title": _session_title(s),
        "type": getattr(s, "type", None),
        "player": player,
        "state": state,
        "progress_percent": percent,
        "transcoding": bool(getattr(s, "transcodeSessions", None)),
        "resolution": resolution,
    }


@router.get("/plex/now-playing", response_model=NowPlayingModel, response_model_exclude_none=True)
def plex_now_playing():
    """Currently-playing streams with per-session detail (who/what/where)."""
    if not settings.plex_token:
        return {"configured": False, "reachable": False, "sessions": []}
    try:
        server = _connect(timeout=5)
        return {
            "configured": True,
            "reachable": True,
            "sessions": [_session_detail(s) for s in server.sessions()],
        }
    except Exception as exc:
        return {"configured": True, "reachable": False, "sessions": [], "error": str(exc)}


@router.get("/plex/insights", response_model=PlexInsightsModel)
def plex_insights(hours: int = 24):
    """Plex activity trends over a recent window — concurrent streams, transcodes,
    and reserved bandwidth sampled by the in-app sampler (plex_history.py), plus
    headline stats. Reads SQLite, so it works even when Plex is unreachable."""
    from app.plex_history import summarize_insights  # avoid import cycle at load

    hours = max(1, min(hours, 24 * 30))  # clamp to the retention window
    since = time.time() - hours * 3600
    samples = db.plex_samples(since_ts=since)
    return {
        "hours": hours,
        "samples": samples,
        "stats": summarize_insights(samples),
    }


# Watch-stats is computed live from Plex history (a few hundred entries, ~0.1s),
# but the dashboard may poll it, so a short TTL cache absorbs repeat hits without
# re-querying Plex each time. monotonic clock so a wall-clock change can't wedge it.
_WATCH_STATS_TTL = 300.0
_watch_stats_cache = {"ts": 0.0, "data": None}


@router.get("/plex/watch-stats", response_model=WatchStatsModel, response_model_exclude_none=True)
def plex_watch_stats():
    """Per-user + per-type Plex watch statistics over week/month/year/all-time,
    computed live from Plex's watch history. Hours are summed from each item's
    runtime (looked up once per item and cached). Degrades to available:false when
    Plex isn't configured or is unreachable."""
    from app.plex_stats import compute_watch_stats  # avoid import cycle at load

    if not settings.plex_token:
        return {"available": False, "reason": "not_configured"}

    now = time.monotonic()
    cached = _watch_stats_cache["data"]
    if cached is not None and now - _watch_stats_cache["ts"] < _WATCH_STATS_TTL:
        return cached

    try:
        server = _connect(timeout=15)
        result = compute_watch_stats(server)
    except Exception:
        result = {"available": False, "reason": "unreachable"}

    # Only cache a successful read — caching an "unreachable" would keep the page
    # broken for the full TTL after a brief Plex blip, even as the other Plex
    # endpoints recover immediately. On failure, retry on the next request.
    if result.get("available"):
        _watch_stats_cache.update(ts=time.monotonic(), data=result)
    return result


def _added_ts(it):
    """addedAt as an epoch float (0 if missing) — for sorting + display."""
    try:
        return getattr(it, "addedAt").timestamp()
    except Exception:
        return 0


def _recent_item(it):
    """A poster-strip entry. For episodes/seasons we point art at the SHOW so
    the strip is uniform portrait posters, not landscape episode stills."""
    kind = getattr(it, "type", None)
    if kind == "episode":
        season = getattr(it, "parentIndex", None)
        episode = getattr(it, "index", None)
        return {
            "rating_key": str(getattr(it, "grandparentRatingKey", "") or getattr(it, "ratingKey", "")),
            "title": getattr(it, "grandparentTitle", None) or getattr(it, "title", ""),
            "subtitle": f"S{season:02d}E{episode:02d}" if season and episode else "",
            "type": kind,
            "added_at": int(_added_ts(it)),
        }
    if kind == "season":
        return {
            "rating_key": str(getattr(it, "parentRatingKey", "") or getattr(it, "ratingKey", "")),
            "title": getattr(it, "parentTitle", None) or getattr(it, "title", ""),
            "subtitle": getattr(it, "title", ""),
            "type": kind,
            "added_at": int(_added_ts(it)),
        }
    return {
        "rating_key": str(getattr(it, "ratingKey", "")),
        "title": getattr(it, "title", ""),
        "subtitle": str(getattr(it, "year", "") or ""),
        "type": kind,
        "added_at": int(_added_ts(it)),
    }


@router.get("/plex/recently-added", response_model=RecentlyAddedModel, response_model_exclude_none=True)
def plex_recently_added(limit: int = 12):
    """Newest items across all libraries, for the dashboard poster strip."""
    if not settings.plex_token:
        return {"configured": False, "items": []}
    try:
        server = _connect(timeout=5)
        items = []
        for section in server.library.sections():
            try:
                items.extend(section.recentlyAdded(maxresults=limit))
            except Exception:
                pass  # a flaky section shouldn't drop the rest
        items = sorted(items, key=_added_ts, reverse=True)[:limit]
        return {"configured": True, "items": [_recent_item(i) for i in items]}
    except Exception as exc:
        return {"configured": True, "items": [], "error": str(exc)}


@router.get("/plex/libraries", response_model=LibrariesModel, response_model_exclude_none=True)
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
                "key": str(section.key),  # used by the library browser drill-down
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


# --- Library browser cache (SQLite) ---------------------------------------
#
# The browser reads from the local SQLite cache (db.py) instead of querying
# Plex on every search/sort — fast, and easy on Plex. A sync job walks Plex
# once and refills the cache; it runs in a background thread so the HTTP
# request returns immediately. Triggered by a UI "Refresh" button (and, later,
# a scheduled nightly job).

# Map a Plex resolution string to a numeric height so quality sorts correctly.
_RES_RANK = {"4k": 2160, "1080": 1080, "720": 720, "576": 576, "480": 480, "sd": 480}

# Sort keys exposed to the UI -> safe column expressions (whitelist; never
# interpolate user input into SQL directly).
_SORT_COLUMNS = {
    "title": "title COLLATE NOCASE",
    "year": "year",
    "duration": "duration_ms",
    "resolution": "res_height",
    "size": "file_size",
    "added": "added_at",
    "episodes": "episodes",
}

_sync_lock = threading.Lock()
_sync_running = False


def _res_height(res):
    return _RES_RANK.get(str(res).lower(), 0) if res else 0


def _media_meta(item):
    """Pull resolution / codec / file size from an item's first media part."""
    res = codec = size = None
    try:
        media = (item.media or [None])[0]
        if media:
            res = media.videoResolution
            codec = media.videoCodec
            part = (media.parts or [None])[0]
            if part:
                size = part.size
    except Exception:
        pass
    return res, codec, size


# Each row matches the media_items column order (see db.py). The last four
# fields are episode-only (season, episode_num, show_title, grandparent_key);
# movies and shows leave them NULL.
def _movie_row(section, m):
    res, codec, size = _media_meta(m)
    return (
        str(m.ratingKey), str(section.key), section.title, "movie",
        m.title, m.year, m.duration, res, _res_height(res), codec, size, None,
        int(m.addedAt.timestamp()) if m.addedAt else None,
        None, None, None, None,
    )


def _show_row(section, s):
    return (
        str(s.ratingKey), str(section.key), section.title, "show",
        s.title, s.year, None, None, 0, None, None, s.leafCount,
        int(s.addedAt.timestamp()) if s.addedAt else None,
        None, None, None, None,
    )


def _episode_row(section, e):
    res, codec, size = _media_meta(e)
    gp = getattr(e, "grandparentRatingKey", None)
    return (
        str(e.ratingKey), str(section.key), section.title, "episode",
        e.title, getattr(e, "year", None), e.duration, res, _res_height(res),
        codec, size, None,
        int(e.addedAt.timestamp()) if e.addedAt else None,
        getattr(e, "parentIndex", None), getattr(e, "index", None),
        getattr(e, "grandparentTitle", None), str(gp) if gp is not None else None,
    )


def _sync_worker():
    """Rebuild the media cache from Plex. Runs in a daemon thread."""
    global _sync_running
    try:
        db.set_meta("sync_status", "running")
        db.set_meta("sync_error", "")
        server = _connect(timeout=120)
        rows = []
        for section in server.library.sections():
            if section.type == "movie":
                rows.extend(_movie_row(section, m) for m in section.all())
            elif section.type == "show":
                rows.extend(_show_row(section, s) for s in section.all())
                # Also cache every episode so show drill-down works offline.
                try:
                    rows.extend(
                        _episode_row(section, e)
                        for e in section.search(libtype="episode")
                    )
                except Exception:
                    pass  # episodes are best-effort; shows still cache
            # music / photo libraries are skipped for now.
        with db.get_conn() as conn:
            conn.execute("DELETE FROM media_items")
            conn.executemany(
                "INSERT INTO media_items (rating_key, library_key, library, type,"
                " title, year, duration_ms, resolution, res_height, codec,"
                " file_size, episodes, added_at, season, episode_num, show_title,"
                " grandparent_key)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                rows,
            )
        db.set_meta("item_count", len(rows))
        db.set_meta("last_synced", int(time.time()))
        db.set_meta("sync_status", "idle")
    except Exception as exc:
        db.set_meta("sync_status", "error")
        db.set_meta("sync_error", str(exc))
    finally:
        with _sync_lock:
            _sync_running = False


@router.post("/plex/sync")
def trigger_sync():
    """Start a background resync of the media cache (no-op if already running)."""
    global _sync_running
    if not settings.plex_token:
        return {"started": False, "error": "not configured"}
    with _sync_lock:
        if _sync_running:
            return {"started": False, "running": True}
        _sync_running = True
    threading.Thread(target=_sync_worker, daemon=True).start()
    return {"started": True}


@router.get("/plex/sync/status", response_model=SyncStatusModel)
def sync_status():
    last = db.get_meta("last_synced")
    return {
        "running": _sync_running,
        "status": db.get_meta("sync_status", "never"),
        "last_synced": int(last) if last else None,
        "item_count": int(db.get_meta("item_count", 0) or 0),
        "error": db.get_meta("sync_error") or None,
    }


@router.get("/plex/library/{library_key}/items")
def library_items(
    library_key: str,
    search: str = "",
    sort: str = "title",
    order: str = "asc",
    limit: int = 100,
    offset: int = 0,
):
    """Paginated, sorted, filtered items for one library — served from cache."""
    sort_col = _SORT_COLUMNS.get(sort, _SORT_COLUMNS["title"])
    direction = "DESC" if order.lower() == "desc" else "ASC"
    # Libraries are at most a few hundred items, so the UI fetches a whole
    # library in one request (then searches/sorts client-side). Cap generously
    # as a safety valve; virtualize the table if we ever browse episodes (~1000s).
    limit = max(1, min(limit, 10000))
    offset = max(0, offset)

    # Episodes share their show's library_key but belong to the show drill-down,
    # not the top-level library listing — exclude them here.
    where = "library_key = ? AND type != 'episode'"
    params = [library_key]
    if search:
        where += " AND title LIKE ? ESCAPE '\\'"
        params.append(f"%{_like_escape(search)}%")

    with db.get_conn() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) AS n FROM media_items WHERE {where}", params
        ).fetchone()["n"]
        rows = conn.execute(
            f"SELECT * FROM media_items WHERE {where}"
            # NULLs always sort last, then by the chosen column/direction.
            f" ORDER BY ({sort_col} IS NULL), {sort_col} {direction}"
            f" LIMIT ? OFFSET ?",
            params + [limit, offset],
        ).fetchall()
    return {"total": total, "items": [dict(r) for r in rows]}


@router.get("/plex/show/{rating_key}/episodes")
def show_episodes(rating_key: str):
    """All cached episodes for one show, in season/episode order."""
    with db.get_conn() as conn:
        show = conn.execute(
            "SELECT title, library_key FROM media_items"
            " WHERE rating_key = ? AND type = 'show'",
            (rating_key,),
        ).fetchone()
        rows = conn.execute(
            "SELECT * FROM media_items WHERE grandparent_key = ? AND type = 'episode'"
            " ORDER BY (season IS NULL), season, (episode_num IS NULL), episode_num",
            (rating_key,),
        ).fetchall()
    return {
        "show": show["title"] if show else None,
        "library_key": show["library_key"] if show else None,
        "total": len(rows),
        "episodes": [dict(r) for r in rows],
    }


@router.get("/plex/item/{rating_key}")
def plex_item(rating_key: str):
    """Rich metadata for one item (movie/show), fetched live from Plex.

    On-demand by design: a single detail view, not searched/sorted, so it
    doesn't belong in the cache. Returns only display metadata — no file paths.
    """
    if not settings.plex_token:
        return {"found": False, "configured": False}
    try:
        server = _connect(timeout=10)
        it = server.fetchItem(int(rating_key))
        data = {
            "found": True,
            "type": it.type,
            "title": it.title,
            "year": getattr(it, "year", None),
            "summary": getattr(it, "summary", None) or None,
            "content_rating": getattr(it, "contentRating", None),
            "rating": getattr(it, "audienceRating", None) or getattr(it, "rating", None),
            "duration_ms": getattr(it, "duration", None),
            "studio": getattr(it, "studio", None),
            "added_at": int(it.addedAt.timestamp()) if getattr(it, "addedAt", None) else None,
            "genres": [g.tag for g in getattr(it, "genres", []) or []],
            "has_art": bool(getattr(it, "thumb", None)),
            "library_key": (
                str(it.librarySectionID)
                if getattr(it, "librarySectionID", None) is not None
                else None
            ),
        }
        if it.type == "show":
            data["seasons"] = getattr(it, "childCount", None)
            data["episodes"] = getattr(it, "leafCount", None)
        if it.type in ("movie", "episode"):
            res, codec, size = _media_meta(it)
            data.update({"resolution": res, "codec": codec, "file_size": size})
        if it.type == "movie":
            data["directors"] = [d.tag for d in getattr(it, "directors", []) or []][:3]
        return data
    except Exception as exc:
        return {"found": False, "error": str(exc)}


# Posters change rarely; cache the downscaled WebP keyed by rating key so repeat
# loads skip the per-image Plex round-trip (connect + fetchItem + full download).
# Not "immutable" since the poster *could* change — a week of browser caching is
# the trade. Clear /data/plex-art to force a refresh.
_PLEX_ART_CACHE_HEADERS = {"Cache-Control": "public, max-age=604800"}


@router.get("/plex/art/{rating_key}")
def plex_art(rating_key: str):
    """Proxy an item's poster from Plex (token stays server-side), downscaled to
    a small WebP and cached on disk so the poster strips load fast."""
    try:
        key = int(rating_key)  # also rejects any path-traversal in the filename
    except (TypeError, ValueError):
        return Response(status_code=404)

    cache_dir = settings.plex_art_dir
    cached = os.path.join(cache_dir, f"{key}.webp")
    if os.path.isfile(cached):
        return FileResponse(cached, media_type="image/webp", headers=_PLEX_ART_CACHE_HEADERS)

    try:
        server = _connect(timeout=10)
        it = server.fetchItem(key)
        url = it.thumbUrl  # full URL incl. token — used server-side only
        if not url:
            return Response(status_code=404)
        r = requests.get(url, timeout=10)
        if r.status_code != 200 or not r.content:
            return Response(status_code=404)
    except Exception:
        return Response(status_code=404)

    thumb = images.to_thumbnail(r.content)
    if thumb:
        try:
            os.makedirs(cache_dir, exist_ok=True)
            images.write_atomic(cached, thumb)
        except OSError:
            pass
        return Response(
            content=thumb, media_type="image/webp", headers=_PLEX_ART_CACHE_HEADERS
        )
    # Not a decodable image — pass the original through without caching.
    return Response(
        content=r.content,
        media_type=r.headers.get("Content-Type", "image/jpeg"),
        headers=_PLEX_ART_CACHE_HEADERS,
    )


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
