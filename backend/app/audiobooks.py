"""
Audiobook cover art — find a book's cover so the Library can show it (the cover
proxy downscales the result to a small WebP, like the game/book/comic covers).

A book is a folder of chapter files. Its cover comes from, in order:
  1. an image file in the folder (cover.jpg / folder.jpg / front.* / any image), or
  2. the embedded art in the first chapter (ID3 APIC for MP3, MP4 `covr` for
     m4a/m4b, FLAC pictures) via mutagen.

Everything is defensive: no readable cover yields None, never raises.
"""

from __future__ import annotations

import os

_IMG_EXTS = (".jpg", ".jpeg", ".png", ".webp")
_AUDIO_EXTS = (".mp3", ".m4a", ".m4b", ".aac", ".ogg", ".opus", ".flac", ".wav")
_PREFERRED = ("cover", "folder", "front")  # preferred image basenames


def _image_rank(filename):
    name = os.path.splitext(filename)[0].lower()
    if name in _PREFERRED:
        return 0
    if "cover" in name or "front" in name:
        return 1
    return 2


def find_cover(book_dir):
    """The cover image bytes for a book folder, or None. Looks at the folder's
    own files only (not subfolders) — a collection folder with no audio/image
    therefore returns None, which is correct (it isn't a book)."""
    try:
        entries = os.listdir(book_dir)
    except OSError:
        return None

    images = sorted(
        (f for f in entries if f.lower().endswith(_IMG_EXTS)),
        key=lambda f: (_image_rank(f), f.lower()),
    )
    for img in images:
        try:
            with open(os.path.join(book_dir, img), "rb") as fh:
                return fh.read()
        except OSError:
            continue

    # No image file — try the first chapter's embedded art.
    audio = sorted(f for f in entries if f.lower().endswith(_AUDIO_EXTS))
    if audio:
        return embedded_art(os.path.join(book_dir, audio[0]))
    return None


def embedded_art(path):
    """Embedded cover art bytes from one audio file, or None — handles ID3 APIC
    (MP3), MP4 `covr` (m4a/m4b), and FLAC/other pictures."""
    try:
        from mutagen import File

        af = File(path)
    except Exception:
        return None
    if af is None:
        return None
    tags = getattr(af, "tags", None)
    if tags is not None:
        try:  # ID3 APIC frames are keyed 'APIC:...'
            for key in tags.keys():
                if key.startswith("APIC"):
                    return tags[key].data
        except Exception:
            pass
        try:  # MP4 cover atom
            covr = tags.get("covr")
            if covr:
                return bytes(covr[0])
        except Exception:
            pass
    try:  # FLAC and other formats expose .pictures
        pics = getattr(af, "pictures", None)
        if pics:
            return pics[0].data
    except Exception:
        pass
    return None
