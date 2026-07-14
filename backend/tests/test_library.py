"""Tests for the Library: the pure listing/traversal-guard logic (library.py)
and the HTTP layer (routers/library.py), including the range-capable streamer
and the path-traversal block."""

import os

import pytest

from app import db, library
from app.config import settings

GAMES = library.get_section("games")
PAPERS = library.get_section("papers")


@pytest.fixture
def papers_dir(tmp_path, monkeypatch):
    """A populated reading dir wired into settings.papers_dir."""
    (tmp_path / "Science News - March 25, 2023.pdf").write_bytes(b"%PDF-1")
    (tmp_path / "The Atlantic - April 2023.pdf").write_bytes(b"%PDF-2")
    (tmp_path / "cover.jpg").write_bytes(b"not a doc")  # ignored
    monkeypatch.setattr(settings, "papers_dir", str(tmp_path))
    return tmp_path


def test_papers_section_lists_pdfs_with_plain_titles(papers_dir):
    items = library.list_items(PAPERS, settings)
    by_name = {it["name"]: it for it in items}
    # Plain titles: the real document name is kept verbatim (no ROM cleanup that
    # would turn " - " into ": " or strip parentheses).
    assert "Science News - March 25, 2023" in by_name
    assert "The Atlantic - April 2023" in by_name
    assert by_name["Science News - March 25, 2023"]["label"] == "PDF"
    assert by_name["Science News - March 25, 2023"]["reader"] == "pdf"
    # The non-PDF is ignored, and sorting ignores the leading article ("The").
    assert [it["name"] for it in items] == [
        "The Atlantic - April 2023",
        "Science News - March 25, 2023",
    ]


def test_papers_safe_path_blocks_non_pdf_and_traversal(papers_dir):
    assert library.safe_path(PAPERS, settings, "Science News - March 25, 2023.pdf")
    assert library.safe_path(PAPERS, settings, "cover.jpg") is None  # wrong ext
    assert library.safe_path(PAPERS, settings, "../etc/passwd") is None


def test_display_name_plain_vs_rom():
    # Plain section keeps the real document title; ROM section gets the cleanup.
    assert (
        library.display_name(PAPERS, "Science News - March 25, 2023.pdf")
        == "Science News - March 25, 2023"
    )
    assert (
        library.display_name(GAMES, "Legend of Zelda, The - Link's Awakening (USA).gb")
        == "The Legend of Zelda: Link's Awakening"
    )


def test_reading_progress_upsert_list_delete():
    db.set_reading_progress("papers", "a.pdf", 5, 80, now_ms=1000)
    db.set_reading_progress("papers", "b.pdf", 1, 50, now_ms=2000)  # page 1 → not on shelf
    db.set_reading_progress("papers", "c.pdf", 12, 100, now_ms=3000)
    assert db.get_reading_progress("papers", "a.pdf")["page"] == 5
    assert db.get_reading_progress("papers", "missing.pdf") is None
    # Shelf = page >= 2, newest first; the page-1 entry is excluded.
    assert [r["item_id"] for r in db.list_reading_progress()] == ["c.pdf", "a.pdf"]
    # Upsert updates the page and bumps it to newest.
    db.set_reading_progress("papers", "a.pdf", 9, 80, now_ms=4000)
    assert db.get_reading_progress("papers", "a.pdf")["page"] == 9
    assert db.list_reading_progress()[0]["item_id"] == "a.pdf"
    # Delete (idempotent return).
    assert db.delete_reading_progress("papers", "a.pdf") is True
    assert db.delete_reading_progress("papers", "a.pdf") is False
    assert db.get_reading_progress("papers", "a.pdf") is None


def test_reading_progress_endpoints(client, papers_dir):
    # Exercises the HTTP layer (the unit tests above call db directly, which
    # wouldn't catch a router-wiring bug like a missing import).
    pid = "Science News - March 25, 2023.pdf"
    assert (
        client.put(
            "/api/library/reading-progress",
            json={"section": "papers", "id": pid, "page": 3, "total": 40},
        ).status_code
        == 200
    )
    assert (
        client.get(
            "/api/library/reading-progress/item",
            params={"section": "papers", "id": pid},
        ).json()["page"]
        == 3
    )
    # A bad id is rejected (not stored).
    assert (
        client.put(
            "/api/library/reading-progress",
            json={"section": "papers", "id": "../secret", "page": 2},
        ).status_code
        == 404
    )
    # Remove clears the bookmark.
    assert (
        client.delete(
            "/api/library/reading-progress", params={"section": "papers", "id": pid}
        ).status_code
        == 204
    )
    assert (
        client.get(
            "/api/library/reading-progress/item",
            params={"section": "papers", "id": pid},
        ).json()["page"]
        is None
    )


def test_library_continue_merges_reading_and_games(
    client, papers_dir, rom_dir, tmp_path, monkeypatch
):
    saves = tmp_path / "saves"
    monkeypatch.setattr(settings, "games_saves_dir", str(saves))
    # A paper in progress (older) ...
    db.set_reading_progress(
        "papers", "The Atlantic - April 2023.pdf", 5, 40, now_ms=1000
    )
    # ... and a game played (last-played marker, newer) — no save state needed: a
    # game counts as in-progress on any play (incl. an in-game/SRAM save), and
    # resume is via the game's own "Continue", so the entry carries no save slot.
    gid = "Tetris.gb"
    db.set_game_progress(gid, "gb", now_ms=3000)

    items = client.get("/api/library/continue").json()["items"]
    assert [(i["kind"], i["id"]) for i in items] == [
        ("play", "Tetris.gb"),  # newest play (3000) sorts above the paper (1000)
        ("read", "The Atlantic - April 2023.pdf"),
    ]
    assert items[0]["core"] == "gb" and items[0].get("slot") is None
    assert items[1]["page"] == 5 and items[1]["total"] == 40

    # Removing the game from the shelf clears the marker.
    assert (
        client.delete("/api/library/games/last-played", params={"id": gid}).status_code
        == 204
    )
    after = client.get("/api/library/continue").json()["items"]
    assert all(i["id"] != gid for i in after)


BOOKS = library.get_section("books")


@pytest.fixture
def books_dir(tmp_path, monkeypatch):
    """A populated ebook dir wired into settings.books_dir."""
    (tmp_path / "Dune.epub").write_bytes(b"PK\x03\x04epub")
    (tmp_path / "Neuromancer.mobi").write_bytes(b"mobi")
    (tmp_path / "Snow Crash.azw3").write_bytes(b"azw3")
    (tmp_path / "A Manual.pdf").write_bytes(b"%PDF-1")
    (tmp_path / "cover.jpg").write_bytes(b"not a book")  # ignored
    monkeypatch.setattr(settings, "books_dir", str(tmp_path))
    return tmp_path


def test_books_section_lists_with_reader_hints(books_dir):
    items = library.list_items(BOOKS, settings)
    by_name = {it["name"]: it for it in items}
    # Plain titles (real book names kept verbatim) + the right reader per format.
    assert by_name["Dune"]["label"] == "EPUB" and by_name["Dune"]["reader"] == "epub"
    assert by_name["Neuromancer"]["reader"] == "epub"  # MOBI uses the ebook reader
    assert by_name["Snow Crash"]["reader"] == "epub"  # AZW3 too
    assert by_name["A Manual"]["reader"] == "pdf"  # a PDF book falls back to PDF.js
    assert "cover" not in by_name  # the .jpg is ignored


def test_books_safe_path_blocks_unknown_ext_and_traversal(books_dir):
    assert library.safe_path(BOOKS, settings, "Dune.epub")
    assert library.safe_path(BOOKS, settings, "cover.jpg") is None
    assert library.safe_path(BOOKS, settings, "../etc/passwd") is None


def test_item_reader():
    assert library.item_reader(BOOKS, "Dune.epub") == "epub"
    assert library.item_reader(BOOKS, "A Manual.pdf") == "pdf"
    assert library.item_reader(PAPERS, "x.pdf") == "pdf"
    assert library.item_reader(GAMES, "Tetris.gb") is None  # play-kind, no reader


def test_ebook_reading_progress_locator_fraction():
    # Ebooks bookmark by locator (CFI) + fraction; page stays 0 for them.
    db.set_reading_progress(
        "books", "Dune.epub", locator="epubcfi(/6/4!/4/2)", fraction=0.42, now_ms=1000
    )
    row = db.get_reading_progress("books", "Dune.epub")
    assert row["page"] == 0
    assert row["locator"] == "epubcfi(/6/4!/4/2)"
    assert row["fraction"] == 0.42
    # An ebook with fraction > 0 is "started" → on the shelf even though page is 0.
    assert any(r["item_id"] == "Dune.epub" for r in db.list_reading_progress())
    # A just-opened ebook (fraction 0) is not on the shelf, mirroring page-1 PDFs.
    db.set_reading_progress(
        "books", "Fresh.epub", locator="epubcfi(/2)", fraction=0.0, now_ms=2000
    )
    assert all(r["item_id"] != "Fresh.epub" for r in db.list_reading_progress())


def test_ebook_reading_progress_endpoints(client, books_dir):
    bid = "Dune.epub"
    assert (
        client.put(
            "/api/library/reading-progress",
            json={"section": "books", "id": bid, "locator": "epubcfi(/6/4)", "fraction": 0.3},
        ).status_code
        == 200
    )
    saved = client.get(
        "/api/library/reading-progress/item", params={"section": "books", "id": bid}
    ).json()
    assert saved["locator"] == "epubcfi(/6/4)" and saved["fraction"] == 0.3
    # Neither page nor locator → nothing to save → 400.
    assert (
        client.put(
            "/api/library/reading-progress",
            json={"section": "books", "id": bid},
        ).status_code
        == 400
    )


def test_continue_includes_reader_for_read_entries(client, books_dir):
    db.set_reading_progress(
        "books", "Dune.epub", locator="epubcfi(/6)", fraction=0.5, now_ms=5000
    )
    entry = next(
        i for i in client.get("/api/library/continue").json()["items"] if i["id"] == "Dune.epub"
    )
    assert entry["kind"] == "read"
    assert entry["reader"] == "epub"
    assert entry["locator"] == "epubcfi(/6)" and entry["fraction"] == 0.5


def test_book_meta_upsert_get_search():
    db.upsert_book_meta_many(
        [
            ("a.epub", "The Stand", "Stephen King", 100.0),
            ("b.mobi", "Dragonflight", "Anne McCaffrey", 200.0),
            ("c.pdf", "Untitled Report", None, 300.0),
        ],
        scanned_at=1.0,
    )
    assert db.count_books_meta() == 3
    assert db.get_book_meta("a.epub")["author"] == "Stephen King"
    assert db.get_book_meta("missing") is None
    # search by title and by author, both case-insensitive
    assert [r["item_id"] for r in db.search_books("stand")] == ["a.epub"]
    assert [r["item_id"] for r in db.search_books("MCCAFFREY")] == ["b.mobi"]
    # empty query → first results alphabetically by title
    assert [r["title"] for r in db.search_books("")] == [
        "Dragonflight",
        "The Stand",
        "Untitled Report",
    ]
    assert len(db.search_books("", limit=1)) == 1
    # mtimes (change detection) + prune
    assert db.book_mtimes()["b.mobi"] == 200.0
    db.delete_book_meta_many(["c.pdf"])
    assert db.count_books_meta() == 2
    # upsert updates an existing row
    db.upsert_book_meta_many([("a.epub", "The Stand: Complete", "Stephen King", 150.0)])
    assert db.get_book_meta("a.epub")["title"] == "The Stand: Complete"


def test_search_books_escapes_wildcards():
    db.upsert_book_meta_many(
        [("a.epub", "100% Pure", "X", 1.0), ("b.epub", "Other", "Y", 1.0)]
    )
    # A literal % must be matched literally, not act as a SQL LIKE wildcard.
    assert [r["item_id"] for r in db.search_books("100%")] == ["a.epub"]


def test_books_search_endpoint(client, books_dir):
    db.upsert_book_meta_many(
        [
            ("Dune.epub", "Dune", "Frank Herbert", 1.0),
            ("Neuromancer.mobi", "Neuromancer", "William Gibson", 1.0),
        ]
    )
    body = client.get("/api/library/books/search", params={"q": "gibson"}).json()
    assert body["total"] == 2  # whole indexed set
    assert len(body["items"]) == 1  # only the match
    hit = body["items"][0]
    assert hit["id"] == "Neuromancer.mobi"
    assert hit["title"] == "Neuromancer"
    assert hit["reader"] == "epub"  # .mobi opens in the ebook reader


def test_books_index_status_endpoint(client, books_dir):
    body = client.get("/api/library/books/index-status").json()
    assert body["configured"] is True
    assert "running" in body and "indexed" in body and "total" in body


# --- Textbooks section (folder-organized reference books) -------------------
TEXTBOOKS = library.get_section("textbooks")


@pytest.fixture
def textbooks_dir(tmp_path, monkeypatch):
    """A textbooks dir organized into sub-category folders, wired into settings."""
    (tmp_path / "Programming").mkdir()
    (tmp_path / "Programming" / "Steve McConnell - Code Complete (2004).pdf").write_bytes(b"%PDF-1")
    (tmp_path / "Programming" / "Kyle Simpson - You Don't Know JS.epub").write_bytes(b"PK\x03\x04")
    (tmp_path / "Cooking").mkdir()
    (tmp_path / "Cooking" / "Samin Nosrat - Salt Fat Acid Heat.mobi").write_bytes(b"mobi")
    (tmp_path / "cover.jpg").write_bytes(b"not a book")  # ignored
    monkeypatch.setattr(settings, "textbooks_dir", str(tmp_path))
    return tmp_path


def test_textbooks_section_exists_and_uses_book_readers():
    # Same file types + reader hints as Books, so the same PDF/EPUB readers open it.
    assert TEXTBOOKS is not None
    assert TEXTBOOKS["kind"] == "read"
    assert library.item_reader(TEXTBOOKS, "x.pdf") == "pdf"
    assert library.item_reader(TEXTBOOKS, "x.epub") == "epub"
    assert library.item_reader(TEXTBOOKS, "x.mobi") == "epub"


def test_textbooks_section_lists_subfolders_as_tree(textbooks_dir):
    items = library.list_items(TEXTBOOKS, settings)
    ids = {it["id"] for it in items}
    # Ids are POSIX-relative paths, so the frontend folder-browser sees the
    # sub-category tree (same shape as Comics).
    assert "Programming/Steve McConnell - Code Complete (2004).pdf" in ids
    assert "Cooking/Samin Nosrat - Salt Fat Acid Heat.mobi" in ids
    by_name = {it["name"]: it for it in items}
    assert by_name["Steve McConnell - Code Complete (2004)"]["reader"] == "pdf"
    assert "cover" not in by_name  # the .jpg is ignored


def test_textbooks_safe_path_blocks_unknown_ext_and_traversal(textbooks_dir):
    assert library.safe_path(TEXTBOOKS, settings, "Cooking/Samin Nosrat - Salt Fat Acid Heat.mobi")
    assert library.safe_path(TEXTBOOKS, settings, "cover.jpg") is None
    assert library.safe_path(TEXTBOOKS, settings, "../etc/passwd") is None


def test_textbooks_in_sections_summary(textbooks_dir):
    summary = {s["key"]: s for s in library.sections_summary(settings)}
    assert summary["textbooks"]["configured"] is True
    assert summary["textbooks"]["count"] == 3


def test_textbook_cover_endpoint_404_for_unknown(client, textbooks_dir):
    # An id that isn't a real textbook resolves to no path → 404 (placeholder).
    resp = client.get("/api/library/textbooks/cover", params={"id": "nope.pdf"})
    assert resp.status_code == 404


# --- inbox status (read-only view of the host-side sorter) ------------------
@pytest.fixture
def inbox_dirs(tmp_path, monkeypatch):
    inbox = tmp_path / "inbox"
    review = tmp_path / "_needs_review"
    inbox.mkdir()
    review.mkdir()
    (inbox / "Dropped Backup.epub").write_bytes(b"x")
    (inbox / ".hidden").write_bytes(b"x")  # skipped
    (review / "Mystery Book.pdf").write_bytes(b"x")
    (review / "Mystery Book.pdf.review.json").write_text(
        '{"reason": "weak signal — needs a human call", "type": "textbook?"}'
    )
    monkeypatch.setattr(settings, "inbox_dir", str(inbox))
    monkeypatch.setattr(settings, "needs_review_dir", str(review))
    return tmp_path


def test_inbox_status_counts_and_reasons(inbox_dirs):
    st = library.inbox_status(settings)
    assert st["configured"] is True
    assert st["inbox_count"] == 1 and st["inbox"] == ["Dropped Backup.epub"]
    assert st["review_count"] == 1
    item = st["review"][0]
    assert item["name"] == "Mystery Book.pdf"
    assert item["reason"] == "weak signal — needs a human call"


def test_inbox_status_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "inbox_dir", "")
    monkeypatch.setattr(settings, "needs_review_dir", "")
    st = library.inbox_status(settings)
    assert st["configured"] is False
    assert st["inbox_count"] == 0 and st["review_count"] == 0


def test_inbox_status_endpoint(client, inbox_dirs):
    body = client.get("/api/library/inbox-status").json()
    assert body["configured"] is True
    assert body["inbox_count"] == 1
    assert body["review"][0]["reason"].startswith("weak signal")


@pytest.fixture
def rom_dir(tmp_path, monkeypatch):
    """A populated ROM dir wired into settings.games_rom_dir."""
    (tmp_path / "Tetris.gb").write_bytes(b"GBROM-tetris")
    (tmp_path / "Zelda.gbc").write_bytes(b"GBC")
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "Metroid.gba").write_bytes(b"GBA-metroid-data")
    (tmp_path / "notes.txt").write_text("not a rom")  # ignored
    # A Mac copying over SMB leaves these beside every real file. Same extension
    # as the ROM, so they must be skipped by name, not by extension.
    (tmp_path / "._Tetris.gb").write_bytes(b"\x00\x05\x16\x07AppleDouble")
    (tmp_path / "sub" / "._Metroid.gba").write_bytes(b"\x00\x05\x16\x07AppleDouble")
    (tmp_path / ".DS_Store").write_bytes(b"junk")
    monkeypatch.setattr(settings, "games_rom_dir", str(tmp_path))
    return tmp_path


# --- pure logic ------------------------------------------------------------

def test_list_items_recurses_and_ignores_unknown(rom_dir):
    items = library.list_items(GAMES, settings)
    names = [it["name"] for it in items]
    # Sorted by (system label, name): "Game Boy" < "Game Boy Advance" < "Game Boy Color".
    assert names == ["Tetris", "Metroid", "Zelda"]
    # notes.txt is excluded; the nested .gba is found.
    assert "notes" not in names


def test_list_items_skips_hidden_files(rom_dir):
    """AppleDouble sidecars carry a real ROM extension — skip them by name, or a
    Mac-copied library scans in a phantom entry beside every game."""
    items = library.list_items(GAMES, settings)
    ids = [it["id"] for it in items]
    assert ids == ["Tetris.gb", "sub/Metroid.gba", "Zelda.gbc"]
    assert not any(os.path.basename(i).startswith(".") for i in ids)


def test_list_items_metadata(rom_dir):
    by_name = {it["name"]: it for it in library.list_items(GAMES, settings)}
    assert by_name["Tetris"]["label"] == "Game Boy"
    assert by_name["Tetris"]["core"] == "gb"
    assert by_name["Zelda"]["label"] == "Game Boy Color" and by_name["Zelda"]["core"] == "gba"
    assert by_name["Metroid"]["label"] == "Game Boy Advance" and by_name["Metroid"]["core"] == "gba"
    assert by_name["Metroid"]["id"] == "sub/Metroid.gba"
    assert by_name["Tetris"]["size"] == len(b"GBROM-tetris")


def test_list_items_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "games_rom_dir", "")
    assert library.list_items(GAMES, settings) == []
    monkeypatch.setattr(settings, "games_rom_dir", "/nope/does/not/exist")
    assert library.list_items(GAMES, settings) == []


def test_safe_path_valid(rom_dir):
    assert library.safe_path(GAMES, settings, "Tetris.gb") == os.path.realpath(
        rom_dir / "Tetris.gb"
    )
    assert library.safe_path(GAMES, settings, "sub/Metroid.gba") == os.path.realpath(
        rom_dir / "sub" / "Metroid.gba"
    )


def test_safe_path_blocks_traversal(rom_dir):
    assert library.safe_path(GAMES, settings, "../../etc/passwd") is None
    assert library.safe_path(GAMES, settings, "/etc/passwd") is None
    assert library.safe_path(GAMES, settings, "sub/../../escape.gb") is None


def test_safe_path_rejects_unknown_ext_and_missing(rom_dir):
    assert library.safe_path(GAMES, settings, "notes.txt") is None  # not a game ext
    assert library.safe_path(GAMES, settings, "Missing.gb") is None  # no such file
    assert library.safe_path(GAMES, settings, "") is None


def test_sections_summary(rom_dir):
    summary = {s["key"]: s for s in library.sections_summary(settings)}
    assert summary["games"]["configured"] is True
    assert summary["games"]["count"] == 3
    assert summary["games"]["kind"] == "play"


def test_sections_summary_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "games_rom_dir", "")
    summary = {s["key"]: s for s in library.sections_summary(settings)}
    assert summary["games"]["configured"] is False
    assert summary["games"]["count"] == 0
    assert summary["games"]["preview"] == []  # nothing to peek at


def test_sections_summary_preview_refs(rom_dir):
    """The hub gets a few cover refs per section (the item ids), capped."""
    games = {s["key"]: s for s in library.sections_summary(settings)}["games"]
    assert 0 < len(games["preview"]) <= 6
    ids = {it["id"] for it in library.list_items(GAMES, settings)}
    assert all(ref in ids for ref in games["preview"])


def test_sections_summary_audiobooks_count_and_preview_are_folders(audiobooks_dir):
    """An audiobook's unit is the book *folder*, not each chapter file — so the
    count and the preview refs are the distinct folders (which the cover endpoint
    keys on), not the mp3s."""
    # Add a second book so we can tell folders from chapters.
    second = audiobooks_dir / "Aldous Huxley - Brave New World"
    second.mkdir(parents=True)
    for n in (1, 2):
        (second / f"Chapter {n}.mp3").write_bytes(b"ID3audio")

    summary = {s["key"]: s for s in library.sections_summary(settings)}["audiobooks"]
    assert summary["count"] == 2  # two books, not five mp3s
    assert set(summary["preview"]) == {
        "George Orwell - Animal Farm",
        "Aldous Huxley - Brave New World",
    }


def test_audiobook_folders_use_chapter_parent_dir():
    """A book is the folder that directly holds its chapters (a chapter's parent
    dir), so a book nested under a collection/author folder is keyed by its real
    folder — what the cover endpoint resolves — not the top segment."""
    items = [
        {"id": "Dune/01.mp3"},
        {"id": "Dune/02.mp3"},
        {"id": "SciFi Collection/Hyperion/01.mp3"},  # nested under a collection
        {"id": "SciFi Collection/Hyperion/02.mp3"},
        {"id": "loose.mp3"},  # no folder → skipped
    ]
    assert library._audiobook_folders(items) == ["Dune", "SciFi Collection/Hyperion"]


# --- HTTP layer ------------------------------------------------------------

def test_get_library_lists_sections(client, rom_dir):
    r = client.get("/api/library")
    assert r.status_code == 200
    games = {s["key"]: s for s in r.json()["sections"]}["games"]
    assert games["configured"] is True and games["count"] == 3


def test_get_section_items(client, rom_dir):
    r = client.get("/api/library/games")
    assert r.status_code == 200
    body = r.json()
    assert body["configured"] is True and body["count"] == 3
    assert {it["name"] for it in body["items"]} == {"Tetris", "Zelda", "Metroid"}


def test_get_section_unknown_404(client, rom_dir):
    assert client.get("/api/library/nope").status_code == 404


def test_file_streams_bytes(client, rom_dir):
    r = client.get("/api/library/file", params={"section": "games", "id": "Tetris.gb"})
    assert r.status_code == 200
    assert r.content == b"GBROM-tetris"


def test_file_supports_range(client, rom_dir):
    r = client.get(
        "/api/library/file",
        params={"section": "games", "id": "Tetris.gb"},
        headers={"Range": "bytes=0-3"},
    )
    assert r.status_code == 206
    assert r.content == b"GBRO"
    assert r.headers["content-range"] == f"bytes 0-3/{len(b'GBROM-tetris')}"


def test_file_head_allowed(client, rom_dir):
    # EmulatorJS sends a HEAD before the GET; it must be allowed (was 405) or the
    # download stalls at "Download Game Data".
    r = client.head("/api/library/file", params={"section": "games", "id": "Tetris.gb"})
    assert r.status_code == 200
    assert r.headers["content-length"] == str(len(b"GBROM-tetris"))


def test_file_blocks_traversal(client, rom_dir):
    r = client.get(
        "/api/library/file", params={"section": "games", "id": "../../etc/passwd"}
    )
    assert r.status_code == 404


def test_file_unknown_section_404(client, rom_dir):
    r = client.get("/api/library/file", params={"section": "nope", "id": "x.gb"})
    assert r.status_code == 404


# --- title cleanup + sort --------------------------------------------------

def test_clean_title():
    assert library.clean_title("Metroid Fusion (USA)") == "Metroid Fusion"
    assert library.clean_title("Golden Sun (USA, Europe)") == "Golden Sun"
    assert (
        library.clean_title("Legend of Zelda, The - The Minish Cap (USA)")
        == "The Legend of Zelda: The Minish Cap"
    )
    assert library.clean_title("Pokemon - Emerald Version (USA, Europe)") == "Pokemon: Emerald Version"
    # all-tags name falls back to the raw stem
    assert library.clean_title("(USA)") == "(USA)"
    # mid-string tags collapse the leftover double space
    assert library.clean_title("Game (1.0) X (Hack)") == "Game X"


def test_sort_key_ignores_leading_article():
    assert library.sort_key("The Legend of Zelda") == "legend of zelda"
    assert library.sort_key("A Boy and His Blob") == "boy and his blob"
    assert library.sort_key("Metroid") == "metroid"


def test_list_items_uses_clean_titles(rom_dir):
    (rom_dir / "Kirby's Dream Land 2 (USA, Europe).gb").write_bytes(b"x")
    names = {it["name"] for it in library.list_items(GAMES, settings)}
    assert "Kirby's Dream Land 2" in names  # tag stripped from the new file
    assert "Tetris" in names  # fixture file, unchanged


# --- box art (thumbnail url + cover proxy) ---------------------------------

def test_thumbnail_url_per_system_and_sanitization():
    gba = library.thumbnail_url("Metroid Fusion (USA).gba")
    assert "Nintendo_-_Game_Boy_Advance" in gba and gba.endswith("Metroid%20Fusion%20%28USA%29.png")
    assert "Nintendo_-_Game_Boy_Color" in library.thumbnail_url("Zelda.gbc")
    assert "Nintendo_-_Game_Boy/" in library.thumbnail_url("Tetris.gb")
    # libretro replaces illegal chars (e.g. ':') with '_' before url-encoding
    assert "A_B" in library.thumbnail_url("A:B.gba")
    # unknown extension → no art URL
    assert library.thumbnail_url("song.mp3") is None


def test_classic_console_formats():
    """The added 8/16-bit systems map each extension to its EmulatorJS core +
    display label (the frontend groups the list by label and boots `core`)."""
    fmt = GAMES["formats"]
    cases = {
        ".nes": ("NES", "nes"),
        ".sfc": ("Super Nintendo", "snes"),
        ".smc": ("Super Nintendo", "snes"),
        ".md": ("Sega Genesis", "segaMD"),
        ".gen": ("Sega Genesis", "segaMD"),
        ".smd": ("Sega Genesis", "segaMD"),
        ".sms": ("Sega Master System", "segaMS"),
        ".gg": ("Sega Game Gear", "segaGG"),
    }
    for ext, (label, core) in cases.items():
        assert fmt[ext] == {"label": label, "core": core}, ext
    # .bin stays unrecognized — it's ambiguous across Genesis/Atari/PS1, and the
    # scan maps one extension to exactly one system.
    assert ".bin" not in fmt


def test_classic_console_box_art_repos():
    """Each new extension resolves to its libretro-thumbnails system repo."""
    assert "Nintendo_-_Nintendo_Entertainment_System/" in library.thumbnail_url("Contra.nes")
    assert "Nintendo_-_Super_Nintendo_Entertainment_System/" in library.thumbnail_url("Mario.sfc")
    assert "Nintendo_-_Super_Nintendo_Entertainment_System/" in library.thumbnail_url("Mario.smc")
    assert "Sega_-_Mega_Drive_-_Genesis/" in library.thumbnail_url("Sonic.md")
    assert "Sega_-_Master_System_-_Mark_III/" in library.thumbnail_url("Wonder Boy.sms")
    assert "Sega_-_Game_Gear/" in library.thumbnail_url("Sonic.gg")


def test_base_title_strips_tags_and_alt():
    assert library.base_title("Golden Axe (USA, Europe, Brazil) (En)") == "golden axe"
    assert library.base_title("Sonic The Hedgehog 2 (Europe, Brazil)") == "sonic the hedgehog 2"
    # No-Intro '~' alternate title → keep the primary name
    assert library.base_title("Aztec Adventure ~ Nazca '88 (World)") == "aztec adventure"
    assert library.base_title("Phantasy Star [T-En by X]") == "phantasy star"


def test_pick_boxart_base_match_and_region_pref():
    names = [
        "Golden Axe (USA, Europe, Brazil) (En)",
        "Golden Axe Warrior (USA, Europe, Brazil) (En)",  # different base — must not match
        "Phantasy Star (Brazil)",
        "Phantasy Star (Japan)",
        "Phantasy Star (USA, Europe)",
    ]
    # tag mismatch on the same base resolves to the libretro variant
    assert library.pick_boxart("Golden Axe (USA, Europe, Brazil)", names) == "Golden Axe (USA, Europe, Brazil) (En)"
    # 'Golden Axe' must NOT grab 'Golden Axe Warrior'
    assert library.pick_boxart("Golden Axe (World)", names) != "Golden Axe Warrior (USA, Europe, Brazil) (En)"
    # region preference: USA/Europe variant beats Brazil/Japan
    assert library.pick_boxart("Phantasy Star (World) (Sega Ages)", names) == "Phantasy Star (USA, Europe)"
    # no base match at all → None (caller falls back to a placeholder)
    assert library.pick_boxart("Some Unlisted Game (USA)", names) is None


def test_boxart_url_and_repo_helpers():
    assert library.thumbnail_repo("Sonic.md") == "Sega_-_Mega_Drive_-_Genesis"
    assert library.thumbnail_repo("song.mp3") is None
    url = library.boxart_url("Sega_-_Game_Gear", "Sonic (USA)")
    assert "/Sega_-_Game_Gear/master/Named_Boxarts/" in url and url.endswith("Sonic%20%28USA%29.png")


def test_cover_fuzzy_fallback_on_exact_miss(client, rom_dir, tmp_path, monkeypatch):
    """When the exact No-Intro name 404s, the cover endpoint matches by base title
    against the system's libretro listing and serves the chosen variant."""
    monkeypatch.setattr(settings, "covers_dir", str(tmp_path / "covers"))
    (rom_dir / "Golden Axe (USA, Europe, Brazil).sms").write_bytes(b"SMSROM")
    tree = {"tree": [
        {"path": "Named_Boxarts/Golden Axe (USA, Europe, Brazil) (En).png"},
        {"path": "Named_Boxarts/Some Other Game (USA).png"},
        {"path": "Named_Titles/Golden Axe (USA, Europe, Brazil) (En).png"},  # wrong kind — ignored
    ]}
    calls = []

    class Resp:
        def __init__(self, status, content=b"", payload=None):
            self.status_code, self.content, self._payload = status, content, payload

        def json(self):
            return self._payload

    def fake_get(url, timeout=0, headers=None):
        calls.append(url)
        if "api.github.com" in url:
            return Resp(200, payload=tree)
        if "Golden%20Axe%20%28USA%2C%20Europe%2C%20Brazil%29%20%28En%29" in url:
            return Resp(200, content=b"\x89PNG-art")  # the fuzzy-matched variant
        return Resp(404)  # the exact-name match misses

    monkeypatch.setattr("app.routers.library.requests.get", fake_get)
    r = client.get("/api/library/games/cover", params={"id": "Golden Axe (USA, Europe, Brazil).sms"})
    assert r.status_code == 200 and r.content == b"\x89PNG-art"
    assert any("api.github.com" in u for u in calls)  # the index was fetched
    # Second request is served from the cache — no exact fetch, no re-fuzzy.
    before = len(calls)
    r2 = client.get("/api/library/games/cover", params={"id": "Golden Axe (USA, Europe, Brazil).sms"})
    assert r2.status_code == 200 and len(calls) == before


def test_cover_unknown_ext_404(client, rom_dir):
    assert client.get("/api/library/games/cover", params={"id": "song.mp3"}).status_code == 404


def test_cover_served_from_cache(client, rom_dir, tmp_path, monkeypatch):
    covers = tmp_path / "covers"
    covers.mkdir()
    monkeypatch.setattr(settings, "covers_dir", str(covers))
    # Pre-seed the cache exactly where the endpoint will look.
    import hashlib

    url = library.thumbnail_url("Metroid Fusion (USA).gba")
    key = hashlib.sha1(url.encode()).hexdigest()
    (covers / f"{key}.png").write_bytes(b"\x89PNG-cached")
    r = client.get("/api/library/games/cover", params={"id": "Metroid Fusion (USA).gba"})
    assert r.status_code == 200 and r.content == b"\x89PNG-cached"


def test_cover_fetches_then_caches(client, rom_dir, tmp_path, monkeypatch):
    covers = tmp_path / "covers"
    monkeypatch.setattr(settings, "covers_dir", str(covers))

    class FakeResp:
        status_code = 200
        content = b"\x89PNG-fetched"

    calls = []

    def fake_get(url, timeout=0):
        calls.append(url)
        return FakeResp()

    monkeypatch.setattr("app.routers.library.requests.get", fake_get)
    r = client.get("/api/library/games/cover", params={"id": "Golden Sun (USA, Europe).gba"})
    assert r.status_code == 200 and r.content == b"\x89PNG-fetched"
    assert len(calls) == 1
    # Second request is served from cache — no second fetch.
    r2 = client.get("/api/library/games/cover", params={"id": "Golden Sun (USA, Europe).gba"})
    assert r2.status_code == 200 and len(calls) == 1


def test_save_state_roundtrip_list_serve_delete(client, tmp_path, monkeypatch):
    saves = tmp_path / "saves"
    monkeypatch.setattr(settings, "games_saves_dir", str(saves))
    gid = "Pokemon - Emerald Version (USA, Europe).gba"

    # Upload a state + screenshot (multipart, as the emulator does).
    r = client.post(
        "/api/library/games/save-states",
        data={"id": gid},
        files={
            "state": ("s.state", b"SAVE-STATE-BYTES", "application/octet-stream"),
            "screenshot": ("s.png", b"\x89PNG-shot", "image/png"),
        },
    )
    assert r.status_code == 200
    slot = r.json()["slot"]
    assert slot.isdigit()

    # It shows up in the list, newest first, with a screenshot flag.
    lst = client.get("/api/library/games/save-states", params={"id": gid}).json()["states"]
    assert len(lst) == 1 and lst[0]["slot"] == slot and lst[0]["has_shot"] is True

    # The blob is served (this is what EJS_loadStateURL fetches) + the screenshot.
    blob = client.get("/api/library/games/save-state", params={"id": gid, "slot": slot})
    assert blob.status_code == 200 and blob.content == b"SAVE-STATE-BYTES"
    shot = client.get(
        "/api/library/games/save-state/screenshot", params={"id": gid, "slot": slot}
    )
    assert shot.status_code == 200 and shot.content == b"\x89PNG-shot"

    # Delete removes it.
    assert client.request(
        "DELETE", "/api/library/games/save-states", params={"id": gid, "slot": slot}
    ).status_code == 204
    assert client.get("/api/library/games/save-states", params={"id": gid}).json()["states"] == []


def test_save_state_without_screenshot(client, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "games_saves_dir", str(tmp_path / "saves"))
    r = client.post(
        "/api/library/games/save-states",
        data={"id": "Tetris.gb"},
        files={"state": ("s.state", b"X", "application/octet-stream")},
    )
    assert r.status_code == 200
    lst = client.get("/api/library/games/save-states", params={"id": "Tetris.gb"}).json()["states"]
    assert lst[0]["has_shot"] is False


def test_save_state_bad_slot_is_404(client, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "games_saves_dir", str(tmp_path / "saves"))
    # Non-numeric slot can't resolve to a path (traversal guard) → 404.
    r = client.get(
        "/api/library/games/save-state", params={"id": "Tetris.gb", "slot": "../../etc/passwd"}
    )
    assert r.status_code == 404


def test_save_state_files_rejects_nonnumeric_slot():
    assert library.save_state_files("/saves", "g.gb", "12ab") == (None, None)
    assert library.save_state_files("/saves", "g.gb", "../x") == (None, None)
    sp, shot = library.save_state_files("/saves", "g.gb", "1700000000000")
    assert sp and sp.endswith("/1700000000000.state") and shot.endswith("/1700000000000.png")


def test_cover_no_match_remembers_miss(client, rom_dir, tmp_path, monkeypatch):
    covers = tmp_path / "covers"
    monkeypatch.setattr(settings, "covers_dir", str(covers))

    # The listing IS reachable (200) but doesn't contain this ROM hack → a genuine,
    # cacheable no-match. The exact-name boxart fetch 404s.
    tree = {"tree": [{"path": "Named_Boxarts/Some Unrelated Game (USA).png"}]}

    class FakeResp:
        def __init__(self, status, payload=None):
            self.status_code, self.content, self._payload = status, b"", payload

        def json(self):
            return self._payload

    calls = []

    def fake_get(url, timeout=0, headers=None):
        calls.append(url)
        return FakeResp(200, tree) if "api.github.com" in url else FakeResp(404)

    monkeypatch.setattr("app.routers.library.requests.get", fake_get)
    p = {"id": "Pokemon Ultra Violet (1.22) LSA (Fire Red Hack).gba"}
    assert client.get("/api/library/games/cover", params=p).status_code == 404
    # First request: exact-name fetch misses, then the base-title fallback consults
    # the (reachable) listing, finds no match → a definitive miss is remembered.
    after_first = len(calls)
    assert after_first >= 1
    assert client.get("/api/library/games/cover", params=p).status_code == 404
    assert len(calls) == after_first  # miss remembered; nothing refetched


def test_cover_transient_index_failure_does_not_cache_miss(client, rom_dir, tmp_path, monkeypatch):
    """If the libretro listing can't be fetched (network/rate-limit), the cover is a
    404 but NOT cached as a miss — so it recovers once the listing is reachable
    again, instead of being pinned to a placeholder forever."""
    monkeypatch.setattr(settings, "covers_dir", str(tmp_path / "covers"))
    (rom_dir / "Sonic The Hedgehog (USA, Europe, Brazil).sms").write_bytes(b"SMSROM")

    class FakeResp:
        def __init__(self, status):
            self.status_code, self.content = status, b""

        def json(self):
            return {}

    def fail_get(url, timeout=0, headers=None):
        # exact boxart 404s (real miss); the index API is rate-limited (403)
        return FakeResp(403 if "api.github.com" in url else 404)

    monkeypatch.setattr("app.routers.library.requests.get", fail_get)
    p = {"id": "Sonic The Hedgehog (USA, Europe, Brazil).sms"}
    assert client.get("/api/library/games/cover", params=p).status_code == 404
    # No .miss sentinel was written — the transient failure stays retryable.
    misses = list((tmp_path / "covers").glob("*.miss")) if (tmp_path / "covers").is_dir() else []
    assert misses == []


# --- book cover proxy -----------------------------------------------------

def _epub_with_png_cover(path):
    """An EPUB carrying a real (tiny) PNG cover, so the proxy can thumbnail it."""
    import io
    import zipfile

    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (600, 900), (20, 40, 80)).save(buf, format="PNG")
    with zipfile.ZipFile(path, "w") as z:
        z.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0"?>'
            '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
            '<rootfiles><rootfile full-path="content.opf"/></rootfiles></container>',
        )
        z.writestr(
            "content.opf",
            '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf">'
            '<metadata><meta name="cover" content="cov"/></metadata>'
            '<manifest><item id="cov" href="cover.png" media-type="image/png"/></manifest>'
            "</package>",
        )
        z.writestr("cover.png", buf.getvalue())


@pytest.fixture
def book_covers_dir(tmp_path, monkeypatch):
    d = tmp_path / "book-covers"
    monkeypatch.setattr(settings, "book_covers_dir", str(d))
    return d


def test_book_cover_extracts_caches_and_serves(client, books_dir, book_covers_dir):
    _epub_with_png_cover(books_dir / "Withcover.epub")
    r = client.get("/api/library/books/cover", params={"id": "Withcover.epub"})
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/webp"
    # The WebP is cached on disk; a second request serves the cached file.
    assert list(book_covers_dir.glob("*.webp"))
    assert client.get("/api/library/books/cover", params={"id": "Withcover.epub"}).status_code == 200


def test_book_cover_missing_is_remembered_as_404(client, books_dir, book_covers_dir):
    # Dune.epub (from the books_dir fixture) is just bytes with no real cover.
    assert client.get("/api/library/books/cover", params={"id": "Dune.epub"}).status_code == 404
    assert list(book_covers_dir.glob("*.miss"))  # the miss is cached, not refetched


def test_book_cover_rejects_unknown_and_traversal(client, books_dir, book_covers_dir):
    assert client.get("/api/library/books/cover", params={"id": "nope.epub"}).status_code == 404
    assert client.get(
        "/api/library/books/cover", params={"id": "../etc/passwd"}
    ).status_code == 404


# --- comics (CBZ/CBR/CB7 page reader) -------------------------------------

COMICS = library.get_section("comics")


def _make_cbz_with_pages(path, n=3):
    """A CBZ holding n real (tiny) PNG pages, so the page proxy can downscale."""
    import io
    import zipfile

    from PIL import Image

    with zipfile.ZipFile(path, "w") as z:
        for i in range(n):
            buf = io.BytesIO()
            Image.new("RGB", (800, 1200), (10 * i, 20, 30)).save(buf, format="PNG")
            z.writestr(f"{i + 1:03d}.png", buf.getvalue())


@pytest.fixture
def comics_dir(tmp_path, monkeypatch):
    d = tmp_path / "comics"
    d.mkdir()
    _make_cbz_with_pages(d / "Star Wars 01.cbz", n=3)
    (d / "notacomic.txt").write_bytes(b"ignored")
    monkeypatch.setattr(settings, "comics_dir", str(d))
    monkeypatch.setattr(settings, "comic_pages_dir", str(tmp_path / "comic-pages"))
    return d


def test_comics_section_lists_with_reader_hint(comics_dir):
    items = library.list_items(COMICS, settings)
    assert len(items) == 1
    assert items[0]["name"] == "Star Wars 01"
    assert items[0]["reader"] == "comic"
    assert items[0]["label"] == "Comic"


def test_comic_info_returns_page_count(client, comics_dir):
    r = client.get("/api/library/comics/info", params={"id": "Star Wars 01.cbz"})
    assert r.status_code == 200
    assert r.json() == {"pages": 3}


def test_comic_page_extracts_caches_and_serves(client, comics_dir):
    r = client.get("/api/library/comics/page", params={"id": "Star Wars 01.cbz", "n": 1})
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/webp"
    # Second request serves the cached page (the p1.webp file now exists).
    assert (settings.comic_pages_dir is not None)
    assert client.get(
        "/api/library/comics/page", params={"id": "Star Wars 01.cbz", "n": 1}
    ).status_code == 200


def test_comic_cover_is_first_page(client, comics_dir):
    r = client.get("/api/library/comics/cover", params={"id": "Star Wars 01.cbz"})
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/webp"


def test_comic_page_out_of_range_404(client, comics_dir):
    assert client.get(
        "/api/library/comics/page", params={"id": "Star Wars 01.cbz", "n": 99}
    ).status_code == 404


def test_comic_endpoints_reject_traversal_and_unknown(client, comics_dir):
    assert client.get(
        "/api/library/comics/info", params={"id": "../etc/passwd"}
    ).status_code == 404
    assert client.get(
        "/api/library/comics/page", params={"id": "nope.cbz", "n": 0}
    ).status_code == 404


# --- pinned folders -------------------------------------------------------

def test_pin_db_add_list_remove():
    db.add_pin("comics", "Star Wars/04. Rebellion era", now_ms=100)
    db.add_pin("comics", "Saga", now_ms=200)
    db.add_pin("comics", "Saga", now_ms=300)  # idempotent — no duplicate
    paths = [p["path"] for p in db.list_pins("comics")]
    assert paths == ["Saga", "Star Wars/04. Rebellion era"]  # newest first
    assert db.list_pins("books") == []  # section filter
    assert db.remove_pin("comics", "Saga") is True
    assert db.remove_pin("comics", "Saga") is False  # already gone
    assert [p["path"] for p in db.list_pins()] == ["Star Wars/04. Rebellion era"]


@pytest.fixture
def comics_with_folder(tmp_path, monkeypatch):
    d = tmp_path / "comics"
    (d / "Star Wars" / "Rebellion").mkdir(parents=True)
    _make_cbz_with_pages(d / "Star Wars" / "Rebellion" / "issue 1.cbz", n=1)
    monkeypatch.setattr(settings, "comics_dir", str(d))
    return d


def test_pin_endpoints_validate_folder(client, comics_with_folder):
    # Pin a real folder → ok, shows up in the list.
    r = client.post("/api/library/pins", json={"section": "comics", "path": "Star Wars/Rebellion"})
    assert r.status_code == 200
    pins = client.get("/api/library/pins", params={"section": "comics"}).json()["pins"]
    assert [p["path"] for p in pins] == ["Star Wars/Rebellion"]
    # A path with no items under it is rejected (no dead pins).
    assert client.post(
        "/api/library/pins", json={"section": "comics", "path": "Star Wars/Nope"}
    ).status_code == 404
    # Unpin.
    assert client.delete(
        "/api/library/pins", params={"section": "comics", "path": "Star Wars/Rebellion"}
    ).status_code == 204
    assert client.get("/api/library/pins").json()["pins"] == []


# --- audiobooks -----------------------------------------------------------

AUDIOBOOKS = library.get_section("audiobooks")


@pytest.fixture
def audiobooks_dir(tmp_path, monkeypatch):
    d = tmp_path / "audiobooks"
    book = d / "George Orwell - Animal Farm"
    book.mkdir(parents=True)
    for n in (1, 2, 3):
        (book / f"Animal Farm (Disc {n} of 3).mp3").write_bytes(b"ID3audio")
    (book / "cover.jpg").write_bytes(b"img")  # not an audio format → ignored
    monkeypatch.setattr(settings, "audiobooks_dir", str(d))
    return d


def test_audiobooks_section_lists_chapters(audiobooks_dir):
    items = library.list_items(AUDIOBOOKS, settings)
    assert len(items) == 3  # the 3 mp3s; the .jpg is ignored
    assert all(it["id"].startswith("George Orwell - Animal Farm/") for it in items)
    assert all(it["id"].endswith(".mp3") for it in items)


def test_listen_progress_db_roundtrip():
    db.set_listen_progress("Book A", "Book A/ch2.mp3", 123.5, now_ms=100)
    db.set_listen_progress("Book A", "Book A/ch2.mp3", 200.0, now_ms=200)  # upsert
    row = db.get_listen_progress("Book A")
    assert row["chapter_id"] == "Book A/ch2.mp3" and row["position_s"] == 200.0
    assert db.get_listen_progress("nope") is None
    assert [r["book_id"] for r in db.list_listen_progress()] == ["Book A"]
    assert db.delete_listen_progress("Book A") is True
    assert db.delete_listen_progress("Book A") is False


def test_listen_progress_endpoints(client, audiobooks_dir):
    book = "George Orwell - Animal Farm"
    chapter = f"{book}/Animal Farm (Disc 2 of 3).mp3"
    assert client.put(
        "/api/library/listen-progress",
        json={"book_id": book, "chapter_id": chapter, "position_s": 42.0},
    ).status_code == 200
    got = client.get("/api/library/listen-progress", params={"book": book}).json()
    assert got["chapter_id"] == chapter and got["position_s"] == 42.0
    assert client.put(
        "/api/library/listen-progress",
        json={"book_id": book, "chapter_id": f"{book}/nope.mp3", "position_s": 1.0},
    ).status_code == 404
    cont = client.get("/api/library/continue").json()["items"]
    listen = [e for e in cont if e["kind"] == "listen"]
    assert listen and listen[0]["id"] == book and listen[0]["name"] == book
    assert client.delete("/api/library/listen-progress", params={"book": book}).status_code == 204
    assert client.get("/api/library/listen-progress", params={"book": book}).json()["chapter_id"] is None


def test_audio_served_with_audio_mime(client, audiobooks_dir):
    # iOS <audio> needs a real audio MIME, not octet-stream.
    r = client.get(
        "/api/library/file",
        params={"section": "audiobooks", "id": "George Orwell - Animal Farm/Animal Farm (Disc 1 of 3).mp3"},
    )
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("audio/mpeg")


@pytest.fixture
def audiobook_covers_dir(tmp_path, monkeypatch):
    d = tmp_path / "ab-covers"
    monkeypatch.setattr(settings, "audiobook_covers_dir", str(d))
    return d


def test_audiobook_cover_from_folder_image(client, audiobooks_dir, audiobook_covers_dir):
    import io
    from PIL import Image

    book = audiobooks_dir / "George Orwell - Animal Farm"
    buf = io.BytesIO()
    Image.new("RGB", (500, 500), (30, 60, 90)).save(buf, format="JPEG")
    (book / "cover.jpg").write_bytes(buf.getvalue())

    r = client.get("/api/library/audiobooks/cover", params={"path": "George Orwell - Animal Farm"})
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/webp"
    assert list(audiobook_covers_dir.glob("*.webp"))


def test_audiobook_cover_missing_is_404_and_remembered(client, audiobooks_dir, audiobook_covers_dir):
    # The fixture book has only mp3 stubs (no real art) → miss.
    assert client.get(
        "/api/library/audiobooks/cover", params={"path": "George Orwell - Animal Farm"}
    ).status_code == 404
    assert list(audiobook_covers_dir.glob("*.miss"))
    # Traversal / unknown folder → 404.
    assert client.get(
        "/api/library/audiobooks/cover", params={"path": "../etc"}
    ).status_code == 404


# --- PDF covers (magazines/papers + PDF books, rendered first page) ---------

@pytest.fixture
def paper_covers_dir(tmp_path, monkeypatch):
    d = tmp_path / "paper-covers"
    monkeypatch.setattr(settings, "paper_covers_dir", str(d))
    return d


def _write_pdf(path, color=(0.2, 0.3, 0.5)):
    import pymupdf

    doc = pymupdf.open()
    page = doc.new_page(width=300, height=400)
    page.draw_rect(page.rect, color=color, fill=color)
    doc.save(str(path))
    doc.close()


def test_paper_cover_renders_first_page(client, papers_dir, paper_covers_dir):
    """A magazine's first page is rendered + cached as a WebP cover."""
    _write_pdf(papers_dir / "Science News - March 25, 2023.pdf")
    r = client.get(
        "/api/library/papers/cover", params={"id": "Science News - March 25, 2023.pdf"}
    )
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/webp"
    assert list(paper_covers_dir.glob("*.webp"))


def test_paper_cover_unreadable_pdf_is_404_and_remembered(client, papers_dir, paper_covers_dir):
    # The papers_dir fixture's stub files aren't valid PDFs → render fails → miss.
    r = client.get("/api/library/papers/cover", params={"id": "The Atlantic - April 2023.pdf"})
    assert r.status_code == 404
    assert list(paper_covers_dir.glob("*.miss"))
    # Traversal / unknown id → 404.
    assert client.get("/api/library/papers/cover", params={"id": "../etc/passwd"}).status_code == 404


def test_book_pdf_cover_renders_first_page(client, tmp_path, monkeypatch):
    """A PDF book has no embedded cover, so its first page is rendered as one
    (same path the EPUB/MOBI embedded cover takes)."""
    books = tmp_path / "ebooks"
    books.mkdir()
    monkeypatch.setattr(settings, "books_dir", str(books))
    monkeypatch.setattr(settings, "book_covers_dir", str(tmp_path / "book-covers"))
    _write_pdf(books / "Networking.pdf")
    r = client.get("/api/library/books/cover", params={"id": "Networking.pdf"})
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/webp"


# --- game cover override + libretro pointer --------------------------------

def test_sidecar_cover_beside_rom(rom_dir):
    from app.routers import library as libr

    assert libr._sidecar_cover(str(rom_dir / "Tetris.gb")) is None  # none yet
    (rom_dir / "Tetris.png").write_bytes(b"img")
    assert libr._sidecar_cover(str(rom_dir / "Tetris.gb")) == str(rom_dir / "Tetris.png")


def test_game_cover_uses_sidecar_override(client, rom_dir, monkeypatch):
    import io
    from PIL import Image
    from app.routers import library as libr

    monkeypatch.setattr(settings, "covers_dir", str(rom_dir / "_covers"))
    buf = io.BytesIO()
    Image.new("RGB", (300, 400), (90, 20, 20)).save(buf, format="PNG")
    (rom_dir / "Zelda.png").write_bytes(buf.getvalue())  # custom cover beside the ROM

    # Even though Zelda.gbc would match libretro, the sidecar wins — and no network.
    def _boom(*a, **k):
        raise AssertionError("should not hit the network when a sidecar exists")

    monkeypatch.setattr(libr.requests, "get", _boom)
    r = client.get("/api/library/games/cover", params={"id": "Zelda.gbc"})
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/webp"


def test_follow_libretro_pointer(monkeypatch):
    from app.routers import library as libr

    class Resp:
        def __init__(self, content, status=200):
            self.content = content
            self.status_code = status

    real_png = b"\x89PNG\r\n\x1a\n" + b"x" * 500
    # A pointer response (short text naming the canonical png) → follows it.
    monkeypatch.setattr(libr.requests, "get", lambda *a, **k: Resp(real_png))
    ptr = Resp(b"Pokemon - Crystal Version (USA).png")
    out = libr._follow_libretro_pointer(ptr, "https://host/dir/Pokemon (Rev 1).png")
    assert out.content == real_png
    # A real image response is returned unchanged (not treated as a pointer).
    img = Resp(real_png)
    assert libr._follow_libretro_pointer(img, "https://host/dir/x.png") is img
