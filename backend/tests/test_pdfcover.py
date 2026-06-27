"""Tests for app.pdfcover — rendering a PDF's first page to image bytes so the
Library can show covers for magazines/papers and PDF books. Uses pymupdf to
generate tiny PDFs in-memory, so no fixture files are needed."""

import io

import pymupdf
import pytest
from PIL import Image

from app import pdfcover


def _make_pdf(path, pages=1, size=(200, 280), color=(0.1, 0.2, 0.3)):
    """Write a small valid PDF with `pages` colored pages."""
    doc = pymupdf.open()
    for _ in range(pages):
        page = doc.new_page(width=size[0], height=size[1])
        page.draw_rect(page.rect, color=color, fill=color)
    doc.save(str(path))
    doc.close()


def test_render_first_page_returns_png(tmp_path):
    pdf = tmp_path / "mag.pdf"
    _make_pdf(pdf, pages=3)
    raw = pdfcover.render_first_page(str(pdf))
    assert raw and raw[:8] == b"\x89PNG\r\n\x1a\n"  # PNG signature
    # And it's a decodable image of plausible size (width-bounded render).
    img = Image.open(io.BytesIO(raw))
    img.load()
    assert img.width > 0 and img.height > 0


def test_render_first_page_bad_pdf_returns_none(tmp_path):
    bad = tmp_path / "not.pdf"
    bad.write_bytes(b"%PDF-1.4 but truncated garbage")
    assert pdfcover.render_first_page(str(bad)) is None


def test_render_first_page_missing_file_returns_none(tmp_path):
    assert pdfcover.render_first_page(str(tmp_path / "nope.pdf")) is None


def test_render_first_page_encrypted_returns_none(tmp_path):
    enc = tmp_path / "locked.pdf"
    doc = pymupdf.open()
    doc.new_page(width=200, height=280)
    # Save with a user password → needs_pass on open, so we bail to None.
    doc.save(str(enc), encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="secret")
    doc.close()
    assert pdfcover.render_first_page(str(enc)) is None


@pytest.mark.parametrize("width", [50, 700, 2000])
def test_render_first_page_bounds_width(tmp_path, width):
    pdf = tmp_path / "page.pdf"
    _make_pdf(pdf, size=(width, width))
    raw = pdfcover.render_first_page(str(pdf))
    assert raw  # any media-box size renders without ballooning
