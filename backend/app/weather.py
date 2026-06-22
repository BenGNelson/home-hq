"""
Weather — current conditions + a 5-day forecast from Open-Meteo.

Open-Meteo is a free public forecast API with NO API key and no account, so the
backend can hit it directly (like Plex or the printer, a data source Home HQ owns)
without a host-side collector. We ask for current conditions plus a 5-day daily
forecast in one call and shape it into a small, stable contract.

Config (all in .env; absent lat/lon => available:false / "not_configured"):
  WEATHER_LAT / WEATHER_LON   the location to forecast
  WEATHER_UNITS               "us" (°F / mph / inch) | "metric" (°C / km/h / mm)
  WEATHER_CACHE_TTL           seconds to reuse the last poll

The round-trip is ~4.5s from the container, so the result is cached aggressively
(module-level dict + time.monotonic, same pattern as solar.py) — weather changes
slowly, so a stale-by-minutes value is fine and the dashboard stays snappy. Only
successes are cached; any requests error / bad JSON degrades to available:false /
"unreachable" rather than raising (the app-wide graceful-degradation pattern).

The shaping is split into pure helpers so it's unit-tested without a live call:
`_current(data)` and `_forecast(data)` feed the pure `shape(data, units)`.

Seam for later: `_current()` reads Open-Meteo for now, but "current conditions"
is conceptually swappable — if a personal weather station shows up, only
`_current()` needs to change (read the PWS instead), while `_forecast()` keeps
pulling Open-Meteo. Both read Open-Meteo today.
"""

import time

import requests

from app.config import settings

_ENDPOINT = "https://api.open-meteo.com/v1/forecast"

# Open-Meteo's "current" + "daily" field lists, requested in one call.
_CURRENT_FIELDS = (
    "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,"
    "weather_code,wind_speed_10m,wind_direction_10m"
)
_DAILY_FIELDS = (
    "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"
)

# Module-level success cache (only successful reads are stored; failures aren't,
# so a transient blip doesn't pin a bad result for the full TTL).
_cache = {"ts": 0.0, "data": None, "ttl": 0.0, "units": None}


def is_configured() -> bool:
    """True when we have both a latitude and a longitude to forecast."""
    return bool(settings.weather_lat and settings.weather_lon)


def _round1(x):
    """Round to 1 decimal, tolerating None (a missing field shouldn't crash the
    whole read into 'unreachable')."""
    return round(x, 1) if isinstance(x, (int, float)) else None


def _int(x):
    """Round to a whole number, tolerating None/non-numbers. Open-Meteo's
    integer-ish fields (humidity, wind_dir, weather_code, precip%) are normally
    ints, but coercing defensively keeps a stray float from failing the
    int-typed response model (a 500) instead of just rendering."""
    return round(x) if isinstance(x, (int, float)) else None


def _params(units: str) -> dict:
    """Build the Open-Meteo query params for the configured location + units."""
    p = {
        "latitude": settings.weather_lat,
        "longitude": settings.weather_lon,
        "timezone": "auto",
        "forecast_days": 5,
        "current": _CURRENT_FIELDS,
        "daily": _DAILY_FIELDS,
    }
    # US imperial units are explicit; metric is Open-Meteo's default (°C/km/h/mm),
    # so we simply omit the unit params for it.
    if units == "us":
        p["temperature_unit"] = "fahrenheit"
        p["wind_speed_unit"] = "mph"
        p["precipitation_unit"] = "inch"
    return p


def _current(data) -> dict:
    """Shape Open-Meteo's `current` block -> our current-conditions contract.

    Kept separate from _forecast() as a seam: a future personal weather station
    would replace just this helper (read the PWS), while the forecast stays on
    Open-Meteo. Pure + defensive."""
    c = data.get("current") or {}
    return {
        "temp": _round1(c.get("temperature_2m")),
        "feels_like": _round1(c.get("apparent_temperature")),
        "humidity": _int(c.get("relative_humidity_2m")),
        "wind_speed": _round1(c.get("wind_speed_10m")),
        "wind_dir": _int(c.get("wind_direction_10m")),
        "code": _int(c.get("weather_code")),
        # Open-Meteo reports is_day as 0/1 — normalize to a real bool.
        "is_day": bool(c.get("is_day")),
    }


def _forecast(data) -> list:
    """Shape Open-Meteo's `daily` parallel arrays -> up to 5 per-day dicts.

    The daily block is column-oriented (parallel arrays keyed by field); we zip
    them into one dict per day. Pure + defensive — a short/missing array just
    yields fewer days rather than raising."""
    d = data.get("daily") or {}
    dates = d.get("time") or []
    codes = d.get("weather_code") or []
    his = d.get("temperature_2m_max") or []
    los = d.get("temperature_2m_min") or []
    precs = d.get("precipitation_probability_max") or []
    out = []
    for date, code, hi, lo, precip in zip(dates, codes, his, los, precs):
        out.append(
            {
                "date": date,
                "code": _int(code),
                "hi": _round1(hi),
                "lo": _round1(lo),
                "precip_prob": _int(precip),
            }
        )
    return out


def shape(data, units) -> dict:
    """Open-Meteo response dict -> the /api/weather payload (pure, unit-tested)."""
    return {
        "available": True,
        "current": _current(data),
        "daily": _forecast(data),
        "temp_unit": "°F" if units == "us" else "°C",
        "wind_unit": "mph" if units == "us" else "km/h",
    }


def get_weather() -> dict:
    """Current conditions + 5-day forecast, or available:false on any problem.

    Cached for `weather_cache_ttl` seconds (the upstream call is slow and weather
    changes slowly). The cache also keys on the units string so flipping
    WEATHER_UNITS doesn't serve a stale-unit payload."""
    if not is_configured():
        return {"available": False, "reason": "not_configured"}

    units = settings.weather_units
    now = time.monotonic()
    if (
        _cache["data"] is not None
        and _cache["units"] == units
        and now - _cache["ts"] < _cache["ttl"]
    ):
        return _cache["data"]

    try:
        resp = requests.get(_ENDPOINT, params=_params(units), timeout=15)
        resp.raise_for_status()
        data = resp.json()
        result = shape(data, units)
    except (requests.RequestException, ValueError):
        # ValueError covers a non-JSON / malformed body (resp.json()). Don't cache
        # the failure — let the next call retry.
        return {"available": False, "reason": "unreachable"}

    _cache.update(ts=time.monotonic(), data=result, ttl=settings.weather_cache_ttl, units=units)
    return result
