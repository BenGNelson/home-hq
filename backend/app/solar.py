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


# Sign conventions, validated against live readings 2026-06-25:
#   grid    (system_net_consumption.watts_now): + = importing,  - = exporting
#   battery (ctmeter_storage.active_power):      + = discharging, - = charging
# True home load = production + grid + battery (Enphase's own system_consumption is
# derived and doesn't see the battery, so we compute load from the three meters).
_IDLE_W = 20  # |watts| under this reads as "idle" — meter jitter around zero


def _watts(obj, attr):
    """A numeric meter field (watts_now / active_power), or None."""
    v = getattr(obj, attr, None) if obj is not None else None
    return v if isinstance(v, (int, float)) else None


def _battery(data) -> dict | None:
    """Battery (IQ/Encharge) summary, or None when no storage is present."""
    agg = getattr(data, "encharge_aggregate", None)
    if agg is None:
        return None
    storage = _watts(getattr(data, "ctmeter_storage", None), "active_power")
    if storage is None:
        state = None  # battery present, but its flow isn't reported this read
    elif abs(storage) < _IDLE_W:
        state = "idle"
    else:
        state = "discharging" if storage > 0 else "charging"
    inv = getattr(data, "encharge_inventory", None)
    enpower = getattr(data, "enpower", None)
    grid_state = None
    if enpower is not None:
        mains = getattr(enpower, "mains_oper_state", None)
        mode = getattr(enpower, "grid_mode", None) or ""
        if mains == "closed" or "ongrid" in mode:
            grid_state = "on-grid"
        elif mains == "open" or "offgrid" in mode:
            grid_state = "off-grid"
        else:
            grid_state = mode or None
    return {
        "soc_percent": _round(getattr(agg, "state_of_charge", None)),
        "available_wh": _round(getattr(agg, "available_energy", None)),
        "capacity_wh": _round(getattr(agg, "max_available_capacity", None)),
        "reserve_percent": _round(getattr(agg, "reserve_state_of_charge", None)),
        "watts": _round(abs(storage)) if storage is not None else None,
        "state": state,
        "count": len(inv) if isinstance(inv, dict) else None,
        "grid_state": grid_state,
    }


def _node(watts, pos, neg):
    """One flow node: magnitude + direction (pos/neg label, 'idle' near zero)."""
    if watts is None:
        return None
    if abs(watts) < _IDLE_W:
        return {"watts": 0, "dir": "idle"}
    return {"watts": _round(abs(watts)), "dir": pos if watts > 0 else neg}


def _power(data) -> dict | None:
    """The four measured flows for the energy diagram (solar/grid/battery/load)."""
    solar = _watts(getattr(data, "system_production", None), "watts_now")
    grid = _watts(getattr(data, "system_net_consumption", None), "watts_now")
    storage = _watts(getattr(data, "ctmeter_storage", None), "active_power")
    if solar is None and grid is None:
        return None
    # True home load = solar + grid + battery. It needs the grid meter, and (when
    # a battery is present) the storage meter too — without them we can't account
    # for the grid/battery contribution, so we report load UNKNOWN (None) rather
    # than a fabricated number (e.g. a non-metered system has no grid meter).
    has_battery = getattr(data, "encharge_aggregate", None) is not None
    load = None
    if grid is not None and not (has_battery and storage is None):
        load = (solar or 0) + grid + (storage or 0)
        if load < -100:
            load = None  # meters momentarily inconsistent (partial read) — unknown
        elif load < 0:
            load = 0  # tiny negatives from rounding/timing
    return {
        "solar": {"watts": _round(solar), "dir": "out"} if solar is not None else None,
        "grid": _node(grid, "importing", "exporting"),
        "battery": _node(storage, "discharging", "charging") if storage is not None else None,
        "load": {"watts": _round(load), "dir": "in"} if load is not None else None,
    }


def _self_sufficiency(power) -> int | None:
    """Instantaneous % of home load NOT supplied by the grid (solar + battery)."""
    if not power or not power.get("load") or not power.get("grid"):
        return None
    load = power["load"]["watts"]
    grid = power["grid"]
    grid_import = grid["watts"] if grid.get("dir") == "importing" else 0
    if not load or load <= 0:
        return None
    return round(max(0.0, min(1.0, (load - grid_import) / load)) * 100)


def shape(data) -> dict:
    """pyenphase EnvoyData -> the /api/solar payload (pure, unit-tested).

    `net_watts` = production - consumption: positive = surplus (exporting to the
    grid), negative = drawing from it. None unless the system is metered. The
    `power`/`battery`/`self_sufficiency_percent` additions surface the battery +
    true grid flow for the 4-node diagram; all None-tolerant for partial reads."""
    prod = _series(getattr(data, "system_production", None))
    cons = _series(getattr(data, "system_consumption", None))
    net = None
    if prod and cons and prod["watts_now"] is not None and cons["watts_now"] is not None:
        net = prod["watts_now"] - cons["watts_now"]
    power = _power(data)
    return {
        "available": True,
        "metered": cons is not None,
        "production": prod,
        "consumption": cons,
        "net_watts": net,
        "battery": _battery(data),
        "power": power,
        "self_sufficiency_percent": _self_sufficiency(power),
    }


def panels(data) -> list:
    """Per-microinverter output for the array view. Keyed by a 1-based INDEX —
    device serials stay server-side. Sorted by serial for a stable order."""
    inv = getattr(data, "inverters", None)
    if not isinstance(inv, dict):
        return []
    out = []
    for i, serial in enumerate(sorted(inv), start=1):
        v = inv[serial]
        out.append(
            {
                "i": i,
                "watts": _round(getattr(v, "last_report_watts", None)),
                "max_watts": _round(getattr(v, "max_report_watts", None)),
            }
        )
    return out


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


async def _get_data():
    """The cached raw EnvoyData (one poll serves both /solar and /solar/panels),
    or None on failure (with a longer backoff so a bad gateway isn't hammered)."""
    # Gate on freshness alone, NOT on data being non-None — a cached failure
    # (data=None) must still satisfy the cache so the _FAILURE_TTL backoff holds
    # and a down gateway isn't re-polled on every request. Initial ttl=0 forces
    # the first real fetch.
    now = time.monotonic()
    if now - _cache["ts"] < _cache["ttl"]:
        return _cache["data"]

    async with _lock:
        # Re-check: another request may have refreshed while we waited on the lock.
        now = time.monotonic()
        if now - _cache["ts"] < _cache["ttl"]:
            return _cache["data"]
        try:
            client = await _ensure_client()
            data = await client.update()
            _cache.update(ts=time.monotonic(), data=data, ttl=settings.solar_cache_ttl)
            return data
        except Exception:
            # Drop the cached client so the next call re-runs setup/auth (handles
            # a changed host, or a token pyenphase couldn't refresh), and back off.
            await _reset_client()
            _cache.update(
                ts=time.monotonic(), data=None, ttl=max(settings.solar_cache_ttl, _FAILURE_TTL)
            )
            return None


async def get_solar() -> dict:
    """Current solar snapshot, or available:false on any problem."""
    if not is_configured():
        return {"available": False, "reason": "not_configured"}
    data = await _get_data()
    if data is None:
        return {"available": False, "reason": "unreachable"}
    try:
        return shape(data)
    except Exception:  # a malformed/partial read must degrade, not 500
        return {"available": False, "reason": "unreachable"}


async def get_panels() -> dict:
    """Per-panel output, or available:false on any problem."""
    if not is_configured():
        return {"available": False, "reason": "not_configured"}
    data = await _get_data()
    if data is None:
        return {"available": False, "reason": "unreachable"}
    try:
        return {"available": True, "panels": panels(data)}
    except Exception:
        return {"available": False, "reason": "unreachable"}
