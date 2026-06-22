"""
Enphase Envoy (solar) — a live production/consumption read via pyenphase.

We talk to the Envoy DIRECTLY from the backend (not through Home Assistant):
solar is a data integration like Plex or the printer, which Home HQ already owns,
and the pyenphase library carries the hard parts — token auth from the Enlighten
cloud (firmware 7+), ~6-month token auto-refresh, the <7-vs-7+ auth split, the
self-signed local HTTPS, and the metered-vs-not data model.

Config (all in .env; absent => available:false / "not_configured"):
  ENVOY_HOST                  the gateway's reachable host/IP
  ENPHASE_USERNAME/PASSWORD   Enlighten homeowner login (pyenphase mints + then
                              auto-refreshes the local token with these + the
                              serial it auto-reads from the gateway)
  ENPHASE_TOKEN               optional pre-minted token, used instead of user/pass

The authenticated client is cached across requests (auth is a cloud round-trip)
and a short TTL cache smooths the dashboard's polling. The shaping is a pure
function so it's unit-tested without a live gateway. Any failure degrades to
available:false rather than raising — the app-wide pattern.
"""

import asyncio
import time

from app.config import settings

# Module-level cached client + a lock so concurrent requests don't double-auth.
_client = None
_lock = asyncio.Lock()
_cache = {"ts": 0.0, "data": None, "ttl": 0.0}

# On failure we cache the negative result for longer than a normal poll, so a bad
# credential / unreachable gateway can't re-run the Enlighten auth round-trip
# every few seconds (which could trip account rate-limiting / lockout).
_FAILURE_TTL = 60.0


def is_configured() -> bool:
    """True when we have a host AND a way to authenticate (creds or a token)."""
    return bool(
        settings.envoy_host
        and (
            (settings.enphase_username and settings.enphase_password)
            or settings.enphase_token
        )
    )


def _round(x):
    """Round to a whole number, but tolerate None — individual EnvoySystem fields
    (e.g. a 7-day/lifetime total) can be None on some firmware/configs, and one
    missing field shouldn't crash the whole read into 'unreachable'."""
    return round(x) if x is not None else None


def _series(s) -> dict | None:
    """Shape one pyenphase EnvoySystem{Production,Consumption} -> a flat dict.
    None (e.g. consumption on a non-metered system) passes through as None."""
    if s is None:
        return None
    return {
        "watts_now": _round(s.watts_now),
        "watt_hours_today": _round(s.watt_hours_today),
        "watt_hours_last_7_days": _round(s.watt_hours_last_7_days),
        "watt_hours_lifetime": _round(s.watt_hours_lifetime),
    }


def shape(data) -> dict:
    """pyenphase EnvoyData -> the /api/solar payload (pure, unit-tested).

    `net_watts` = production - consumption: positive = surplus (exporting to the
    grid), negative = drawing from it. None unless the system is metered."""
    prod = _series(getattr(data, "system_production", None))
    cons = _series(getattr(data, "system_consumption", None))
    net = None
    if prod and cons and prod["watts_now"] is not None and cons["watts_now"] is not None:
        net = prod["watts_now"] - cons["watts_now"]
    return {
        "available": True,
        "metered": cons is not None,
        "production": prod,
        "consumption": cons,
        "net_watts": net,
    }


async def _ensure_client():
    global _client
    if _client is not None:
        return _client
    from pyenphase import Envoy  # lazy: keeps the import off the pure-shape tests

    envoy = Envoy(settings.envoy_host)
    await envoy.setup()  # reads firmware + serial from the gateway
    await envoy.authenticate(
        username=settings.enphase_username or None,
        password=settings.enphase_password or None,
        token=settings.enphase_token or None,
    )
    _client = envoy
    return envoy


async def _reset_client():
    """Drop (and best-effort close) the cached client so the next call re-auths."""
    global _client
    c, _client = _client, None
    if c is not None:
        try:
            await c.close()
        except Exception:
            pass


async def get_solar() -> dict:
    """Current solar snapshot, or available:false on any problem."""
    if not is_configured():
        return {"available": False, "reason": "not_configured"}

    now = time.monotonic()
    if _cache["data"] is not None and now - _cache["ts"] < _cache["ttl"]:
        return _cache["data"]

    async with _lock:
        # Re-check: another request may have refreshed while we waited on the lock.
        now = time.monotonic()
        if _cache["data"] is not None and now - _cache["ts"] < _cache["ttl"]:
            return _cache["data"]
        try:
            client = await _ensure_client()
            data = await client.update()
            result = shape(data)
            ttl = settings.solar_cache_ttl
        except Exception:
            # Drop the cached client so the next call re-runs setup/auth (handles
            # a changed host, or a token pyenphase couldn't refresh), and back off.
            await _reset_client()
            result = {"available": False, "reason": "unreachable"}
            ttl = max(settings.solar_cache_ttl, _FAILURE_TTL)
        _cache.update(ts=time.monotonic(), data=result, ttl=ttl)
        return result
