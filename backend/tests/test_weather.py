"""Tests for the weather (Open-Meteo) shaping + config gating — the pure logic
only. The HTTP fetch isn't exercised here; shape() is pure so it's tested against
a hand-written Open-Meteo response, and the not_configured path needs no network."""

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
