"""Tests for the Books indexer (book_sync.BookIndexer.index_once): the
mtime-skip, version-bump re-parse, prune, the interrupted-pass safety guard, and
the no-title filename fallback. The library + parser are stubbed; the SQLite
book_meta cache is real (the temp_db fixture)."""

import os

from app import book_sync, bookmeta, db, library
from app.book_sync import BookIndexer

_SECTION = object()  # opaque — every library.* call is stubbed below


def _stub_library(monkeypatch, items, mtimes, names=None):
    """Make library look like a configured Books section of `items`, each with a
    fake on-disk mtime; `names` overrides the filename-fallback display name."""
    names = names or {}
    monkeypatch.setattr(library, "get_section", lambda name: _SECTION)
    monkeypatch.setattr(library, "is_configured", lambda section, settings: True)
    monkeypatch.setattr(library, "list_items", lambda section, settings: [{"id": i} for i in items])
    monkeypatch.setattr(library, "safe_path", lambda section, settings, item_id: "/books/" + item_id)
    monkeypatch.setattr(library, "display_name", lambda section, item_id: names.get(item_id, item_id))
    monkeypatch.setattr(os.path, "getmtime", lambda path: mtimes[path.rsplit("/", 1)[-1]])


def _meta(monkeypatch, fn):
    monkeypatch.setattr(bookmeta, "extract_meta", fn)


def _indexer():
    return BookIndexer(enabled=True, interval=300)


def test_first_pass_indexes_all_and_records_version(monkeypatch):
    _stub_library(monkeypatch, ["a.epub", "b.epub"], {"a.epub": 100.0, "b.epub": 200.0})
    _meta(monkeypatch, lambda p, e: ("T", "A"))
    ix = _indexer()
    assert ix.index_once() == 2
    assert db.count_books_meta() == 2
    assert db.get_meta("book_index_version") == book_sync._INDEX_VERSION


def test_unchanged_mtime_is_skipped(monkeypatch):
    _stub_library(monkeypatch, ["a.epub", "b.epub"], {"a.epub": 100.0, "b.epub": 200.0})
    _meta(monkeypatch, lambda p, e: ("T", "A"))
    ix = _indexer()
    assert ix.index_once() == 2
    # Same files, same mtimes, version already recorded → nothing re-parsed.
    assert ix.index_once() == 0
    assert db.count_books_meta() == 2


def test_changed_mtime_is_reparsed(monkeypatch):
    _stub_library(monkeypatch, ["a.epub"], {"a.epub": 100.0})
    _meta(monkeypatch, lambda p, e: ("Old", "A"))
    ix = _indexer()
    assert ix.index_once() == 1
    # File touched (newer mtime) → re-parsed, and the new title overwrites.
    _stub_library(monkeypatch, ["a.epub"], {"a.epub": 500.0})
    _meta(monkeypatch, lambda p, e: ("New", "A"))
    assert ix.index_once() == 1
    assert db.get_book_meta("a.epub")["title"] == "New"


def test_version_bump_forces_reparse(monkeypatch):
    _stub_library(monkeypatch, ["a.epub"], {"a.epub": 100.0})
    _meta(monkeypatch, lambda p, e: ("T", "A"))
    ix = _indexer()
    assert ix.index_once() == 1
    assert ix.index_once() == 0  # unchanged + same version → skipped
    monkeypatch.setattr(book_sync, "_INDEX_VERSION", "new-version")
    assert ix.index_once() == 1  # version bump re-parses even an unchanged file
    assert db.get_meta("book_index_version") == "new-version"


def test_removed_item_is_pruned(monkeypatch):
    _stub_library(monkeypatch, ["a.epub", "b.epub"], {"a.epub": 1.0, "b.epub": 2.0})
    _meta(monkeypatch, lambda p, e: ("T", "A"))
    ix = _indexer()
    ix.index_once()
    assert db.count_books_meta() == 2
    # b disappears from disk → a completed pass prunes its stale cache row.
    _stub_library(monkeypatch, ["a.epub"], {"a.epub": 1.0})
    _meta(monkeypatch, lambda p, e: ("T", "A"))
    ix.index_once()
    assert db.count_books_meta() == 1
    assert db.get_book_meta("b.epub") is None


def test_interrupted_pass_keeps_unscanned_books_and_version(monkeypatch):
    """Regression: an interrupted pass must NOT prune (its `present` set is
    partial) and must NOT record the version (so a full pass still runs next)."""
    # Baseline: a complete pass indexes a + b and records the version.
    _stub_library(monkeypatch, ["a.epub", "b.epub"], {"a.epub": 1.0, "b.epub": 2.0})
    _meta(monkeypatch, lambda p, e: ("T", "A"))
    ix = _indexer()
    ix.index_once()
    baseline_version = db.get_meta("book_index_version")
    assert db.count_books_meta() == 2

    # A forced pass over only [a] (so b would normally be pruned), but the
    # process is asked to stop while parsing a — the pass never completes.
    _stub_library(monkeypatch, ["a.epub"], {"a.epub": 1.0})
    monkeypatch.setattr(book_sync, "_INDEX_VERSION", "forced")  # force a to be parsed, not skipped

    def _extract_then_stop(path, ext):
        ix.stop()  # shutdown requested mid-pass
        return ("T2", "A2")

    _meta(monkeypatch, _extract_then_stop)
    ix.index_once()

    # b survived (not pruned despite being absent from the partial pass)...
    assert db.get_book_meta("b.epub") is not None
    assert db.count_books_meta() == 2
    # ...and the version was NOT advanced, so the next full pass still happens.
    assert db.get_meta("book_index_version") == baseline_version


def test_missing_title_falls_back_to_display_name(monkeypatch):
    _stub_library(monkeypatch, ["weird.epub"], {"weird.epub": 1.0}, names={"weird.epub": "Weird Book"})
    _meta(monkeypatch, lambda p, e: (None, None))  # parser found no embedded title
    ix = _indexer()
    ix.index_once()
    meta = db.get_book_meta("weird.epub")
    assert meta["title"] == "Weird Book"
    assert meta["author"] is None
