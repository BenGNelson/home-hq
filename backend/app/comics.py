"""
Comic archive reading — a comic (CBZ/CBR/CB7) is just an archive of page images
(zip / rar / 7z respectively). `libarchive` reads all three formats through one
binding, so this module lists a comic's pages and extracts one page's bytes on
demand; the router downscales + caches each page (app/images.py) so paging is
fast and only comics you open take cache space.

Pages are ordered by a **natural** filename sort (so `page2` precedes `page10`),
not the archive's internal order, which is arbitrary. Everything is defensive: a
corrupt/unsupported archive yields an empty page list or None, never raises — one
bad comic never breaks the section listing.
"""

from __future__ import annotations

import os
import re

import libarchive

# Page image types we recognize inside a comic archive.
_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}


def _natural_key(name):
    """Sort key that orders embedded numbers numerically (so '2' < '10') and is
    case-insensitive — comic pages are usually named 01.jpg, 02.jpg, … but some
    use 1.jpg … 10.jpg, which a plain string sort would mis-order."""
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", name)]


def _is_page(name):
    """True if an archive entry name is a real page image (not a directory entry,
    a hidden/sidecar file, or archiver junk like __MACOSX / Thumbs.db)."""
    if not name or "__MACOSX" in name:
        return False
    base = name.rsplit("/", 1)[-1]
    if not base or base.startswith(".") or base.lower() == "thumbs.db":
        return False
    return os.path.splitext(base)[1].lower() in _IMAGE_EXTS


def list_pages(path):
    """The comic's page image entry names, in natural reading order. [] on any
    archive error (caller treats it as a 0-page / unreadable comic)."""
    names = []
    try:
        with libarchive.file_reader(path) as archive:
            for entry in archive:
                if entry.isdir:
                    continue
                name = entry.pathname or ""
                if _is_page(name):
                    names.append(name)
    except Exception:
        return []
    names.sort(key=_natural_key)
    return names


def page_count(path):
    """How many pages the comic has (0 if unreadable)."""
    return len(list_pages(path))


def read_page_by_index(path, index):
    """The raw image bytes of the page at `index` (0-based, in reading order), or
    None if the index is out of range or the archive can't be read. Two passes:
    one to resolve the index to a name (reading order), one to extract it — both
    cheap relative to the one-time, then-cached, downscale the router does."""
    names = list_pages(path)
    if index < 0 or index >= len(names):
        return None
    target = names[index]
    try:
        with libarchive.file_reader(path) as archive:
            for entry in archive:
                if entry.pathname == target:
                    return b"".join(entry.get_blocks())
    except Exception:
        return None
    return None
