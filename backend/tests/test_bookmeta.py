"""Tests for ebook metadata extraction (bookmeta.py): EPUB (zip+OPF), the
MOBI/AZW3 EXTH + record-0 parsing, and the dispatcher / fallbacks."""

import struct
import zipfile

from app import bookmeta


# --- EPUB -----------------------------------------------------------------

def _make_epub(path, title, author, opf_at="OEBPS/content.opf"):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0"?>'
            '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
            f'<rootfiles><rootfile full-path="{opf_at}"/></rootfiles></container>',
        )
        z.writestr(
            opf_at,
            '<?xml version="1.0"?>'
            '<package xmlns="http://www.idpf.org/2007/opf">'
            '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
            f"<dc:title>{title}</dc:title><dc:creator>{author}</dc:creator>"
            "</metadata></package>",
        )


def test_parse_epub_meta(tmp_path):
    p = tmp_path / "book.epub"
    _make_epub(p, "The Stand", "Stephen King")
    assert bookmeta.parse_epub_meta(str(p)) == ("The Stand", "Stephen King")


def test_parse_epub_meta_collapses_whitespace(tmp_path):
    p = tmp_path / "book.epub"
    _make_epub(p, "  The   Stand\n", " Stephen  King ")
    assert bookmeta.parse_epub_meta(str(p)) == ("The Stand", "Stephen King")


def test_parse_epub_meta_bad_file_is_none(tmp_path):
    p = tmp_path / "notazip.epub"
    p.write_bytes(b"not a zip")
    assert bookmeta.parse_epub_meta(str(p)) == (None, None)


# --- MOBI / AZW3 ----------------------------------------------------------

def _make_exth(records):
    """Build an EXTH block from [(type, text)]."""
    body = b""
    for rtype, txt in records:
        data = txt.encode("utf-8")
        body += struct.pack(">II", rtype, 8 + len(data)) + data
    return b"EXTH" + struct.pack(">II", 12 + len(body), len(records)) + body


def _make_record0(title=None, author=None, full_name="Full Name Title"):
    """A minimal MOBI record 0: 16-byte PalmDOC + MOBI header + EXTH + fullname."""
    mobi_header = bytearray(132)
    mobi_header[0:4] = b"MOBI"
    struct.pack_into(">I", mobi_header, 4, len(mobi_header))  # header length
    struct.pack_into(">I", mobi_header, 28, 65001)  # encoding = utf-8
    records = []
    if author is not None:
        records.append((bookmeta._EXTH_AUTHOR, author))
    if title is not None:
        records.append((bookmeta._EXTH_TITLE, title))
    exth = _make_exth(records) if records else b""
    rec0 = bytearray(bytes(16) + bytes(mobi_header) + exth)
    name_off = len(rec0)
    name_bytes = full_name.encode("utf-8")
    rec0 += name_bytes
    struct.pack_into(">I", rec0, 16 + 84, name_off)
    struct.pack_into(">I", rec0, 16 + 88, len(name_bytes))
    return bytes(rec0)


def test_parse_exth_reads_author_and_title():
    rec0 = bytes(16) + bytes(40) + _make_exth([(100, "Jane Doe"), (503, "Real Title")])
    out = bookmeta.parse_exth(rec0, 40)
    assert out == {100: "Jane Doe", 503: "Real Title"}


def test_parse_exth_absent_is_empty():
    rec0 = bytes(16) + bytes(40)  # no EXTH magic where expected
    assert bookmeta.parse_exth(rec0, 40) == {}


def test_parse_mobi_record0_prefers_exth_title():
    rec0 = _make_record0(title="EXTH Title", author="John Grisham", full_name="Ignored")
    assert bookmeta._parse_mobi_record0(rec0) == ("EXTH Title", "John Grisham")


def test_parse_mobi_record0_falls_back_to_full_name():
    # No EXTH title → use the MOBI "full name" field.
    rec0 = _make_record0(title=None, author="Anne McCaffrey", full_name="Dragonflight")
    assert bookmeta._parse_mobi_record0(rec0) == ("Dragonflight", "Anne McCaffrey")


def test_parse_mobi_meta_roundtrip(tmp_path):
    """Full file parse: PDB header + record info + record 0."""
    rec0 = _make_record0(title="The Runaway Jury", author="John Grisham")
    rec0_off = 78 + 2 * 8  # header + 2 record-info entries
    rec_info = struct.pack(">II", rec0_off, 0) + struct.pack(">II", rec0_off + len(rec0), 0)
    header = bytearray(78)
    struct.pack_into(">H", header, 76, 2)  # num records
    p = tmp_path / "book.mobi"
    p.write_bytes(bytes(header) + rec_info + rec0 + b"REC1")
    assert bookmeta.parse_mobi_meta(str(p)) == ("The Runaway Jury", "John Grisham")


def test_parse_mobi_meta_bad_file_is_none(tmp_path):
    p = tmp_path / "bad.mobi"
    p.write_bytes(b"too short")
    assert bookmeta.parse_mobi_meta(str(p)) == (None, None)


# --- dispatcher -----------------------------------------------------------

def test_decode_text_falls_back_without_tofu():
    # cp1252 bytes mis-declared as utf-8: strict utf-8 fails → cp1252 recovers
    # the real text instead of inserting U+FFFD replacement chars ("tofu").
    out = bookmeta._decode_text(b"Caf\xe9", "utf-8")
    assert out == "Café"
    assert "�" not in out


def test_clean_strips_tofu_and_control_chars():
    # Replacement chars + control/zero-width chars (the 'tofu' box culprits) are
    # removed; whitespace collapses; an all-garbage value becomes None.
    assert bookmeta._clean("A�B​\x00 C") == "AB C"
    assert bookmeta._clean("�\x00") is None
    assert bookmeta._clean("   ") is None


def test_parse_exth_recovers_misdeclared_encoding():
    # Author bytes are cp1252 but the header declares utf-8.
    author = "Café".encode("cp1252")
    exth = b"EXTH" + struct.pack(">II", 12 + 8 + len(author), 1) + struct.pack(
        ">II", 100, 8 + len(author)
    ) + author
    rec0 = bytes(16) + bytes(40) + exth
    out = bookmeta.parse_exth(rec0, 40, "utf-8")
    assert out[100] == "Café"


def test_extract_meta_dispatch(tmp_path):
    epub = tmp_path / "x.epub"
    _make_epub(epub, "T", "A")
    assert bookmeta.extract_meta(str(epub), ".EPUB") == ("T", "A")  # case-insensitive ext
    # .prc (Mobipocket) is parsed like MOBI.
    rec0 = _make_record0(title="Made in America", author="Bill Bryson")
    rec0_off = 78 + 2 * 8
    rec_info = struct.pack(">II", rec0_off, 0) + struct.pack(">II", rec0_off + len(rec0), 0)
    header = bytearray(78)
    struct.pack_into(">H", header, 76, 2)
    prc = tmp_path / "book.prc"
    prc.write_bytes(bytes(header) + rec_info + rec0 + b"REC1")
    assert bookmeta.extract_meta(str(prc), ".PRC") == ("Made in America", "Bill Bryson")
    # PDFs and unknown types: no extraction here → caller uses the filename.
    assert bookmeta.extract_meta(str(tmp_path / "x.pdf"), ".pdf") == (None, None)
    assert bookmeta.extract_meta(str(tmp_path / "x.txt"), ".txt") == (None, None)
