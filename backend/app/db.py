"""
SQLite cache for the Plex library browser.

Phase 1 of Home HQ was deliberately stateless. The library browser is the first
feature that needs storage: caching thousands of media items locally so search,
sort, and pagination are instant and don't hammer the Plex API on every click.

We use the stdlib `sqlite3` (no ORM) — the schema is tiny and the queries are
simple. The DB file lives on a Docker volume (see compose) so it survives image
rebuilds. Nothing host-specific or secret is stored here — only public-ish media
metadata (titles, years, runtimes, resolutions). No file paths.
"""

import os
import sqlite3
from contextlib import contextmanager

from app.config import settings

# DDL is idempotent — safe to run on every startup.
_SCHEMA = """
CREATE TABLE IF NOT EXISTS media_items (
    rating_key      TEXT PRIMARY KEY, -- Plex's stable id for the item
    library_key     TEXT NOT NULL,    -- Plex section key (which library)
    library         TEXT NOT NULL,    -- section title, for display
    type            TEXT NOT NULL,    -- movie | show | episode
    title           TEXT NOT NULL,
    year            INTEGER,
    duration_ms     INTEGER,
    resolution      TEXT,             -- raw Plex value: 4k, 1080, 720, sd …
    res_height      INTEGER,          -- numeric rank for sorting (2160, 1080 …)
    codec           TEXT,             -- video codec (movies / episodes)
    file_size       INTEGER,          -- bytes (movies / episodes)
    episodes        INTEGER,          -- episode count (shows)
    added_at        INTEGER,          -- epoch seconds
    season          INTEGER,          -- episodes: season number
    episode_num     INTEGER,          -- episodes: episode number within season
    show_title      TEXT,             -- episodes: parent show title
    grandparent_key TEXT              -- episodes: parent show's rating_key
);
CREATE INDEX IF NOT EXISTS idx_media_library ON media_items (library_key);

CREATE TABLE IF NOT EXISTS sync_meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""


@contextmanager
def get_conn():
    """A short-lived connection with row access by column name."""
    os.makedirs(os.path.dirname(settings.db_path) or ".", exist_ok=True)
    conn = sqlite3.connect(settings.db_path, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


# Columns added after the first release. SQLite has no "ADD COLUMN IF NOT
# EXISTS", so we attempt each and ignore the error when it's already there.
# (The cache is rebuildable, but this avoids forcing a wipe on upgrade.)
_MIGRATIONS = [
    "ALTER TABLE media_items ADD COLUMN season INTEGER",
    "ALTER TABLE media_items ADD COLUMN episode_num INTEGER",
    "ALTER TABLE media_items ADD COLUMN show_title TEXT",
    "ALTER TABLE media_items ADD COLUMN grandparent_key TEXT",
]


def init_db():
    """Create tables if they don't exist + apply migrations. Called on startup."""
    with get_conn() as conn:
        conn.executescript(_SCHEMA)
        for stmt in _MIGRATIONS:
            try:
                conn.execute(stmt)
            except sqlite3.OperationalError:
                pass  # column already exists
        # Created after migrations so the column it references exists first.
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_media_grandparent"
            " ON media_items (grandparent_key)"
        )


def get_meta(key, default=None):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT value FROM sync_meta WHERE key = ?", (key,)
        ).fetchone()
        return row["value"] if row else default


def set_meta(key, value):
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO sync_meta (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, str(value)),
        )
