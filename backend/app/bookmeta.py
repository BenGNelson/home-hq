"""
Ebook metadata extraction — pull a book's embedded title + author so the Library
can search by author/title and show consistent names regardless of the filename.

Stdlib only (no extra deps):
  - EPUB is a zip: read META-INF/container.xml → the OPF path → the Dublin Core
    <dc:title>/<dc:creator> (only those entries are read, not the whole book).
  - MOBI / AZW3 are PalmDB files: parse record 0's MOBI + EXTH headers for the
    author (EXTH type 100) and an updated title (EXTH type 503), falling back to
    the MOBI "full name" field.
  - PDF: no embedded metadata extraction here (book PDFs are rare and their info
    dicts are usually empty/garbage) — callers fall back to the cleaned filename.

Everything is defensive: a malformed/unsupported file yields (None, None) rather
than raising, so one bad book never breaks the indexer.
"""

from __future__ import annotations

import struct
import xml.etree.ElementTree as ET
import zipfile

_DC = "{http://purl.org/dc/elements/1.1/}"
_CONTAINER_NS = {"c": "urn:oasis:names:tc:opendocument:xmlns:container"}

# EXTH record types we care about.
_EXTH_AUTHOR = 100
_EXTH_TITLE = 503

# MOBI text-encoding codes → Python codecs.
_MOBI_ENCODINGS = {1252: "cp1252", 65001: "utf-8"}


def _clean(s):
    """Trim + collapse whitespace; return None for an empty/None value."""
    if not s:
        return None
    s = " ".join(s.split())
    return s or None


# --- EPUB -----------------------------------------------------------------

def parse_epub_meta(path):
    """(title, author) from an EPUB's OPF, or (None, None) on any problem."""
    try:
        with zipfile.ZipFile(path) as z:
            opf_path = _epub_opf_path(z)
            if not opf_path:
                return None, None
            root = ET.fromstring(z.read(opf_path))
            title = root.find(f".//{_DC}title")
            creator = root.find(f".//{_DC}creator")
            return (
                _clean(title.text if title is not None else None),
                _clean(creator.text if creator is not None else None),
            )
    except (zipfile.BadZipFile, KeyError, ET.ParseError, OSError, ValueError):
        return None, None


def _epub_opf_path(z):
    """The OPF (package document) path from META-INF/container.xml."""
    root = ET.fromstring(z.read("META-INF/container.xml"))
    rootfile = root.find(".//c:rootfile", _CONTAINER_NS)
    return rootfile.get("full-path") if rootfile is not None else None


# --- MOBI / AZW3 ----------------------------------------------------------

def parse_exth(rec0, mobi_header_len, encoding="utf-8"):
    """Parse the EXTH header that follows the MOBI header in record 0 → a
    {type: text} dict for the record types we read. Pure + defensive: returns {}
    if there's no EXTH block. The EXTH block starts right after the MOBI header
    (offset 16 = end of the 16-byte PalmDOC header, + the MOBI header length)."""
    start = 16 + mobi_header_len
    if rec0[start : start + 4] != b"EXTH":
        return {}
    count = struct.unpack_from(">I", rec0, start + 8)[0]
    pos = start + 12
    out = {}
    for _ in range(count):
        if pos + 8 > len(rec0):
            break
        rtype, rlen = struct.unpack_from(">II", rec0, pos)
        if rlen < 8 or pos + rlen > len(rec0):
            break
        if rtype in (_EXTH_AUTHOR, _EXTH_TITLE) and rtype not in out:
            out[rtype] = rec0[pos + 8 : pos + rlen].decode(encoding, "replace")
        pos += rlen
    return out


def parse_mobi_meta(path):
    """(title, author) from a MOBI/AZW3 file, or (None, None) on any problem."""
    try:
        with open(path, "rb") as f:
            header = f.read(78)
            if len(header) < 78:
                return None, None
            num_records = struct.unpack_from(">H", header, 76)[0]
            if num_records < 1:
                return None, None
            rec_info = f.read(num_records * 8)
            rec0_start = struct.unpack_from(">I", rec_info, 0)[0]
            rec0_end = (
                struct.unpack_from(">I", rec_info, 8)[0] if num_records > 1 else None
            )
            f.seek(rec0_start)
            rec0 = f.read((rec0_end - rec0_start) if rec0_end else 16384)
        return _parse_mobi_record0(rec0)
    except (struct.error, OSError):
        return None, None


def _parse_mobi_record0(rec0):
    """Extract (title, author) from a MOBI record 0 (PalmDOC + MOBI + EXTH)."""
    # MOBI header sits after the 16-byte PalmDOC header; verify its magic.
    if len(rec0) < 24 or rec0[16:20] != b"MOBI":
        return None, None
    mobi_header_len = struct.unpack_from(">I", rec0, 20)[0]
    encoding = _MOBI_ENCODINGS.get(struct.unpack_from(">I", rec0, 16 + 28)[0], "utf-8")
    exth = parse_exth(rec0, mobi_header_len, encoding)

    author = _clean(exth.get(_EXTH_AUTHOR))
    title = _clean(exth.get(_EXTH_TITLE)) or _clean(_mobi_full_name(rec0, encoding))
    return title, author


def _mobi_full_name(rec0, encoding):
    """The MOBI "full name" field (offset/length live in the MOBI header,
    measured from the start of record 0)."""
    try:
        name_off = struct.unpack_from(">I", rec0, 16 + 84)[0]
        name_len = struct.unpack_from(">I", rec0, 16 + 88)[0]
        if name_len <= 0 or name_off + name_len > len(rec0):
            return None
        return rec0[name_off : name_off + name_len].decode(encoding, "replace")
    except struct.error:
        return None


# --- dispatcher -----------------------------------------------------------

def extract_meta(path, ext):
    """(title, author) for a book by extension. (None, None) when unsupported or
    unparseable — the caller falls back to the cleaned filename."""
    ext = (ext or "").lower()
    if ext == ".epub":
        return parse_epub_meta(path)
    if ext in (".mobi", ".azw3"):
        return parse_mobi_meta(path)
    return None, None
