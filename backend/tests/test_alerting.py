"""Tests for the alerting engine: rule checks (pure) + edge-trigger behavior."""

from app import alerting, notify
from app.alerting import (
    AlertManager,
    _check_backup,
    _check_containers,
    _check_disk,
    _check_printer,
    _check_raid,
    _check_smart,
    _check_watchdog,
)
from app.config import settings

NOW = 1_000_000.0


# --- rule checks ------------------------------------------------------------


def test_backup_ok_when_fresh():
    assert _check_backup({"now": NOW, "backups": {"configured": True, "last_backup": NOW - 3600}}) == (None, "")


def test_backup_stale_and_missing():
    old = NOW - (settings.alert_backup_max_age_days + 2) * 86400
    key, msg = _check_backup({"now": NOW, "backups": {"configured": True, "last_backup": old}})
    assert key == "stale" and "days" in msg
    key2, _ = _check_backup({"now": NOW, "backups": {"configured": True, "last_backup": None}})
    assert key2 == "missing"


def test_backup_ignored_when_unconfigured():
    assert _check_backup({"now": NOW, "backups": {"configured": False}}) == (None, "")


def test_raid_degraded_vs_healthy():
    bad = {"raid": {"available": True, "arrays": [{"name": "md0", "healthy": False, "status": "U_U", "failed": ["sdc2"]}]}}
    key, msg = _check_raid(bad)
    assert key.startswith("degraded") and "md0" in msg
    ok = {"raid": {"available": True, "arrays": [{"name": "md0", "healthy": True, "status": "UUU", "failed": []}]}}
    assert _check_raid(ok) == (None, "")


def test_smart_fail_outranks_warn():
    ctx = {"smart": {"available": True, "drives": [
        {"name": "sda", "passed": False, "warnings": ["x"]},
        {"name": "sdb", "passed": True, "warnings": ["1 pending"]},
    ]}}
    key, msg = _check_smart(ctx)
    assert key.startswith("fail:") and "sda" in msg


def test_smart_warn_only():
    ctx = {"smart": {"available": True, "drives": [{"name": "sdb", "passed": True, "warnings": ["1 pending"]}]}}
    assert _check_smart(ctx)[0] == "warn:sdb"


def test_disk_full_vs_ok():
    full = {"disk": {"available": True, "mount": "/m", "percent": 96.0}}
    key, msg = _check_disk(full)
    assert key.startswith("full:") and "96%" in msg
    assert _check_disk({"disk": {"available": True, "mount": "/m", "percent": 80.0}}) == (None, "")


def test_watchdog_unhealthy_but_not_stale():
    bad = {"watchdog": {"available": True, "healthy": False, "stale": False, "label": "4tex", "note": "recovery-failed"}}
    assert _check_watchdog(bad)[0] == "unhealthy"
    stale = {"watchdog": {"available": True, "healthy": False, "stale": True, "label": "4tex"}}
    assert _check_watchdog(stale) == (None, "")


def test_container_down():
    ctx = {"containers": {"available": True, "containers": [
        {"name": "plex", "status": "running"}, {"name": "qb", "status": "exited"}]}}
    key, msg = _check_containers(ctx)
    assert key == "down:qb" and "qb" in msg


def test_printer_done_failed_running():
    # ctx["printer"] holds the printer SNAPSHOT, i.e. {available, printer:{...}}.
    def pctx(state):
        return {"printer": {"available": True, "printer": {"state": state, "file": "a.3mf"}}}

    assert _check_printer(pctx("FINISH"))[0] == "done:a.3mf"
    assert _check_printer(pctx("FAILED"))[0] == "failed:a.3mf"
    assert _check_printer(pctx("RUNNING")) == (None, "")


# --- edge-trigger behavior (db-backed, notify mocked) -----------------------


def test_edge_trigger_prime_fire_dedupe_clear(monkeypatch):
    sent = []
    monkeypatch.setattr(notify, "notify", lambda *a, **k: (sent.append((a, k)), True)[1])
    mgr = AlertManager(60)

    def ctx_disk(pct, now):
        return {"now": now, "disk": {"available": True, "mount": "/m", "percent": pct}}

    # 1) first pass, disk OK -> primes silently
    monkeypatch.setattr(mgr, "build_context", lambda: ctx_disk(50.0, NOW))
    mgr.evaluate()
    assert sent == []

    # 2) disk crosses threshold -> one notification
    monkeypatch.setattr(mgr, "build_context", lambda: ctx_disk(97.0, NOW + 60))
    mgr.evaluate()
    assert len(sent) == 1

    # 3) still full (same key) -> no duplicate
    mgr.evaluate()
    assert len(sent) == 1

    # 4) recovered -> a "resolved" notification (rule.notify_on_clear=True)
    monkeypatch.setattr(mgr, "build_context", lambda: ctx_disk(60.0, NOW + 180))
    mgr.evaluate()
    assert len(sent) == 2
    assert any(r["firing"] is False for r in mgr.status())
