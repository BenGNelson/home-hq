"""
Solar production sampling — remembers current production (and, on metered
systems, consumption + net grid flow) over time so the Solar page can chart the
day's curve.

The current point-in-time data is already exposed by /api/solar. All we need is
the *time* dimension, so (like plex_history.py / storage_history.py) this is a
lightweight in-app background thread started from the app lifespan. Each tick it
reads the live snapshot and appends one row — but only when the Envoy is
reachable, so an unconfigured/unreachable gateway doesn't get recorded as "0 W".
Old rows are pruned to the retention window.

One wrinkle vs the other samplers: `solar.get_solar()` is async and its cached
pyenphase client + lock are bound to the app's event loop. So rather than spin a
throwaway loop per tick (which would break that cached client), the sampler
submits the coroutine to the main loop captured at startup via
`run_coroutine_threadsafe`. In tests no loop is passed and it falls back to
`asyncio.run` (the test stubs out get_solar, so there's no real client to share).

`summarize_history` is pure and unit-tested; the thread just persists samples
and calls it on read.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time

from app import db

log = logging.getLogger("home-hq.solar-history")

# How long to wait for one snapshot when submitting to the main loop. The Envoy
# poll itself is quick; this is a generous ceiling so a wedged gateway can't hang
# the sampler thread forever.
_FETCH_TIMEOUT = 60.0


def summarize_history(samples):
    """Aggregate raw solar samples into headline stats. Pure + defensive.

    `samples` = [{ts, prod_watts, cons_watts, net_watts}], ascending by ts.
    Returns the sample count, the peak production seen (and *when* it occurred, so
    the curve can mark it), and the latest production (the gauge uses peak as its
    reference scale). Empty input → zeros / None, never raises.
    """
    n = len(samples)
    if n == 0:
        return {"samples": 0, "peak_watts": None, "peak_ts": None, "latest_watts": None}

    # The sample with the highest production — keep its ts for the peak marker.
    # Skip rows with no reading so a None can't win the max.
    peak = max(
        (s for s in samples if s.get("prod_watts") is not None),
        key=lambda s: s["prod_watts"],
        default=None,
    )
    return {
        "samples": n,
        "peak_watts": peak["prod_watts"] if peak else None,
        "peak_ts": peak["ts"] if peak else None,
        "latest_watts": samples[-1].get("prod_watts"),
    }


class SolarSampler:
    """Background thread that records solar samples while the Envoy is reachable."""

    def __init__(self, interval: int, retention_days: int, loop=None):
        self._interval = max(60, interval)
        self._retention_days = retention_days
        self._loop = loop  # the app's event loop (None in tests → asyncio.run)
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, daemon=True, name="solar-history")
        self._thread.start()
        log.info("solar-history: started (every %ss, keep %sd)", self._interval, self._retention_days)

    def stop(self) -> None:
        self._stop.set()

    def _run(self) -> None:
        if self._stop.wait(25):  # let things settle before the first sample
            return
        while not self._stop.is_set():
            try:
                self.sample_once()
            except Exception as exc:  # never let the loop die
                log.warning("solar-history: sample error: %s", exc)
            if self._stop.wait(self._interval):
                return

    def _fetch(self) -> dict:
        """Read the live solar snapshot, reusing the app's event loop + cached
        client when one was provided (production), else a one-off loop (tests).

        Wrapped in asyncio.wait_for so a stalled gateway read is CANCELLED (not
        merely abandoned): get_solar() holds a module-level asyncio lock across
        the Envoy update, and a bare future-timeout would leave that coroutine
        running with the lock held, hanging every live /api/solar request. The
        cancellation unwinds the `async with` and frees the lock."""
        from app import solar

        if self._loop is not None:
            fut = asyncio.run_coroutine_threadsafe(
                asyncio.wait_for(solar.get_solar(), _FETCH_TIMEOUT), self._loop
            )
            return fut.result(timeout=_FETCH_TIMEOUT + 10)
        return asyncio.run(asyncio.wait_for(solar.get_solar(), _FETCH_TIMEOUT))

    def sample_once(self, now: float | None = None) -> bool:
        """Read the live snapshot and persist a sample if available. Returns True
        if one was recorded. Skips entirely when solar isn't configured (no point
        polling) or the gateway is unreachable (don't record a phantom 0 W)."""
        from app import solar

        now = now if now is not None else time.time()
        if not solar.is_configured():
            return False
        data = self._fetch()
        if not data.get("available"):
            return False
        prod = data.get("production") or {}
        cons = data.get("consumption") or {}
        batt = data.get("battery") or {}
        # Store battery flow SIGNED (+ discharging / - charging) for the trend.
        # Unknown flow (watts None, e.g. the storage meter dropped this read) stays
        # None — NOT a fabricated 0, which would conflate "unknown" with "idle".
        batt_w = batt.get("watts")
        if batt_w is not None and batt.get("state") == "charging":
            batt_w = -batt_w
        db.insert_solar_sample(
            {
                "ts": int(now),
                "prod_watts": prod.get("watts_now"),
                "cons_watts": cons.get("watts_now"),
                "net_watts": data.get("net_watts"),
                "soc_percent": batt.get("soc_percent"),
                "battery_watts": batt_w,
            }
        )
        if self._retention_days:
            db.prune_solar_samples(now - self._retention_days * 86400)
        return True


# Process-wide singleton, wired up in the app lifespan (main.py).
_sampler: SolarSampler | None = None


def init_sampler(interval: int, retention_days: int, loop=None) -> SolarSampler:
    global _sampler
    _sampler = SolarSampler(interval, retention_days, loop)
    return _sampler
