"""Tests for the Speedtest / ISP monitor: the PURE parse_result + the alert rule.

PRIVACY: every fixture here uses FAKE data — no real ISP name, server location,
or result URL. The parser is the only piece exercised here (a real speedtest run
moves ~3.5 GB and needs the network, so it's never invoked in tests).
"""

from app.alerting import RULES, _check_speedtest
from app.config import settings
from app.speedtest import parse_result

NOW = 1_000_000.0


# A hand-written stand-in for what the Ookla CLI emits with --format=json.
# bandwidth fields are BYTES/sec: 125_000_000 B/s * 8 / 1e6 = 1000.0 Mbps.
def _fake_ookla(**overrides):
    data = {
        "download": {"bandwidth": 125_000_000},   # → 1000.0 Mbps
        "upload": {"bandwidth": 12_500_000},       # → 100.0 Mbps
        "ping": {"latency": 12.34, "jitter": 1.56},
        "packetLoss": 0.0,
        "server": {"name": "FakeISP", "location": "Springfield, ZZ"},
        "isp": "Fake Networks",
        "result": {"url": "https://example.test/result/abc123"},
    }
    data.update(overrides)
    return data


# --- parse_result (pure) ----------------------------------------------------


def test_parse_converts_bytes_per_sec_to_mbps():
    rec = parse_result(_fake_ookla(), now=NOW)
    assert rec["download_mbps"] == 1000.0   # 125 MB/s * 8 / 1e6
    assert rec["upload_mbps"] == 100.0      # 12.5 MB/s * 8 / 1e6
    assert rec["ts"] == int(NOW)


def test_parse_rounds_ping_and_jitter():
    rec = parse_result(_fake_ookla(), now=NOW)
    assert rec["ping_ms"] == 12.3
    assert rec["jitter_ms"] == 1.6


def test_parse_combines_server_name_and_location():
    rec = parse_result(_fake_ookla(), now=NOW)
    assert rec["server"] == "FakeISP - Springfield, ZZ"
    assert rec["isp"] == "Fake Networks"
    assert rec["result_url"] == "https://example.test/result/abc123"


def test_parse_server_with_only_name():
    rec = parse_result(_fake_ookla(server={"name": "FakeISP"}), now=NOW)
    assert rec["server"] == "FakeISP"


def test_parse_tolerates_missing_packet_loss():
    data = _fake_ookla()
    del data["packetLoss"]
    rec = parse_result(data, now=NOW)
    assert rec["packet_loss"] is None


def test_parse_tolerates_missing_jitter_and_fields():
    data = _fake_ookla(ping={"latency": 9.0})  # no jitter key
    rec = parse_result(data, now=NOW)
    assert rec["jitter_ms"] is None
    assert rec["ping_ms"] == 9.0


def test_parse_is_pure_default_ts_zero():
    # No `now` passed → ts is 0, never reads the clock inside the pure function.
    rec = parse_result(_fake_ookla())
    assert rec["ts"] == 0


# --- _check_speedtest (alert rule) ------------------------------------------


def test_speedtest_fires_below_threshold(monkeypatch):
    monkeypatch.setattr(settings, "speedtest_min_download", 500.0)
    key, msg = _check_speedtest({"speedtest": {"download_mbps": 120.0}})
    assert key == "slow:120.0"
    assert "120" in msg and "500" in msg


def test_speedtest_silent_above_threshold(monkeypatch):
    monkeypatch.setattr(settings, "speedtest_min_download", 500.0)
    assert _check_speedtest({"speedtest": {"download_mbps": 940.0}}) == (None, "")


def test_speedtest_silent_when_threshold_zero(monkeypatch):
    monkeypatch.setattr(settings, "speedtest_min_download", 0)
    # Even a terrible reading stays quiet when the floor is disabled.
    assert _check_speedtest({"speedtest": {"download_mbps": 1.0}}) == (None, "")


def test_speedtest_silent_when_no_sample(monkeypatch):
    monkeypatch.setattr(settings, "speedtest_min_download", 500.0)
    assert _check_speedtest({"speedtest": {}}) == (None, "")
    assert _check_speedtest({}) == (None, "")


def test_speedtest_rule_is_registered():
    rule = next(r for r in RULES if r.id == "speedtest")
    assert rule.path.startswith("/")
