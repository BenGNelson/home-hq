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

import json
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

-- Alerting: the last-seen condition per rule (for edge-triggering) + a log.
CREATE TABLE IF NOT EXISTS alert_state (
    rule_id    TEXT PRIMARY KEY,
    alert_key  TEXT,          -- NULL = ok; otherwise the firing condition's key
    since      REAL,          -- when the current key began
    updated_at REAL
);
CREATE TABLE IF NOT EXISTS alert_log (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    ts      REAL NOT NULL,
    rule_id TEXT NOT NULL,
    kind    TEXT NOT NULL,    -- fire | clear
    message TEXT
);
CREATE INDEX IF NOT EXISTS idx_alert_log_ts ON alert_log (ts);

-- Storage trend history: one row per (UTC day, kind, subject) holding a JSON
-- metrics blob. Powers the Storage page's SMART trends + capacity projection.
-- Upserted by the in-app sampler (storage_history.py), so re-running a day just
-- refreshes that day's row.
CREATE TABLE IF NOT EXISTS storage_samples (
    day     TEXT NOT NULL,   -- 'YYYY-MM-DD' (UTC) sample bucket
    ts      REAL NOT NULL,   -- when recorded (epoch seconds)
    kind    TEXT NOT NULL,   -- 'smart' | 'capacity'
    subject TEXT NOT NULL,   -- drive name (smart) or mount path (capacity)
    metrics TEXT NOT NULL,   -- JSON: metric name -> value
    PRIMARY KEY (day, kind, subject)
);
CREATE INDEX IF NOT EXISTS idx_storage_samples ON storage_samples (kind, ts);

-- Print history: one row per completed print (success or failed), logged when
-- the printer transitions out of an active state. Powers the printer stats.
CREATE TABLE IF NOT EXISTS print_history (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    file         TEXT,
    result       TEXT NOT NULL,   -- 'success' | 'failed'
    started_at   REAL,
    ended_at     REAL NOT NULL,
    duration_s   INTEGER,
    layers       INTEGER,
    total_layers INTEGER
);
CREATE INDEX IF NOT EXISTS idx_print_history_ended ON print_history (ended_at);

-- What's-eating-space: the latest top-level usage breakdown of the storage mount.
-- One row per UTC day (a daily du scan is expensive, so we cache it); the page
-- reads the most recent. `entries` is a JSON list of {name, bytes}.
CREATE TABLE IF NOT EXISTS space_usage (
    day        TEXT PRIMARY KEY,  -- 'YYYY-MM-DD' (UTC) of the scan
    scanned_at REAL NOT NULL,
    root       TEXT NOT NULL,
    total_bytes INTEGER,
    entries    TEXT NOT NULL
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


def get_alert_state(rule_id):
    """The persisted condition for a rule, or None if it's never been seen."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT rule_id, alert_key, since FROM alert_state WHERE rule_id = ?",
            (rule_id,),
        ).fetchone()
        return dict(row) if row else None


def set_alert_state(rule_id, alert_key, since):
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO alert_state (rule_id, alert_key, since, updated_at) "
            "VALUES (?, ?, ?, ?) ON CONFLICT(rule_id) DO UPDATE SET "
            "alert_key = excluded.alert_key, since = excluded.since, "
            "updated_at = excluded.updated_at",
            (rule_id, alert_key, since, since),
        )


def add_alert_log(ts, rule_id, kind, message):
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO alert_log (ts, rule_id, kind, message) VALUES (?, ?, ?, ?)",
            (ts, rule_id, kind, message),
        )


def recent_alert_log(limit=20):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT ts, rule_id, kind, message FROM alert_log ORDER BY ts DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]


def record_storage_sample(day, ts, kind, subject, metrics):
    """Upsert one day's trend sample for a drive/mount (metrics is a dict)."""
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO storage_samples (day, ts, kind, subject, metrics) "
            "VALUES (?, ?, ?, ?, ?) ON CONFLICT(day, kind, subject) DO UPDATE SET "
            "ts = excluded.ts, metrics = excluded.metrics",
            (day, ts, kind, subject, json.dumps(metrics)),
        )


def storage_samples(kind, since_ts=None):
    """Trend samples of one kind ('smart'|'capacity'), oldest first. Each row's
    `metrics` JSON is decoded back into a dict."""
    with get_conn() as conn:
        if since_ts is not None:
            rows = conn.execute(
                "SELECT day, ts, subject, metrics FROM storage_samples "
                "WHERE kind = ? AND ts >= ? ORDER BY ts ASC",
                (kind, since_ts),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT day, ts, subject, metrics FROM storage_samples "
                "WHERE kind = ? ORDER BY ts ASC",
                (kind,),
            ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["metrics"] = json.loads(d["metrics"])
        out.append(d)
    return out


def prune_storage_samples(before_ts):
    """Drop trend samples older than a cutoff (retention)."""
    with get_conn() as conn:
        conn.execute("DELETE FROM storage_samples WHERE ts < ?", (before_ts,))


def record_print(rec):
    """Insert one completed print (a dict from build_print_record)."""
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO print_history "
            "(file, result, started_at, ended_at, duration_s, layers, total_layers) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                rec.get("file"),
                rec["result"],
                rec.get("started_at"),
                rec["ended_at"],
                rec.get("duration_s"),
                rec.get("layers"),
                rec.get("total_layers"),
            ),
        )


def recent_prints(limit=50):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, file, result, started_at, ended_at, duration_s, layers, "
            "total_layers FROM print_history ORDER BY ended_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]


def print_stats():
    """Aggregate totals across all logged prints."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS total, "
            "SUM(CASE WHEN result = 'success' THEN 1 ELSE 0 END) AS successes, "
            "COALESCE(SUM(duration_s), 0) AS total_seconds "
            "FROM print_history"
        ).fetchone()
    total = row["total"] or 0
    successes = row["successes"] or 0
    return {
        "total": total,
        "successes": successes,
        "failures": total - successes,
        "success_rate": (successes / total) if total else None,
        "total_print_seconds": row["total_seconds"] or 0,
    }


def record_space_usage(day, scanned_at, root, total_bytes, entries):
    """Upsert one day's storage breakdown (entries is a list of dicts)."""
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO space_usage (day, scanned_at, root, total_bytes, entries) "
            "VALUES (?, ?, ?, ?, ?) ON CONFLICT(day) DO UPDATE SET "
            "scanned_at = excluded.scanned_at, root = excluded.root, "
            "total_bytes = excluded.total_bytes, entries = excluded.entries",
            (day, scanned_at, root, total_bytes, json.dumps(entries)),
        )


def latest_space_usage():
    """The most recent storage breakdown, or None. `entries` is decoded back."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT day, scanned_at, root, total_bytes, entries FROM space_usage "
            "ORDER BY scanned_at DESC LIMIT 1"
        ).fetchone()
    if not row:
        return None
    out = dict(row)
    out["entries"] = json.loads(out["entries"])
    return out


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
