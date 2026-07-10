"""
Pure logic for the Pokémon Cards module — parsing the pokemon-tcg-data catalog
JSON and the user's owned-cards import file into the row shapes db.py stores.

Kept free of HTTP / threads / DB so it's unit-tested directly (same split as
app/library.py vs routers/library.py). The background indexer (card_sync.py) and
the router import these; nothing here touches the network or the filesystem
beyond reading the already-mounted read-only catalog clone.

Card identity everywhere is the dataset's own id, `"<setid>-<number>"` (e.g.
`base1-4`), which is also the join key against a Pokéllector export (set code +
card number).
"""

from __future__ import annotations

import csv
import io
import json
import os
import re

# --- catalog parsing (pokemon-tcg-data → db rows) --------------------------

# A card's printed `number` is a string (promos like "TG01", "SWSH001", "H1"),
# so we derive an integer sort key from its leading digits; anything without a
# numeric lead (letter-prefixed promos/holos) sorts after the numbered cards but
# stays deterministic (ties break on the number string in SQL).
_NON_NUMERIC_SORT = 1_000_000


def sort_order(number: str) -> int:
    """Integer grid-ordering key from a printed card number."""
    m = re.match(r"\s*(\d+)", number or "")
    return int(m.group(1)) if m else _NON_NUMERIC_SORT


def parse_set(raw: dict) -> dict | None:
    """One raw set object → a db.card_sets row dict, or None if it has no id."""
    setid = raw.get("id")
    if not setid:
        return None
    images = raw.get("images") or {}
    return {
        "setid": setid,
        "name": raw.get("name") or setid,
        "series": raw.get("series"),
        "printed_total": raw.get("printedTotal"),
        "total": raw.get("total"),
        "ptcgo_code": raw.get("ptcgoCode"),
        "release_date": raw.get("releaseDate"),
        "symbol_url": images.get("symbol"),
        "logo_url": images.get("logo"),
    }


def parse_card(raw: dict, setid: str | None = None) -> dict | None:
    """One raw card object → a db.cards row dict, or None if it has no id/name.
    `setid` (the filename stem) wins over the embedded set id, which is more
    reliable across the dataset. JSON list fields are stored as JSON strings."""
    card_id = raw.get("id")
    name = raw.get("name")
    if not card_id or not name:
        return None
    resolved_set = setid or (raw.get("set") or {}).get("id") or card_id.rsplit("-", 1)[0]
    number = str(raw.get("number") or "")
    images = raw.get("images") or {}

    def _jsonify(key):
        val = raw.get(key)
        return json.dumps(val) if val else None

    return {
        "id": card_id,
        "setid": resolved_set,
        "number": number,
        "sort_order": sort_order(number),
        "name": name,
        "supertype": raw.get("supertype"),
        "subtypes": _jsonify("subtypes"),
        "rarity": raw.get("rarity"),
        "types": _jsonify("types"),
        "hp": raw.get("hp"),
        "artist": raw.get("artist"),
        "image_small": images.get("small"),
        "image_large": images.get("large"),
        "national_dex": _jsonify("nationalPokedexNumbers"),
    }


def _read_json(path: str):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def load_sets(data_dir: str) -> list[dict]:
    """Parse every set from `<data_dir>/sets/en.json` into db row dicts. Returns
    [] if the file is absent/unreadable (so an unconfigured/empty clone is a
    no-op, not a crash)."""
    path = os.path.join(data_dir, "sets", "en.json")
    try:
        raw = _read_json(path)
    except (OSError, ValueError):
        return []
    out = []
    for s in raw if isinstance(raw, list) else []:
        row = parse_set(s)
        if row:
            out.append(row)
    return out


def set_files(data_dir: str) -> list[tuple[str, str]]:
    """(setid, path) for every per-set card file under `<data_dir>/cards/en/`.
    The filename stem is the setid. Returns [] if the dir is absent."""
    cards_dir = os.path.join(data_dir, "cards", "en")
    try:
        names = sorted(os.listdir(cards_dir))
    except OSError:
        return []
    return [
        (os.path.splitext(n)[0], os.path.join(cards_dir, n))
        for n in names
        if n.endswith(".json")
    ]


def load_set_cards(setid: str, path: str) -> list[dict]:
    """Parse one per-set card file into db row dicts (skips malformed entries).
    Raises OSError/ValueError on an unreadable or corrupt file — the caller must
    distinguish that from a genuinely empty set so a transient read error doesn't
    look like 'this set has no cards' and trigger a wrongful prune."""
    raw = _read_json(path)
    out = []
    for c in raw if isinstance(raw, list) else []:
        row = parse_card(c, setid)
        if row:
            out.append(row)
    return out


# --- price extraction (Phase 3: live pokemontcg.io API card object) --------


def extract_prices(api_card: dict) -> tuple[float | None, float | None]:
    """(tcgplayer_usd, cardmarket_eur) from a live pokemontcg.io card object.
    TCGplayer market price is taken from the highest-signal printing available
    (holofoil → normal → reverse → 1st-ed); Cardmarket uses its trend price.
    Either may be None when that source doesn't list the card."""
    usd = None
    tp = (api_card.get("tcgplayer") or {}).get("prices") or {}
    for variant in ("holofoil", "normal", "reverseHolofoil", "1stEditionHolofoil"):
        market = (tp.get(variant) or {}).get("market")
        if market:
            usd = market
            break
    cm = (api_card.get("cardmarket") or {}).get("prices") or {}
    eur = cm.get("trendPrice") or cm.get("averageSellPrice")
    return usd, eur


# --- TCGplayer Mass Entry want-list (the buy-helper) ------------------------


def massentry_line(name: str, ptcgo_code: str | None, number: str, qty: int = 1) -> str:
    """One TCGplayer Mass Entry line for a card: ``<qty> <name> <setcode> <number>``
    (e.g. ``1 Charizard ex SSP 199``). The set code is the ptcgo code — pasted into
    tcgplayer.com/massentry, then the Cart Optimizer minimizes sellers/shipping. A
    set with no ptcgo code omits it (Mass Entry still matches on name + number; the
    user tweaks the few that don't resolve)."""
    parts = [str(qty), name.strip()]
    if ptcgo_code:
        parts.append(ptcgo_code.strip())
    if number:
        parts.append(str(number).strip())
    return " ".join(p for p in parts if p)


# --- owned-cards import file (Pokéllector export → ownership rows) ----------

_TRUE = {"1", "true", "yes", "y", "want", "wishlist"}


def _norm_row(setid, number, variant=None, qty=None, condition=None,
              wishlist=None, notes=None, card_id=None) -> dict | None:
    """Normalize one import record into an ownership row dict. Resolves the card
    id from setid+number when not given directly. Returns None if it can't form
    an id (the caller counts these as skipped/unparseable)."""
    cid = (card_id or "").strip() if card_id else ""
    if not cid:
        setid = (setid or "").strip()
        number = (str(number) if number is not None else "").strip()
        if not setid or not number:
            return None
        cid = f"{setid}-{number}"
    try:
        qty_i = int(qty) if qty not in (None, "") else 1
    except (TypeError, ValueError):
        qty_i = 1
    wish = 1 if str(wishlist).strip().lower() in _TRUE else 0
    return {
        "card_id": cid,
        "variant": (variant or "normal").strip() or "normal",
        "qty": qty_i,
        "condition": (condition or None) or None,
        "wishlist": wish,
        "notes": (notes or None) or None,
    }


def _dedupe(rows: list[dict]) -> list[dict]:
    """Collapse file-internal duplicate (card_id, variant) pairs, last wins — so
    the bulk insert can't hit a primary-key clash within one import."""
    seen: dict[tuple[str, str], dict] = {}
    for r in rows:
        seen[(r["card_id"], r["variant"])] = r
    return list(seen.values())


def parse_ownership(data: bytes | str, filename: str = "") -> list[dict]:
    """Parse an owned-cards import (CSV or JSON) into ownership row dicts.

    JSON: a list of objects (or an object with a top-level "cards" list), each
    with either `id`/`card_id` or `setid`+`number`, plus optional variant, qty,
    condition, wishlist, notes.
    CSV: a header row naming those same columns (setid,number[,variant,qty,…]).

    Format is chosen by extension, then sniffed. Malformed rows are skipped.
    Duplicates within the file are collapsed (last wins)."""
    text = data.decode("utf-8", "replace") if isinstance(data, bytes) else data
    stripped = text.lstrip()
    is_json = filename.lower().endswith(".json") or stripped[:1] in ("[", "{")
    rows: list[dict] = []
    if is_json:
        try:
            obj = json.loads(text)
        except ValueError:
            return []
        records = obj.get("cards", []) if isinstance(obj, dict) else obj
        for rec in records if isinstance(records, list) else []:
            if not isinstance(rec, dict):
                continue
            row = _norm_row(
                setid=rec.get("setid") or rec.get("set"),
                number=rec.get("number") or rec.get("num"),
                variant=rec.get("variant"),
                qty=rec.get("qty") or rec.get("quantity"),
                condition=rec.get("condition"),
                wishlist=rec.get("wishlist"),
                notes=rec.get("notes"),
                card_id=rec.get("id") or rec.get("card_id"),
            )
            if row:
                rows.append(row)
    else:
        reader = csv.DictReader(io.StringIO(text))
        for rec in reader:
            low = {(k or "").strip().lower(): v for k, v in rec.items()}
            row = _norm_row(
                setid=low.get("setid") or low.get("set"),
                number=low.get("number") or low.get("num"),
                variant=low.get("variant"),
                qty=low.get("qty") or low.get("quantity"),
                condition=low.get("condition"),
                wishlist=low.get("wishlist"),
                notes=low.get("notes"),
                card_id=low.get("id") or low.get("card_id"),
            )
            if row:
                rows.append(row)
    return _dedupe(rows)
