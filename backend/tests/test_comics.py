"""Tests for comic archive reading (comics.py). CBZ (a plain zip) exercises the
same libarchive read path as CBR/CB7 — the format-specific decoders (rar/7z) are
verified against real files, not constructed in-process. Covers natural page
ordering, junk filtering, index extraction, and defensive failure."""

import zipfile

from app import comics


def _make_cbz(path, entries):
    """A CBZ (zip) with the given {name: bytes} entries."""
    with zipfile.ZipFile(path, "w") as z:
        for name, data in entries.items():
            z.writestr(name, data)


def test_natural_key_orders_numbers_numerically():
    names = ["p10.jpg", "p2.jpg", "p1.jpg"]
    assert sorted(names, key=comics._natural_key) == ["p1.jpg", "p2.jpg", "p10.jpg"]


def test_list_pages_natural_order_and_filtering(tmp_path):
    p = tmp_path / "comic.cbz"
    _make_cbz(
        p,
        {
            "page10.jpg": b"10",
            "page2.jpg": b"2",
            "page1.jpg": b"1",
            "cover.png": b"c",  # an image, sorts before pageN by name
            "notes.txt": b"x",  # non-image — ignored
            "__MACOSX/._page1.jpg": b"junk",  # archiver junk — ignored
            "Thumbs.db": b"db",  # ignored
            ".hidden.jpg": b"h",  # hidden sidecar — ignored
        },
    )
    # cover.png, page1, page2, page10 — natural order, junk dropped.
    assert comics.list_pages(str(p)) == ["cover.png", "page1.jpg", "page2.jpg", "page10.jpg"]
    assert comics.page_count(str(p)) == 4


def test_read_page_by_index_returns_right_bytes(tmp_path):
    p = tmp_path / "comic.cbz"
    _make_cbz(p, {"01.jpg": b"FIRST", "02.jpg": b"SECOND", "03.jpg": b"THIRD"})
    assert comics.read_page_by_index(str(p), 0) == b"FIRST"
    assert comics.read_page_by_index(str(p), 2) == b"THIRD"


def test_read_page_out_of_range_is_none(tmp_path):
    p = tmp_path / "comic.cbz"
    _make_cbz(p, {"01.jpg": b"A"})
    assert comics.read_page_by_index(str(p), 5) is None
    assert comics.read_page_by_index(str(p), -1) is None


def test_pages_in_a_subfolder(tmp_path):
    # Some comics nest pages under a folder; the directory entry is skipped and
    # the images still list in order.
    p = tmp_path / "comic.cbz"
    _make_cbz(p, {"Comic/001.jpg": b"a", "Comic/002.jpg": b"b"})
    assert comics.list_pages(str(p)) == ["Comic/001.jpg", "Comic/002.jpg"]
    assert comics.read_page_by_index(str(p), 1) == b"b"


def test_unreadable_archive_is_defensive(tmp_path):
    p = tmp_path / "broken.cbz"
    p.write_bytes(b"this is not an archive")
    assert comics.list_pages(str(p)) == []
    assert comics.page_count(str(p)) == 0
    assert comics.read_page_by_index(str(p), 0) is None
