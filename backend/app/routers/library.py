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
import json
import os
import time
import urllib.parse

import requests
from fastapi import APIRouter, File, Form, Query, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from app import audiobooks, book_sync, bookmeta, comics, db, images, library, pdfcover
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
    preview: list[str] = Field(
        default_factory=list,
        description="A few cover refs (item ids; audiobooks=folder paths) for the hub peek tile",
    )


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
    return FileResponse(path, media_type=_media_type(id))


# Audio needs a correct MIME type to play in an <audio> element (iOS Safari is
# strict). ROMs/PDFs/EPUBs are read as bytes by their engines, so octet-stream is
# fine for them; only audio must be labelled precisely.
_AUDIO_TYPES = {
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".m4b": "audio/mp4",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
    ".flac": "audio/flac",
    ".wav": "audio/wav",
}


def _media_type(item_id: str) -> str:
    return _AUDIO_TYPES.get(os.path.splitext(item_id)[1].lower(), "application/octet-stream")


# Art is content-addressed (cover by sha1 of its source URL) and rarely
# changes, so let the browser/PWA hold onto it for a long time.
_ART_CACHE_HEADERS = {"Cache-Control": "public, max-age=2592000, immutable"}


_SIDECAR_EXTS = (".png", ".jpg", ".jpeg", ".webp")


def _sidecar_cover(rom_path):
    """A custom cover image dropped beside the ROM (same basename), or None — the
    manual override for ROM hacks / libretro misses."""
    stem = os.path.splitext(rom_path)[0]
    for ext in _SIDECAR_EXTS:
        if os.path.isfile(stem + ext):
            return stem + ext
    return None


def _follow_libretro_pointer(resp, url):
    """libretro-thumbnails stores some boxarts as a tiny TEXT file naming the
    canonical .png (a pseudo-symlink for alternate ROM names). If `resp` is one of
    those, fetch the file it points to (same dir) and return that response."""
    if len(resp.content) >= 256:
        return resp
    try:
        target = resp.content.decode("utf-8").strip()
    except UnicodeDecodeError:
        return resp
    if "/" in target or "\n" in target or not target.lower().endswith((".png", ".jpg", ".jpeg")):
        return resp
    base = url.rsplit("/", 1)[0]
    try:
        follow = requests.get(f"{base}/{urllib.parse.quote(target)}", timeout=10)
    except requests.RequestException:
        return resp
    return follow if follow.status_code == 200 and follow.content else resp


# The system's full boxart listing, fetched once from the GitHub API and cached
# on disk (it changes rarely), so the base-title fallback can match a ROM whose
# exact No-Intro name isn't filed under that name in libretro-thumbnails. Lazily
# fetched only when an exact match misses for that system.
_BOXIDX_TTL = 30 * 86400  # refresh the listing monthly


def _boxart_names(repo):
    """The list of Named_Boxarts names (no extension) for a libretro system repo,
    cached on disk. Returns None on any fetch/parse failure (so the caller just
    degrades to a placeholder, like the rest of the cover path)."""
    cache_dir = settings.covers_dir
    idx = os.path.join(cache_dir, f"boxidx_{repo}.json")
    try:
        if os.path.isfile(idx) and (time.time() - os.path.getmtime(idx)) < _BOXIDX_TTL:
            with open(idx) as fh:
                return json.load(fh)
    except (OSError, ValueError):
        pass  # unreadable/corrupt cache → refetch
    try:
        resp = requests.get(
            library.boxart_tree_url(repo), timeout=15, headers={"User-Agent": "home-hq"}
        )
        tree = resp.json().get("tree", []) if resp.status_code == 200 else []
    except (requests.RequestException, ValueError):
        return None
    prefix, suffix = "Named_Boxarts/", ".png"
    names = [
        e["path"][len(prefix):-len(suffix)]
        for e in tree
        if isinstance(e, dict)
        and e.get("path", "").startswith(prefix)
        and e["path"].endswith(suffix)
    ]
    if not names:
        return None
    try:
        os.makedirs(cache_dir, exist_ok=True)
        images.write_atomic(idx, json.dumps(names).encode())
    except OSError:
        pass  # cache write is best-effort
    return names


def _fuzzy_cover_bytes(item_id):
    """Resolve box art for a ROM whose exact name missed, via base-title matching.
    Returns (art_bytes, definitive):
      - art_bytes: the matched variant's bytes, or None if none were obtained.
      - definitive: True when we actually consulted the system's listing, so a
        None result is a genuine no-match the caller may cache as a miss; False on
        a TRANSIENT failure (couldn't fetch the listing, or the matched art's
        request errored) — the caller must NOT cache a permanent miss then, mirror-
        ing the exact-fetch path's 'transient → don't cache as a miss' guard."""
    repo = library.thumbnail_repo(item_id)
    if not repo:
        return None, True  # unreachable in practice (exact path needs a repo too)
    names = _boxart_names(repo)
    if not names:
        return None, False  # no usable listing (network/rate-limit/empty) → transient
    chosen = library.pick_boxart(os.path.basename(item_id), names)
    if not chosen:
        return None, True  # consulted a real listing, no base-title match → cacheable
    url = library.boxart_url(repo, chosen)
    try:
        resp = requests.get(url, timeout=10)
    except requests.RequestException:
        return None, False  # transient art-fetch failure
    if resp.status_code == 200:
        resp = _follow_libretro_pointer(resp, url)
    if resp.status_code == 200 and resp.content:
        return resp.content, True
    return None, False  # listing named it but the art GET failed → transient


@router.get("/library/games/cover")
def get_game_cover(id: str = Query(description="Game id from the section listing")):
    """Box art for a game, proxied + cached as a small WebP. Precedence: a custom
    cover dropped beside the ROM (override) → libretro-thumbnails matched by the
    ROM's No-Intro name (following libretro's text-pointer pseudo-symlinks) →
    placeholder. Fetched once and downscaled to a cached WebP, so browsing makes
    no repeat external calls and a no-match is remembered as a miss. 404 → the
    frontend shows a placeholder."""
    cache_dir = settings.covers_dir
    # 1. Manual override — an image beside the ROM wins over libretro (this is how
    #    a ROM hack or a name-mismatch gets a cover). Cached, keyed by file mtime
    #    so replacing the image refreshes it.
    games = library.get_section("games")
    rom_path = library.safe_path(games, settings, id) if games else None
    side = _sidecar_cover(rom_path) if rom_path else None
    if side:
        try:
            okey = hashlib.sha1(f"o:{id}:{int(os.path.getmtime(side))}".encode()).hexdigest()
        except OSError:
            okey = None
        owebp = os.path.join(cache_dir, okey + ".webp") if okey else None
        if owebp and os.path.isfile(owebp):
            return FileResponse(owebp, media_type="image/webp", headers=_ART_CACHE_HEADERS)
        try:
            with open(side, "rb") as fh:
                thumb = images.to_thumbnail(fh.read())
        except OSError:
            thumb = None
        if thumb and owebp:
            os.makedirs(cache_dir, exist_ok=True)
            images.write_atomic(owebp, thumb)
            return FileResponse(owebp, media_type="image/webp", headers=_ART_CACHE_HEADERS)

    url = library.thumbnail_url(id)
    if not url:
        return Response(status_code=404)
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
                images.write_atomic(webp, thumb)
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
    if resp.status_code == 200:
        resp = _follow_libretro_pointer(resp, url)  # text pointer → the real art
    os.makedirs(cache_dir, exist_ok=True)
    if resp.status_code == 200 and resp.content:
        thumb = images.to_thumbnail(resp.content)
        if thumb:
            images.write_atomic(webp, thumb)
            return FileResponse(webp, media_type="image/webp", headers=_ART_CACHE_HEADERS)
        # Not a decodable image — cache the raw bytes so we don't refetch.
        images.write_atomic(png, resp.content)
        return FileResponse(png, media_type="image/png", headers=_ART_CACHE_HEADERS)

    # Exact No-Intro name missed — fall back to base-title matching against the
    # system's libretro listing (handles region/version-tag mismatches like our
    # "Golden Axe (USA, Europe, Brazil)" vs libretro's "... (En)" variant). Cache
    # the result under the exact-name key so future loads skip the fallback.
    fuzzy, definitive = _fuzzy_cover_bytes(id)
    if fuzzy:
        thumb = images.to_thumbnail(fuzzy)
        if thumb:
            images.write_atomic(webp, thumb)
            return FileResponse(webp, media_type="image/webp", headers=_ART_CACHE_HEADERS)
        images.write_atomic(png, fuzzy)  # not decodable — cache raw, like the exact path
        return FileResponse(png, media_type="image/png", headers=_ART_CACHE_HEADERS)

    if definitive:
        open(miss, "w").close()  # genuinely no art for this game — remember it
    return Response(status_code=404)  # transient failure → no miss cached, retry later


class SaveStateModel(BaseModel):
    slot: str = Field(description="Slot id (also its creation time in ms)")
    created_ms: int
    has_shot: bool = Field(description="True if a screenshot was captured")


class SaveStatesModel(BaseModel):
    states: list[SaveStateModel]


@router.post("/library/games/save-states")
def create_save_state(
    id: str = Form(description="Game id from the section listing"),
    state: UploadFile = File(description="The emulator save-state blob"),
    screenshot: UploadFile | None = File(default=None, description="Optional PNG screenshot"),
):
    """Store a new save state (server-side, so it roams across devices and rides
    the off-site backup). The slot id is a backend-assigned ms timestamp — never
    client-supplied — so it can't traverse. Capped in size. A plain (sync) handler
    so Starlette runs it in a threadpool — the disk write to the RAID mount stays
    off the event loop."""
    saves_root = settings.games_saves_dir
    slot = str(int(time.time() * 1000))
    state_path, shot_path = library.save_state_files(saves_root, id, slot)
    if not state_path:
        return Response(status_code=400)
    # Read at most cap+1 bytes so an oversized upload is rejected without ever
    # buffering the whole (possibly multi-GB) body.
    data = state.file.read(_MAX_STATE_BYTES + 1)
    if not data or len(data) > _MAX_STATE_BYTES:
        return Response(status_code=413)
    os.makedirs(os.path.dirname(state_path), exist_ok=True)
    with open(state_path, "wb") as fh:
        fh.write(data)
    if screenshot is not None:
        shot = screenshot.file.read(_MAX_SHOT_BYTES + 1)
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


# --- in-game battery save (SRAM) -------------------------------------------
# The game's OWN save (e.g. Pokemon's in-game "Save"), distinct from snapshot
# save states. One per game, overwritten on each save, stored server-side so it
# roams across devices + rides the backup. EmulatorJS doesn't persist SRAM
# itself, so the player captures the .sav and POSTs it here.


@router.post("/library/games/sram")
def put_sram(
    id: str = Form(description="Game id from the section listing"),
    sram: UploadFile = File(description="The game's .sav battery save"),
):
    """Store/overwrite a game's in-game battery save (SRAM). Sync handler →
    threadpool, so the write stays off the event loop."""
    path = library.sram_file(settings.games_saves_dir, id)
    if not path:
        return Response(status_code=400)
    data = sram.file.read(_MAX_STATE_BYTES + 1)  # cap+1 — never buffer the whole body
    if not data or len(data) > _MAX_STATE_BYTES:
        return Response(status_code=413)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(data)
    # An in-game save means you're playing it — surface it on the Jump Back In
    # shelf (records the real id + core, since the save dir name is a hash).
    games = library.get_section("games")
    core = games["formats"].get(os.path.splitext(id)[1].lower(), {}).get("core") if games else None
    db.set_game_progress(id, core)
    return Response(status_code=204)


@router.get("/library/games/sram")
def get_sram(id: str = Query(description="Game id")):
    """Serve a game's in-game battery save (SRAM), so the player can seed the
    emulator with it on open. 404 when there's none yet."""
    path = library.sram_file(settings.games_saves_dir, id)
    if not path or not os.path.isfile(path):
        return Response(status_code=404)
    return FileResponse(path, media_type="application/octet-stream")


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
    kind: str = Field(description="'read' (to a position), 'play' (a save state), or 'listen' (an audiobook)")
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
    # listen-kind fields
    chapter_id: str | None = None
    position_s: float | None = None


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
    # Recently-played games that still have a ROM. Resume = open the game and let
    # its in-game (SRAM) "Continue" pick up your save — NOT a save-state snapshot,
    # which would restore an older machine state over your latest in-game save. So
    # no slot, and a game counts as in-progress on any play (save state OR SRAM),
    # not only when a save state exists.
    games = library.get_section("games")
    for row in db.list_game_progress():
        gid = row["game_id"]
        if not library.safe_path(games, settings, gid):
            continue  # ROM removed
        entries.append(
            {
                "kind": "play",
                "section": "games",
                "id": gid,
                "name": library.display_name(games, gid),
                "core": row["core"],
                "updated_ms": row["updated_ms"],
            }
        )
    # Audiobooks in progress (resume the book → its saved chapter + position).
    for row in db.list_listen_progress():
        book_id = row["book_id"]
        if not _folder_exists("audiobooks", book_id):
            continue  # book folder gone
        entries.append(
            {
                "kind": "listen",
                "section": "audiobooks",
                "id": book_id,
                "name": book_id.rsplit("/", 1)[-1],
                "chapter_id": row["chapter_id"],
                "position_s": row["position_s"],
                "updated_ms": row["updated_ms"],
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


# --- audiobook listening position -----------------------------------------
# A book is a folder of chapter files; resume = which chapter (its item id) +
# seconds into it. Keyed by the book folder path so there's one position per book.


class ListenProgressModel(BaseModel):
    chapter_id: str | None = None
    position_s: float | None = None


class ListenProgressUpdate(BaseModel):
    book_id: str = Field(description="The book folder path")
    chapter_id: str = Field(description="The currently-playing chapter's item id")
    position_s: float = Field(ge=0, description="Seconds into the chapter")


@router.get("/library/listen-progress", response_model=ListenProgressModel)
def listen_progress_item(book: str = Query(description="The book folder path")):
    """The saved position for an audiobook — the player fetches this on open."""
    row = db.get_listen_progress(book)
    if not row:
        return {"chapter_id": None}
    return {"chapter_id": row["chapter_id"], "position_s": row["position_s"]}


@router.put("/library/listen-progress")
def listen_progress_update(body: ListenProgressUpdate):
    """Save the listening position (upsert). The chapter must be a real audiobook
    file (traversal-guarded), so a bad client can't pollute the shelf."""
    audiobooks = library.get_section("audiobooks")
    if not audiobooks or not library.safe_path(audiobooks, settings, body.chapter_id):
        return Response(status_code=404)
    db.set_listen_progress(body.book_id, body.chapter_id, body.position_s)
    return {"ok": True}


@router.delete("/library/listen-progress")
def listen_progress_delete(book: str = Query(description="The book folder path")):
    """Drop an audiobook from Jump Back In (clears its saved position)."""
    removed = db.delete_listen_progress(book)
    return Response(status_code=204 if removed else 404)


def _serve_cached_cover(cache_dir, key_source, extract):
    """Shared on-demand cover cache (book + audiobook art). Serve the cached WebP
    if present, a 404 if a prior miss was recorded, else call `extract()` for raw
    image bytes, downscale + cache them as a WebP — or record a miss so a coverless
    item isn't re-extracted every view. `key_source` is hashed for the filename so
    a raw path never becomes a path component. Same shape as the comic page cache."""
    key = hashlib.sha1(key_source.encode()).hexdigest()
    webp = os.path.join(cache_dir, key + ".webp")
    miss = os.path.join(cache_dir, key + ".miss")

    if os.path.isfile(webp):
        return FileResponse(webp, media_type="image/webp", headers=_EXTRACTED_ART_HEADERS)
    if os.path.isfile(miss):
        return Response(status_code=404)

    raw = extract()
    thumb = images.to_thumbnail(raw) if raw else None
    os.makedirs(cache_dir, exist_ok=True)
    if thumb:
        images.write_atomic(webp, thumb)
        return FileResponse(webp, media_type="image/webp", headers=_EXTRACTED_ART_HEADERS)
    open(miss, "w").close()  # no cover (or unreadable) — remember it
    return Response(status_code=404)


@router.get("/library/audiobooks/cover")
def audiobook_cover(path: str = Query(description="The book folder path")):
    """A book's cover, from a folder image or the first chapter's embedded art,
    downscaled + cached as a WebP (same on-demand shape as the other covers). A
    book with no art (or a collection folder) is remembered as a miss → 404, and
    the frontend shows a 🎧 placeholder."""
    section = library.get_section("audiobooks")
    book_dir = library.safe_dir(section, settings, path) if section else None
    if not book_dir:
        return Response(status_code=404)
    return _serve_cached_cover(
        settings.audiobook_covers_dir, path, lambda: audiobooks.find_cover(book_dir)
    )


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
    """A book's cover art, cached once as a small WebP (same cache-and-proxy shape
    as game box art / Plex posters). On first view we get the cover from the file
    — the embedded image for an EPUB/MOBI, or the rendered first page for a PDF
    book — downscale it, and store the WebP keyed by a hash of the id; later views
    serve that local file. A book with no readable cover is remembered as a miss →
    404, and the frontend shows a titled placeholder."""
    books = library.get_section("books")
    if not books:
        return Response(status_code=404)
    path = library.safe_path(books, settings, id)
    if not path:
        return Response(status_code=404)
    return _serve_cached_cover(
        settings.book_covers_dir, id, lambda: bookmeta.extract_cover(path, os.path.splitext(id)[1])
    )


@router.get("/library/papers/cover")
def get_paper_cover(id: str = Query(description="Paper/magazine item id from the listing")):
    """A magazine/paper's cover = its first page, rendered once and cached as a
    small WebP (same on-demand cache shape as the book/comic covers). A PDF has no
    embedded cover, so the first page — which for a magazine is its cover — is
    rendered on first view; an unreadable PDF is remembered as a miss → 404 and
    the frontend shows a titled placeholder."""
    papers = library.get_section("papers")
    if not papers:
        return Response(status_code=404)
    path = library.safe_path(papers, settings, id)
    if not path:
        return Response(status_code=404)
    return _serve_cached_cover(
        settings.paper_covers_dir, id, lambda: pdfcover.render_first_page(path)
    )


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
    images.write_atomic(webp, thumb)
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
