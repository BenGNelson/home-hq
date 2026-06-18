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

import requests
from fastapi import APIRouter, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from app import library
from app.config import settings

router = APIRouter()


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


@router.get("/library/games/cover")
def get_game_cover(id: str = Query(description="Game id from the section listing")):
    """Box art for a game, proxied + cached. Matches the ROM's No-Intro name to
    libretro-thumbnails, fetches the image once into the covers cache, and serves
    it locally thereafter — so browsing makes no repeat external calls and a
    no-match (e.g. a ROM hack) is remembered as a miss rather than refetched.
    404 → the frontend shows a placeholder."""
    url = library.thumbnail_url(id)
    if not url:
        return Response(status_code=404)
    cache_dir = settings.covers_dir
    key = hashlib.sha1(url.encode()).hexdigest()
    hit = os.path.join(cache_dir, key + ".png")
    miss = os.path.join(cache_dir, key + ".miss")
    if os.path.isfile(hit):
        return FileResponse(hit, media_type="image/png")
    if os.path.isfile(miss):
        return Response(status_code=404)
    try:
        resp = requests.get(url, timeout=10)
    except requests.RequestException:
        return Response(status_code=404)  # transient — don't cache as a miss
    os.makedirs(cache_dir, exist_ok=True)
    if resp.status_code == 200 and resp.content:
        with open(hit, "wb") as fh:
            fh.write(resp.content)
        return FileResponse(hit, media_type="image/png")
    open(miss, "w").close()  # remember the no-match
    return Response(status_code=404)


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
