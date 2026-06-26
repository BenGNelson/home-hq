"""Tests for the alerting engine: rule checks (pure) + edge-trigger behavior."""

import pytest

from app import alerting, notify
from app.alerting import (
    RULES,
    AlertManager,
    Rule,
    _check_backup,
    _check_containers,
    _check_db,
    _check_disk,
    _check_printer,
    _check_printer_hms,
    _check_printer_offline,
    _check_printer_paused,
    _check_raid,
    _check_smart,
    _check_vpn,
    _check_watchdog,
    _click_url,
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


def test_vpn_fires_only_on_a_real_leak():
    # A leak (protected traffic exiting via the home IP) is the one thing to alert.
    key, msg = _check_vpn({"vpn": {"available": True, "status": "leak"}})
    assert key == "leak"
    assert "LEAK" in msg
    # Protected / down are benign (down = kill-switch dropped traffic, not a leak).
    assert _check_vpn({"vpn": {"available": True, "status": "protected"}}) == (None, "")
    assert _check_vpn({"vpn": {"available": True, "status": "down"}}) == (None, "")


def test_vpn_silent_when_unavailable_or_stale():
    # Stale = the checker isn't running, so the state is unknown — don't cry leak.
    assert _check_vpn({"vpn": {"available": True, "status": "leak", "stale": True}}) == (None, "")
    assert _check_vpn({"vpn": {"available": False, "status": "leak"}}) == (None, "")
    assert _check_vpn({}) == (None, "")


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


def test_db_over_ceiling_vs_ok():
    over = settings.alert_db_max_mb * 1024 * 1024 + 1
    key, msg = _check_db({"db": {"size_bytes": over}})
    assert key.startswith("big:") and "MB" in msg
    under = {"db": {"size_bytes": settings.alert_db_max_mb * 1024 * 1024 - 1}}
    assert _check_db(under) == (None, "")
    # No size reading at all -> quiet.
    assert _check_db({"db": {"size_bytes": None}}) == (None, "")


def test_watchdog_unhealthy_fires_even_when_stale():
    bad = {"watchdog": {"available": True, "healthy": False, "stale": False, "label": "4tex", "note": "recovery-failed"}}
    assert _check_watchdog(bad)[0] == "unhealthy"
    # A stale report must NOT clear an active unhealthy alert (this was the flapping
    # bug): during a hard wedge the watchdog backs off for minutes, so its state goes
    # stale while the drive is still known-bad. Stale + unhealthy keeps firing.
    stale_bad = {"watchdog": {"available": True, "healthy": False, "stale": True, "label": "4tex"}}
    assert _check_watchdog(stale_bad)[0] == "unhealthy"
    # Stale but last-known healthy still doesn't alarm.
    stale_ok = {"watchdog": {"available": True, "healthy": True, "stale": True, "label": "4tex"}}
    assert _check_watchdog(stale_ok) == (None, "")
    # Not configured -> quiet.
    assert _check_watchdog({"watchdog": {"available": False}}) == (None, "")


def test_container_down():
    ctx = {"containers": {"available": True, "containers": [
        {"name": "plex", "status": "running"}, {"name": "qb", "status": "exited"}]}}
    key, msg = _check_containers(ctx)
    assert key == "down:qb" and "qb" in msg


def test_container_down_skips_dev_containers():
    # `*-dev` are opt-in dev services expected to be down — not alert-worthy.
    ctx = {"containers": {"available": True, "containers": [
        {"name": "home-hq-frontend-dev", "status": "exited"},
        {"name": "fair-play-web-dev", "status": "exited"},
        {"name": "qb", "status": "exited"}]}}
    key, msg = _check_containers(ctx)
    assert key == "down:qb" and "dev" not in msg
    # A lone dev container down stays quiet.
    ctx_dev_only = {"containers": {"available": True, "containers": [
        {"name": "home-hq-frontend-dev", "status": "exited"}]}}
    assert _check_containers(ctx_dev_only) == (None, "")


def test_printer_done_failed_idle():
    # Gated on the live terminal state; dedup key comes from the latest RECORDED
    # print_history row (ctx["last_print"]) so it's 1:1 with the printer page.
    def ctx(state, last):
        return {"printer": {"available": True, "printer": {"state": state}}, "last_print": last}

    row = {"id": 7, "file": "a.3mf", "result": "success"}
    assert _check_printer(ctx("FINISH", row)) == ("done:7", "Print finished: a.3mf")
    assert _check_printer(ctx("FINISH", {"id": 7, "file": "a.3mf", "result": "failed"}))[0] == "failed:7"
    # Printer isn't sitting on a finished plate -> OK regardless of history,
    # so the UI clears once it powers off / starts the next job.
    assert _check_printer(ctx("RUNNING", row)) == (None, "")
    assert _check_printer(ctx("IDLE", row)) == (None, "")
    assert _check_printer({"last_print": row}) == (None, "")  # no snapshot at all
    # Sitting in FINISH but nothing recorded yet -> nothing to announce.
    assert _check_printer(ctx("FINISH", None)) == (None, "")
    # Sitting in FINISH but history unreadable this tick -> raise so the engine
    # skips (holds state) instead of clearing.
    with pytest.raises(RuntimeError):
        _check_printer({"printer": {"available": True, "printer": {"state": "FINISH"}}})


def test_printer_paused_surfaces_stage():
    ctx = {"printer": {"available": True, "printer": {"state": "PAUSE", "stage": "Changing filament"}}}
    key, msg = _check_printer_paused(ctx)
    assert key == "paused" and "Changing filament" in msg
    assert _check_printer_paused({"printer": {"available": True, "printer": {"state": "RUNNING"}}}) == (None, "")


def test_printer_hms():
    ctx = {"printer": {"available": True, "printer": {"hms": [{"code": "0300"}, {"code": "0500"}]}}}
    key, msg = _check_printer_hms(ctx)
    assert key == "hms:0300, 0500" and "0300" in msg
    assert _check_printer_hms({"printer": {"available": True, "printer": {"hms": []}}}) == (None, "")


def test_printer_offline_only_mid_print():
    midprint = {"printer": {"available": False, "reason": "offline", "last_state": "RUNNING"}}
    assert _check_printer_offline(midprint)[0] == "offline"
    # idle power-down stays quiet; never-configured/no-data ignored
    assert _check_printer_offline({"printer": {"available": False, "reason": "offline", "last_state": "IDLE"}}) == (None, "")
    assert _check_printer_offline({"printer": {"available": False, "reason": "not_configured"}}) == (None, "")


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


def test_printer_alert_fires_once_per_recorded_print(monkeypatch):
    # A new print_history row (new id) fires exactly once; the same id sitting
    # there across ticks (printer idling in FINISH) never re-fires.
    sent = []
    monkeypatch.setattr(notify, "notify", lambda *a, **k: (sent.append((a, k)), True)[1])
    mgr = AlertManager(60)

    def ctx_last(print_row, now, state="FINISH"):
        return {"now": now, "printer": {"available": True, "printer": {"state": state}},
                "last_print": print_row}

    # 1) prime silently on the print already on the bed
    monkeypatch.setattr(mgr, "build_context", lambda: ctx_last({"id": 1, "file": "a.3mf", "result": "success"}, NOW))
    mgr.evaluate()
    assert sent == []

    # 2) same id across ticks -> no fire (no new completion)
    mgr.evaluate()
    assert sent == []

    # 3) a new print completes (new id) -> one notification
    monkeypatch.setattr(mgr, "build_context", lambda: ctx_last({"id": 2, "file": "b.3mf", "result": "success"}, NOW + 60))
    mgr.evaluate()
    assert len(sent) == 1

    # 4) printer powers off / leaves terminal state -> rule clears to OK (no push,
    #    notify_on_clear=False) so the UI doesn't stay amber forever.
    monkeypatch.setattr(mgr, "build_context",
                        lambda: ctx_last({"id": 2, "file": "b.3mf", "result": "success"}, NOW + 120, state="IDLE"))
    mgr.evaluate()
    assert len(sent) == 1
    assert any(r["id"] == "printer" and r["firing"] is False for r in mgr.status())


def test_printer_alert_holds_state_when_history_unreadable(monkeypatch):
    # A transient print-history read error (last_print absent) must NOT clear the
    # key and re-fire the already-announced completion on the next good tick.
    sent = []
    monkeypatch.setattr(notify, "notify", lambda *a, **k: (sent.append((a, k)), True)[1])
    mgr = AlertManager(60)
    term = {"printer": {"available": True, "printer": {"state": "FINISH"}}}
    row = {"id": 1, "file": "a.3mf", "result": "success"}

    monkeypatch.setattr(mgr, "build_context", lambda: {"now": NOW, **term, "last_print": row})
    mgr.evaluate()  # prime
    # history unreadable this tick -> rule raises -> engine skips, state preserved
    monkeypatch.setattr(mgr, "build_context", lambda: {"now": NOW + 60, **term})
    mgr.evaluate()
    # readable again, SAME completion -> must not re-fire
    monkeypatch.setattr(mgr, "build_context", lambda: {"now": NOW + 120, **term, "last_print": row})
    mgr.evaluate()
    assert sent == []


def test_heartbeat_pings_when_configured(monkeypatch):
    seen = {}

    class _R:
        def close(self):
            seen["closed"] = True

    monkeypatch.setattr(alerting.urllib.request, "urlopen", lambda url, timeout=None: (seen.__setitem__("url", url), _R())[1])
    monkeypatch.setattr(settings, "healthcheck_ping_url", "https://hc.example/ping")
    AlertManager(60)._heartbeat()
    assert seen["url"] == "https://hc.example/ping"


def test_heartbeat_noop_when_unset(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("should not ping when no URL is set")

    monkeypatch.setattr(alerting.urllib.request, "urlopen", boom)
    monkeypatch.setattr(settings, "healthcheck_ping_url", "")
    AlertManager(60)._heartbeat()  # no exception = pass


# --- deep-link (tap an alert -> open the relevant page) ---------------------


def test_every_rule_has_a_deep_link_path():
    # Every alert should know which in-app page it's about.
    assert all(r.path.startswith("/") for r in RULES)


def test_click_url_joins_base_and_path(monkeypatch):
    rule = Rule("x", "X", "tag", "high", True, lambda c: (None, ""), path="/storage")
    # Trailing slash on the base must not double up.
    monkeypatch.setattr(settings, "alert_click_url", "https://host.example/")
    assert _click_url(rule) == "https://host.example/storage"
    monkeypatch.setattr(settings, "alert_click_url", "https://host.example")
    assert _click_url(rule) == "https://host.example/storage"


def test_click_url_none_when_base_unset(monkeypatch):
    rule = Rule("x", "X", "tag", "high", True, lambda c: (None, ""), path="/storage")
    monkeypatch.setattr(settings, "alert_click_url", "")
    assert _click_url(rule) is None


def test_fire_passes_per_rule_click(monkeypatch):
    sent = []
    monkeypatch.setattr(notify, "notify", lambda *a, **k: (sent.append(k), True)[1])
    monkeypatch.setattr(settings, "alert_click_url", "https://host.example")
    raid_rule = next(r for r in RULES if r.id == "raid")
    AlertManager(60)._fire(raid_rule, "boom", NOW)
    assert sent[0]["click"] == "https://host.example/storage"


# --- per-rule mute toggles --------------------------------------------------


def test_mute_roundtrip():
    from app import db

    assert db.muted_rule_ids() == set()
    db.set_rule_muted("disk", True)
    db.set_rule_muted("disk", True)  # idempotent
    assert db.muted_rule_ids() == {"disk"}
    db.set_rule_muted("disk", False)
    assert db.muted_rule_ids() == set()


def test_muted_rule_suppresses_push_but_tracks_state(monkeypatch):
    from app import db

    sent = []
    monkeypatch.setattr(notify, "notify", lambda *a, **k: (sent.append((a, k)), True)[1])
    mgr = AlertManager(60)

    def ctx_disk(pct, now):
        return {"now": now, "disk": {"available": True, "mount": "/m", "percent": pct}}

    # Mute disk, then prime OK and cross the threshold: no push, but status shows
    # it firing-and-muted and the edge is consumed.
    db.set_rule_muted("disk", True)
    monkeypatch.setattr(mgr, "build_context", lambda: ctx_disk(50.0, NOW))
    mgr.evaluate()
    monkeypatch.setattr(mgr, "build_context", lambda: ctx_disk(97.0, NOW + 60))
    mgr.evaluate()
    assert sent == []  # muted -> silent
    disk_status = next(s for s in mgr.status() if s["id"] == "disk")
    assert disk_status["firing"] is True and disk_status["muted"] is True

    # Unmute: because the edge was already consumed, a STEADY condition doesn't
    # replay — only the next change fires.
    db.set_rule_muted("disk", False)
    mgr.evaluate()
    assert sent == []


def test_mute_endpoint_toggles_and_validates(client):
    # Mute a real rule, see it reflected in GET, then unmute.
    r = client.post("/api/alerts/disk/mute", json={"muted": True})
    assert r.status_code == 200 and r.json() == {"rule_id": "disk", "muted": True}

    rules = client.get("/api/alerts").json()["rules"]
    disk = next((x for x in rules if x["id"] == "disk"), None)
    if disk is not None:  # present once the engine has evaluated at least once
        assert disk["muted"] is True

    assert client.post("/api/alerts/disk/mute", json={"muted": False}).json()["muted"] is False
    # An unknown rule id is rejected.
    assert client.post("/api/alerts/nope/mute", json={"muted": True}).status_code == 404
