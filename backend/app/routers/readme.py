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
    return FileResponse(path)
