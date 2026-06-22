"""Tests for the solar (Enphase) shaping + config gating — the pure logic only.
The pyenphase client itself is I/O and isn't exercised here; solar.py imports it
lazily, so none of these touch it."""

import asyncio
from types import SimpleNamespace

from app import solar
from app.config import settings


def _series(**kw):
    base = dict(
        watts_now=1234.6,
        watt_hours_today=5000.4,
        watt_hours_last_7_days=42000.0,
        watt_hours_lifetime=9_000_000.0,
    )
    base.update(kw)
    return SimpleNamespace(**base)


def test_series_rounds_and_passes_none_through():
    assert solar._series(None) is None
    assert solar._series(_series(watts_now=1234.6)) == {
        "watts_now": 1235,
        "watt_hours_today": 5000,
        "watt_hours_last_7_days": 42000,
        "watt_hours_lifetime": 9_000_000,
    }


def test_shape_metered_computes_net_as_surplus():
    data = SimpleNamespace(
        system_production=_series(watts_now=3000.0),
        system_consumption=_series(watts_now=1200.0),
    )
    out = solar.shape(data)
    assert out["available"] is True
    assert out["metered"] is True
    assert out["production"]["watts_now"] == 3000
    assert out["consumption"]["watts_now"] == 1200
    assert out["net_watts"] == 1800  # producing more than using -> exporting


def test_shape_importing_is_negative_net():
    data = SimpleNamespace(
        system_production=_series(watts_now=200.0),
        system_consumption=_series(watts_now=1500.0),
    )
    assert solar.shape(data)["net_watts"] == -1300  # drawing from the grid


def test_series_tolerates_none_fields():
    # Some firmware/configs report a present production object but a None on an
    # individual total — that must not crash the read (round(None) would raise).
    out = solar._series(_series(watt_hours_last_7_days=None, watts_now=None))
    assert out["watt_hours_last_7_days"] is None
    assert out["watts_now"] is None
    assert out["watt_hours_today"] == 5000


def test_shape_skips_net_when_a_watts_now_is_none():
    data = SimpleNamespace(
        system_production=_series(watts_now=None),
        system_consumption=_series(watts_now=1200.0),
    )
    assert solar.shape(data)["net_watts"] is None  # can't compute, don't crash


def test_shape_non_metered_has_no_consumption_or_net():
    data = SimpleNamespace(system_production=_series(), system_consumption=None)
    out = solar.shape(data)
    assert out["metered"] is False
    assert out["consumption"] is None
    assert out["net_watts"] is None
    assert out["production"] is not None


def test_is_configured_needs_host_plus_creds_or_token():
    saved = (
        settings.envoy_host,
        settings.enphase_username,
        settings.enphase_password,
        settings.enphase_token,
    )
    try:
        settings.envoy_host = settings.enphase_username = ""
        settings.enphase_password = settings.enphase_token = ""
        assert solar.is_configured() is False
        settings.envoy_host = "envoy.local"
        assert solar.is_configured() is False  # host but no way to auth
        settings.enphase_username, settings.enphase_password = "me@example.com", "pw"
        assert solar.is_configured() is True
        settings.enphase_username = settings.enphase_password = ""
        settings.enphase_token = "a-token"
        assert solar.is_configured() is True  # a token alone is enough
    finally:
        (
            settings.envoy_host,
            settings.enphase_username,
            settings.enphase_password,
            settings.enphase_token,
        ) = saved


def test_get_solar_reports_not_configured_when_unset():
    saved = (
        settings.envoy_host,
        settings.enphase_username,
        settings.enphase_password,
        settings.enphase_token,
    )
    try:
        settings.envoy_host = settings.enphase_username = ""
        settings.enphase_password = settings.enphase_token = ""
        assert asyncio.run(solar.get_solar()) == {
            "available": False,
            "reason": "not_configured",
        }
    finally:
        (
            settings.envoy_host,
            settings.enphase_username,
            settings.enphase_password,
            settings.enphase_token,
        ) = saved
