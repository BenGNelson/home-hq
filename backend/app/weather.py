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

To keep `/api/weather` off the slow upstream path entirely, `get_weather()` is
**stale-while-revalidate**: a fresh cache is returned directly, a stale cache is
returned *immediately* while a single background thread re-polls Open-Meteo (so the
request never blocks on the ~4.5s round-trip), and only a truly cold cache (right
after a restart) does the blocking fetch. `warm()` (called once at startup) pre-fills
the cache in the background so even the first page load is an instant hit. This mirrors
how every other data source here (solar/plex/storage/speedtest) collects off the hot
path rather than fetching on request.

The shaping is split into pure helpers so it's unit-tested without a live call:
`_current(data)` and `_forecast(data)` feed the pure `shape(data, units)`.

Seam for later: `_current()` reads Open-Meteo for now, but "current conditions"
is conceptually swappable — if a personal weather station shows up, only
`_current()` needs to change (read the PWS instead), while `_forecast()` keeps
pulling Open-Meteo. Both read Open-Meteo today.
"""

import threading
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
# Per-hour fields for the tap-to-expand hourly strip on the Weather page. Open-Meteo
# returns these for every forecast_day; we group them under their day in shape().
_HOURLY_FIELDS = "temperature_2m,precipitation_probability,weather_code,is_day"

# Module-level success cache (only successful reads are stored; failures aren't,
# so a transient blip doesn't pin a bad result for the full TTL).
_cache = {"ts": 0.0, "data": None, "ttl": 0.0, "units": None}

# Guards the stale-while-revalidate background refresh so only one upstream poll
# is ever in flight at a time (a burst of stale-cache requests coalesces into one).
_refresh_lock = threading.Lock()
_refreshing = False


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
        "hourly": _HOURLY_FIELDS,
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


def _hourly(data) -> list:
    """Shape Open-Meteo's `hourly` parallel arrays -> a flat list of hour dicts.

    Like _forecast(), the block is column-oriented; we zip the parallel arrays
    into one dict per hour. shape() then groups these under their day. Pure +
    defensive — a short/missing array just yields fewer hours rather than
    raising."""
    h = data.get("hourly") or {}
    times = h.get("time") or []
    temps = h.get("temperature_2m") or []
    precs = h.get("precipitation_probability") or []
    codes = h.get("weather_code") or []
    days = h.get("is_day") or []
    out = []
    for t, temp, precip, code, is_day in zip(times, temps, precs, codes, days):
        out.append(
            {
                "time": t,
                "temp": _round1(temp),
                "precip_prob": _int(precip),
                "code": _int(code),
                "is_day": bool(is_day),
            }
        )
    return out


def shape(data, units) -> dict:
    """Open-Meteo response dict -> the /api/weather payload (pure, unit-tested)."""
    days = _forecast(data)
    # Group the flat hourly list under each day by its date prefix
    # ("2026-06-24T14:00" -> "2026-06-24"), so the UI can expand a day to its
    # hours without a second request. An unmatched day just gets [].
    by_date = {}
    for hr in _hourly(data):
        date = (hr.get("time") or "").split("T")[0]
        by_date.setdefault(date, []).append(hr)
    for day in days:
        day["hours"] = by_date.get(day["date"], [])
    return {
        "available": True,
        "current": _current(data),
        "daily": days,
        "temp_unit": "°F" if units == "us" else "°C",
        "wind_unit": "mph" if units == "us" else "km/h",
    }


def _fetch(units: str) -> dict:
    """Do the (slow) Open-Meteo round-trip and shape it. Raises on any HTTP / JSON
    problem so callers can decide whether to degrade or keep serving a stale value."""
    resp = requests.get(_ENDPOINT, params=_params(units), timeout=15)
    resp.raise_for_status()
    return shape(resp.json(), units)


def _refresh(units: str) -> None:
    """Re-poll Open-Meteo and update the cache. On failure, leave the existing
    (stale) cache in place — a transient blip shouldn't blank out the page."""
    global _refreshing
    try:
        result = _fetch(units)
        _cache.update(ts=time.monotonic(), data=result, ttl=settings.weather_cache_ttl, units=units)
    except (requests.RequestException, ValueError):
        pass  # keep serving the last good value
    finally:
        with _refresh_lock:
            _refreshing = False


def _revalidate(units: str) -> None:
    """Kick a background refresh if one isn't already running (dedup), so a stale
    cache is updated without blocking the request that noticed it was stale."""
    global _refreshing
    with _refresh_lock:
        if _refreshing:
            return
        _refreshing = True
    threading.Thread(target=_refresh, args=(units,), daemon=True, name="weather-refresh").start()


def warm() -> None:
    """Pre-fill the cache in the background (called once at startup) so the first
    page load after a restart is an instant hit instead of eating the ~4.5s poll."""
    if is_configured():
        _revalidate(settings.weather_units)


def get_weather() -> dict:
    """Current conditions + 5-day forecast, or available:false on any problem.

    Stale-while-revalidate: a fresh cache is returned directly; a stale cache is
    returned *immediately* while a single background thread re-polls Open-Meteo, so
    the request never blocks on the slow upstream call. Only a cold cache (right
    after a restart, before `warm()` lands) does the blocking fetch. The cache keys
    on the units string so flipping WEATHER_UNITS doesn't serve a stale-unit payload."""
    if not is_configured():
        return {"available": False, "reason": "not_configured"}

    units = settings.weather_units
    cached = _cache["data"]
    if cached is not None and _cache["units"] == units:
        if time.monotonic() - _cache["ts"] >= _cache["ttl"]:
            _revalidate(units)  # stale → refresh in the background, serve stale now
        return cached

    # Cold cache (or the units just changed): we have nothing to serve, so this one
    # request blocks on the fetch. Failures degrade rather than caching a bad value.
    try:
        result = _fetch(units)
    except (requests.RequestException, ValueError):
        return {"available": False, "reason": "unreachable"}

    _cache.update(ts=time.monotonic(), data=result, ttl=settings.weather_cache_ttl, units=units)
    return result
