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
import time
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

-- Muted alert rules: a row's mere presence = that rule is muted (the engine
-- still tracks its state but sends no push). Unmuting just deletes the row.
CREATE TABLE IF NOT EXISTS alert_mutes (
    rule_id    TEXT PRIMARY KEY,
    updated_at REAL
);

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

-- Plex activity samples: periodic snapshots of concurrent streams / transcodes /
-- reserved bandwidth, recorded by the in-app sampler (plex_history.py). Powers
-- the Plex insights page (load + bandwidth trends). Pruned by retention.
CREATE TABLE IF NOT EXISTS plex_samples (
    ts             REAL NOT NULL,    -- when recorded (epoch seconds)
    streams        INTEGER NOT NULL,
    transcodes     INTEGER NOT NULL,
    bandwidth_kbps INTEGER
);
CREATE INDEX IF NOT EXISTS idx_plex_samples_ts ON plex_samples (ts);

-- Speedtest / ISP monitor samples: one row per completed Ookla speedtest run,
-- recorded by the in-app sampler (speedtest.py) and the manual /run endpoint.
-- Powers the Speedtest page's down/up/ping trend. Pruned by retention. Nothing
-- secret — only the public result url, the ISP name, and the chosen server.
CREATE TABLE IF NOT EXISTS speedtest_samples (
    ts            INTEGER NOT NULL,   -- when recorded (epoch seconds)
    download_mbps REAL,
    upload_mbps   REAL,
    ping_ms       REAL,
    jitter_ms     REAL,
    packet_loss   REAL,
    server        TEXT,               -- "name - location"
    isp           TEXT,
    result_url    TEXT                -- shareable Ookla result link
);
CREATE INDEX IF NOT EXISTS idx_speedtest_samples_ts ON speedtest_samples (ts);

-- Solar production samples: periodic snapshots of current production (and, on
-- metered systems, whole-home consumption + net grid flow) recorded by the
-- in-app sampler (solar_history.py) while the Envoy is reachable. Powers the
-- Solar page's intraday trend. Pruned by retention. Nothing secret — just watts.
CREATE TABLE IF NOT EXISTS solar_samples (
    ts            INTEGER NOT NULL,   -- when recorded (epoch seconds)
    prod_watts    INTEGER,            -- production right now, W
    cons_watts    INTEGER,            -- whole-home consumption, W (metered only)
    net_watts     INTEGER,            -- production - consumption (metered only)
    soc_percent   INTEGER,            -- battery state of charge, % (storage only)
    battery_watts INTEGER             -- battery flow, W (+discharging / -charging)
);
CREATE INDEX IF NOT EXISTS idx_solar_samples_ts ON solar_samples (ts);

-- Cached item runtimes for the watch-stats endpoint. A Plex history entry omits
-- duration, so to total hours-watched we look it up once per item via fetchItem
-- and remember it here (it never changes). A row with duration_ms = 0 is a
-- sentinel for "couldn't fetch" (deleted media) so we don't refetch every time.
CREATE TABLE IF NOT EXISTS plex_item_durations (
    rating_key  INTEGER PRIMARY KEY,  -- Plex's stable item id
    duration_ms INTEGER               -- runtime in ms (0 = unfetchable sentinel)
);

-- Reading progress: where you are in a Library reading item. PDFs bookmark by
-- page/total; ebooks (EPUB/MOBI via foliate-js) have no stable pages, so they
-- bookmark by a location string (`locator`, a foliate CFI) + a 0..1 `fraction`
-- (page stays 0 for them — see set_reading_progress). Keyed by (section,
-- item_id) so it upserts. Powers the "Continue reading" shelf and cross-device
-- resume — server-side so it roams and rides the backup. One row per opened item
-- (bounded by library size), so no retention prune. Nothing host-specific: just
-- a relative item id + a position. (locator/fraction added via _MIGRATIONS.)
CREATE TABLE IF NOT EXISTS reading_progress (
    section    TEXT NOT NULL,
    item_id    TEXT NOT NULL,
    page       INTEGER NOT NULL,
    total      INTEGER,
    updated_ms INTEGER NOT NULL,
    PRIMARY KEY (section, item_id)
);
CREATE INDEX IF NOT EXISTS idx_reading_progress_updated
    ON reading_progress (updated_ms);

-- Book metadata cache: one row per ebook, holding its embedded title + author
-- so the Books section can search by title/author and show consistent names
-- regardless of the filename. Populated by a background indexer (book_sync.py)
-- that parses each file's embedded metadata once; `mtime` lets it re-index only
-- changed files. Text only (no covers / no file copies), so it's a few MB even
-- for a large library. `title` is always set (falls back to the cleaned
-- filename when a file has no embedded title); `author` may be NULL.
CREATE TABLE IF NOT EXISTS book_meta (
    item_id    TEXT PRIMARY KEY,  -- relative path = the Library item id
    title      TEXT NOT NULL,
    author     TEXT,
    mtime      REAL,              -- file mtime at index time (change detection)
    scanned_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_book_meta_title ON book_meta (title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_book_meta_author ON book_meta (author COLLATE NOCASE);

-- "Last played" marker for games that have save states — the games half of the
-- Jump Back In shelf. Save files live on disk keyed by a HASH of the game id (so
-- the raw filename never hits a path), which can't be reversed; this table holds
-- the real game id + core so the shelf can list the game, show its art, and
-- resume its newest save. Removing a row drops it from the shelf WITHOUT touching
-- the save files (still reachable from the game's detail page).
CREATE TABLE IF NOT EXISTS game_progress (
    game_id    TEXT PRIMARY KEY,
    core       TEXT,
    updated_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_game_progress_updated ON game_progress (updated_ms);

-- IGDB metadata cache — the rich data behind the game screen (screenshots,
-- summary, genres, rating, developer/publisher, trailer ids). A background
-- matcher looks each ROM up on IGDB once; `rom_mtime` lets it skip unchanged
-- files. `matched=0` is a REAL result ("IGDB has nothing good for this ROM" —
-- e.g. a ROM hack), cached so it isn't re-queried forever. `source` guards a
-- manual re-match/clear (M2) from being stomped by the auto matcher. JSON blobs
-- (genres/screenshot_ids/videos/candidates) keep the row self-contained.
CREATE TABLE IF NOT EXISTS igdb_meta (
    game_id        TEXT PRIMARY KEY,  -- Library games item id (relative ROM path)
    igdb_id        INTEGER,           -- chosen IGDB game id (NULL when unmatched)
    matched        INTEGER NOT NULL,  -- 1 = a candidate cleared the threshold
    name           TEXT,
    summary        TEXT,
    release_year   INTEGER,
    rating         INTEGER,           -- 0..100 (rounded IGDB total_rating)
    developer      TEXT,
    publisher      TEXT,
    genres         TEXT,              -- JSON array of strings
    cover_image_id TEXT,
    screenshot_ids TEXT,              -- JSON array of image-id strings
    videos         TEXT,              -- JSON array of {id, name}
    candidates     TEXT,              -- JSON shortlist (for the M2 re-match picker)
    confidence     REAL,              -- best match score, 0..1
    source         TEXT NOT NULL,     -- 'auto' | 'manual' | 'cleared'
    match_version  TEXT,              -- matcher logic version this row was made with
    rom_mtime      REAL,              -- ROM mtime at match time (change detection)
    updated_at     REAL NOT NULL
);

-- Pinned (starred) Library folders, so a frequently-revisited deep folder (e.g.
-- a comic series buried a few levels down) is one tap away. Just (section, path)
-- of the folder; the UI deep-links to it. Roams across devices like the rest.
CREATE TABLE IF NOT EXISTS pinned_folders (
    section    TEXT NOT NULL,
    path       TEXT NOT NULL,
    created_ms INTEGER NOT NULL,
    PRIMARY KEY (section, path)
);

-- Audiobook listening position. A book is a folder of chapter files, so resume
-- = which chapter (its item id) + seconds into it. Keyed by the book folder so
-- there's one position per book. Roams + powers the Jump-back-in shelf.
CREATE TABLE IF NOT EXISTS listen_progress (
    book_id    TEXT PRIMARY KEY,
    chapter_id TEXT NOT NULL,
    position_s REAL NOT NULL,
    updated_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_listen_progress_updated ON listen_progress (updated_ms);
"""

# Tables the in-app samplers append to. Each is bounded two ways: a time-based
# retention prune (steady state) AND a hard row cap enforced on write (a backstop
# so a bug looping inserts can't balloon the DB between prune cycles). Caps are
# generous — far above the steady-state row count at normal sampling cadence.
_SAMPLE_TABLE_CAPS = {
    "plex_samples": 100_000,
    "speedtest_samples": 100_000,
    "solar_samples": 200_000,
    "alert_log": 20_000,
}


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
    # Reading progress for ebooks: PDFs bookmark by page/total; EPUB/MOBI have no
    # stable pages, so they bookmark by an exact location string (foliate-js CFI)
    # + a 0..1 read fraction. Both nullable — a PDF row leaves them NULL.
    "ALTER TABLE reading_progress ADD COLUMN locator TEXT",
    "ALTER TABLE reading_progress ADD COLUMN fraction REAL",
    # Battery columns added to the solar trend after its first release.
    "ALTER TABLE solar_samples ADD COLUMN soc_percent INTEGER",
    "ALTER TABLE solar_samples ADD COLUMN battery_watts INTEGER",
    # Per-row matcher-logic version on the IGDB cache (added during M1 development so
    # a re-match is resumable). A DB whose igdb_meta table predates the column gets it
    # here; a fresh one already has it from CREATE TABLE (this ALTER then no-ops).
    "ALTER TABLE igdb_meta ADD COLUMN match_version TEXT",
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
        _cap_table(conn, "alert_log")


def recent_alert_log(limit=20):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT ts, rule_id, kind, message FROM alert_log ORDER BY ts DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]


def muted_rule_ids():
    """The set of rule ids the user has muted (no push, engine still tracks state)."""
    with get_conn() as conn:
        rows = conn.execute("SELECT rule_id FROM alert_mutes").fetchall()
        return {r["rule_id"] for r in rows}


def set_rule_muted(rule_id, muted, now=None):
    """Mute (insert) or unmute (delete) a rule. Idempotent."""
    with get_conn() as conn:
        if muted:
            conn.execute(
                "INSERT INTO alert_mutes (rule_id, updated_at) VALUES (?, ?) "
                "ON CONFLICT(rule_id) DO UPDATE SET updated_at = excluded.updated_at",
                (rule_id, now if now is not None else time.time()),
            )
        else:
            conn.execute("DELETE FROM alert_mutes WHERE rule_id = ?", (rule_id,))


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


def record_plex_sample(ts, streams, transcodes, bandwidth_kbps):
    """Append one Plex activity sample (concurrent streams/transcodes/bandwidth)."""
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO plex_samples (ts, streams, transcodes, bandwidth_kbps) "
            "VALUES (?, ?, ?, ?)",
            (ts, int(streams), int(transcodes), bandwidth_kbps),
        )
        _cap_table(conn, "plex_samples")


def plex_samples(since_ts=None):
    """Plex activity samples, oldest first (optionally only since a cutoff)."""
    with get_conn() as conn:
        if since_ts is not None:
            rows = conn.execute(
                "SELECT ts, streams, transcodes, bandwidth_kbps FROM plex_samples "
                "WHERE ts >= ? ORDER BY ts ASC",
                (since_ts,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT ts, streams, transcodes, bandwidth_kbps FROM plex_samples "
                "ORDER BY ts ASC"
            ).fetchall()
        return [dict(r) for r in rows]


def prune_plex_samples(before_ts):
    """Drop Plex activity samples older than a cutoff (retention)."""
    with get_conn() as conn:
        conn.execute("DELETE FROM plex_samples WHERE ts < ?", (before_ts,))


# --- speedtest / ISP monitor samples ---------------------------------------

# The columns a speedtest record carries, in insert order. parse_result()
# returns exactly these keys (see speedtest.py).
_SPEEDTEST_COLS = (
    "ts", "download_mbps", "upload_mbps", "ping_ms", "jitter_ms",
    "packet_loss", "server", "isp", "result_url",
)


def insert_speedtest_sample(record):
    """Append one completed speedtest result (a dict from parse_result)."""
    with get_conn() as conn:
        placeholders = ",".join("?" for _ in _SPEEDTEST_COLS)
        conn.execute(
            f"INSERT INTO speedtest_samples ({','.join(_SPEEDTEST_COLS)}) "
            f"VALUES ({placeholders})",
            tuple(record.get(c) for c in _SPEEDTEST_COLS),
        )
        _cap_table(conn, "speedtest_samples")


def recent_speedtest_samples(limit=30, since_ts=None):
    """The most recent speedtest samples, returned OLDEST-FIRST for charting
    (we pull the newest rows, then reverse so a line chart reads left to right in
    time). Optionally restrict to rows at/after `since_ts`; pass `limit=None` to
    return the whole (optionally windowed) series uncapped — the trend endpoint
    does this so a long range isn't silently truncated to the newest N (it then
    downsamples for the chart). Mirrors recent_solar_samples' windowed mode."""
    where = "WHERE ts >= ?" if since_ts is not None else ""
    params = [since_ts] if since_ts is not None else []
    limit_sql = ""
    if limit is not None:
        limit_sql = "LIMIT ?"
        params.append(limit)
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT {','.join(_SPEEDTEST_COLS)} FROM speedtest_samples "
            f"{where} ORDER BY ts DESC {limit_sql}",
            params,
        ).fetchall()
        return [dict(r) for r in reversed(rows)]


def latest_speedtest_sample():
    """The newest speedtest sample, or None if none recorded yet."""
    with get_conn() as conn:
        row = conn.execute(
            f"SELECT {','.join(_SPEEDTEST_COLS)} FROM speedtest_samples "
            "ORDER BY ts DESC LIMIT 1"
        ).fetchone()
        return dict(row) if row else None


def speedtest_stats(since_ts=None):
    """Headline aggregates across stored speedtest samples (optionally only since
    a cutoff): avg/min download, avg upload, and the sample count."""
    where = "WHERE ts >= ?" if since_ts is not None else ""
    params = (since_ts,) if since_ts is not None else ()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS samples, "
            "AVG(download_mbps) AS avg_download, MIN(download_mbps) AS min_download, "
            f"AVG(upload_mbps) AS avg_upload FROM speedtest_samples {where}",
            params,
        ).fetchone()
    n = row["samples"] or 0
    return {
        "samples": n,
        "avg_download": round(row["avg_download"], 1) if row["avg_download"] is not None else None,
        "min_download": round(row["min_download"], 1) if row["min_download"] is not None else None,
        "avg_upload": round(row["avg_upload"], 1) if row["avg_upload"] is not None else None,
    }


def prune_speedtest_samples(before_ts):
    """Drop speedtest samples older than a cutoff (retention)."""
    with get_conn() as conn:
        conn.execute("DELETE FROM speedtest_samples WHERE ts < ?", (before_ts,))


# --- solar production samples ----------------------------------------------

# The columns a solar sample carries, in insert order (see solar_history.py).
_SOLAR_COLS = ("ts", "prod_watts", "cons_watts", "net_watts", "soc_percent", "battery_watts")


def insert_solar_sample(record):
    """Append one solar production sample (a dict with the _SOLAR_COLS keys)."""
    with get_conn() as conn:
        placeholders = ",".join("?" for _ in _SOLAR_COLS)
        conn.execute(
            f"INSERT INTO solar_samples ({','.join(_SOLAR_COLS)}) "
            f"VALUES ({placeholders})",
            tuple(record.get(c) for c in _SOLAR_COLS),
        )
        _cap_table(conn, "solar_samples")


def recent_solar_samples(since_ts=None, limit=None):
    """Solar samples returned OLDEST-FIRST for charting. With `limit=None` (the
    history endpoint's case) the time window — `since_ts` plus the retention
    prune — is the only bound, so no rows in range are silently dropped (a fixed
    cap would truncate wide windows: 30 days at a 1-min cadence > any small cap).
    A positive `limit` keeps just the newest N (for ad-hoc callers)."""
    where = "WHERE ts >= ?" if since_ts is not None else ""
    params = [] if since_ts is None else [since_ts]
    sql = f"SELECT {','.join(_SOLAR_COLS)} FROM solar_samples {where} ORDER BY ts DESC"
    if limit is not None:
        sql += " LIMIT ?"
        params.append(limit)
    with get_conn() as conn:
        rows = conn.execute(sql, tuple(params)).fetchall()
        return [dict(r) for r in reversed(rows)]


def prune_solar_samples(before_ts):
    """Drop solar samples older than a cutoff (retention)."""
    with get_conn() as conn:
        conn.execute("DELETE FROM solar_samples WHERE ts < ?", (before_ts,))


def get_item_duration(rating_key):
    """The cached runtime (ms) for an item, or None if we've never fetched it.
    A stored 0 is the 'unfetchable' sentinel and comes back as 0 (not None) so
    the caller can tell 'known-bad' from 'unknown'."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT duration_ms FROM plex_item_durations WHERE rating_key = ?",
            (int(rating_key),),
        ).fetchone()
        return row["duration_ms"] if row else None


def set_item_duration(rating_key, duration_ms):
    """Remember an item's runtime (ms). Store 0 for media we couldn't fetch so we
    don't re-hit Plex for it on every request."""
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO plex_item_durations (rating_key, duration_ms) VALUES (?, ?)"
            " ON CONFLICT(rating_key) DO UPDATE SET duration_ms = excluded.duration_ms",
            (int(rating_key), int(duration_ms or 0)),
        )


def _cap_table(conn, table):
    """Runaway-growth backstop: if `table` exceeds its configured cap, drop the
    oldest rows (by insert order = rowid) back down to the cap. A no-op when the
    table is uncapped or under the cap, so it costs one COUNT per write."""
    cap = _SAMPLE_TABLE_CAPS.get(table)
    if not cap:
        return
    n = conn.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()["n"]  # noqa: S608 - constant table
    if n > cap:
        conn.execute(
            f"DELETE FROM {table} WHERE rowid IN "  # noqa: S608 - constant table name
            f"(SELECT rowid FROM {table} ORDER BY rowid DESC LIMIT -1 OFFSET ?)",
            (cap,),
        )


# Tables surfaced in the DB-size view + row-count breakdown (the ones that grow).
_TRACKED_TABLES = (
    "media_items", "storage_samples", "plex_samples", "speedtest_samples",
    "solar_samples", "print_history", "alert_log", "space_usage", "book_meta",
)


def db_stats():
    """Size of the SQLite file + per-table row counts, for the Storage page's
    'database' card and the DB-size alert. Caps (where set) are included so the
    UI can show headroom."""
    try:
        size_bytes = os.path.getsize(settings.db_path)
    except OSError:
        size_bytes = None
    tables = []
    with get_conn() as conn:
        for name in _TRACKED_TABLES:
            try:
                n = conn.execute(f"SELECT COUNT(*) AS n FROM {name}").fetchone()["n"]  # noqa: S608
            except sqlite3.OperationalError:
                continue  # table not created yet
            tables.append({"name": name, "rows": n, "cap": _SAMPLE_TABLE_CAPS.get(name)})
    return {"size_bytes": size_bytes, "path": settings.db_path, "tables": tables}


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


def set_reading_progress(
    section, item_id, page=None, total=None, locator=None, fraction=None, now_ms=None
):
    """Upsert where the reader is in an item (the saved position IS the bookmark).
    PDFs pass page/total; ebooks pass locator (a foliate CFI) + fraction. `page`
    is NOT NULL in the table, so an ebook (no page) stores 0 and resumes by
    locator/fraction instead."""
    if now_ms is None:
        now_ms = int(time.time() * 1000)
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO reading_progress"
            " (section, item_id, page, total, locator, fraction, updated_ms)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)"
            " ON CONFLICT(section, item_id) DO UPDATE SET"
            " page = excluded.page, total = excluded.total,"
            " locator = excluded.locator, fraction = excluded.fraction,"
            " updated_ms = excluded.updated_ms",
            (section, item_id, page or 0, total, locator, fraction, now_ms),
        )


def get_reading_progress(section, item_id):
    """One item's saved position, or None."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT section, item_id, page, total, locator, fraction, updated_ms"
            " FROM reading_progress WHERE section = ? AND item_id = ?",
            (section, item_id),
        ).fetchone()
        return dict(row) if row else None


def list_reading_progress(min_page=2, limit=50):
    """In-progress items (actually started, not just opened), newest first — for
    the Continue Reading shelf. "Started" = past the first PDF page OR any ebook
    read fraction above zero (ebooks store page 0, so the page test alone would
    miss them)."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT section, item_id, page, total, locator, fraction, updated_ms"
            " FROM reading_progress"
            " WHERE page >= ? OR (fraction IS NOT NULL AND fraction > 0)"
            " ORDER BY updated_ms DESC LIMIT ?",
            (min_page, limit),
        ).fetchall()
        return [dict(r) for r in rows]


def delete_reading_progress(section, item_id):
    """Remove an item from Continue Reading (clear its saved page). Returns
    whether a row was deleted."""
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM reading_progress WHERE section = ? AND item_id = ?",
            (section, item_id),
        )
        return cur.rowcount > 0


def set_game_progress(game_id, core, now_ms=None):
    """Mark a game as recently played (it has save states) for the Jump Back In
    shelf. Records the real game id + core (the on-disk save dir is hashed)."""
    if now_ms is None:
        now_ms = int(time.time() * 1000)
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO game_progress (game_id, core, updated_ms) VALUES (?, ?, ?)"
            " ON CONFLICT(game_id) DO UPDATE SET"
            " core = excluded.core, updated_ms = excluded.updated_ms",
            (game_id, core, now_ms),
        )


def list_game_progress(limit=50):
    """Recently-played games, newest first."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT game_id, core, updated_ms FROM game_progress"
            " ORDER BY updated_ms DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]


def delete_game_progress(game_id):
    """Drop a game from Jump Back In (keeps its save files). Returns whether a
    row was deleted."""
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM game_progress WHERE game_id = ?", (game_id,)
        )
        return cur.rowcount > 0


# --- pinned Library folders ------------------------------------------------

def add_pin(section, path, now_ms=None):
    """Pin a folder (idempotent — re-pinning the same folder is a no-op)."""
    now_ms = now_ms if now_ms is not None else int(time.time() * 1000)
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO pinned_folders (section, path, created_ms) VALUES (?, ?, ?)"
            " ON CONFLICT(section, path) DO NOTHING",
            (section, path, now_ms),
        )


def remove_pin(section, path):
    """Unpin a folder. Returns whether a row was removed."""
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM pinned_folders WHERE section = ? AND path = ?", (section, path)
        )
        return cur.rowcount > 0


def list_pins(section=None):
    """Pinned folders, newest first. Filter by section when given."""
    with get_conn() as conn:
        if section is None:
            rows = conn.execute(
                "SELECT section, path, created_ms FROM pinned_folders"
                " ORDER BY created_ms DESC"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT section, path, created_ms FROM pinned_folders"
                " WHERE section = ? ORDER BY created_ms DESC",
                (section,),
            ).fetchall()
        return [dict(r) for r in rows]


# --- audiobook listening position -----------------------------------------

def set_listen_progress(book_id, chapter_id, position_s, now_ms=None):
    """Save where you are in an audiobook (which chapter + seconds in)."""
    now_ms = now_ms if now_ms is not None else int(time.time() * 1000)
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO listen_progress (book_id, chapter_id, position_s, updated_ms)"
            " VALUES (?, ?, ?, ?)"
            " ON CONFLICT(book_id) DO UPDATE SET"
            " chapter_id = excluded.chapter_id, position_s = excluded.position_s,"
            " updated_ms = excluded.updated_ms",
            (book_id, chapter_id, position_s, now_ms),
        )


def get_listen_progress(book_id):
    """The saved position for a book, or None."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT book_id, chapter_id, position_s, updated_ms FROM listen_progress"
            " WHERE book_id = ?",
            (book_id,),
        ).fetchone()
        return dict(row) if row else None


def list_listen_progress(limit=50):
    """In-progress audiobooks, newest first (for the Jump-back-in shelf)."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT book_id, chapter_id, position_s, updated_ms FROM listen_progress"
            " ORDER BY updated_ms DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]


def delete_listen_progress(book_id):
    """Drop an audiobook from the shelf. Returns whether a row was deleted."""
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM listen_progress WHERE book_id = ?", (book_id,))
        return cur.rowcount > 0


# --- book metadata cache (the Books search index) --------------------------


def upsert_book_meta_many(records, scanned_at=None):
    """Bulk upsert book metadata in ONE transaction (the indexer flushes in
    chunks — far cheaper than a connection per book over a large library).
    `records` = iterable of (item_id, title, author, mtime)."""
    if scanned_at is None:
        scanned_at = time.time()
    rows = [(i, t, a, m, scanned_at) for (i, t, a, m) in records]
    if not rows:
        return
    with get_conn() as conn:
        conn.executemany(
            "INSERT INTO book_meta (item_id, title, author, mtime, scanned_at)"
            " VALUES (?, ?, ?, ?, ?)"
            " ON CONFLICT(item_id) DO UPDATE SET"
            " title = excluded.title, author = excluded.author,"
            " mtime = excluded.mtime, scanned_at = excluded.scanned_at",
            rows,
        )


def get_book_meta(item_id):
    """One book's cached title/author, or None if not indexed yet."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT item_id, title, author FROM book_meta WHERE item_id = ?",
            (item_id,),
        ).fetchone()
        return dict(row) if row else None


def book_mtimes():
    """{item_id: mtime} for every indexed book — lets the indexer skip unchanged
    files and prune rows for files that are gone."""
    with get_conn() as conn:
        rows = conn.execute("SELECT item_id, mtime FROM book_meta").fetchall()
        return {r["item_id"]: r["mtime"] for r in rows}


def delete_book_meta_many(item_ids):
    """Drop cache rows for books no longer present on disk."""
    ids = list(item_ids)
    if not ids:
        return
    with get_conn() as conn:
        conn.executemany("DELETE FROM book_meta WHERE item_id = ?", [(i,) for i in ids])


def count_books_meta():
    """How many books are indexed (the search 'total')."""
    with get_conn() as conn:
        return conn.execute("SELECT COUNT(*) AS n FROM book_meta").fetchone()["n"]


# --- IGDB game metadata cache ----------------------------------------------

# JSON-encoded columns on igdb_meta, decoded back to Python on read.
_IGDB_JSON_COLS = ("genres", "screenshot_ids", "videos", "candidates")
_IGDB_COLS = (
    "game_id", "igdb_id", "matched", "name", "summary", "release_year", "rating",
    "developer", "publisher", "genres", "cover_image_id", "screenshot_ids",
    "videos", "candidates", "confidence", "source", "match_version", "rom_mtime",
    "updated_at",
)


def upsert_igdb_meta(game_id, record, updated_at=None):
    """Store one game's IGDB match. `record` is a dict of the igdb_meta columns
    (minus game_id/updated_at); missing keys default to NULL, and the JSON
    columns (genres/screenshot_ids/videos/candidates) are encoded here. `matched`
    and `source` should always be set by the caller."""
    if updated_at is None:
        updated_at = time.time()
    row = {c: None for c in _IGDB_COLS}
    row.update(record)
    row["game_id"] = game_id
    row["updated_at"] = updated_at
    row["matched"] = 1 if row["matched"] else 0
    row["source"] = row["source"] or "auto"
    for col in _IGDB_JSON_COLS:
        row[col] = json.dumps(row[col]) if row[col] is not None else None
    cols = ",".join(_IGDB_COLS)
    placeholders = ",".join("?" for _ in _IGDB_COLS)
    updates = ",".join(f"{c} = excluded.{c}" for c in _IGDB_COLS if c != "game_id")
    with get_conn() as conn:
        conn.execute(
            f"INSERT INTO igdb_meta ({cols}) VALUES ({placeholders})"
            f" ON CONFLICT(game_id) DO UPDATE SET {updates}",
            tuple(row[c] for c in _IGDB_COLS),
        )


def get_igdb_meta(game_id):
    """One game's cached IGDB metadata (JSON columns decoded), or None if the
    matcher hasn't looked it up yet."""
    with get_conn() as conn:
        r = conn.execute(
            "SELECT * FROM igdb_meta WHERE game_id = ?", (game_id,)
        ).fetchone()
    if not r:
        return None
    out = dict(r)
    out["matched"] = bool(out["matched"])
    for col in _IGDB_JSON_COLS:
        out[col] = json.loads(out[col]) if out[col] else None
    return out


def igdb_mtimes():
    """{game_id: (rom_mtime, source, match_version)} for every looked-up ROM. Lets
    the matcher skip a ROM that's unchanged (mtime) AND matched under the current
    logic (match_version), leave manual overrides alone (source), and prune rows
    for ROMs that are gone. Returns every row — the caller decides what to skip."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT game_id, rom_mtime, source, match_version FROM igdb_meta"
        ).fetchall()
    return {r["game_id"]: (r["rom_mtime"], r["source"], r["match_version"]) for r in rows}


def delete_igdb_meta_many(game_ids):
    """Drop cache rows for ROMs no longer present on disk."""
    ids = list(game_ids)
    if not ids:
        return
    with get_conn() as conn:
        conn.executemany("DELETE FROM igdb_meta WHERE game_id = ?", [(i,) for i in ids])


def count_igdb_meta():
    """(total looked up, of which matched) — for the collector status."""
    with get_conn() as conn:
        total = conn.execute("SELECT COUNT(*) AS n FROM igdb_meta").fetchone()["n"]
        matched = conn.execute(
            "SELECT COUNT(*) AS n FROM igdb_meta WHERE matched = 1"
        ).fetchone()["n"]
    return total, matched


def _like_escape(s):
    """Escape LIKE wildcards so a query of literal % or _ doesn't match-all."""
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def search_books(q, limit=100):
    """Books whose title OR author matches `q` (case-insensitive substring),
    ordered by title. An empty query returns the first `limit` alphabetically
    (a browseable default rather than dumping the whole library)."""
    q = (q or "").strip()
    with get_conn() as conn:
        if q:
            like = f"%{_like_escape(q)}%"
            rows = conn.execute(
                "SELECT item_id, title, author FROM book_meta"
                " WHERE title LIKE ? ESCAPE '\\' OR author LIKE ? ESCAPE '\\'"
                " ORDER BY title COLLATE NOCASE LIMIT ?",
                (like, like, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT item_id, title, author FROM book_meta"
                " ORDER BY title COLLATE NOCASE LIMIT ?",
                (limit,),
            ).fetchall()
        return [dict(r) for r in rows]
