"""Tests for app/images.to_thumbnail — the box-art / poster downscaler."""

import io

from PIL import Image

from app import images


def _png(width: int, height: int, mode: str = "RGB") -> bytes:
    """A solid test image of the given size, as PNG bytes."""
    img = Image.new(mode, (width, height), color=(10, 20, 30) if mode == "RGB" else 0)
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def test_downscales_wide_image_and_outputs_webp():
    thumb = images.to_thumbnail(_png(1000, 1400), max_width=400)
    assert thumb is not None
    out = Image.open(io.BytesIO(thumb))
    assert out.format == "WEBP"
    assert out.width == 400
    # Aspect ratio preserved (1000x1400 -> 400x560).
    assert out.height == 560
    # And it's actually smaller than a full-size PNG of the same picture.
    assert len(thumb) < len(_png(1000, 1400))


def test_does_not_upscale_small_image():
    thumb = images.to_thumbnail(_png(120, 160), max_width=400)
    assert thumb is not None
    out = Image.open(io.BytesIO(thumb))
    assert out.format == "WEBP"
    assert (out.width, out.height) == (120, 160)


def test_converts_non_rgb_modes():
    # A palette ("P") image must be converted before WebP can save it.
    thumb = images.to_thumbnail(_png(500, 500, mode="P"), max_width=400)
    assert thumb is not None
    assert Image.open(io.BytesIO(thumb)).format == "WEBP"


def test_returns_none_for_non_image_bytes():
    assert images.to_thumbnail(b"this is not an image") is None
    assert images.to_thumbnail(b"") is None
