"""
/api/cards — the Pokémon TCG collection module.

Browse every set from the self-hosted catalog (ingested by card_sync.py from a
read-only pokemon-tcg-data clone), see which cards you own overlaid on each set,
search across all cards, and show off your collection. Card face images are
proxied from images.pokemontcg.io and cached on demand as WebP — the same
cache-and-serve shape as game box art, so browsing makes no repeat external
calls and only cards you actually view take cache space.

Ownership is imported once from a Pokéllector export (keyed on set code + card
number) and then edited in HQ — HQ is the living source of truth. A re-import
replaces the imported ('pokellector') rows but preserves in-HQ ('manual') edits.

This router is the thin HTTP layer; the catalog/import parsing lives in
app/cards.py (pure, unit-tested) and the queries in app/db.py.
"""

import hashlib
import json
import os
import urllib.parse

import requests
from fastapi import APIRouter, File, Query, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from app import card_sync, cards as cards_mod, db, images
from app.config import settings
from app.routers.library import _ART_CACHE_HEADERS

router = APIRouter()

# An import file is small (a collection list, not media) — cap so a bad upload
# can't buffer unbounded. Even a complete ~20k-card collection is well under this.
_MAX_IMPORT_BYTES = 8 * 1024 * 1024

# Card face thumbnail widths: the browse grid is small; the detail modal wants a
# larger face (the hi-res source is 745px wide, so this keeps it crisp).
_GRID_WIDTH = 400
_FACE_WIDTH = 745


def _decode_list(s):
    """A JSON-array text column back into a Python list (None/blank → [])."""
    if not s:
        return []
    try:
        val = json.loads(s)
        return val if isinstance(val, list) else []
    except ValueError:
        return []


def _completion_pct(owned, total):
    return round(100 * owned / total, 1) if total else 0.0


# --- response models -------------------------------------------------------


class CollectionStatsModel(BaseModel):
    owned_unique: int = Field(description="Distinct cards owned (any variant)")
    owned_total_qty: int = Field(description="Total copies owned across all cards")
    sets: int = Field(description="Sets in the catalog")
    sets_completed: int = Field(description="Sets where every catalogued card is owned")
    completion_pct: float = Field(description="Owned cards as a % of the whole catalog")
    total_value_usd: float | None = Field(
        default=None, description="Collection market value (null until prices are configured)"
    )


class SetSummaryModel(BaseModel):
    setid: str
    name: str
    series: str | None = None
    ptcgo_code: str | None = None
    release_date: str | None = None
    printed_total: int | None = None
    total: int | None = None
    card_count: int = Field(description="Cards for this set in the catalog")
    owned: int = Field(description="Distinct owned cards in this set")
    completion_pct: float
    logo_url: str | None = None
    symbol_url: str | None = None


class SetsModel(BaseModel):
    sets: list[SetSummaryModel]


class CardBriefModel(BaseModel):
    id: str = Field(description="Card id '<setid>-<number>' (the image + detail handle)")
    setid: str
    number: str
    name: str
    rarity: str | None = None
    supertype: str | None = None
    types: list[str] = Field(default_factory=list)
    owned: bool = False
    owned_qty: int = 0
    wishlist: bool = False


class SetDetailModel(BaseModel):
    set: SetSummaryModel
    cards: list[CardBriefModel]


class SearchModel(BaseModel):
    items: list[CardBriefModel]
    total: int = Field(description="Total cards in the catalog (the searchable set)")
    query: str


class OwnershipRowModel(BaseModel):
    variant: str
    qty: int
    condition: str | None = None
    wishlist: bool = False
    notes: str | None = None
    source: str = Field(description="'pokellector' (imported) or 'manual' (in-HQ edit)")


class CardDetailModel(BaseModel):
    id: str
    setid: str
    set_name: str | None = None
    number: str
    name: str
    supertype: str | None = None
    subtypes: list[str] = Field(default_factory=list)
    rarity: str | None = None
    types: list[str] = Field(default_factory=list)
    hp: str | None = None
    artist: str | None = None
    national_dex: list[int] = Field(default_factory=list)
    tcgplayer_usd: float | None = None
    cardmarket_eur: float | None = None
    price_updated: float | None = Field(default=None, description="Epoch time of the last price refresh")
    ownership: list[OwnershipRowModel] = Field(default_factory=list)


class ImportResultModel(BaseModel):
    imported: int = Field(description="Ownership rows written")
    skipped: int = Field(description="Rows kept out because a manual (in-HQ) edit already owns that card+variant")
    unmatched: list[str] = Field(description="Card ids in the file with no match in the catalog")
    total_rows: int = Field(description="Rows parsed from the file")


class OwnershipUpdate(BaseModel):
    card_id: str
    variant: str = "normal"
    qty: int = Field(default=1, ge=0)
    condition: str | None = None
    wishlist: bool = False
    notes: str | None = None


class SyncStatusModel(BaseModel):
    configured: bool = Field(description="False when CARD_DATA_DIR is unset/missing")
    enabled: bool
    running: bool = Field(description="True while a catalog pass is in progress")
    indexed: int = Field(description="Cards currently in the catalog")
    sets: int = Field(description="Sets currently in the catalog")
    processed: int = Field(description="Cards upserted so far in the current/last pass")
    total: int = Field(description="Cards seen in the current/last pass")
    last_scanned: float | None = None


# --- browse / search -------------------------------------------------------


@router.get("/cards/stats", response_model=CollectionStatsModel, response_model_exclude_none=True)
def cards_stats():
    """Headline collection figures for the hub hero."""
    return db.collection_stats()


@router.get("/cards/sets", response_model=SetsModel, response_model_exclude_none=True)
def cards_sets():
    """Every set with its card count + how many you own, newest release first."""
    sets = []
    for s in db.list_card_sets_with_counts():
        s["completion_pct"] = _completion_pct(s["owned"], s["card_count"])
        sets.append(s)
    return {"sets": sets}


def _brief(row):
    """A db card row (list/search shape) → the CardBrief dict."""
    return {
        "id": row["id"],
        "setid": row["setid"],
        "number": row["number"],
        "name": row["name"],
        "rarity": row.get("rarity"),
        "supertype": row.get("supertype"),
        "types": _decode_list(row.get("types")),
        "owned": bool(row.get("owned")),
        "owned_qty": row.get("owned_qty", 0) or 0,
        "wishlist": bool(row.get("wishlist")),
    }


@router.get("/cards/sets/{setid}", response_model=SetDetailModel, response_model_exclude_none=True)
def cards_set_detail(setid: str):
    """One set: its metadata + every card, each with an owned/unowned overlay."""
    meta = db.get_card_set(setid)
    if not meta:
        return Response(status_code=404)
    cards = db.list_set_cards(setid)
    owned = sum(1 for c in cards if c.get("owned"))
    meta["card_count"] = len(cards)
    meta["owned"] = owned
    meta["completion_pct"] = _completion_pct(owned, len(cards))
    return {"set": meta, "cards": [_brief(c) for c in cards]}


@router.get("/cards/search", response_model=SearchModel, response_model_exclude_none=True)
def cards_search(
    q: str = Query("", description="Card-name substring; empty = first results alphabetically"),
    owned: bool = Query(False, description="Restrict to cards you own"),
    limit: int = Query(120, ge=1, le=500),
):
    """Search across the whole catalog by card name, with an owned overlay."""
    rows = db.search_cards(q, owned=owned, limit=limit)
    return {"items": [_brief(r) for r in rows], "total": db.count_cards(), "query": q}


@router.get("/cards/card/{card_id}", response_model=CardDetailModel, response_model_exclude_none=True)
def cards_card_detail(card_id: str):
    """One card's full metadata, market price, and your ownership of it."""
    card = db.get_card(card_id)
    if not card:
        return Response(status_code=404)
    set_meta = db.get_card_set(card["setid"])
    return {
        "id": card["id"],
        "setid": card["setid"],
        "set_name": set_meta["name"] if set_meta else None,
        "number": card["number"],
        "name": card["name"],
        "supertype": card["supertype"],
        "subtypes": _decode_list(card["subtypes"]),
        "rarity": card["rarity"],
        "types": _decode_list(card["types"]),
        "hp": card["hp"],
        "artist": card["artist"],
        "national_dex": _decode_list(card["national_dex"]),
        "tcgplayer_usd": card["tcgplayer_usd"],
        "cardmarket_eur": card["cardmarket_eur"],
        "price_updated": card["price_updated"],
        "ownership": [
            {
                "variant": o["variant"],
                "qty": o["qty"],
                "condition": o["condition"],
                "wishlist": bool(o["wishlist"]),
                "notes": o["notes"],
                "source": o["source"],
            }
            for o in card["ownership"]
        ],
    }


# --- card face images (proxy + WebP cache) ---------------------------------


def _card_image_bytes(url):
    """Raw bytes for a card face: a local archival original under CARDS_DIR when
    configured (its layout mirrors the CDN's /<set>/<num>.png), else the network.
    Returns None on any miss/failure — treated as transient (no permanent miss is
    cached, unlike book covers), since a card in this dataset effectively always
    has a working image URL and a placeholder-forever on a CDN blip is worse."""
    if settings.cards_dir:
        rel = urllib.parse.urlparse(url).path.lstrip("/")
        local = os.path.join(settings.cards_dir, rel)
        if os.path.isfile(local):
            try:
                with open(local, "rb") as fh:
                    return fh.read()
            except OSError:
                pass
    try:
        resp = requests.get(url, timeout=15)
    except requests.RequestException:
        return None
    return resp.content if resp.status_code == 200 and resp.content else None


@router.get("/cards/image")
def cards_image(
    id: str = Query(description="Card id from a listing"),
    size: str = Query("small", description="'small' (grid) or 'large' (detail face)"),
):
    """A card's face, downscaled + cached as a WebP (same proxy-and-cache idea as
    game box art). Prefers a local original under CARDS_DIR when configured, else
    proxies images.pokemontcg.io. Cached by card id + size so the grid thumb and
    the larger detail face coexist. 404 (without caching a miss) when the image
    can't be fetched, so a transient CDN failure doesn't stick — the frontend
    shows a placeholder and a later load retries."""
    small_url, large_url = db.get_card_image_urls(id)
    want_large = size == "large"
    url = (large_url or small_url) if want_large else (small_url or large_url)
    if not url:
        return Response(status_code=404)

    key = hashlib.sha1(f"{id}:{size}".encode()).hexdigest()
    webp = os.path.join(settings.card_art_dir, key + ".webp")
    if os.path.isfile(webp):
        return FileResponse(webp, media_type="image/webp", headers=_ART_CACHE_HEADERS)

    thumb = images.to_thumbnail(_card_image_bytes(url) or b"", max_width=_FACE_WIDTH if want_large else _GRID_WIDTH)
    if not thumb:
        return Response(status_code=404)
    os.makedirs(settings.card_art_dir, exist_ok=True)
    images.write_atomic(webp, thumb)
    return FileResponse(webp, media_type="image/webp", headers=_ART_CACHE_HEADERS)


# --- ownership -------------------------------------------------------------


@router.post("/cards/ownership/import", response_model=ImportResultModel)
def cards_import(file: UploadFile = File(description="Owned-cards CSV or JSON export")):
    """Seed/refresh your collection from a Pokéllector export (CSV or JSON). Rows
    are keyed on set code + card number → resolved to catalog card ids; ids with
    no catalog match are reported back (never silently dropped). Replaces the
    imported ('pokellector') rows but preserves in-HQ ('manual') edits."""
    data = file.file.read(_MAX_IMPORT_BYTES + 1)
    if not data or len(data) > _MAX_IMPORT_BYTES:
        return Response(status_code=413)
    rows = cards_mod.parse_ownership(data, file.filename or "")
    known = db.card_ids()
    matched = [r for r in rows if r["card_id"] in known]
    unmatched = sorted({r["card_id"] for r in rows if r["card_id"] not in known})
    inserted, skipped = db.replace_ownership("pokellector", matched)
    return {
        "imported": inserted,
        "skipped": skipped,
        "unmatched": unmatched,
        "total_rows": len(rows),
    }


@router.put("/cards/ownership")
def cards_ownership_put(body: OwnershipUpdate):
    """Mark a card owned / edit qty-condition-wishlist (an in-HQ 'manual' edit
    that survives a later re-import). The card must exist in the catalog."""
    if body.card_id not in db.card_ids():
        return Response(status_code=404)
    db.upsert_ownership(
        body.card_id,
        variant=body.variant,
        qty=body.qty,
        condition=body.condition,
        wishlist=1 if body.wishlist else 0,
        notes=body.notes,
        source="manual",
    )
    return {"ok": True}


@router.delete("/cards/ownership")
def cards_ownership_delete(
    card_id: str = Query(description="Card id"),
    variant: str = Query("normal", description="Variant to remove"),
):
    """Remove an ownership row (un-own a card)."""
    removed = db.delete_ownership(card_id, variant)
    return Response(status_code=204 if removed else 404)


@router.get("/cards/sync-status", response_model=SyncStatusModel, response_model_exclude_none=True)
def cards_sync_status():
    """Catalog indexer progress, so the UI can show 'building the catalog…' on
    first run (the initial pass ingests ~20k cards)."""
    configured = bool(settings.card_data_dir) and os.path.isdir(settings.card_data_dir)
    indexer = card_sync.get_indexer()
    base = (
        indexer.status()
        if indexer
        else {
            "enabled": False,
            "running": False,
            "indexed": db.count_cards(),
            "sets": db.count_card_sets(),
            "processed": 0,
            "total": 0,
            "last_scanned": None,
        }
    )
    return {"configured": configured, **base}
