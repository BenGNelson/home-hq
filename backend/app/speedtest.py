"""
Speedtest / ISP monitor — runs the Ookla `speedtest` CLI periodically, stores
each result in SQLite, and lets the Speedtest page chart down/up/ping over time.

The current point-in-time number is something you'd normally run by hand; this
adds the *time* dimension. Like storage_history.py / plex_history.py, it's a
lightweight in-app background thread started from the app lifespan. Each tick it
runs one test, parses it, appends a row, and prunes past the retention window.

`parse_result` is pure and unit-tested; everything else is a thin wrapper around
the CLI + SQLite. A module-level lock guarantees only ONE test runs at a time —
the scheduled sampler and the manual /run endpoint share it (a speedtest is
heavy, ~3.5 GB of traffic per gigabit run, so overlapping runs would be wasteful
and would skew each other's numbers).

!! DATA COST: each gigabit test moves ~3.5 GB. SPEEDTEST_INTERVAL=0 disables the
schedule (manual-only).
"""

from __future__ import annotations

import json
import logging
import subprocess
import threading
import time

from app import db

log = logging.getLogger("home-hq.speedtest")

# The Ookla CLI binary (baked into the image by the Dockerfile).
_BINARY = "speedtest"
_RUN_TIMEOUT = 120  # seconds — one run is ~15-30s; this is a generous ceiling.

# Only ONE test may run at a time (sampler + manual endpoint share this).
_lock = threading.Lock()
_running = False


def parse_result(data: dict, now: float | None = None) -> dict:
    """Turn the Ookla CLI's JSON into a flat record to persist. PURE + defensive.

    Ookla's `download.bandwidth` / `upload.bandwidth` are BYTES/sec, so Mbps =
    bandwidth * 8 / 1e6. `ping.latency`/`ping.jitter` are ms floats; `packetLoss`
    is a float that may be absent (older servers) → None. `server.name` +
    `server.location` combine into a human label. `result.url` is the shareable
    link. `ts` is taken from `now` (kept out of this pure function), else 0.
    """
    download = (data.get("download") or {}).get("bandwidth")
    upload = (data.get("upload") or {}).get("bandwidth")
    ping = data.get("ping") or {}
    server = data.get("server") or {}
    result = data.get("result") or {}

    def _mbps(bw):
        return round(bw * 8 / 1e6, 1) if bw is not None else None

    def _round1(v):
        return round(v, 1) if isinstance(v, (int, float)) else None

    name = server.get("name") or ""
    location = server.get("location") or ""
    server_label = " - ".join(p for p in (name, location) if p) or None

    packet_loss = data.get("packetLoss")
    if isinstance(packet_loss, (int, float)):
        packet_loss = round(float(packet_loss), 2)
    else:
        packet_loss = None  # tolerate a missing/null field

    return {
        "ts": int(now) if now is not None else 0,
        "download_mbps": _mbps(download),
        "upload_mbps": _mbps(upload),
        "ping_ms": _round1(ping.get("latency")),
        "jitter_ms": _round1(ping.get("jitter")),
        "packet_loss": packet_loss,
        "server": server_label,
        "isp": data.get("isp") or None,
        "result_url": result.get("url") or None,
    }


# --- history ranges + downsampling (pure, unit-tested) ----------------------

# The windows the /speedtest/history endpoint offers, as range-key → seconds.
# Anything outside this set falls back to DEFAULT_RANGE (so a typo'd query is a
# sane chart, not a 4xx). Keep in sync with the frontend's range selector.
HISTORY_RANGES = {
    "24h": 86_400,
    "7d": 7 * 86_400,
    "30d": 30 * 86_400,
    "90d": 90 * 86_400,
    "1y": 365 * 86_400,
}
DEFAULT_RANGE = "30d"


def normalize_range(range_key: str | None) -> str:
    """Clamp a requested range to the allowed set (unknown/None → default). PURE."""
    return range_key if range_key in HISTORY_RANGES else DEFAULT_RANGE


def _mean(values) -> float | None:
    """Mean of the numeric (non-None) values, or None when there are none."""
    nums = [v for v in values if isinstance(v, (int, float))]
    return sum(nums) / len(nums) if nums else None


def bucket_samples(rows: list[dict], max_points: int = 120) -> list[dict]:
    """Downsample a time-ordered list of speedtest rows to at most `max_points`,
    averaging each contiguous bucket. PURE (no clock, no I/O) so it's unit-tested.

    `rows` are OLDEST-FIRST dicts with ts / download_mbps / upload_mbps / ping_ms.
    With `<= max_points` rows (or max_points <= 0) it just trims each row to those
    four keys. Otherwise it splits the ordered rows into `max_points` equal-count
    buckets and averages each — per field, skipping None (an all-None field in a
    bucket stays None). A bucket's ts is the mean of its rows' timestamps, so the
    points stay correctly placed on a time axis. Equal-count buckets suit the
    regular sampling cadence; the result reads left-to-right in time.
    """
    n = len(rows)
    keys = ("download_mbps", "upload_mbps", "ping_ms")
    if n == 0:
        return []
    if max_points <= 0 or n <= max_points:
        return [{"ts": r.get("ts"), **{k: r.get(k) for k in keys}} for r in rows]

    out: list[dict] = []
    for i in range(max_points):
        lo = i * n // max_points
        hi = (i + 1) * n // max_points
        chunk = rows[lo:hi]
        if not chunk:
            continue
        ts_mean = _mean([r.get("ts") for r in chunk])
        point = {"ts": int(ts_mean) if ts_mean is not None else 0}
        for k in keys:
            avg = _mean([r.get(k) for r in chunk])
            point[k] = round(avg, 1) if avg is not None else None
        out.append(point)
    return out


def is_running() -> bool:
    """True while a test is in flight (sampler or manual)."""
    return _running


def run_test(now: float | None = None) -> dict | None:
    """Run ONE speedtest via the CLI, parse it, and insert it into SQLite.

    Returns the stored record, or None if another test is already running (we
    don't queue — a concurrent caller just gets a no-op). Raises on CLI failure
    so the caller (sampler loop / trigger thread) can log it; both wrap this in
    try/except so a failure never kills the thread.
    """
    global _running
    with _lock:
        if _running:
            return None
        _running = True
    try:
        now = now if now is not None else time.time()
        proc = subprocess.run(
            [_BINARY, "--format=json", "--accept-license", "--accept-gdpr"],
            capture_output=True,
            text=True,
            timeout=_RUN_TIMEOUT,
            check=True,
        )
        data = json.loads(proc.stdout)
        record = parse_result(data, now=now)
        db.insert_speedtest_sample(record)
        log.info(
            "speedtest: %.1f down / %.1f up Mbps, %.1f ms ping",
            record.get("download_mbps") or 0,
            record.get("upload_mbps") or 0,
            record.get("ping_ms") or 0,
        )
        return record
    finally:
        with _lock:
            _running = False


def trigger_async() -> bool:
    """Spawn a daemon thread that runs one test, unless one is already running.

    Returns whether a run was started (False if one is in flight). Used by the
    manual POST /run endpoint — it returns immediately while the test proceeds.
    """
    with _lock:
        if _running:
            return False
    def _worker():
        try:
            run_test()
        except Exception as exc:  # never let the thread die loudly
            log.warning("speedtest: manual run failed: %s", exc)
    threading.Thread(target=_worker, daemon=True, name="speedtest-run").start()
    return True


class SpeedtestSampler:
    """Background thread that runs a scheduled speedtest every `interval` seconds.

    When `interval <= 0` the schedule is disabled (manual-only): the thread is
    simply never started, so the only way to run a test is the /run endpoint.
    """

    def __init__(self, interval: int, retention_days: int):
        self._interval = interval
        self._retention_days = retention_days
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._interval <= 0:
            log.info("speedtest: scheduled tests disabled (interval=0) — manual only")
            return
        self._thread = threading.Thread(target=self._run, daemon=True, name="speedtest-history")
        self._thread.start()
        log.info(
            "speedtest: started (every %ss, keep %sd)", self._interval, self._retention_days
        )

    def stop(self) -> None:
        self._stop.set()

    def _run(self) -> None:
        # Let the rest of the app settle before hammering the link with a test.
        if self._stop.wait(30):
            return
        while not self._stop.is_set():
            # Skip if a recent sample already covers this interval — so a restart
            # or redeploy doesn't fire a fresh ~3.5 GB test when we just ran one.
            latest = db.latest_speedtest_sample()
            due = not latest or (time.time() - (latest.get("ts") or 0)) >= self._interval
            if due:
                try:
                    self.sample_once()
                except Exception as exc:  # never let the loop die
                    log.warning("speedtest: sample error: %s", exc)
            if self._stop.wait(self._interval):
                return

    def sample_once(self, now: float | None = None) -> dict | None:
        """Run one test, persist it, and prune old samples. Returns the record."""
        record = run_test(now=now)
        if self._retention_days:
            cutoff = (now if now is not None else time.time()) - self._retention_days * 86400
            db.prune_speedtest_samples(cutoff)
        return record


# Process-wide singleton, wired up in the app lifespan (main.py).
_sampler: SpeedtestSampler | None = None


def init_sampler(interval: int, retention_days: int) -> SpeedtestSampler:
    global _sampler
    _sampler = SpeedtestSampler(interval, retention_days)
    return _sampler
