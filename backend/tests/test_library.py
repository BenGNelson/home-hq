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
    shelf = client.get("/api/library/reading-progress").json()["items"]
    assert any(
        i["id"] == pid and i["name"] == "Science News - March 25, 2023" for i in shelf
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
    assert client.get("/api/library/reading-progress").json()["items"] == []


@pytest.fixture
def rom_dir(tmp_path, monkeypatch):
    """A populated ROM dir wired into settings.games_rom_dir."""
    (tmp_path / "Tetris.gb").write_bytes(b"GBROM-tetris")
    (tmp_path / "Zelda.gbc").write_bytes(b"GBC")
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "Metroid.gba").write_bytes(b"GBA-metroid-data")
    (tmp_path / "notes.txt").write_text("not a rom")  # ignored
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


def test_list_items_metadata(rom_dir):
    by_name = {it["name"]: it for it in library.list_items(GAMES, settings)}
    assert by_name["Tetris"]["label"] == "Game Boy"
    assert by_name["Tetris"]["core"] == "gb"
    assert by_name["Zelda"]["label"] == "Game Boy Color" and by_name["Zelda"]["core"] == "gb"
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

    class FakeResp:
        status_code = 404
        content = b""

    calls = []

    def fake_get(url, timeout=0):
        calls.append(url)
        return FakeResp()

    monkeypatch.setattr("app.routers.library.requests.get", fake_get)
    p = {"id": "Pokemon Ultra Violet (1.22) LSA (Fire Red Hack).gba"}
    assert client.get("/api/library/games/cover", params=p).status_code == 404
    assert client.get("/api/library/games/cover", params=p).status_code == 404
    assert len(calls) == 1  # miss remembered; not refetched
