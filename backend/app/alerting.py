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
from dataclasses import dataclass, field
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
    # Per-condition override of `priority`, keyed by the check's returned key.
    # For a rule whose conditions differ in weight (a VPN leak vs a dead tunnel).
    key_priority: dict = field(default_factory=dict)


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
    # Fire on the drive's last-reported health — even when the report is stale.
    # During a hard wedge the watchdog backs off for minutes between probes, so
    # its state file goes "stale" (older than the stale window) while it's still
    # actively managing a known-bad drive. Treating stale as "clear" made the
    # alert flap unhealthy -> resolved -> unhealthy every few minutes. Staleness
    # is still surfaced in the API/UI; it just no longer clears an active
    # drive-unhealthy alert. A stale-but-healthy report still doesn't alarm (the
    # last report has to actually say unhealthy).
    if not w.get("healthy"):
        return "unhealthy", f"Drive {w.get('label') or 'external'} is unhealthy ({w.get('note')})"
    return None, ""


def _check_containers(ctx):
    c = ctx.get("containers") or {}
    if not c.get("available"):
        return None, ""
    # Skip `*-dev` containers: they're opt-in `profiles: ["dev"]` services that
    # are *expected* to be down most of the time, so a stopped dev container
    # isn't a fault worth a push. Prod containers don't carry the suffix.
    #
    # `created` counts as down. A container that compose gave up on (its
    # dependency's healthcheck flapped at boot) sits in `created` indefinitely:
    # it has never run, so no restart policy will ever touch it, and it is
    # invisible to `docker ps`. Two did exactly that for four days in Aug 2026
    # while everything else read healthy. `restarting` is a crash loop.
    down = sorted(
        x["name"]
        for x in c.get("containers", [])
        if x.get("status") in ("exited", "dead", "created", "restarting") and not x["name"].endswith("-dev")
    )
    if down:
        return "down:" + ",".join(down), f"Container(s) down: {', '.join(down)}"
    return None, ""


# A completion older than this is never announced, however the printer reports.
_PRINT_DONE_WINDOW_S = 24 * 3600


def _check_printer(ctx):
    """Fire once per *completed* print, and clear once the printer moves on.

    Dedupe on the latest recorded `print_history` row id — the same
    RUNNING/PAUSE→FINISH/FAILED completion the printer page shows — so loading a
    new plate without printing (which leaves the Bambu sitting in FINISH,
    re-publishing the same telemetry) can't edge-trigger a phantom alert: the id
    only changes when a genuinely new print is recorded. We also gate on the
    *live* terminal state so the rule reads OK again once the printer powers off
    or starts the next job, instead of staying amber forever.

    Two guards keep that gate from re-arming the edge. A tick with NO live
    snapshot (MQTT reconnecting, a telemetry gap over 60 s — the printer sits
    behind a second router) HOLDS the stored key rather than reading as cleared:
    clearing on the blip and then seeing the same FINISH again re-fired a
    five-week-old completion twice in Sept 2026. And a recorded completion older
    than _PRINT_DONE_WINDOW_S is never announced at all, whatever the printer
    reports, so nothing it does later can resurrect it."""
    if "last_print" not in ctx:
        # Print history couldn't be read this tick. Raise so the engine SKIPS the
        # rule (preserving its stored key) instead of reading the absence as
        # "cleared" and re-firing the already-announced completion next tick.
        raise RuntimeError("print history unavailable")
    last = ctx["last_print"]
    if not last:
        return None, ""
    ended, now = last.get("ended_at"), ctx.get("now")
    if ended and now and now - ended > _PRINT_DONE_WINDOW_S:
        return None, ""  # old news: nothing to announce, live state irrelevant
    p = ctx.get("printer") or {}
    if not p.get("available"):
        raise RuntimeError("printer snapshot unavailable")  # hold, don't clear
    pr = p.get("printer") or {}
    if pr.get("state") not in ("FINISH", "FAILED"):
        return None, ""
    name = last.get("file") or "print"
    if last.get("result") == "success":
        return f"done:{last['id']}", f"Print finished: {name}"
    return f"failed:{last['id']}", f"Print FAILED: {name}"


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


# When the tunnel first read "down" under a running container; None while it
# isn't. In memory on purpose — a backend restart just restarts the clock.
_vpn_down_since: float | None = None


def _check_vpn(ctx):
    """Fire on a genuine LEAK, and on a tunnel that is down while the container
    is still running.

    The leak case is the security one: the VPN's egress IP equals the home IP,
    so protected traffic isn't being masked.

    The tunnel case is the availability one. `status == "down"` covers two very
    different situations and only one is benign:
      * container NOT running -> intentional. A host monitor may stop it on
        purpose, and the kill-switch means no traffic escapes. Staying quiet
        here is right; alarming would just spam.
      * container running, no egress IP -> the tunnel is dead while everything
        looks up. Nothing leaks (the kill-switch still holds), but nothing works
        either: no traffic passes.
        This went unnoticed for ~50 hours in Aug 2026, so it now alerts.

    Deliberately NOT alerted: a protected tunnel with no forwarded port. The port
    is optional and comes and goes on its own between samples, so that rule would
    flap on a healthy tunnel. The dead-tunnel case above already covers the outage
    that matters.

    The tunnel case fires only once "down" has PERSISTED for
    `alert_vpn_down_minutes`. One sample is not a verdict: the collector learns
    the exit IP by fetching an IP-echo from inside the container, and when the
    container's own resolver hiccups every echo times out together — the sample
    records no exit IP and reads exactly like a dead tunnel. That was ~1 urgent
    false alarm a day in Sept 2026, each "resolved" by the next 5-minute sample,
    while the real tunnel restarts self-healed in seconds and never overlapped a
    sample at all. A tunnel that is still down three samples later is real.

    Stale = the checker isn't running, so the state is unknown; don't alarm on it.
    """
    global _vpn_down_since
    v = ctx.get("vpn") or {}
    usable = v.get("available") and not v.get("stale")
    down_running = usable and v.get("status") == "down" and v.get("container_running")
    if not down_running:
        # Any other reading — protected, stopped, stale, missing — breaks the
        # streak. Two blips either side of a gap must not add up to an outage.
        _vpn_down_since = None
    if not usable:
        return None, ""
    if v.get("status") == "leak":
        return "leak", "VPN LEAK: protected traffic is exiting via your home IP, not the VPN"
    if down_running:
        now = ctx.get("now") or time.time()
        if _vpn_down_since is None:
            _vpn_down_since = now
        if now - _vpn_down_since < settings.alert_vpn_down_minutes * 60:
            return None, ""
        return "tunnel", (
            f"VPN tunnel is down but {v.get('container') or 'the container'} is still "
            f"running (for over {settings.alert_vpn_down_minutes} min) — no traffic is "
            "escaping, but nothing is getting out either (no traffic is passing)"
        )
    return None, ""


def _check_speedtest(ctx):
    """Fire when the latest measured download is below the configured floor —
    an early read on the ISP under-delivering. Disabled (no alert) when
    SPEEDTEST_MIN_DOWNLOAD is 0; quiet when there's no sample yet."""
    floor = settings.speedtest_min_download
    if floor <= 0:
        return None, ""
    s = ctx.get("speedtest") or {}
    down = s.get("download_mbps")
    if down is None:
        return None, ""
    if down < floor:
        return f"slow:{down}", f"Internet slow: {down:.0f} Mbps down (below {floor:.0f})"
    return None, ""


def _check_db(ctx):
    """Warn if the local SQLite DB has grown past the configured ceiling — an
    early signal that a sampler/log is writing more than expected."""
    d = ctx.get("db") or {}
    size = d.get("size_bytes")
    if size is None:
        return None, ""
    if size > settings.alert_db_max_mb * 1024 * 1024:
        mb = size / (1024 * 1024)
        return f"big:{int(mb)}", f"Home HQ database is {mb:.0f} MB (over {settings.alert_db_max_mb} MB limit)"
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
    # A leak is the security case and stays urgent; a dead tunnel (already held
    # for alert_vpn_down_minutes) is an outage but wakes nobody up.
    Rule("vpn", "VPN egress", "lock", "urgent", True, _check_vpn, path="/vpn",
         key_priority={"tunnel": "high"}),
    Rule("speedtest", "Internet speed", "snail", "high", True, _check_speedtest, path="/speedtest"),
    Rule("db", "Database size", "card_index_dividers", "high", True, _check_db, path="/storage"),
]

# Valid rule ids, for validating mute requests against typo'd / stale ids.
RULE_IDS = frozenset(r.id for r in RULES)


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
        # Last failure message per rule, so a rule that raises every tick (the
        # printer rule holding through a day-long power-off) logs once, not 720
        # times a day.
        self._rule_errors: dict[str, str] = {}

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
            "db": db.db_stats,
            # The latest stored speedtest result (or {} when none yet). Reads
            # SQLite, not the CLI — _check_speedtest just compares the last number.
            "speedtest": lambda: db.latest_speedtest_sample() or {},
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
        # The most recent *recorded* completion (a print_history row). The printer
        # finish alert keys off this so it stays 1:1 with the printer page rather
        # than re-firing on live-snapshot filename churn. On a read error leave
        # `last_print` ABSENT (not None) — _check_printer then holds its state
        # instead of treating the gap as a cleared/finished print.
        try:
            recent = db.recent_prints(1)
            ctx["last_print"] = recent[0] if recent else None
        except Exception:
            pass
        return ctx

    def evaluate(self) -> None:
        ctx = self.build_context()
        now = ctx["now"]
        muted = db.muted_rule_ids()
        statuses: dict[str, dict] = {}
        for rule in RULES:
            try:
                key, message = rule.check(ctx)
            except Exception as exc:
                # The rule is holding (or broke). Keep its stored key untouched
                # AND carry its last row forward, so the Alerts page doesn't lose
                # the entry for as long as the hold lasts.
                if self._rule_errors.get(rule.id) != str(exc):
                    log.info("alerting: rule %s holding: %s", rule.id, exc)
                    self._rule_errors[rule.id] = str(exc)
                if rule.id in self._status:
                    statuses[rule.id] = self._status[rule.id]
                continue
            self._rule_errors.pop(rule.id, None)

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
                "muted": rule.id in muted,
            }

            if prev is None:
                db.set_alert_state(rule.id, key, now)  # prime silently
                continue
            if key != prev_key:
                # A muted rule still consumes its edge (state is recorded) but
                # sends no push — so unmuting resumes on the NEXT change, not a
                # replay of whatever it's doing right now.
                if rule.id not in muted:
                    if key is not None:
                        self._fire(rule, message, now, key)
                    elif rule.notify_on_clear and prev_key is not None:
                        self._clear(rule, now)
                db.set_alert_state(rule.id, key, now)

        with self._lock:
            self._status = statuses

    def _fire(self, rule: Rule, message: str, now: float, key: str | None = None) -> None:
        priority = rule.key_priority.get(key, rule.priority) if key else rule.priority
        notify.notify(message, title=f"Home HQ - {rule.title}", priority=priority,
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
