"""Image helpers — turn full-size source art (game box art, Plex posters) into
small WebP thumbnails so the art grids load fast.

The art proxies (routers/library.py cover proxy, routers/plex.py art proxy)
fetch a full-size image once, run it through `to_thumbnail`, and cache the WebP
result — so every later load is a small, locally-served file. Pure + isolated
here so it's unit-tested without the HTTP/Plex machinery.
"""

import io

from PIL import Image

# WebP is supported by every browser we target (incl. iOS Safari). 400px wide
# covers the grid thumbnails and the larger detail-page poster (~2.5x at the
# 160px display size) while shrinking a typical box-art/poster PNG from a few
# hundred KB down to ~20-40 KB.
DEFAULT_MAX_WIDTH = 400
DEFAULT_QUALITY = 80


def to_thumbnail(
    raw: bytes,
    max_width: int = DEFAULT_MAX_WIDTH,
    quality: int = DEFAULT_QUALITY,
) -> bytes | None:
    """Downscale `raw` to at most `max_width` (preserving aspect ratio, never
    upscaling) and re-encode as WebP. Returns the WebP bytes, or None if the
    input isn't a decodable image (caller then falls back to the original)."""
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception:
        return None

    # WebP saves RGB / RGBA; normalize palettes, CMYK, etc.
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA" if "A" in img.getbands() else "RGB")

    if img.width > max_width:
        height = max(1, round(img.height * max_width / img.width))
        img = img.resize((max_width, height), Image.LANCZOS)

    out = io.BytesIO()
    try:
        img.save(out, format="WEBP", quality=quality, method=6)
    except Exception:
        return None
    return out.getvalue()
