"""Shared fixtures: an isolated temp SQLite DB per test, and a TestClient."""

import pytest

from app import db
from app.config import settings


@pytest.fixture(autouse=True)
def temp_db(tmp_path, monkeypatch):
    """Point the cache at a fresh temp DB for every test and create the schema."""
    monkeypatch.setattr(settings, "db_path", str(tmp_path / "test.db"))
    db.init_db()
    yield


@pytest.fixture(autouse=True)
def _no_printer(monkeypatch):
    """Isolate tests from any real printer config in the ambient .env, so the app
    lifespan never opens a live MQTT connection during the suite."""
    monkeypatch.setattr(settings, "printer_host", "")
    monkeypatch.setattr(settings, "printer_serial", "")
    monkeypatch.setattr(settings, "printer_access_code", "")
    monkeypatch.setattr(settings, "printer_camera", False)
    yield


@pytest.fixture
def client(_no_printer):
    """A FastAPI TestClient (its context runs the startup hook = init_db)."""
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c


# Column order of media_items (see db.py) — used by the insert helper.
_COLS = (
    "rating_key", "library_key", "library", "type", "title", "year",
    "duration_ms", "resolution", "res_height", "codec", "file_size",
    "episodes", "added_at", "season", "episode_num", "show_title",
    "grandparent_key",
)


@pytest.fixture
def insert_item():
    """Returns a helper that inserts one media_items row (NOT NULL cols defaulted)."""

    def _insert(**overrides):
        row = {c: None for c in _COLS}
        row.update(rating_key="x", library_key="1", library="Lib", type="movie", title="T")
        row.update(overrides)
        placeholders = ",".join("?" for _ in _COLS)
        with db.get_conn() as conn:
            conn.execute(
                f"INSERT INTO media_items ({','.join(_COLS)}) VALUES ({placeholders})",
                tuple(row[c] for c in _COLS),
            )

    return _insert
