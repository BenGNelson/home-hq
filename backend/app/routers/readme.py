"""
The in-app README viewer.

  GET /readme            — the project README as markdown text.
  GET /readme/asset/{n}  — an image the README references (a screenshot), served
                           from the docs image dir so it renders in the app.

Both files are mounted read-only into the container (see docker-compose.yml),
so this stays a live view of the real README — no copy, no drift. Both endpoints
degrade gracefully when the files aren't present (e.g. a non-Docker dev run).
"""
import os

from fastapi import APIRouter
from fastapi.responses import FileResponse, Response

from app.config import settings

router = APIRouter()

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
    try:
        with open(settings.readme_path, encoding="utf-8") as f:
            return {"available": True, "markdown": f.read()}
    except OSError:
        return {"available": False, "markdown": ""}


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
