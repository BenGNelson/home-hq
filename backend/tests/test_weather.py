"""Tests for the weather (Open-Meteo) shaping + config gating — the pure logic
only. The HTTP fetch isn't exercised here; shape() is pure so it's tested against
a hand-written Open-Meteo response, and the not_configured path needs no network.

The stale-while-revalidate cache behavior is exercised separately by stubbing the
(slow) `_fetch` round-trip — no real network — so the fresh/stale/cold paths are
deterministic."""

import time

from app import weather
from app.config import settings


def _fake_response():
    """A hand-built Open-Meteo /v1/forecast response (current + 5-day daily),
    shaped like the real API's parallel-array `daily` block."""
    return {
        "current": {
            "time": "2026-06-22T14:00",
            "temperature_2m": 71.45,
            "relative_humidity_2m": 55,
            "apparent_temperature": 70.12,
            "is_day": 1,
            "weather_code": 3,
            "wind_speed_10m": 8.27,
            "wind_direction_10m": 210,
        },
        "daily": {
            "time": [
                "2026-06-22",
                "2026-06-23",
                "2026-06-24",
                "2026-06-25",
                "2026-06-26",
            ],
            "weather_code": [3, 61, 0, 80, 95],
            "temperature_2m_max": [78.46, 75.1, 81.0, 73.9, 70.0],
            "temperature_2m_min": [60.12, 58.4, 62.0, 55.5, 54.0],
            "precipitation_probability_max": [10, 80, 0, 60, None],
            "sunrise": [
                "2026-06-22T05:58",
                "2026-06-23T05:58",
                "2026-06-24T05:59",
                "2026-06-25T05:59",
                "2026-06-26T05:59",
            ],
            "sunset": [
                "2026-06-22T20:31",
                "2026-06-23T20:31",
                "2026-06-24T20:32",
                "2026-06-25T20:32",
                "2026-06-26T20:32",
            ],
            "uv_index_max": [6.85, 7.0, 9.2, 5.5, 4.0],
            "precipitation_sum": [0.0, 0.413, 0.0, 0.25, None],
        },
        "hourly": {
            # Two hours on day 1, one on day 2 — enough to prove the date grouping.
            "time": [
                "2026-06-22T00:00",
                "2026-06-22T01:00",
                "2026-06-23T00:00",
            ],
            "temperature_2m": [61.3, 60.05, 59.0],
            "precipitation_probability": [5, 10, 80],
            "weather_code": [3, 3, 61],
            "is_day": [0, 0, 1],
        },
    }


def test_shape_maps_current_fields_and_is_day_bool():
    out = weather.shape(_fake_response(), "us")
    assert out["available"] is True
    cur = out["current"]
    assert cur["temp"] == 71.5  # rounded to 1 decimal
    assert cur["feels_like"] == 70.1
    assert cur["humidity"] == 55
    assert cur["wind_speed"] == 8.3
    assert cur["wind_dir"] == 210
    assert cur["code"] == 3
    assert cur["is_day"] is True  # 0/1 -> real bool


def test_is_day_zero_becomes_false():
    data = _fake_response()
    data["current"]["is_day"] = 0
    assert weather.shape(data, "us")["current"]["is_day"] is False


def test_current_carries_time_for_sun_arc():
    cur = weather.shape(_fake_response(), "us")["current"]
    assert cur["time"] == "2026-06-22T14:00"  # location-local "now" for the sun-arc


def test_daily_carries_sun_uv_and_precip_sum():
    day = weather.shape(_fake_response(), "us")["daily"][2]  # 2026-06-24
    assert day["sunrise"] == "2026-06-24T05:59"
    assert day["sunset"] == "2026-06-24T20:32"
    assert day["uv_max"] == 9.2
    assert day["precip_sum"] == 0.0


def test_daily_extras_tolerate_missing_arrays():
    # Drop the sun/UV/precip arrays entirely — days still come through, just
    # without those fields (zip_longest pads with None rather than dropping rows).
    data = _fake_response()
    for k in ("sunrise", "sunset", "uv_index_max", "precipitation_sum"):
        data["daily"].pop(k)
    days = weather.shape(data, "us")["daily"]
    assert len(days) == 5
    assert days[0]["sunrise"] is None
    assert days[0]["uv_max"] is None
    assert days[4]["precip_sum"] is None  # last day's precip_sum was None anyway


def test_daily_zips_parallel_arrays():
    daily = weather.shape(_fake_response(), "us")["daily"]
    assert len(daily) == 5
    # A sample entry (the second day) maps each parallel array by index. Its
    # `hours` is asserted separately below; check the daily scalars here.
    d = daily[1]
    assert (d["date"], d["code"], d["hi"], d["lo"], d["precip_prob"]) == (
        "2026-06-23",
        61,
        75.1,
        58.4,
        80,
    )
    # precip_prob tolerates a None (Open-Meteo can omit it for a far-out day).
    assert daily[4]["precip_prob"] is None


def test_hourly_grouped_under_its_day():
    daily = weather.shape(_fake_response(), "us")["daily"]
    # Day 1 had two hours, day 2 had one, the rest none.
    assert len(daily[0]["hours"]) == 2
    assert len(daily[1]["hours"]) == 1
    assert daily[2]["hours"] == []
    # An hour carries the shaped fields (rounding + is_day bool).
    assert daily[0]["hours"][0] == {
        "time": "2026-06-22T00:00",
        "temp": 61.3,
        "precip_prob": 5,
        "code": 3,
        "is_day": False,  # 0 -> bool
    }
    assert daily[1]["hours"][0]["temp"] == 59.0


def test_unit_labels_us_vs_metric():
    us = weather.shape(_fake_response(), "us")
    assert us["temp_unit"] == "°F"
    assert us["wind_unit"] == "mph"
    metric = weather.shape(_fake_response(), "metric")
    assert metric["temp_unit"] == "°C"
    assert metric["wind_unit"] == "km/h"


def test_get_weather_reports_not_configured_when_unset():
    saved = (settings.weather_lat, settings.weather_lon)
    try:
        settings.weather_lat = settings.weather_lon = ""
        # No network: is_configured() is False, so we never call out.
        assert weather.get_weather() == {
            "available": False,
            "reason": "not_configured",
        }
    finally:
        settings.weather_lat, settings.weather_lon = saved


# --- stale-while-revalidate cache behavior (with the slow fetch stubbed) --------


def _configured(monkeypatch):
    """Point the settings at a location so is_configured() is True (no network)."""
    monkeypatch.setattr(settings, "weather_lat", "1.0")
    monkeypatch.setattr(settings, "weather_lon", "2.0")
    monkeypatch.setattr(settings, "weather_units", "us")
    monkeypatch.setattr(settings, "weather_cache_ttl", 600)


def _reset_cache():
    """Clear the module cache + the in-flight flag between cases."""
    weather._cache.update(ts=0.0, data=None, ttl=0.0, units=None)
    weather._refreshing = False


def _wait_until(pred, timeout=2.0):
    """Poll until a background refresh lands (or give up) — no fixed sleeps."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if pred():
            return True
        time.sleep(0.01)
    return False


def test_cold_cache_blocks_once_then_serves(monkeypatch):
    """An empty cache does the (stubbed) fetch inline and stores the result."""
    _configured(monkeypatch)
    _reset_cache()
    calls = []
    monkeypatch.setattr(weather, "_fetch", lambda units: calls.append(units) or {"available": True, "n": 1})

    out = weather.get_weather()
    assert out == {"available": True, "n": 1}
    assert calls == ["us"]  # exactly one upstream poll


def test_fresh_cache_returns_without_fetching(monkeypatch):
    """A fresh cache is served directly — no upstream poll at all."""
    _configured(monkeypatch)
    _reset_cache()
    weather._cache.update(ts=time.monotonic(), data={"available": True, "cached": True}, ttl=600, units="us")
    monkeypatch.setattr(weather, "_fetch", lambda units: (_ for _ in ()).throw(AssertionError("should not fetch")))

    assert weather.get_weather() == {"available": True, "cached": True}


def test_stale_cache_serves_stale_then_revalidates(monkeypatch):
    """A stale cache returns the OLD value immediately, then a background refresh
    replaces it with the NEW value — the request never blocks on the fetch."""
    _configured(monkeypatch)
    _reset_cache()
    # ts far in the past relative to the 600s ttl => stale.
    weather._cache.update(ts=time.monotonic() - 10_000, data={"available": True, "v": "old"}, ttl=600, units="us")
    monkeypatch.setattr(weather, "_fetch", lambda units: {"available": True, "v": "new"})

    out = weather.get_weather()
    assert out == {"available": True, "v": "old"}  # served instantly, still stale
    assert _wait_until(lambda: weather._cache["data"] == {"available": True, "v": "new"})


def test_revalidate_failure_keeps_stale_value(monkeypatch):
    """If the background re-poll errors, the last good (stale) value stays cached."""
    _configured(monkeypatch)
    _reset_cache()
    weather._cache.update(ts=time.monotonic() - 10_000, data={"available": True, "v": "old"}, ttl=600, units="us")
    import requests

    def boom(units):
        raise requests.RequestException("down")

    monkeypatch.setattr(weather, "_fetch", boom)
    weather.get_weather()
    # The refresh thread finishes and clears the in-flight flag, cache untouched.
    assert _wait_until(lambda: weather._refreshing is False)
    assert weather._cache["data"] == {"available": True, "v": "old"}


def test_warm_prefills_cache_in_background(monkeypatch):
    """warm() seeds a cold cache off-thread (so the first real request is a hit)."""
    _configured(monkeypatch)
    _reset_cache()
    monkeypatch.setattr(weather, "_fetch", lambda units: {"available": True, "warmed": True})

    weather.warm()
    assert _wait_until(lambda: weather._cache["data"] == {"available": True, "warmed": True})
