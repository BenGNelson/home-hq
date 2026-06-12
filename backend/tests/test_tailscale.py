"""Tests for the Tailscale status summarizer (pure, no real file)."""

from app.routers.tailscale import _STALE_AFTER_SECONDS, summarize

NOW = 1_000_000.0

SELF = {
    "hostname": "home-server", "dns_name": "home-server.tailnet.ts.net",
    "os": "linux", "online": True, "ip": "100.64.0.1",
    "exit_node": False, "exit_node_option": False, "last_seen": None, "self": True,
}
PHONE = {
    "hostname": "phone", "dns_name": "phone.tailnet.ts.net", "os": "iOS",
    "online": True, "ip": "100.64.0.2", "exit_node": False,
    "exit_node_option": False, "last_seen": NOW - 60, "self": False,
}
LAPTOP = {
    "hostname": "laptop", "dns_name": "laptop.tailnet.ts.net", "os": "windows",
    "online": False, "ip": "100.64.0.3", "exit_node": False,
    "exit_node_option": True, "last_seen": NOW - 7200, "self": False,
}

RUNNING = {
    "updated": NOW - 30,
    "available": True,
    "tailnet": "tailnet.ts.net",
    "magicdns": True,
    "backend_state": "Running",
    "self": SELF,
    # Deliberately unsorted: offline laptop before online phone.
    "peers": [LAPTOP, PHONE],
}


def test_up_with_counts():
    out = summarize(RUNNING, now=NOW)
    assert out["available"] is True
    assert out["status"] == "up"
    assert out["stale"] is False
    assert out["peer_count"] == 2
    assert out["online_count"] == 1  # only the phone is online
    assert out["tailnet"] == "tailnet.ts.net"
    assert out["magicdns"] is True


def test_peers_sorted_online_first_then_name():
    out = summarize(RUNNING, now=NOW)
    # Online phone sorts ahead of the offline laptop despite input order.
    assert [p["hostname"] for p in out["peers"]] == ["phone", "laptop"]


def test_exit_node_detected_when_in_use():
    data = {**RUNNING, "peers": [{**LAPTOP, "online": True, "exit_node": True}, PHONE]}
    out = summarize(data, now=NOW)
    assert out["exit_node"] == "laptop"


def test_no_exit_node_when_only_offered():
    # LAPTOP offers (exit_node_option) but isn't in use (exit_node False).
    out = summarize(RUNNING, now=NOW)
    assert out["exit_node"] is None


def test_unavailable_when_tailscale_not_running():
    out = summarize({"updated": NOW - 10, "available": False}, now=NOW)
    assert out["available"] is True
    assert out["status"] == "unavailable"
    assert out["peers"] == [] and out["peer_count"] == 0
    assert out["self"] is None


def test_down_when_backend_not_running():
    out = summarize({**RUNNING, "backend_state": "Stopped"}, now=NOW)
    assert out["status"] == "down"


def test_stale_when_old():
    data = {**RUNNING, "updated": NOW - (_STALE_AFTER_SECONDS + 60)}
    out = summarize(data, now=NOW)
    assert out["stale"] is True
