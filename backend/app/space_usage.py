"""
What's-eating-space — a cached top-level usage breakdown of the storage mount.

`du` over a multi-terabyte array is slow (tens of seconds to minutes) and heavy
on I/O, so we never run it on request. A background thread runs it at most once
per UTC day (deduped, so frequent backend restarts don't re-scan), niced down,
and caches the result to SQLite. /api/storage/space just hands back the cache.

The app already mounts the array read-only, and `du` needs no privileges, so this
stays in-app rather than a host script (it's heavy, but not privileged). Disable
with SPACE_SCAN_ENABLED=false.
"""

from __future__ import annotations

import logging
import shutil
import subprocess
import threading
import time
from datetime import datetime, timezone

from app import db

log = logging.getLogger("home-hq.space-usage")


def _utc_day(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")


def parse_du(output: str, root: str):
    """Parse `du -B1` output (one 'bytes<TAB>path' line per dir) into a sorted
    [{name, bytes}] of the root's immediate children. The root's own grand-total
    line is dropped. Pure + defensive."""
    root = root.rstrip("/")
    entries = []
    for line in output.splitlines():
        parts = line.split("\t") if "\t" in line else line.split(None, 1)
        if len(parts) != 2:
            continue
        size_str, path = parts[0].strip(), parts[1].strip()
        try:
            size = int(size_str)
        except ValueError:
            continue
        p = path.rstrip("/")
        if p == root or not p:
            continue  # the grand-total line for the root itself
        name = p[len(root) + 1:] if p.startswith(root + "/") else p.rsplit("/", 1)[-1]
        entries.append({"name": name, "bytes": size})
    entries.sort(key=lambda e: e["bytes"], reverse=True)
    return entries


class SpaceScanner:
    """Background daily `du` of the storage mount, cached in SQLite."""

    def __init__(self, root: str, enabled: bool, interval: int, timeout: int):
        self._root = root
        self._enabled = enabled
        self._interval = max(300, interval)
        self._timeout = timeout
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if not self._enabled:
            log.info("space-usage: disabled (SPACE_SCAN_ENABLED) — not starting")
            return
        self._thread = threading.Thread(target=self._run, daemon=True, name="space-usage")
        self._thread.start()
        log.info("space-usage: started (root=%s, every %ss)", self._root, self._interval)

    def stop(self) -> None:
        self._stop.set()

    def _run(self) -> None:
        # Let the box settle before a heavy scan, and don't fight startup I/O.
        if self._stop.wait(60):
            return
        while not self._stop.is_set():
            try:
                self.scan_if_due()
            except Exception as exc:  # never let the loop die
                log.warning("space-usage: scan error: %s", exc)
            if self._stop.wait(self._interval):
                return

    def scan_if_due(self, now: float | None = None) -> bool:
        """Run a scan unless today's is already cached. Returns True if it scanned."""
        now = now if now is not None else time.time()
        today = _utc_day(now)
        latest = db.latest_space_usage()
        if latest and latest.get("day") == today:
            return False
        output = self._run_du()
        if output is None:
            return False
        entries = parse_du(output, self._root)
        total = sum(e["bytes"] for e in entries)
        db.record_space_usage(today, now, self._root, total, entries)
        log.info("space-usage: scanned %s — %d top-level entries", self._root, len(entries))
        return True

    def _run_du(self) -> str | None:
        """Run a niced, one-level, single-filesystem du. None on any failure."""
        nice = shutil.which("nice")
        cmd = ["du", "-x", "-d1", "-B1", self._root]
        if nice:
            cmd = [nice, "-n", "19"] + cmd
        try:
            proc = subprocess.run(
                cmd, capture_output=True, text=True, timeout=self._timeout, check=False
            )
        except (subprocess.TimeoutExpired, OSError) as exc:
            log.warning("space-usage: du failed: %s", exc)
            return None
        # du exits non-zero on unreadable subdirs but still prints what it could;
        # use the output as long as there is some.
        return proc.stdout or None


# Process-wide singleton, wired up in the app lifespan (main.py).
_scanner: SpaceScanner | None = None


def init_scanner(root: str, enabled: bool, interval: int, timeout: int) -> SpaceScanner:
    global _scanner
    _scanner = SpaceScanner(root, enabled, interval, timeout)
    return _scanner


def get_scanner() -> SpaceScanner | None:
    return _scanner
