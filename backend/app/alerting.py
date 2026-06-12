"""
Alerting engine — watches the same data the dashboard shows and pushes a phone
notification (via ntfy) when something crosses into a bad state.

Design:
  * A background thread evaluates a list of RULES every `alert_interval` seconds.
  * Each rule.check(ctx) returns (key, message): key=None means OK; any string is
    a firing condition, and the *string itself* identifies which condition (so a
    different problem on the same rule re-notifies).
  * We EDGE-trigger: notify only when a rule's key changes — None→X (problem),
    X→Y (changed problem), X→None (resolved, for sustained conditions). State is
    persisted in SQLite so a backend restart doesn't re-announce everything.
  * First time we ever see a rule (no stored state), we record its current key
    *silently* — so enabling alerts (or a finished print sitting on the bed)
    doesn't trigger a burst. New transitions after that do notify.

Each rule carries its own emoji (ntfy tag) so alerts read at a glance.
"""

from __future__ import annotations

import logging
import threading
import time
import urllib.request
from dataclasses import dataclass
from typing import Callable

from app import db, notify
from app.config import settings
from app.printer import get_client as get_printer_client
from app.routers import backups, containers, disk, raid, smart, vpn, watchdog

log = logging.getLogger("home-hq.alerting")


@dataclass
class Rule:
    id: str
    title: str
    emoji: str  # ntfy tag shortcode, e.g. "floppy_disk"
    priority: str  # ntfy priority when firing: default | high | urgent
    notify_on_clear: bool  # send a "resolved" when it goes back to OK
    check: Callable[[dict], tuple[str | None, str]]
    path: str = ""  # in-app route this alert is about (deep-link target on tap)


# --- individual checks: take the gathered context, return (key, message) -------


def _check_backup(ctx):
    b = ctx.get("backups") or {}
    if not b.get("configured"):
        return None, ""
    last = b.get("last_backup")
    max_age = settings.alert_backup_max_age_days * 86400
    if not last:
        return "missing", "No config backup found"
    if (ctx["now"] - last) > max_age:
        days = int((ctx["now"] - last) / 86400)
        return "stale", f"No fresh config backup in {days} days"
    return None, ""


def _check_raid(ctx):
    r = ctx.get("raid") or {}
    if not r.get("available"):
        return None, ""
    bad = [a for a in r.get("arrays", []) if a.get("healthy") is False or a.get("failed")]
    if bad:
        names = ", ".join(a.get("name", "?") for a in bad)
        states = ", ".join(a.get("status") or "?" for a in bad)
        return f"degraded:{names}", f"RAID array {names} is DEGRADED ({states})"
    return None, ""


def _check_smart(ctx):
    s = ctx.get("smart") or {}
    if not s.get("available"):
        return None, ""
    failed = sorted(d["name"] for d in s.get("drives", []) if d.get("passed") is False)
    warned = sorted(d["name"] for d in s.get("drives", []) if d.get("warnings"))
    if failed:
        return "fail:" + ",".join(failed), f"SMART self-test FAILED on {', '.join(failed)}"
    if warned:
        return "warn:" + ",".join(warned), f"SMART warnings on {', '.join(warned)}"
    return None, ""


def _check_disk(ctx):
    d = ctx.get("disk") or {}
    if not d.get("available"):
        return None, ""
    pct = d.get("percent")
    if pct is not None and pct >= settings.alert_disk_percent:
        return f"full:{int(pct)}", f"Storage {d.get('mount')} is {pct:.0f}% full"
    return None, ""


def _check_watchdog(ctx):
    w = ctx.get("watchdog") or {}
    if not w.get("available"):
        return None, ""
    # stale = the watchdog process is down; that's a separate concern, not a
    # drive fault, so we don't alarm on it here.
    if not w.get("healthy") and not w.get("stale"):
        return "unhealthy", f"Drive {w.get('label') or 'external'} is unhealthy ({w.get('note')})"
    return None, ""


def _check_containers(ctx):
    c = ctx.get("containers") or {}
    if not c.get("available"):
        return None, ""
    down = sorted(x["name"] for x in c.get("containers", []) if x.get("status") in ("exited", "dead"))
    if down:
        return "down:" + ",".join(down), f"Container(s) down: {', '.join(down)}"
    return None, ""


def _check_printer(ctx):
    p = ctx.get("printer") or {}
    if not p.get("available"):
        return None, ""
    pr = p.get("printer") or {}
    name = pr.get("file") or "print"
    if pr.get("state") == "FINISH":
        return f"done:{name}", f"Print finished: {name}"
    if pr.get("state") == "FAILED":
        return f"failed:{name}", f"Print FAILED: {name}"
    return None, ""


def _check_printer_paused(ctx):
    """Catches filament runout (printer pauses, stage = 'Changing filament'),
    user pauses, and fault pauses — all surface as gcode_state PAUSE."""
    p = ctx.get("printer") or {}
    if not p.get("available"):
        return None, ""
    pr = p.get("printer") or {}
    if pr.get("state") == "PAUSE":
        stage = pr.get("stage")
        return "paused", f"Print paused{f': {stage}' if stage else ''}"
    return None, ""


def _check_printer_hms(ctx):
    p = ctx.get("printer") or {}
    if not p.get("available"):
        return None, ""
    hms = (p.get("printer") or {}).get("hms") or []
    codes = [str(h.get("code")) for h in hms if h.get("code") is not None]
    if codes:
        joined = ", ".join(codes)
        return "hms:" + joined, f"Printer fault (HMS): {joined}"
    return None, ""


def _check_vpn(ctx):
    """Fire only on a genuine LEAK — the VPN's egress IP equals the home IP, so
    protected traffic isn't being masked. 'down' (container stopped) is benign
    because the kill-switch drops traffic, and the stack is intentionally stopped
    when the external drive isn't mounted, so we'd just spam. Stale = the checker
    isn't running, so the state is unknown; don't alarm on it."""
    v = ctx.get("vpn") or {}
    if not v.get("available") or v.get("stale"):
        return None, ""
    if v.get("status") == "leak":
        return "leak", "VPN LEAK: protected traffic is exiting via your home IP, not the VPN"
    return None, ""


def _check_printer_offline(ctx):
    """Fire ONLY if the printer vanished mid-print — that's a dead pipe / crash /
    eero-IP drift, the bad case. A power-down while idle is normal, so stay quiet."""
    p = ctx.get("printer") or {}
    if p.get("available") or p.get("reason") != "offline":
        return None, ""
    if p.get("last_state") in ("RUNNING", "PAUSE"):
        return "offline", "Printer went offline mid-print — telemetry lost (check power / PRINTER_HOST / eero IP)"
    return None, ""


RULES = [
    Rule("backup", "Config backup", "floppy_disk", "high", True, _check_backup, path="/backups"),
    Rule("raid", "RAID array", "rotating_light", "urgent", True, _check_raid, path="/storage"),
    Rule("smart", "Drive SMART", "minidisc", "high", True, _check_smart, path="/storage"),
    Rule("disk", "Storage capacity", "card_file_box", "high", True, _check_disk, path="/storage"),
    Rule("watchdog", "External drive", "electric_plug", "high", True, _check_watchdog, path="/storage"),
    Rule("containers", "Containers", "package", "high", True, _check_containers, path="/containers"),
    Rule("printer", "3D printer", "printer", "default", False, _check_printer, path="/printer"),
    Rule("printer_paused", "Print paused", "printer", "high", True, _check_printer_paused, path="/printer"),
    Rule("printer_hms", "Printer fault (HMS)", "warning", "high", True, _check_printer_hms, path="/printer"),
    Rule("printer_offline", "Printer telemetry", "satellite", "urgent", True, _check_printer_offline, path="/printer"),
    Rule("vpn", "VPN egress", "lock", "urgent", True, _check_vpn, path="/vpn"),
]


def _click_url(rule: Rule) -> str | None:
    """The in-app page an alert should open when tapped. `ALERT_CLICK_URL` is the
    app's base origin (e.g. https://host.example); each rule appends its own path
    so a RAID alert lands on the Storage page, a print alert on the Printer page,
    etc. Returns None when no base is set, so no Click header is sent."""
    base = settings.alert_click_url.strip()
    if not base:
        return None
    return (base.rstrip("/") + rule.path) if rule.path else base


class AlertManager:
    def __init__(self, interval: int):
        self._interval = max(15, interval)
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._status: dict[str, dict] = {}

    def start(self) -> None:
        if not settings.alerts_enabled:
            log.info("alerting: disabled (ALERTS_ENABLED) — not starting")
            return
        self._thread = threading.Thread(target=self._run, daemon=True, name="alerting")
        self._thread.start()
        log.info("alerting: started (every %ss, %d rules)", self._interval, len(RULES))

    def stop(self) -> None:
        self._stop.set()

    def _run(self) -> None:
        # Let the other subsystems (printer MQTT, etc.) settle before first pass.
        if self._stop.wait(10):
            return
        while not self._stop.is_set():
            try:
                self.evaluate()
            except Exception as exc:  # never let the loop die
                log.warning("alerting: evaluation error: %s", exc)
            self._heartbeat()
            if self._stop.wait(self._interval):
                return

    def _heartbeat(self) -> None:
        """Dead-man's switch: ping an external check each tick. If this loop (or
        the whole box) dies, the pings stop and that external service alerts —
        the one failure our own alerting can never self-report."""
        url = settings.healthcheck_ping_url
        if not url:
            return
        try:
            urllib.request.urlopen(url, timeout=10).close()
        except Exception as exc:  # best-effort; never disturb the loop
            log.info("alerting: heartbeat ping failed: %s", exc)

    def build_context(self) -> dict:
        """Gather every data source once; one failing source can't break a tick."""
        ctx: dict = {"now": time.time()}
        sources = {
            "raid": raid.get_raid,
            "smart": smart.get_smart,
            "disk": disk.get_disk,
            "watchdog": watchdog.get_drive_watchdog,
            "containers": containers.get_containers,
            "backups": backups.list_backups,
            "vpn": vpn.get_vpn,
        }
        for name, fn in sources.items():
            try:
                ctx[name] = fn()
            except Exception as exc:
                log.info("alerting: source %s failed: %s", name, exc)
                ctx[name] = {}
        try:
            client = get_printer_client()
            ctx["printer"] = client.snapshot() if client else {}
        except Exception:
            ctx["printer"] = {}
        return ctx

    def evaluate(self) -> None:
        ctx = self.build_context()
        now = ctx["now"]
        statuses: dict[str, dict] = {}
        for rule in RULES:
            try:
                key, message = rule.check(ctx)
            except Exception as exc:
                log.info("alerting: rule %s failed: %s", rule.id, exc)
                continue

            prev = db.get_alert_state(rule.id)
            prev_key = prev["alert_key"] if prev else None
            since = prev["since"] if (prev and prev_key == key) else now
            statuses[rule.id] = {
                "id": rule.id,
                "title": rule.title,
                "emoji": rule.emoji,
                "firing": key is not None,
                "message": message,
                "since": since if key is not None else None,
            }

            if prev is None:
                db.set_alert_state(rule.id, key, now)  # prime silently
                continue
            if key != prev_key:
                if key is not None:
                    self._fire(rule, message, now)
                elif rule.notify_on_clear and prev_key is not None:
                    self._clear(rule, now)
                db.set_alert_state(rule.id, key, now)

        with self._lock:
            self._status = statuses

    def _fire(self, rule: Rule, message: str, now: float) -> None:
        notify.notify(message, title=f"Home HQ - {rule.title}", priority=rule.priority,
                      tags=[rule.emoji], click=_click_url(rule))
        db.add_alert_log(now, rule.id, "fire", message)
        log.info("alert FIRED [%s]: %s", rule.id, message)

    def _clear(self, rule: Rule, now: float) -> None:
        msg = f"{rule.title}: resolved"
        notify.notify(msg, title="Home HQ", priority="default",
                      tags=[rule.emoji, "white_check_mark"], click=_click_url(rule))
        db.add_alert_log(now, rule.id, "clear", msg)
        log.info("alert CLEARED [%s]", rule.id)

    def status(self) -> list[dict]:
        with self._lock:
            return [self._status[r.id] for r in RULES if r.id in self._status]


# Process-wide singleton, wired up in the app lifespan (main.py).
_manager: AlertManager | None = None


def init_manager(interval: int) -> AlertManager:
    global _manager
    _manager = AlertManager(interval)
    return _manager


def get_manager() -> AlertManager | None:
    return _manager
