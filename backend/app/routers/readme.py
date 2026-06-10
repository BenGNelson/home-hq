"""
In-app markdown doc viewers.

  GET /readme            — the project README as markdown text.
  GET /readme/asset/{n}  — an image the README references (a screenshot), served
                           from the docs image dir so it renders in the app.
  GET /server-guide      — the host's own server guide as markdown text.

The files are mounted read-only into the container (see docker-compose.yml), so
these stay live views of the real files — no copy, no drift. Every endpoint
degrades gracefully when its file isn't present (e.g. a non-Docker dev run, or no
server guide configured).
"""
import os

from fastapi import APIRouter
from fastapi.responses import FileResponse, Response

from app.config import settings

router = APIRouter()


def _read_markdown(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as f:
            return {"available": True, "markdown": f.read()}
    except OSError:
        return {"available": False, "markdown": ""}

# Explicit image content-types — Python's mimetypes doesn't always know .webp,
# and the README's theme animation is a webp, so don't rely on guessing.
_ASSET_TYPES = {
    ".png": "image/png",
    ".webp": "image/webp",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
}


@router.get("/readme")
def get_readme():
    return _read_markdown(settings.readme_path)


@router.get("/server-guide")
def get_server_guide():
    return _read_markdown(settings.server_guide_path)


@router.get("/readme/asset/{name}")
def get_readme_asset(name: str):
    # Serve only a bare filename from the assets dir — never traverse out of it.
    if name != os.path.basename(name):
        return Response(status_code=404)
    path = os.path.join(settings.readme_assets_dir, name)
    if not os.path.isfile(path):
        return Response(status_code=404)
    media_type = _ASSET_TYPES.get(os.path.splitext(name)[1].lower())
    return FileResponse(path, media_type=media_type)
