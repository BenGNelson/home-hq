"""Tests for the solar (Enphase) shaping + config gating — the pure logic only.
The pyenphase client itself is I/O and isn't exercised here; solar.py imports it
lazily, so none of these touch it."""

import asyncio
from types import SimpleNamespace

from app import db, solar, solar_history
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
    assert out["battery"] is None  # no encharge_aggregate


# --- battery / power / self-sufficiency / panels ---------------------------


def _agg(**kw):
    base = dict(
        state_of_charge=82, available_energy=8250,
        max_available_capacity=10000, reserve_state_of_charge=20,
    )
    base.update(kw)
    return SimpleNamespace(**base)


def _full(production, net_consumption, storage, agg=None, **extra):
    base = dict(
        system_production=_series(watts_now=production),
        system_consumption=_series(watts_now=production),  # value irrelevant to power calc
        system_net_consumption=SimpleNamespace(watts_now=net_consumption),
        ctmeter_storage=SimpleNamespace(active_power=storage),
        encharge_aggregate=agg,
        encharge_inventory={"a": {}, "b": {}},
        enpower=SimpleNamespace(mains_oper_state="closed", grid_mode="multimode-ongrid"),
        inverters={},
    )
    base.update(extra)
    return SimpleNamespace(**base)


def test_power_load_is_computed_from_the_three_meters():
    # load = production + grid(import +) + battery(discharge +).
    out = solar.shape(_full(production=1000.0, net_consumption=300.0, storage=200.0, agg=_agg()))
    p = out["power"]
    assert p["solar"] == {"watts": 1000, "dir": "out"}
    assert p["grid"] == {"watts": 300, "dir": "importing"}
    assert p["battery"] == {"watts": 200, "dir": "discharging"}
    assert p["load"] == {"watts": 1500, "dir": "in"}  # 1000 + 300 + 200


def test_self_sufficiency_excludes_grid_import():
    out = solar.shape(_full(production=1000.0, net_consumption=300.0, storage=200.0, agg=_agg()))
    # (load 1500 - grid_import 300) / 1500 = 80%
    assert out["self_sufficiency_percent"] == 80


def test_self_sufficiency_full_when_exporting():
    # Exporting (net < 0) → no grid import → 100% self-sufficient.
    out = solar.shape(_full(production=4000.0, net_consumption=-1500.0, storage=-500.0, agg=_agg()))
    assert out["power"]["grid"]["dir"] == "exporting"
    assert out["self_sufficiency_percent"] == 100


def test_battery_charging_sign_and_fields():
    out = solar.shape(_full(production=2635.0, net_consumption=9.0, storage=-1417.0, agg=_agg()))
    b = out["battery"]
    assert b == {
        "soc_percent": 82, "available_wh": 8250, "capacity_wh": 10000,
        "reserve_percent": 20, "watts": 1417, "state": "charging",
        "count": 2, "grid_state": "on-grid",
    }
    # grid 9 W is below the idle threshold → reads idle, not a phantom import.
    assert out["power"]["grid"] == {"watts": 0, "dir": "idle"}


def test_battery_idle_near_zero():
    out = solar.shape(_full(production=500.0, net_consumption=0.0, storage=5.0, agg=_agg()))
    assert out["battery"]["state"] == "idle"


def test_power_non_metered_has_no_grid_or_load():
    # No grid meter (non-metered) → home consumption is unknowable, not fabricated.
    out = solar.shape(_full(production=1500.0, net_consumption=None, storage=None, agg=None))
    p = out["power"]
    assert p["solar"]["watts"] == 1500
    assert p["grid"] is None
    assert p["load"] is None
    assert out["self_sufficiency_percent"] is None


def test_power_load_unknown_when_battery_present_but_storage_missing():
    # Battery exists but its flow dropped this read → load can't be computed.
    out = solar.shape(_full(production=2000.0, net_consumption=100.0, storage=None, agg=_agg()))
    assert out["power"]["load"] is None
    assert out["self_sufficiency_percent"] is None
    assert out["battery"]["state"] is None  # flow unknown, not a fabricated "idle"


def test_power_large_negative_load_is_unknown_not_clamped():
    # Inconsistent partial read (production missing while exporting hard) → unknown,
    # NOT a confidently-wrong 0.
    out = solar.shape(_full(production=0.0, net_consumption=-3000.0, storage=-500.0, agg=_agg()))
    assert out["power"]["load"] is None


def test_battery_none_tolerant_partial_fields():
    # A present aggregate with missing fields must not crash (round(None) guard).
    out = solar.shape(_full(production=500.0, net_consumption=0.0, storage=None,
                            agg=_agg(available_energy=None, state_of_charge=None)))
    assert out["battery"]["available_wh"] is None
    assert out["battery"]["watts"] is None  # no storage meter


def test_panels_indexes_and_hides_serials():
    inv = {
        "482000000002": SimpleNamespace(last_report_watts=210.4, max_report_watts=300),
        "482000000001": SimpleNamespace(last_report_watts=None, max_report_watts=295),
    }
    out = solar.panels(SimpleNamespace(inverters=inv))
    assert out == [
        {"i": 1, "watts": None, "max_watts": 295},  # sorted by serial → …001 first
        {"i": 2, "watts": 210, "max_watts": 300},
    ]


def test_panels_empty_without_inverters():
    assert solar.panels(SimpleNamespace(inverters=None)) == []


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


# --- intraday history sampler + endpoint -----------------------------------


def test_summarize_history_empty():
    assert solar_history.summarize_history([]) == {
        "samples": 0,
        "peak_watts": None,
        "peak_ts": None,
        "latest_watts": None,
    }


def test_summarize_history_peak_and_latest():
    samples = [
        {"ts": 1, "prod_watts": 100, "cons_watts": 400, "net_watts": -300},
        {"ts": 2, "prod_watts": 2500, "cons_watts": 800, "net_watts": 1700},
        {"ts": 3, "prod_watts": 1800, "cons_watts": 600, "net_watts": 1200},
    ]
    out = solar_history.summarize_history(samples)
    # peak_ts is the timestamp of the peak sample (ts=2), for the curve marker.
    assert out == {"samples": 3, "peak_watts": 2500, "peak_ts": 2, "latest_watts": 1800}


def test_summarize_history_ignores_none_production():
    # A non-metered/partial sample may carry a None prod — must not crash max().
    samples = [{"ts": 1, "prod_watts": None}, {"ts": 2, "prod_watts": 500}]
    out = solar_history.summarize_history(samples)
    assert out["peak_watts"] == 500
    assert out["peak_ts"] == 2
    assert out["latest_watts"] == 500


def _stub_solar(monkeypatch, payload):
    """Make solar.is_configured()/get_solar() return a fixed snapshot."""
    async def _fake_get_solar():
        return payload

    monkeypatch.setattr(solar, "is_configured", lambda: True)
    monkeypatch.setattr(solar, "get_solar", _fake_get_solar)


def test_sampler_records_a_metered_sample(monkeypatch):
    _stub_solar(
        monkeypatch,
        {
            "available": True,
            "metered": True,
            "production": {"watts_now": 3200},
            "consumption": {"watts_now": 1400},
            "net_watts": 1800,
        },
    )
    sampler = solar_history.SolarSampler(interval=300, retention_days=30)  # loop=None → asyncio.run
    assert sampler.sample_once(now=1000) is True
    rows = db.recent_solar_samples()
    assert rows == [{
        "ts": 1000, "prod_watts": 3200, "cons_watts": 1400, "net_watts": 1800,
        "soc_percent": None, "battery_watts": None,
    }]


def test_sampler_records_battery_signed(monkeypatch):
    _stub_solar(
        monkeypatch,
        {
            "available": True, "metered": True,
            "production": {"watts_now": 1000}, "consumption": {"watts_now": 1200},
            "net_watts": -200,
            "battery": {"soc_percent": 82, "watts": 1417, "state": "charging"},
        },
    )
    sampler = solar_history.SolarSampler(interval=300, retention_days=30)
    assert sampler.sample_once(now=2000) is True
    row = db.recent_solar_samples()[0]
    assert row["soc_percent"] == 82
    assert row["battery_watts"] == -1417  # charging → stored negative


def test_sampler_records_none_battery_when_flow_unknown(monkeypatch):
    _stub_solar(
        monkeypatch,
        {
            "available": True, "metered": True,
            "production": {"watts_now": 1000}, "consumption": {"watts_now": 1200},
            "battery": {"soc_percent": 80, "watts": None, "state": None},
        },
    )
    sampler = solar_history.SolarSampler(interval=300, retention_days=30)
    assert sampler.sample_once(now=3000) is True
    row = db.recent_solar_samples()[0]
    assert row["soc_percent"] == 80
    assert row["battery_watts"] is None  # unknown flow → None, not a fabricated 0


def test_sampler_skips_when_unconfigured(monkeypatch):
    monkeypatch.setattr(solar, "is_configured", lambda: False)
    sampler = solar_history.SolarSampler(interval=300, retention_days=30)
    assert sampler.sample_once(now=1000) is False
    assert db.recent_solar_samples() == []


def test_sampler_skips_when_unavailable(monkeypatch):
    _stub_solar(monkeypatch, {"available": False, "reason": "unreachable"})
    sampler = solar_history.SolarSampler(interval=300, retention_days=30)
    assert sampler.sample_once(now=1000) is False
    assert db.recent_solar_samples() == []


def test_sampler_prunes_old_rows(monkeypatch):
    _stub_solar(
        monkeypatch,
        {"available": True, "metered": False, "production": {"watts_now": 500}},
    )
    sampler = solar_history.SolarSampler(interval=300, retention_days=1)
    # An old row beyond the 1-day window, inserted directly.
    db.insert_solar_sample({"ts": 100, "prod_watts": 10, "cons_watts": None, "net_watts": None})
    # A fresh sample (now) prunes anything older than now - 1 day.
    now = 100 + 5 * 86400
    assert sampler.sample_once(now=now) is True
    rows = db.recent_solar_samples()
    assert [r["ts"] for r in rows] == [now]  # the ancient row was pruned


def test_solar_history_endpoint_shape(client):
    import time

    t0 = int(time.time()) - 3600  # within the 24h window
    db.insert_solar_sample({"ts": t0, "prod_watts": 700, "cons_watts": 900, "net_watts": -200})
    db.insert_solar_sample({"ts": t0 + 60, "prod_watts": 1500, "cons_watts": 500, "net_watts": 1000})
    r = client.get("/api/solar/history?hours=24")
    assert r.status_code == 200
    body = r.json()
    assert body["hours"] == 24
    assert [s["ts"] for s in body["samples"]] == [t0, t0 + 60]  # oldest-first
    assert body["stats"] == {
        "samples": 2,
        "peak_watts": 1500,
        "peak_ts": t0 + 60,
        "latest_watts": 1500,
    }


def test_solar_history_clamps_hours(client):
    r = client.get("/api/solar/history?hours=99999")
    assert r.status_code == 200
    assert r.json()["hours"] == 720  # clamped to the 30-day ceiling


def test_recent_solar_samples_unlimited_returns_whole_window():
    # The window (since_ts) is the only bound when limit is None — no fixed cap
    # silently truncates a wide history query.
    for ts in range(1, 51):
        db.insert_solar_sample({"ts": ts, "prod_watts": ts, "cons_watts": None, "net_watts": None})
    rows = db.recent_solar_samples(since_ts=0, limit=None)
    assert len(rows) == 50
    assert [r["ts"] for r in rows] == list(range(1, 51))  # oldest-first
    # A positive limit still keeps just the newest N (ad-hoc callers).
    assert [r["ts"] for r in db.recent_solar_samples(since_ts=0, limit=3)] == [48, 49, 50]
