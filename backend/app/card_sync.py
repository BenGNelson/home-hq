"""
Card catalog indexer — loads the Pokémon TCG catalog (sets + cards) from a
read-only clone of the public pokemon-tcg-data dataset into SQLite, and
(optionally) refreshes market prices for the cards you own.

Same in-app-background-worker pattern as book_sync: a daemon thread started from
the app lifespan, reading the already-mounted read-only data dir. The first pass
parses ~170 set files / ~20k cards and upserts them (a few seconds); later passes
skip unchanged set files by mtime, so they're cheap. The catalog is refreshed on
the host by a `git pull` of the dataset — this thread just re-ingests what's on
disk, so it works entirely offline.

Card face IMAGES are never fetched here — the router proxies + caches them on
demand (routers/cards.py). The only network use is the OPTIONAL price refresh,
which runs only when a pokemontcg.io API key is configured and only for cards you
own (a bounded set), keeping value ≤1 day stale without pricing all 20k cards.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time

import requests

from app import cards as cards_mod
from app import db
from app.config import settings

log = logging.getLogger("home-hq.card-index")

# Bump when parse_set/parse_card change so already-cached rows get rewritten once
# (otherwise unchanged set files are skipped by the mtime check).
_INDEX_VERSION = "1"

_PRICE_API = "https://api.pokemontcg.io/v2/cards"
_PRICE_BATCH = 40  # card ids per API request (kept well under URL/rate limits)
_PRICE_STALE_S = 20 * 3600  # only refresh prices older than ~20h (daily cadence)


class CardIndexer:
    """Background indexer for the Pokémon card catalog + owned-card prices."""

    def __init__(self, enabled: bool, interval: int):
        self._enabled = enabled
        self._interval = max(300, interval)
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        # Live progress for the sync-status endpoint.
        self._running = False
        self._processed = 0  # cards upserted this pass
        self._total = 0  # cards seen this pass
        self._last_scanned: float | None = None

    def _configured(self) -> bool:
        return bool(settings.card_data_dir) and os.path.isdir(settings.card_data_dir)

    def start(self) -> None:
        if not self._enabled or not self._configured():
            log.info("card-index: disabled or CARD_DATA_DIR not present — not starting")
            return
        self._thread = threading.Thread(target=self._run, daemon=True, name="card-index")
        self._thread.start()
        log.info("card-index: started (every %ss)", self._interval)

    def stop(self) -> None:
        self._stop.set()

    def status(self) -> dict:
        return {
            "enabled": self._enabled,
            "running": self._running,
            "indexed": db.count_cards(),
            "sets": db.count_card_sets(),
            "processed": self._processed,
            "total": self._total,
            "last_scanned": self._last_scanned,
        }

    def _run(self) -> None:
        if self._stop.wait(15):  # let startup settle before the first pass
            return
        while not self._stop.is_set():
            try:
                self.index_once()
            except Exception as exc:  # never let the loop die
                log.warning("card-index: pass error: %s", exc)
            try:
                self.refresh_prices()
            except Exception as exc:
                log.warning("card-index: price refresh error: %s", exc)
            if self._stop.wait(self._interval):
                return

    def index_once(self) -> int:
        """One catalog pass: upsert sets + changed set files, prune what's gone.
        Returns how many cards were upserted. Skips unchanged set files (mtime)."""
        data_dir = settings.card_data_dir
        if not self._configured():
            return 0
        force = db.get_meta("card_index_version") != _INDEX_VERSION

        loaded_sets = cards_mod.load_sets(data_dir)
        db.upsert_card_sets_many(loaded_sets)
        present_sets = {s["setid"] for s in loaded_sets}  # from the SOURCE, for prune
        # A real dataset always yields sets; an empty read = the sets file is
        # missing/unreadable this pass, so DON'T prune against it (would wipe the
        # whole catalog). `clean` gates every prune below.
        clean = bool(loaded_sets)

        known_mtimes: dict = json.loads(db.get_meta("card_file_mtimes") or "{}")
        new_mtimes: dict = {}
        present_cards: set[str] = set()
        self._running = True
        self._processed = 0
        self._total = 0
        try:
            for setid, path in cards_mod.set_files(data_dir):
                if self._stop.is_set():
                    break
                try:
                    mtime = os.path.getmtime(path)
                    # Parse every file each pass (cheap) so `present_cards` is
                    # complete for the prune; only the DB upsert is skipped for
                    # unchanged files.
                    rows = cards_mod.load_set_cards(setid, path)
                except (OSError, ValueError):
                    # A transient/corrupt read of ONE set file — record it and skip
                    # this file, but mark the pass unclean so the prune can't delete
                    # this set's still-present cards as if they were gone.
                    clean = False
                    continue
                new_mtimes[setid] = mtime
                self._total += len(rows)
                present_cards.update(r["id"] for r in rows)
                prev = known_mtimes.get(setid)
                if not force and prev is not None and abs(prev - mtime) < 1:
                    continue  # unchanged since last index
                db.upsert_cards_many(rows)
                self._processed += len(rows)
            # Prune + record version/mtimes only once a pass actually completes AND
            # every file read cleanly — an interrupted or read-failed pass has a
            # partial `present_*`, and pruning against it would delete not-yet-
            # scanned rows (same guard as book_sync, extended to per-file failures).
            removed_cards = 0
            if not self._stop.is_set() and clean:
                stale_sets = db.card_set_ids() - present_sets
                if stale_sets:
                    db.delete_card_sets_many(stale_sets)
                gone = db.card_ids() - present_cards
                if gone:
                    db.delete_cards_many(gone)
                    removed_cards = len(gone)
                db.set_meta("card_file_mtimes", json.dumps(new_mtimes))
                db.set_meta("card_index_version", _INDEX_VERSION)
            self._last_scanned = time.time()
            log.info(
                "card-index: pass done — %d upserted, %d seen, %d pruned",
                self._processed, self._total, removed_cards,
            )
        finally:
            self._running = False
        return self._processed

    def refresh_prices(self, now: float | None = None) -> int:
        """Refresh TCGplayer/Cardmarket prices for OWNED cards whose price is
        missing or stale, via the pokemontcg.io API. No-op without an API key or
        with nothing owned. Returns how many cards were repriced. Only owned cards
        are fetched (a bounded set), so value stays ≤1 day fresh cheaply."""
        key = settings.pokemontcg_api_key
        if not key or not self._configured():
            return 0
        now = now if now is not None else time.time()
        ids = db.owned_card_ids(stale_before=now - _PRICE_STALE_S)
        if not ids:
            return 0
        headers = {"X-Api-Key": key}
        repriced = 0
        for i in range(0, len(ids), _PRICE_BATCH):
            if self._stop.is_set():
                break
            batch = ids[i:i + _PRICE_BATCH]
            query = " OR ".join(f'id:"{cid}"' for cid in batch)
            try:
                resp = requests.get(
                    _PRICE_API,
                    params={"q": query, "select": "id,tcgplayer,cardmarket", "pageSize": _PRICE_BATCH},
                    headers=headers,
                    timeout=20,
                )
                if resp.status_code != 200:
                    continue  # transient/error — retry next pass, don't stamp
                data = resp.json().get("data", [])
            except (requests.RequestException, ValueError) as exc:
                log.warning("card-index: price batch failed: %s", exc)
                continue
            returned = set()
            for api_card in data:
                cid = api_card.get("id")
                if not cid:
                    continue
                usd, eur = cards_mod.extract_prices(api_card)
                db.update_card_prices(cid, usd, eur, now=now)
                returned.add(cid)
                repriced += 1
            # A card the API has no price for still gets a price_updated stamp (with
            # null prices) so it isn't re-queried every pass — it retries on the
            # same staleness cadence as priced cards, not forever.
            for cid in batch:
                if cid not in returned:
                    db.update_card_prices(cid, None, None, now=now)
        if repriced:
            log.info("card-index: repriced %d owned cards", repriced)
        return repriced


# Process-wide singleton, wired up in the app lifespan (main.py).
_indexer: CardIndexer | None = None


def init_indexer(enabled: bool, interval: int) -> CardIndexer:
    global _indexer
    _indexer = CardIndexer(enabled, interval)
    return _indexer


def get_indexer() -> CardIndexer | None:
    return _indexer
