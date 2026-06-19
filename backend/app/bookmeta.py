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

import posixpath
import struct
import urllib.parse
import xml.etree.ElementTree as ET
import unicodedata
import zipfile

_DC = "{http://purl.org/dc/elements/1.1/}"
_CONTAINER_NS = {"c": "urn:oasis:names:tc:opendocument:xmlns:container"}

# EXTH record types we care about.
_EXTH_AUTHOR = 100
_EXTH_TITLE = 503
# EXTH 201 = "coveroffset": a uint32 index of the cover image, relative to the
# book's first image record (used for cover extraction, not text metadata).
_EXTH_COVER = 201

# MOBI text-encoding codes → Python codecs.
_MOBI_ENCODINGS = {1252: "cp1252", 65001: "utf-8"}


def _clean(s):
    """Sanitize a metadata string for display: drop U+FFFD replacement chars and
    control/format chars (zero-width, etc.) that render as empty 'tofu' boxes on
    some devices, then trim + collapse whitespace. Returns None if nothing usable
    is left (so the caller falls back to the cleaned filename)."""
    if not s:
        return None
    s = s.replace("�", "")
    s = "".join(ch for ch in s if unicodedata.category(ch)[0] != "C")
    s = " ".join(s.split())
    return s or None


def _decode_text(b, encoding):
    """Decode bytes trying the declared encoding, then common fallbacks, each
    STRICT — so a mis-declared encoding raises and we move on rather than
    silently inserting U+FFFD replacement chars (the source of the 'tofu' boxes).
    Last resort drops undecodable bytes instead of replacing them."""
    for enc in (encoding, "utf-8", "cp1252"):
        if not enc:
            continue
        try:
            return b.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return b.decode("utf-8", "ignore")


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
            out[rtype] = _decode_text(rec0[pos + 8 : pos + rlen], encoding)
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
        return _decode_text(rec0[name_off : name_off + name_len], encoding)
    except struct.error:
        return None


# --- cover art -------------------------------------------------------------
# Pull a book's embedded cover image bytes so the Library can show box-art-style
# thumbnails (the cover proxy downscales the result to a small WebP, exactly
# like game box art / Plex posters). Like the title/author parsers, everything
# is defensive: a missing or unreadable cover yields None, never raises.

# Image record magic bytes, used to locate image records inside a MOBI.
_JPEG_MAGIC = b"\xff\xd8\xff"
_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
_GIF_MAGICS = (b"GIF87a", b"GIF89a")


def _localname(tag):
    """The local (namespace-stripped) name of an ElementTree tag, so we can match
    OPF elements whether or not the file declares the OPF namespace."""
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def parse_epub_cover(path):
    """The cover image bytes from an EPUB, or None. Tries, in order: the EPUB2
    `<meta name="cover">` pointer into the manifest, the EPUB3
    `properties="cover-image"` manifest item, then any image manifest item whose
    id/href mentions 'cover'."""
    try:
        with zipfile.ZipFile(path) as z:
            opf_path = _epub_opf_path(z)
            if not opf_path:
                return None
            root = ET.fromstring(z.read(opf_path))
            href = _epub_cover_href(root)
            if not href:
                return None
            # Manifest hrefs are relative to the OPF's own directory; resolve +
            # normalize (collapsing any ../) and undo URL-encoding before reading.
            opf_dir = posixpath.dirname(opf_path)
            full = posixpath.normpath(posixpath.join(opf_dir, href)) if opf_dir else href
            return z.read(urllib.parse.unquote(full))
    except (zipfile.BadZipFile, KeyError, ET.ParseError, OSError, ValueError):
        return None


def _epub_cover_href(root):
    """The manifest href of an EPUB's cover image, or None — namespace-tolerant
    (matches by local element name)."""
    items = []  # manifest <item> elements, in order
    cover_meta_id = None  # content="" of <meta name="cover">
    for el in root.iter():
        name = _localname(el.tag)
        if name == "meta" and el.get("name") == "cover":
            cover_meta_id = el.get("content")
        elif name == "item":
            items.append(el)
    by_id = {it.get("id"): it for it in items if it.get("id")}
    # 1) EPUB2 pointer.
    if cover_meta_id and cover_meta_id in by_id:
        href = by_id[cover_meta_id].get("href")
        if href:
            return href
    # 2) EPUB3 manifest property.
    for it in items:
        if "cover-image" in (it.get("properties") or "").split():
            if it.get("href"):
                return it.get("href")
    # 3) Heuristic fallback: an image item that looks like a cover.
    for it in items:
        media = it.get("media-type") or ""
        href = it.get("href") or ""
        if media.startswith("image/") and "cover" in (it.get("id", "") + href).lower():
            return href
    return None


def parse_mobi_cover(path):
    """The cover image bytes from a MOBI/AZW3/PRC, or None. MOBI stores the cover
    as one of the image records that follow the text; EXTH 201 gives its index
    relative to the first image record. We read that index, then collect the
    file's image records (by magic bytes) in order and return the indexed one."""
    try:
        with open(path, "rb") as f:
            header = f.read(78)
            if len(header) < 78:
                return None
            num_records = struct.unpack_from(">H", header, 76)[0]
            if num_records < 2:
                return None
            rec_info = f.read(num_records * 8)
            offsets = [struct.unpack_from(">I", rec_info, i * 8)[0] for i in range(num_records)]
            f.seek(0, 2)
            file_size = f.tell()

            def read_record(i):
                end = offsets[i + 1] if i + 1 < num_records else file_size
                if end <= offsets[i]:
                    return b""  # corrupt/non-monotonic offset table — skip it
                f.seek(offsets[i])
                return f.read(end - offsets[i])

            rec0 = read_record(0)
            if len(rec0) < 24 or rec0[16:20] != b"MOBI":
                return None
            cover_index = _mobi_cover_index(rec0)
            if cover_index is None:
                return None
            seen = 0
            for i in range(1, num_records):
                data = read_record(i)
                if not _is_image(data):
                    continue
                if seen == cover_index:
                    return data
                seen += 1
            return None
    except (struct.error, OSError):
        return None


def _is_image(data):
    return (
        data[:3] == _JPEG_MAGIC
        or data[:8] == _PNG_MAGIC
        or data[:6] in _GIF_MAGICS
    )


def _mobi_cover_index(rec0):
    """The cover image index from EXTH record 201 (a uint32), or None."""
    mobi_header_len = struct.unpack_from(">I", rec0, 20)[0]
    start = 16 + mobi_header_len
    if rec0[start : start + 4] != b"EXTH":
        return None
    count = struct.unpack_from(">I", rec0, start + 8)[0]
    pos = start + 12
    for _ in range(count):
        if pos + 8 > len(rec0):
            break
        rtype, rlen = struct.unpack_from(">II", rec0, pos)
        if rlen < 8 or pos + rlen > len(rec0):
            break
        if rtype == _EXTH_COVER and rlen == 12:
            return struct.unpack_from(">I", rec0, pos + 8)[0]
        pos += rlen
    return None


def extract_cover(path, ext):
    """The embedded cover image bytes for a book by extension, or None when the
    format is unsupported (PDF) or has no readable cover — the cover proxy then
    serves a placeholder."""
    ext = (ext or "").lower()
    if ext == ".epub":
        return parse_epub_cover(path)
    if ext in (".mobi", ".azw3", ".prc"):
        return parse_mobi_cover(path)
    return None


# --- dispatcher -----------------------------------------------------------

def extract_meta(path, ext):
    """(title, author) for a book by extension. (None, None) when unsupported or
    unparseable — the caller falls back to the cleaned filename."""
    ext = (ext or "").lower()
    if ext == ".epub":
        return parse_epub_meta(path)
    if ext in (".mobi", ".azw3", ".prc"):  # .prc = Mobipocket (same container)
        return parse_mobi_meta(path)
    return None, None
