"""
Storage trend sampling — remembers SMART + capacity over time so the Storage page
can chart trends and project when the array fills up.

The current point-in-time data is already exposed by /api/smart, /api/raid and
/api/disk. All we need is the *time* dimension, so rather than a host timer (like
smart-health.py, which needs root) this is a lightweight in-app background thread
started from the app lifespan. Each tick it reads those sources and upserts one
row per UTC day (idempotent — re-running a day refreshes that day's row), then
prunes anything past the retention window.

`build_samples` and `project_capacity` are pure and unit-tested; the thread is a
thin wrapper that persists what they produce.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone

from app import db

log = logging.getLogger("home-hq.storage-history")


def _utc_day(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")


def build_samples(smart_payload: dict, disk_payload: dict):
    """Turn current /smart + /disk payloads into rows to persist.

    Returns [(kind, subject, metrics_dict), ...]. Unreadable drives (USB-bridged
    enclosures that can't do SMART passthrough) carry no trend signal, so they're
    skipped.
    """
    rows: list[tuple[str, str, dict]] = []
    if (smart_payload or {}).get("available"):
        for d in smart_payload.get("drives", []) or []:
            if not d.get("supported"):
                continue
            rows.append(
                (
                    "smart",
                    d.get("name") or "?",
                    {
                        "temperature_c": d.get("temperature_c"),
                        "power_on_hours": d.get("power_on_hours"),
                        "reallocated": d.get("reallocated"),
                        "pending": d.get("pending"),
                        "wear_percent": d.get("wear_percent"),
                        "media_errors": d.get("media_errors"),
                    },
                )
            )
    if (disk_payload or {}).get("available"):
        rows.append(
            (
                "capacity",
                disk_payload.get("mount") or "storage",
                {
                    "total_bytes": disk_payload.get("total_bytes"),
                    "used_bytes": disk_payload.get("used_bytes"),
                    "free_bytes": disk_payload.get("free_bytes"),
                    "percent": disk_payload.get("percent"),
                },
            )
        )
    return rows


def project_capacity(samples):
    """Least-squares fit of used-bytes over time → estimate days until full.

    `samples` = capacity rows as returned by db.storage_samples (each a dict with
    `ts` and a `metrics` dict carrying used_bytes/total_bytes), ascending by ts.
    Returns a projection dict, or None when there isn't enough signal (need >= 2
    points with a known total). `days_until_full` is None when usage is flat or
    shrinking — the page then just says "not growing".
    """
    pts = []
    total = None
    for s in samples:
        m = s.get("metrics") or {}
        used = m.get("used_bytes")
        if used is None:
            continue
        pts.append((float(s["ts"]), float(used)))
        if m.get("total_bytes"):
            total = float(m["total_bytes"])
    if len(pts) < 2 or total is None:
        return None

    t0 = pts[0][0]
    xs = [(t - t0) / 86400.0 for t, _ in pts]  # days since first sample
    ys = [u for _, u in pts]
    n = len(pts)
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    denom = sum((x - mean_x) ** 2 for x in xs)
    if denom == 0:  # all samples at the same instant
        return None
    slope = sum((xs[i] - mean_x) * (ys[i] - mean_y) for i in range(n)) / denom  # bytes/day

    used_now = ys[-1]
    free = total - used_now
    result = {
        "bytes_per_day": slope,
        "used_bytes": used_now,
        "total_bytes": total,
        "span_days": xs[-1] - xs[0],
        "samples": n,
        "days_until_full": (free / slope) if (slope > 0 and free > 0) else None,
    }
    return result


class StorageSampler:
    """Background thread that records a daily SMART + capacity snapshot."""

    def __init__(self, interval: int, retention_days: int):
        self._interval = max(300, interval)
        self._retention_days = retention_days
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, daemon=True, name="storage-history")
        self._thread.start()
        log.info("storage-history: started (every %ss, keep %sd)", self._interval, self._retention_days)

    def stop(self) -> None:
        self._stop.set()

    def _run(self) -> None:
        # Let smart.json land and mounts settle before the first sample.
        if self._stop.wait(15):
            return
        while not self._stop.is_set():
            try:
                self.sample_once()
            except Exception as exc:  # never let the loop die
                log.warning("storage-history: sample error: %s", exc)
            if self._stop.wait(self._interval):
                return

    def sample_once(self, now: float | None = None) -> int:
        """Read the live sources and persist today's rows. Returns rows written."""
        # Imported here (not at module top) to keep this importable by tests that
        # only exercise the pure helpers, without standing up the routers.
        from app.routers import disk, smart

        now = now if now is not None else time.time()
        day = _utc_day(now)
        rows = build_samples(smart.get_smart(), disk.get_disk())
        for kind, subject, metrics in rows:
            db.record_storage_sample(day, now, kind, subject, metrics)
        if self._retention_days:
            db.prune_storage_samples(now - self._retention_days * 86400)
        return len(rows)


# Process-wide singleton, wired up in the app lifespan (main.py).
_sampler: StorageSampler | None = None


def init_sampler(interval: int, retention_days: int) -> StorageSampler:
    global _sampler
    _sampler = StorageSampler(interval, retention_days)
    return _sampler


def get_sampler() -> StorageSampler | None:
    return _sampler
