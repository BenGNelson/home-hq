"""Tests for the Speedtest / ISP monitor: the PURE parse_result + the alert rule.

PRIVACY: every fixture here uses FAKE data — no real ISP name, server location,
or result URL. The parser is the only piece exercised here (a real speedtest run
moves ~3.5 GB and needs the network, so it's never invoked in tests).
"""

from app.alerting import RULES, _check_speedtest
from app.config import settings
from app.speedtest import (
    DEFAULT_RANGE,
    HISTORY_RANGES,
    bucket_samples,
    normalize_range,
    parse_result,
)

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


# --- normalize_range (pure) -------------------------------------------------


def test_normalize_range_passes_known_keys():
    for key in HISTORY_RANGES:
        assert normalize_range(key) == key


def test_normalize_range_falls_back_on_unknown():
    assert normalize_range("bogus") == DEFAULT_RANGE
    assert normalize_range(None) == DEFAULT_RANGE
    assert normalize_range("") == DEFAULT_RANGE


# --- bucket_samples (pure) --------------------------------------------------


def _rows(n, step=3600, start=1_000_000):
    """n oldest-first rows with predictable, distinct field values."""
    return [
        {
            "ts": start + i * step,
            "download_mbps": float(i),
            "upload_mbps": float(i) / 2,
            "ping_ms": 10.0 + i,
        }
        for i in range(n)
    ]


def test_bucket_empty_returns_empty():
    assert bucket_samples([], max_points=120) == []


def test_bucket_under_max_trims_to_four_keys_unchanged():
    rows = _rows(5)
    out = bucket_samples(rows, max_points=120)
    assert len(out) == 5
    assert out[0] == {"ts": 1_000_000, "download_mbps": 0.0, "upload_mbps": 0.0, "ping_ms": 10.0}
    # Only the four chart keys survive (no jitter/server/etc leaking through).
    assert set(out[0]) == {"ts", "download_mbps", "upload_mbps", "ping_ms"}


def test_bucket_downsamples_to_max_points():
    out = bucket_samples(_rows(1000), max_points=120)
    assert len(out) == 120
    # Oldest-first order preserved, timestamps strictly increasing.
    assert out == sorted(out, key=lambda p: p["ts"])
    assert out[0]["ts"] < out[-1]["ts"]


def test_bucket_averages_within_a_bucket():
    # 4 rows → 2 buckets of 2: each bucket averages its pair.
    out = bucket_samples(_rows(4, step=100, start=0), max_points=2)
    assert len(out) == 2
    assert out[0]["download_mbps"] == 0.5  # mean(0, 1)
    assert out[1]["download_mbps"] == 2.5  # mean(2, 3)
    assert out[0]["ts"] == 50            # mean(0, 100)


def test_bucket_skips_none_per_field():
    rows = [
        {"ts": 0, "download_mbps": None, "upload_mbps": 10.0, "ping_ms": None},
        {"ts": 100, "download_mbps": 20.0, "upload_mbps": None, "ping_ms": None},
    ]
    [point] = bucket_samples(rows, max_points=1)
    assert point["download_mbps"] == 20.0  # the lone non-null
    assert point["upload_mbps"] == 10.0
    assert point["ping_ms"] is None        # all-None field stays None


def test_bucket_zero_max_points_trims_without_averaging():
    rows = _rows(3)
    assert bucket_samples(rows, max_points=0) == [
        {"ts": r["ts"], "download_mbps": r["download_mbps"], "upload_mbps": r["upload_mbps"], "ping_ms": r["ping_ms"]}
        for r in rows
    ]


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
