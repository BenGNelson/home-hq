"""
/api/library — the owned-content hub (games now; comics/books/papers later).

  GET /library                      — every section + whether it's configured + count (hub landing)
  GET /library/{section}            — one section's items (the browse list)
  GET /library/file?section=&id=    — stream one item's bytes (range-capable)

Content lives on disk under RAID_MOUNT and is served via the existing read-only
RAID mount — the backend only lists + streams, never writes. All the listing /
traversal-guard logic is in app/library.py (pure, unit-tested); this router is
the thin HTTP layer. Sections degrade gracefully: an unconfigured section
reports configured=False instead of erroring, so the hub renders a hint.
"""

import hashlib
import os
import time

import requests
from fastapi import APIRouter, File, Form, Query, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from app import book_sync, bookmeta, comics, db, images, library
from app.config import settings

router = APIRouter()

# Upload caps so a buggy/abusive client can't fill the volume. Save states are
# small (GB/GBA well under 1 MB); these are generous headroom.
_MAX_STATE_BYTES = 16 * 1024 * 1024
_MAX_SHOT_BYTES = 4 * 1024 * 1024


class SectionSummaryModel(BaseModel):
    key: str
    label: str
    icon: str
    kind: str = Field(description="How items open: 'play' (emulator) or 'read' (reader)")
    configured: bool = Field(description="False when the section's content dir is unset/missing")
    count: int


class LibraryModel(BaseModel):
    sections: list[SectionSummaryModel]


class ItemModel(BaseModel):
    id: str = Field(description="Path relative to the content dir; opaque handle for /library/file")
    name: str
    label: str | None = Field(default=None, description="Sub-type (e.g. the game's system)")
    core: str | None = Field(default=None, description="EmulatorJS core, for play-kind items")
    reader: str | None = Field(default=None, description="Reader engine, for read-kind items (e.g. 'pdf')")
    size: int | None = None


class SectionModel(BaseModel):
    section: str
    label: str
    kind: str
    configured: bool
    count: int
    items: list[ItemModel]


@router.get("/library", response_model=LibraryModel)
def get_library():
    """The hub landing: each section with its configured state + item count."""
    return {"sections": library.sections_summary(settings)}


@router.api_route("/library/file", methods=["GET", "HEAD"])
def get_library_file(
    section: str = Query(description="Section key, e.g. 'games'"),
    id: str = Query(description="Item id from the section listing"),
):
    """Stream one item's bytes. GET + HEAD: EmulatorJS (and well-behaved
    downloaders) send a HEAD first to size the file / check range support, then
    GET — so HEAD must be allowed or the download stalls. FileResponse honors the
    Range header (206) and answers HEAD with headers only. The path is resolved
    through safe_path(), which blocks any id that would escape the section's
    content dir."""
    section_def = library.get_section(section)
    if not section_def:
        return Response(status_code=404)
    path = library.safe_path(section_def, settings, id)
    if not path:
        return Response(status_code=404)
    return FileResponse(path, media_type="application/octet-stream")


# Art is content-addressed (cover by sha1 of its source URL) and rarely
# changes, so let the browser/PWA hold onto it for a long time.
_ART_CACHE_HEADERS = {"Cache-Control": "public, max-age=2592000, immutable"}


@router.get("/library/games/cover")
def get_game_cover(id: str = Query(description="Game id from the section listing")):
    """Box art for a game, proxied + cached as a small WebP. Matches the ROM's
    No-Intro name to libretro-thumbnails, fetches the image once, downscales it
    to a fast-loading WebP thumbnail in the covers cache, and serves that locally
    thereafter — so browsing makes no repeat external calls and a no-match (e.g.
    a ROM hack) is remembered as a miss rather than refetched. 404 → the frontend
    shows a placeholder."""
    url = library.thumbnail_url(id)
    if not url:
        return Response(status_code=404)
    cache_dir = settings.covers_dir
    key = hashlib.sha1(url.encode()).hexdigest()
    webp = os.path.join(cache_dir, key + ".webp")
    png = os.path.join(cache_dir, key + ".png")  # legacy / manually-injected
    miss = os.path.join(cache_dir, key + ".miss")

    if os.path.isfile(webp):
        return FileResponse(webp, media_type="image/webp", headers=_ART_CACHE_HEADERS)
    # A pre-existing PNG (older cache, or a hand-injected custom cover): optimize
    # it to WebP once so it gets the speedup too, then serve the WebP.
    if os.path.isfile(png):
        try:
            with open(png, "rb") as fh:
                thumb = images.to_thumbnail(fh.read())
            if thumb:
                with open(webp, "wb") as fh:
                    fh.write(thumb)
                return FileResponse(webp, media_type="image/webp", headers=_ART_CACHE_HEADERS)
        except OSError:
            pass
        return FileResponse(png, media_type="image/png", headers=_ART_CACHE_HEADERS)
    if os.path.isfile(miss):
        return Response(status_code=404)

    try:
        resp = requests.get(url, timeout=10)
    except requests.RequestException:
        return Response(status_code=404)  # transient — don't cache as a miss
    os.makedirs(cache_dir, exist_ok=True)
    if resp.status_code == 200 and resp.content:
        thumb = images.to_thumbnail(resp.content)
        if thumb:
            with open(webp, "wb") as fh:
                fh.write(thumb)
            return FileResponse(webp, media_type="image/webp", headers=_ART_CACHE_HEADERS)
        # Not a decodable image — cache the raw bytes so we don't refetch.
        with open(png, "wb") as fh:
            fh.write(resp.content)
        return FileResponse(png, media_type="image/png", headers=_ART_CACHE_HEADERS)
    open(miss, "w").close()  # remember the no-match
    return Response(status_code=404)


class SaveStateModel(BaseModel):
    slot: str = Field(description="Slot id (also its creation time in ms)")
    created_ms: int
    has_shot: bool = Field(description="True if a screenshot was captured")


class SaveStatesModel(BaseModel):
    states: list[SaveStateModel]


@router.post("/library/games/save-states")
async def create_save_state(
    id: str = Form(description="Game id from the section listing"),
    state: UploadFile = File(description="The emulator save-state blob"),
    screenshot: UploadFile | None = File(default=None, description="Optional PNG screenshot"),
):
    """Store a new save state (server-side, so it roams across devices and rides
    the off-site backup). The slot id is a backend-assigned ms timestamp — never
    client-supplied — so it can't traverse. Capped in size."""
    saves_root = settings.games_saves_dir
    slot = str(int(time.time() * 1000))
    state_path, shot_path = library.save_state_files(saves_root, id, slot)
    if not state_path:
        return Response(status_code=400)
    data = await state.read()
    if not data or len(data) > _MAX_STATE_BYTES:
        return Response(status_code=413)
    os.makedirs(os.path.dirname(state_path), exist_ok=True)
    with open(state_path, "wb") as fh:
        fh.write(data)
    if screenshot is not None:
        shot = await screenshot.read()
        if shot and len(shot) <= _MAX_SHOT_BYTES:
            with open(shot_path, "wb") as fh:
                fh.write(shot)
    # Mark the game as recently played so it surfaces on the Jump Back In shelf
    # (records the real id + core, since the save dir name is a hash).
    games = library.get_section("games")
    core = games["formats"].get(os.path.splitext(id)[1].lower(), {}).get("core")
    db.set_game_progress(id, core)
    return {"slot": slot, "created_ms": int(slot)}


@router.get("/library/games/save-states", response_model=SaveStatesModel)
def list_save_states(id: str = Query(description="Game id from the section listing")):
    """A game's save states, newest first."""
    return {"states": library.list_save_states(settings.games_saves_dir, id)}


@router.get("/library/games/save-state")
def get_save_state(
    id: str = Query(description="Game id"),
    slot: str = Query(description="Slot id"),
):
    """Serve a save state's bytes — this is what EJS_loadStateURL points at to
    resume a game into that state."""
    state_path, _ = library.save_state_files(settings.games_saves_dir, id, slot)
    if not state_path or not os.path.isfile(state_path):
        return Response(status_code=404)
    return FileResponse(state_path, media_type="application/octet-stream")


@router.get("/library/games/save-state/screenshot")
def get_save_state_screenshot(
    id: str = Query(description="Game id"),
    slot: str = Query(description="Slot id"),
):
    """The screenshot for a save state (the detail-page thumbnail)."""
    _, shot_path = library.save_state_files(settings.games_saves_dir, id, slot)
    if not shot_path or not os.path.isfile(shot_path):
        return Response(status_code=404)
    return FileResponse(shot_path, media_type="image/png")


@router.delete("/library/games/save-states")
def delete_save_state(
    id: str = Query(description="Game id"),
    slot: str = Query(description="Slot id"),
):
    """Delete one save state (and its screenshot)."""
    state_path, shot_path = library.save_state_files(settings.games_saves_dir, id, slot)
    if not state_path:
        return Response(status_code=400)
    removed = False
    for p in (state_path, shot_path):
        if p and os.path.isfile(p):
            os.remove(p)
            removed = True
    return Response(status_code=204 if removed else 404)


# --- reading progress / Continue Reading ----------------------------------
# Where you are in a reading item, stored server-side so it roams across devices
# (the saved page IS the bookmark). Powers the Continue Reading shelf + resume.


class ReadingProgressItemModel(BaseModel):
    page: int | None = Field(default=None, description="Saved PDF page, or null if none")
    total: int | None = None
    locator: str | None = Field(default=None, description="Ebook location string (foliate CFI)")
    fraction: float | None = Field(default=None, description="Ebook read fraction (0..1)")


class ReadingProgressUpdate(BaseModel):
    section: str
    id: str
    # PDFs send page/total; ebooks send locator/fraction. One pair is required.
    page: int | None = None
    total: int | None = None
    locator: str | None = None
    fraction: float | None = None


class ContinueEntry(BaseModel):
    kind: str = Field(description="'read' (resume to a position) or 'play' (resume a save state)")
    section: str
    id: str
    name: str
    updated_ms: int
    # read-kind fields
    reader: str | None = Field(default=None, description="Reader engine ('pdf' | 'epub')")
    page: int | None = None
    total: int | None = None
    locator: str | None = None
    fraction: float | None = None
    # play-kind fields
    core: str | None = None
    slot: str | None = Field(default=None, description="Newest save-state slot to resume")


class ContinueModel(BaseModel):
    items: list[ContinueEntry]


@router.get("/library/continue", response_model=ContinueModel)
def library_continue():
    """The unified "Jump back in" shelf: in-progress reading items (resume to a
    page) AND recently-played games (resume their newest save state), merged and
    sorted newest-first. Skips entries whose underlying file is gone (a removed
    PDF, or a game whose ROM or save states are gone)."""
    entries = []
    # Reading items in progress.
    for row in db.list_reading_progress():
        section_def = library.get_section(row["section"])
        if not section_def or not library.safe_path(section_def, settings, row["item_id"]):
            continue
        name = library.display_name(section_def, row["item_id"])
        if row["section"] == "books":  # prefer the indexed title for consistency
            bm = db.get_book_meta(row["item_id"])
            if bm and bm["title"]:
                name = bm["title"]
        entries.append(
            {
                "kind": "read",
                "section": row["section"],
                "id": row["item_id"],
                "name": name,
                "reader": library.item_reader(section_def, row["item_id"]),
                "page": row["page"],
                "total": row["total"],
                "locator": row["locator"],
                "fraction": row["fraction"],
                "updated_ms": row["updated_ms"],
            }
        )
    # Recently-played games that still have a ROM + at least one save state.
    games = library.get_section("games")
    for row in db.list_game_progress():
        gid = row["game_id"]
        if not library.safe_path(games, settings, gid):
            continue  # ROM removed
        states = library.list_save_states(settings.games_saves_dir, gid)
        if not states:
            continue  # all saves deleted
        entries.append(
            {
                "kind": "play",
                "section": "games",
                "id": gid,
                "name": library.display_name(games, gid),
                "core": row["core"],
                "slot": states[0]["slot"],
                "updated_ms": states[0]["created_ms"],
            }
        )
    entries.sort(key=lambda e: e["updated_ms"], reverse=True)
    return {"items": entries[:12]}


@router.delete("/library/games/last-played")
def delete_last_played(id: str = Query(description="Game id")):
    """Drop a game from Jump Back In (keeps its save files)."""
    removed = db.delete_game_progress(id)
    return Response(status_code=204 if removed else 404)


@router.get("/library/reading-progress/item", response_model=ReadingProgressItemModel)
def reading_progress_item(
    section: str = Query(description="Section key"),
    id: str = Query(description="Item id"),
):
    """One item's saved position — the reader fetches this on open to resume
    (PDFs use page; ebooks use locator/fraction)."""
    row = db.get_reading_progress(section, id)
    if not row:
        return {"page": None}
    return {
        "page": row["page"],
        "total": row["total"],
        "locator": row["locator"],
        "fraction": row["fraction"],
    }


@router.put("/library/reading-progress")
def reading_progress_update(body: ReadingProgressUpdate):
    """Save where the reader is (upsert). Validated against a real item so a bad
    client can't pollute the shelf. A PDF sends page (>=1); an ebook sends a
    locator — one or the other is required."""
    section_def = library.get_section(body.section)
    if not section_def or not library.safe_path(section_def, settings, body.id):
        return Response(status_code=404)
    has_page = body.page is not None and body.page >= 1
    if not has_page and not body.locator:
        return Response(status_code=400)
    db.set_reading_progress(
        body.section,
        body.id,
        page=body.page,
        total=body.total,
        locator=body.locator,
        fraction=body.fraction,
    )
    return {"ok": True}


@router.delete("/library/reading-progress")
def reading_progress_delete(
    section: str = Query(description="Section key"),
    id: str = Query(description="Item id"),
):
    """Remove an item from Continue Reading (clear its bookmark)."""
    removed = db.delete_reading_progress(section, id)
    return Response(status_code=204 if removed else 404)


# --- pinned Library folders -----------------------------------------------
# Star a folder so a deep, frequently-revisited spot (e.g. a comic series a few
# levels down) is one tap away. Just (section, path); the UI deep-links to it.


class PinModel(BaseModel):
    section: str
    path: str
    created_ms: int


class PinsModel(BaseModel):
    pins: list[PinModel]


class PinCreate(BaseModel):
    section: str
    path: str = Field(description="Folder path within the section (e.g. 'Star Wars/04. Rebellion era')")


def _folder_exists(section: str, path: str) -> bool:
    """True if `path` is a real folder in the section — i.e. some item lives
    under it. Guards against pinning a stale/typo path."""
    section_def = library.get_section(section)
    if not section_def or not path:
        return False
    prefix = path + "/"
    return any(it["id"].startswith(prefix) for it in library.list_items(section_def, settings))


@router.get("/library/pins", response_model=PinsModel)
def list_pins(section: str = Query(None, description="Filter to one section (optional)")):
    """Pinned folders (newest first), optionally for one section."""
    return {"pins": db.list_pins(section)}


@router.post("/library/pins")
def add_pin(body: PinCreate):
    """Pin a folder. 404 if it isn't a real folder in the section."""
    if not _folder_exists(body.section, body.path):
        return Response(status_code=404)
    db.add_pin(body.section, body.path)
    return {"ok": True}


@router.delete("/library/pins")
def remove_pin(
    section: str = Query(description="Section key"),
    path: str = Query(description="Folder path"),
):
    """Unpin a folder."""
    removed = db.remove_pin(section, path)
    return Response(status_code=204 if removed else 404)


# --- Books search (backed by the metadata cache) --------------------------
# 11k+ books are unbrowseable as a flat list, so the Books section is search-
# first: this queries the indexed title/author cache instead of returning the
# whole library. Declared BEFORE the /library/{section} catch-all.


class BookHit(BaseModel):
    id: str = Field(description="Item id (opaque handle for /library/read and /library/file)")
    title: str
    author: str | None = None
    reader: str | None = Field(default=None, description="Reader engine ('epub' | 'pdf')")


class BookSearchModel(BaseModel):
    items: list[BookHit]
    total: int = Field(description="Total books indexed (the whole searchable set)")
    query: str


@router.get("/library/books/search", response_model=BookSearchModel)
def books_search(
    q: str = Query("", description="Title/author substring; empty = first results alphabetically"),
    limit: int = Query(100, ge=1, le=500),
):
    """Search the Books metadata cache by title or author. Returns matches with
    their reader engine so the frontend can open each in the right reader."""
    books = library.get_section("books")
    rows = db.search_books(q, limit)
    items = [
        {
            "id": r["item_id"],
            "title": r["title"],
            "author": r["author"],
            "reader": library.item_reader(books, r["item_id"]) if books else None,
        }
        for r in rows
    ]
    return {"items": items, "total": db.count_books_meta(), "query": q}


# Art extracted from a content file (book covers, comic pages) is keyed by item
# id (a path), which could in principle be replaced — so cache it for a good
# while but not `immutable` (clear the cache dir to force a re-extract). Mirrors
# the Plex art proxy's choice for the same reason.
_EXTRACTED_ART_HEADERS = {"Cache-Control": "public, max-age=2592000"}


@router.get("/library/books/cover")
def get_book_cover(id: str = Query(description="Book item id from the search/listing")):
    """A book's cover art, extracted from its embedded image once and cached as a
    small WebP (same cache-and-proxy shape as game box art / Plex posters). On
    first view we pull the cover out of the EPUB/MOBI, downscale it, and store the
    WebP keyed by a hash of the id; later views serve that local file. A book with
    no embedded cover (or a PDF) is remembered as a miss → 404, and the frontend
    shows a titled placeholder."""
    books = library.get_section("books")
    if not books:
        return Response(status_code=404)
    path = library.safe_path(books, settings, id)
    if not path:
        return Response(status_code=404)
    cache_dir = settings.book_covers_dir
    key = hashlib.sha1(id.encode()).hexdigest()
    webp = os.path.join(cache_dir, key + ".webp")
    miss = os.path.join(cache_dir, key + ".miss")

    if os.path.isfile(webp):
        return FileResponse(webp, media_type="image/webp", headers=_EXTRACTED_ART_HEADERS)
    if os.path.isfile(miss):
        return Response(status_code=404)

    raw = bookmeta.extract_cover(path, os.path.splitext(id)[1])
    thumb = images.to_thumbnail(raw) if raw else None
    os.makedirs(cache_dir, exist_ok=True)
    if thumb:
        with open(webp, "wb") as fh:
            fh.write(thumb)
        return FileResponse(webp, media_type="image/webp", headers=_EXTRACTED_ART_HEADERS)
    open(miss, "w").close()  # no cover (or unreadable) — remember it
    return Response(status_code=404)


# --- Comics (CBZ/CBR/CB7 page reader) -------------------------------------
# A comic is an archive of page images; the reader pages through them one at a
# time. The backend extracts a page from the archive on first view, downscales
# it to a WebP, and caches it — so paging is fast and only opened comics take
# cache space (same on-demand cache shape as covers). The cover is page 0 at a
# smaller width; reading pages are larger.
_COMIC_COVER_WIDTH = 400
_COMIC_PAGE_WIDTH = 1400


def _comic_cache_dir(id: str) -> str:
    """A comic's page-cache dir, keyed by a hash of its id so the raw filename
    (spaces/slashes) never becomes a path component."""
    return os.path.join(settings.comic_pages_dir, hashlib.sha1(id.encode()).hexdigest())


def _serve_comic_page(id: str, path: str, index: int, width: int, cache_name: str):
    """Extract page `index` from the comic, downscale to a cached WebP, serve it.
    Returns a FileResponse (200) or a 404 Response. The cached file name lets the
    cover (page 0, small) and the reading pages (large) coexist without clashing."""
    cache_dir = _comic_cache_dir(id)
    webp = os.path.join(cache_dir, cache_name)
    if os.path.isfile(webp):
        return FileResponse(webp, media_type="image/webp", headers=_EXTRACTED_ART_HEADERS)
    raw = comics.read_page_by_index(path, index)
    thumb = images.to_thumbnail(raw, max_width=width) if raw else None
    if not thumb:
        return Response(status_code=404)
    os.makedirs(cache_dir, exist_ok=True)
    with open(webp, "wb") as fh:
        fh.write(thumb)
    return FileResponse(webp, media_type="image/webp", headers=_EXTRACTED_ART_HEADERS)


class ComicInfoModel(BaseModel):
    pages: int = Field(description="Number of page images in the comic (0 if unreadable)")


@router.get("/library/comics/info", response_model=ComicInfoModel)
def comic_info(id: str = Query(description="Comic item id from the section listing")):
    """The comic's page count — the reader fetches this on open to size its pager."""
    section = library.get_section("comics")
    path = library.safe_path(section, settings, id) if section else None
    if not path:
        return Response(status_code=404)
    return {"pages": comics.page_count(path)}


@router.get("/library/comics/cover")
def comic_cover(id: str = Query(description="Comic item id")):
    """The comic's cover = its first page, downscaled small for the browse grid
    (cached). 404 → the frontend shows a titled placeholder."""
    section = library.get_section("comics")
    path = library.safe_path(section, settings, id) if section else None
    if not path:
        return Response(status_code=404)
    return _serve_comic_page(id, path, 0, _COMIC_COVER_WIDTH, "cover.webp")


@router.get("/library/comics/page")
def comic_page(
    id: str = Query(description="Comic item id"),
    n: int = Query(0, ge=0, description="0-based page index"),
):
    """One comic page, extracted from the archive + downscaled to a WebP for
    reading (cached). 404 when the page index is out of range / unreadable."""
    section = library.get_section("comics")
    path = library.safe_path(section, settings, id) if section else None
    if not path:
        return Response(status_code=404)
    return _serve_comic_page(id, path, n, _COMIC_PAGE_WIDTH, f"p{n}.webp")


class BookIndexStatusModel(BaseModel):
    configured: bool = Field(description="False when BOOKS_DIR is unset/missing")
    enabled: bool
    running: bool = Field(description="True while an indexing pass is in progress")
    indexed: int = Field(description="Books currently in the search cache")
    processed: int = Field(description="Files parsed so far in the current/last pass")
    total: int = Field(description="Files seen in the current/last pass")
    last_scanned: float | None = None


@router.get("/library/books/index-status", response_model=BookIndexStatusModel)
def books_index_status():
    """Indexer progress, so the UI can show 'indexing your library…' on first run."""
    books = library.get_section("books")
    configured = bool(books) and library.is_configured(books, settings)
    indexer = book_sync.get_indexer()
    base = (
        indexer.status()
        if indexer
        else {
            "enabled": False,
            "running": False,
            "indexed": db.count_books_meta(),
            "processed": 0,
            "total": 0,
            "last_scanned": None,
        }
    )
    return {"configured": configured, **base}


@router.get("/library/{section}", response_model=SectionModel)
def get_section(section: str):
    """One section's browse list (or a configured=False shell if unset)."""
    section_def = library.get_section(section)
    if not section_def:
        return Response(status_code=404)
    configured = library.is_configured(section_def, settings)
    items = library.list_items(section_def, settings) if configured else []
    return {
        "section": section_def["key"],
        "label": section_def["label"],
        "kind": section_def["kind"],
        "configured": configured,
        "count": len(items),
        "items": items,
    }
