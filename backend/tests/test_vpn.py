"""Tests for the VPN egress summarizer + leak alert check (pure, no real file)."""

from app.alerting import _check_vpn
from app.routers.vpn import _STALE_AFTER_SECONDS, summarize

NOW = 1_000_000.0

PROTECTED = {
    "updated": NOW - 30,
    "container": "gluetun",
    "container_running": True,
    "home": {"ip": "203.0.113.7", "org": "AS1 Home ISP", "city": "Townsville",
             "region": "Somewhere", "country": "US"},
    "vpn": {"ip": "198.51.100.9", "org": "AS2 VPN Host", "country": "NL"},
    "forwarded_port": 34525,
}


def test_protected_when_ips_differ():
    out = summarize(PROTECTED, now=NOW)
    assert out["available"] is True
    assert out["status"] == "protected"
    assert out["leak"] is False
    assert out["stale"] is False
    assert out["forwarded_port"] == 34525


def test_home_ip_masked_and_city_dropped():
    out = summarize(PROTECTED, now=NOW)
    # The real home address must never reach the response — only a masked form.
    assert out["home"]["ip"] == "203.0.•.•"
    assert "203.0.113.7" not in str(out["home"])
    assert "city" not in out["home"] and "region" not in out["home"]
    assert out["home"]["org"] == "AS1 Home ISP"  # ISP/country are kept for contrast
    # The VPN exit is NOT masked (a shared server IP, and the point of the page).
    assert out["vpn"]["ip"] == "198.51.100.9"


def test_leak_when_egress_equals_home_ip():
    data = {**PROTECTED, "vpn": {"ip": "203.0.113.7", "org": "AS1 Home ISP"}}
    out = summarize(data, now=NOW)
    assert out["status"] == "leak"
    assert out["leak"] is True


def test_down_when_container_not_running():
    data = {**PROTECTED, "container_running": False, "vpn": {}}
    out = summarize(data, now=NOW)
    assert out["status"] == "down"
    assert out["leak"] is False


def test_down_when_vpn_lookup_failed():
    data = {**PROTECTED, "vpn": {}}
    out = summarize(data, now=NOW)
    assert out["status"] == "down"


def test_stale_when_old():
    data = {**PROTECTED, "updated": NOW - (_STALE_AFTER_SECONDS + 60)}
    out = summarize(data, now=NOW)
    assert out["stale"] is True


def test_stale_when_no_timestamp():
    data = {**PROTECTED}
    del data["updated"]
    out = summarize(data, now=NOW)
    assert out["stale"] is True


# --- alert rule: fires ONLY on a fresh leak ---------------------------------


def _ctx(vpn):
    return {"now": NOW, "vpn": vpn}


def test_alert_fires_on_leak():
    v = summarize({**PROTECTED, "vpn": {"ip": "203.0.113.7"}}, now=NOW)
    key, msg = _check_vpn(_ctx(v))
    assert key == "leak"
    assert "home IP" in msg


def test_alert_silent_when_protected():
    key, _ = _check_vpn(_ctx(summarize(PROTECTED, now=NOW)))
    assert key is None


def test_alert_silent_when_down():
    v = summarize({**PROTECTED, "container_running": False, "vpn": {}}, now=NOW)
    key, _ = _check_vpn(_ctx(v))
    assert key is None


def test_alert_silent_when_stale_even_if_leak():
    # A stale leak verdict is untrustworthy (checker not running) → don't alarm.
    v = summarize(
        {**PROTECTED, "vpn": {"ip": "203.0.113.7"}, "updated": NOW - (_STALE_AFTER_SECONDS + 60)},
        now=NOW,
    )
    key, _ = _check_vpn(_ctx(v))
    assert key is None


def test_alert_silent_when_unavailable():
    key, _ = _check_vpn(_ctx({"available": False}))
    assert key is None
