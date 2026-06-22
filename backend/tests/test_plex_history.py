"""Tests for the Plex insights aggregator (pure, no DB)."""

from app.plex_history import summarize_insights

# 5-minute spacing, all within UTC hour 0 (epoch 0 = 1970-01-01 00:00 UTC).
BASIC = [
    {"ts": 0, "streams": 0, "transcodes": 0, "bandwidth_kbps": None},
    {"ts": 300, "streams": 2, "transcodes": 1, "bandwidth_kbps": 5000},
    {"ts": 600, "streams": 3, "transcodes": 0, "bandwidth_kbps": 8000},
    {"ts": 900, "streams": 1, "transcodes": 0, "bandwidth_kbps": 3000},
]


def test_empty_is_zeroed():
    s = summarize_insights([])
    assert s["samples"] == 0
    assert s["peak_streams"] == 0
    assert s["peak_bandwidth_kbps"] is None
    assert s["active_share"] is None
    assert s["transcode_share"] is None
    assert s["stream_hours"] == 0.0
    assert s["busiest_hour"] is None


def test_basic_stats():
    s = summarize_insights(BASIC)
    assert s["samples"] == 4
    assert s["peak_streams"] == 3
    assert s["peak_bandwidth_kbps"] == 8000
    assert s["active_share"] == 0.75  # 3 of 4 samples had a stream
    assert abs(s["transcode_share"] - 1 / 3) < 1e-9  # 1 of 3 active samples
    assert s["stream_hours"] == 0.5  # sum(6) * 300s / 3600
    assert s["busiest_hour"] == 0


def test_all_idle():
    samples = [{"ts": t, "streams": 0, "transcodes": 0, "bandwidth_kbps": None} for t in (0, 300)]
    s = summarize_insights(samples)
    assert s["active_share"] == 0.0
    assert s["transcode_share"] is None  # no active time to take a share of
    assert s["busiest_hour"] is None


def test_busiest_hour_picks_higher_average():
    samples = [
        {"ts": 0, "streams": 1, "transcodes": 0, "bandwidth_kbps": None},     # hour 0
        {"ts": 3600, "streams": 4, "transcodes": 0, "bandwidth_kbps": None},  # hour 1
        {"ts": 3900, "streams": 4, "transcodes": 0, "bandwidth_kbps": None},  # hour 1
    ]
    assert summarize_insights(samples)["busiest_hour"] == 1


def test_single_sample_has_no_hours():
    s = summarize_insights([{"ts": 0, "streams": 2, "transcodes": 0, "bandwidth_kbps": None}])
    assert s["stream_hours"] == 0.0  # no gaps → median dt 0
    assert s["peak_streams"] == 2


def test_missing_ts_does_not_raise():
    # The docstring promises this never raises; a hand-built / partial sample
    # missing `ts` is read defensively (.get) and simply skipped for the
    # gap/busiest-hour math instead of throwing a KeyError.
    samples = [
        {"streams": 1, "transcodes": 0, "bandwidth_kbps": None},  # no ts
        {"ts": 300, "streams": 2, "transcodes": 0, "bandwidth_kbps": None},
    ]
    s = summarize_insights(samples)
    assert s["samples"] == 2
    assert s["peak_streams"] == 2
    assert s["stream_hours"] == 0.0  # only one usable ts → no gaps
    assert s["busiest_hour"] == 0   # the ts=300 sample lands in UTC hour 0


def test_active_but_no_usable_ts_does_not_raise():
    # Degenerate: a sample is active (streams > 0) but has no ts, so by_hour ends
    # up empty while active > 0 — busiest_hour must fall back to None, not crash.
    s = summarize_insights([{"streams": 1, "transcodes": 0, "bandwidth_kbps": None}])
    assert s["peak_streams"] == 1
    assert s["busiest_hour"] is None
