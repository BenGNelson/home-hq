"""Tests for audiobook cover discovery (audiobooks.find_cover) — the folder-image
path (deterministic) and the no-cover case. Embedded-art extraction (mutagen) is
verified against real files, not constructed here."""

from app import audiobooks


def test_find_cover_prefers_named_cover(tmp_path):
    (tmp_path / "art.jpg").write_bytes(b"\xff\xd8\xffOTHER")
    (tmp_path / "cover.jpg").write_bytes(b"\xff\xd8\xffCOVER")
    (tmp_path / "01 chapter.mp3").write_bytes(b"audio")
    assert audiobooks.find_cover(str(tmp_path)) == b"\xff\xd8\xffCOVER"


def test_find_cover_uses_any_image_when_no_named_one(tmp_path):
    (tmp_path / "Pygmy.png").write_bytes(b"\x89PNGdata")
    assert audiobooks.find_cover(str(tmp_path)) == b"\x89PNGdata"


def test_find_cover_none_without_image_or_audio(tmp_path):
    # A collection folder (only subfolders / no audio + no image) → no cover.
    (tmp_path / "notes.txt").write_bytes(b"x")
    assert audiobooks.find_cover(str(tmp_path)) is None


def test_find_cover_missing_dir_is_defensive():
    assert audiobooks.find_cover("/no/such/dir") is None
