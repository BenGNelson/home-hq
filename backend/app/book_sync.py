"""
Book indexer — builds the Books search cache by parsing each ebook's embedded
title + author into SQLite (book_meta), once per file.

Same privileged-app-not-needed pattern as the other in-app background workers
(storage_history / space_usage): a daemon thread started from the app lifespan,
reading the already-mounted read-only library. Over a large library (10k+ files)
the first pass parses everything (a few minutes); later passes are cheap because
files are skipped by mtime. Parsing is defensive — a bad file falls back to its
cleaned filename for the title and a NULL author, never aborting the pass.

The cache is text-only (title/author/path), so it stays a few MB even for a
huge library — no covers, no copies of the books.
"""

from __future__ import annotations

import logging
import os
import threading
import time

from app import bookmeta, db, library
from app.config import settings

log = logging.getLogger("home-hq.book-index")

_FLUSH_EVERY = 200  # books per write transaction
# Bump when the parsing/cleaning logic changes so already-cached books get
# re-parsed once (otherwise they'd be skipped by the unchanged-mtime check).
_INDEX_VERSION = "2"


class BookIndexer:
    """Background indexer for the Books metadata cache."""

    def __init__(self, enabled: bool, interval: int):
        self._enabled = enabled
        self._interval = max(300, interval)
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        # Live progress for the index-status endpoint.
        self._running = False
        self._processed = 0  # files parsed (not skipped) this pass
        self._total = 0  # files seen this pass
        self._last_scanned: float | None = None

    def start(self) -> None:
        section = library.get_section("books")
        if not self._enabled or not section or not library.is_configured(section, settings):
            log.info("book-index: disabled or Books section not configured — not starting")
            return
        self._thread = threading.Thread(target=self._run, daemon=True, name="book-index")
        self._thread.start()
        log.info("book-index: started (every %ss)", self._interval)

    def stop(self) -> None:
        self._stop.set()

    def status(self) -> dict:
        return {
            "enabled": self._enabled,
            "running": self._running,
            "indexed": db.count_books_meta(),
            "processed": self._processed,
            "total": self._total,
            "last_scanned": self._last_scanned,
        }

    def _run(self) -> None:
        if self._stop.wait(15):  # let startup settle before a big first pass
            return
        while not self._stop.is_set():
            try:
                self.index_once()
            except Exception as exc:  # never let the loop die
                log.warning("book-index: pass error: %s", exc)
            if self._stop.wait(self._interval):
                return

    def index_once(self) -> int:
        """One indexing pass: parse new/changed books, prune removed ones.
        Returns how many files were parsed. Skips unchanged files (by mtime)."""
        section = library.get_section("books")
        if not section or not library.is_configured(section, settings):
            return 0
        items = library.list_items(section, settings)
        known = db.book_mtimes()
        # When the parsing logic version changes, re-parse every file once
        # (ignore the unchanged-mtime skip) so existing rows get the new logic.
        force = db.get_meta("book_index_version") != _INDEX_VERSION
        present: set[str] = set()
        batch: list[tuple] = []
        self._running = True
        self._processed = 0
        self._total = len(items)
        try:
            for it in items:
                if self._stop.is_set():
                    break
                item_id = it["id"]
                present.add(item_id)
                path = library.safe_path(section, settings, item_id)
                if not path:
                    continue
                try:
                    mtime = os.path.getmtime(path)
                except OSError:
                    continue
                prev = known.get(item_id)
                if not force and prev is not None and abs(prev - mtime) < 1:
                    continue  # unchanged — already indexed
                title, author = bookmeta.extract_meta(path, os.path.splitext(item_id)[1])
                if not title:
                    title = library.display_name(section, item_id)  # filename fallback
                batch.append((item_id, title, author, mtime))
                self._processed += 1
                if len(batch) >= _FLUSH_EVERY:
                    db.upsert_book_meta_many(batch)
                    batch = []
            if batch:
                db.upsert_book_meta_many(batch)
            # Prune cache rows for files that no longer exist.
            removed = set(known) - present
            if removed:
                db.delete_book_meta_many(removed)
            # Record the logic version once a pass actually completes (not if it
            # was interrupted), so a forced re-parse only happens once.
            if not self._stop.is_set():
                db.set_meta("book_index_version", _INDEX_VERSION)
            self._last_scanned = time.time()
            log.info(
                "book-index: pass done — %d parsed, %d total, %d pruned",
                self._processed, self._total, len(removed),
            )
        finally:
            self._running = False
        return self._processed


# Process-wide singleton, wired up in the app lifespan (main.py).
_indexer: BookIndexer | None = None


def init_indexer(enabled: bool, interval: int) -> BookIndexer:
    global _indexer
    _indexer = BookIndexer(enabled, interval)
    return _indexer


def get_indexer() -> BookIndexer | None:
    return _indexer
