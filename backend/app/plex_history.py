"""
Plex activity sampling — remembers concurrent streams / transcodes / reserved
bandwidth over time so the Plex insights page can chart load and bandwidth.

The current point-in-time data is already exposed by /api/plex. All we need is
the *time* dimension, so (like storage_history.py) this is a lightweight in-app
background thread started from the app lifespan. Each tick it reads /api/plex and
appends one row — but only when Plex is reachable, so an unreachable server
doesn't get recorded as "0 streams". Old rows are pruned to the retention window.

`summarize_insights` is pure and unit-tested; the thread just persists samples
and calls it on read.
"""

from __future__ import annotations

import logging
import statistics
import threading
import time
from datetime import datetime, timezone

from app import db

log = logging.getLogger("home-hq.plex-history")


def summarize_insights(samples, now=None):
    """Aggregate raw activity samples into headline stats. Pure + defensive.

    `samples` = [{ts, streams, transcodes, bandwidth_kbps}], ascending by ts.
    Returns stats including peak concurrency, an approximate stream-hours figure
    (samples count for the median sampling gap each), what share of the time
    something was playing, the transcode share of active time, and the busiest
    hour of day (UTC). Empty input → zeros / None, never raises.
    """
    n = len(samples)
    if n == 0:
        return {
            "samples": 0,
            "peak_streams": 0,
            "peak_bandwidth_kbps": None,
            "active_share": None,
            "transcode_share": None,
            "stream_hours": 0.0,
            "busiest_hour": None,
        }

    streams = [int(s.get("streams") or 0) for s in samples]
    transcodes = [int(s.get("transcodes") or 0) for s in samples]
    bandwidths = [s.get("bandwidth_kbps") for s in samples if s.get("bandwidth_kbps")]

    active = sum(1 for v in streams if v > 0)
    transcoding = sum(1 for v in transcodes if v > 0)

    # Approximate each sample as covering the median gap between samples, so the
    # hours figure is robust to an uneven cadence (restarts, retention pruning).
    # `ts` is read defensively (.get) like the other fields so a hand-built or
    # partial sample can't raise — the docstring promises this never throws.
    ts = [s.get("ts") for s in samples]
    gaps = [
        ts[i] - ts[i - 1]
        for i in range(1, n)
        if ts[i] is not None and ts[i - 1] is not None and ts[i] - ts[i - 1] > 0
    ]
    dt = statistics.median(gaps) if gaps else 0.0
    stream_hours = sum(streams) * dt / 3600.0

    # Busiest hour of day: the UTC hour whose samples average the most streams.
    by_hour: dict[int, list[int]] = {}
    for s, v in zip(samples, streams):
        t = s.get("ts")
        if t is None:
            continue
        hour = datetime.fromtimestamp(t, tz=timezone.utc).hour
        by_hour.setdefault(hour, []).append(v)
    busiest_hour = None
    # `active` counts streams across all samples, but by_hour only holds samples
    # with a usable ts — guard on by_hour too so an all-active-but-ts-less set
    # can't hit max() on an empty dict.
    if active and by_hour:
        busiest_hour = max(by_hour, key=lambda h: sum(by_hour[h]) / len(by_hour[h]))

    return {
        "samples": n,
        "peak_streams": max(streams),
        "peak_bandwidth_kbps": max(bandwidths) if bandwidths else None,
        "active_share": active / n,
        "transcode_share": (transcoding / active) if active else None,
        "stream_hours": round(stream_hours, 2),
        "busiest_hour": busiest_hour,
    }


class PlexSampler:
    """Background thread that records Plex activity samples while reachable."""

    def __init__(self, interval: int, retention_days: int):
        self._interval = max(60, interval)
        self._retention_days = retention_days
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, daemon=True, name="plex-history")
        self._thread.start()
        log.info("plex-history: started (every %ss, keep %sd)", self._interval, self._retention_days)

    def stop(self) -> None:
        self._stop.set()

    def _run(self) -> None:
        if self._stop.wait(20):  # let things settle before the first sample
            return
        while not self._stop.is_set():
            try:
                self.sample_once()
            except Exception as exc:  # never let the loop die
                log.warning("plex-history: sample error: %s", exc)
            if self._stop.wait(self._interval):
                return

    def sample_once(self, now: float | None = None) -> bool:
        """Read /api/plex and persist a sample if reachable. Returns True if one
        was recorded."""
        from app.routers import plex  # local import keeps the pure helper test-light

        now = now if now is not None else time.time()
        data = plex.get_plex()
        if not data.get("reachable"):
            return False
        db.record_plex_sample(
            now,
            data.get("streams") or 0,
            data.get("transcodes") or 0,
            data.get("bandwidth_kbps"),
        )
        if self._retention_days:
            db.prune_plex_samples(now - self._retention_days * 86400)
        return True


# Process-wide singleton, wired up in the app lifespan (main.py).
_sampler: PlexSampler | None = None


def init_sampler(interval: int, retention_days: int) -> PlexSampler:
    global _sampler
    _sampler = PlexSampler(interval, retention_days)
    return _sampler


def get_sampler() -> PlexSampler | None:
    return _sampler
