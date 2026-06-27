"""PDF cover art — render a PDF's first page to an image so the Library can show
a cover for magazines/papers and PDF books (the formats with no embedded cover
metadata). The cover proxy then downscales the result to a small WebP, exactly
like game box art / ebook covers.

A magazine's first page IS its cover, so this turns the title-tile sections into
real cover grids. Everything is defensive: an unreadable / encrypted / empty PDF
yields None (the proxy records a miss and the frontend shows a placeholder),
never raises.

Kept isolated from the HTTP layer so it's unit-tested on a tiny generated PDF.
"""

# PyMuPDF ships a native (MuPDF) wheel. Guard the import so a load failure
# (ABI/arch mismatch, partial install) degrades to "no PDF covers" — render
# returns None, the cover proxy serves a placeholder — instead of taking down
# every module that imports this (bookmeta → the whole Library router).
try:
    import pymupdf

    _AVAILABLE = True
except Exception:  # pragma: no cover - exercised only on a broken install
    pymupdf = None
    _AVAILABLE = False

# Render the first page targeting this box in pixels. The shared thumbnailer
# (images.to_thumbnail) downscales to 400px anyway, so rendering at ~700 gives it
# clean source without blowing up the pixmap. Bounding BOTH dimensions (not just
# width) matters: a tall/narrow media box at a width-only zoom would still
# allocate a huge bitmap before to_thumbnail's decompression-bomb guard runs.
_TARGET_WIDTH = 700
_MAX_HEIGHT = 1200
# Never scale a page up past this, so a tiny-media-box PDF can't request an
# enormous zoom and produce a huge pixmap.
_MAX_ZOOM = 4.0


def render_first_page(path: str) -> bytes | None:
    """The first page of a PDF rendered to PNG bytes, or None if it can't be read
    (PyMuPDF unavailable, corrupt, encrypted, no pages, or any pymupdf error).
    Width- AND height-bounded so the pixmap stays small; the caller downscales +
    re-encodes to WebP."""
    if not _AVAILABLE:
        return None
    doc = None
    try:
        doc = pymupdf.open(path)
        if doc.needs_pass or doc.page_count < 1:
            return None
        page = doc.load_page(0)
        width = page.rect.width or _TARGET_WIDTH
        height = page.rect.height or _MAX_HEIGHT
        # Fit the page within the target box, never upscaling past _MAX_ZOOM, so
        # neither dimension can blow up the bitmap regardless of media-box shape.
        zoom = min(_MAX_ZOOM, _TARGET_WIDTH / width, _MAX_HEIGHT / height)
        pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom))
        return pix.tobytes("png")
    except Exception:
        return None
    finally:
        if doc is not None:
            try:
                doc.close()
            except Exception:
                pass
