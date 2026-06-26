"""
/api/solar — a live glance at the Enphase solar system: current production,
whole-home consumption (metered systems only), net flow, and today/7-day/lifetime
energy. The backend reads the Envoy's local API directly via pyenphase (see
app/solar.py for the why + the auth model). available:false ("not_configured" |
"unreachable") whenever creds are missing or the gateway can't be reached, so the
UI degrades cleanly — same pattern as /api/printer and /api/ha.
"""

import time

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app import db, solar
from app.solar_history import summarize_history

router = APIRouter()


class SolarSeriesModel(BaseModel):
    # Optional: some firmware/configs omit a total, and _series()/_round() pass
    # None for those — a required int would fail response validation and 500 the
    # endpoint (outside the router's try/except), defeating graceful degradation.
    watts_now: int | None = Field(default=None, description="Current power, watts")
    watt_hours_today: int | None = Field(default=None, description="Energy since local midnight, Wh")
    watt_hours_last_7_days: int | None = Field(default=None, description="Energy over the last 7 days, Wh")
    watt_hours_lifetime: int | None = Field(default=None, description="Lifetime energy, Wh")


class FlowNodeModel(BaseModel):
    watts: int = Field(description="Magnitude of the flow, W (0 when idle)")
    dir: str = Field(description="out|in|idle|importing|exporting|charging|discharging")


class SolarPowerModel(BaseModel):
    solar: FlowNodeModel | None = None
    grid: FlowNodeModel | None = None
    battery: FlowNodeModel | None = None
    load: FlowNodeModel | None = None


class SolarBatteryModel(BaseModel):
    soc_percent: int | None = Field(default=None, description="State of charge, %")
    available_wh: int | None = Field(default=None, description="Usable energy now, Wh")
    capacity_wh: int | None = Field(default=None, description="Max usable capacity, Wh")
    reserve_percent: int | None = Field(default=None, description="Backup reserve floor, %")
    watts: int | None = Field(default=None, description="Charge/discharge magnitude, W")
    state: str | None = Field(default=None, description="charging | discharging | idle")
    count: int | None = Field(default=None, description="Number of batteries")
    grid_state: str | None = Field(default=None, description="on-grid | off-grid | …")


# Superset model. solar.get_solar() always returns `available`; the rest are
# dropped by response_model_exclude_none when absent (not_configured, a non-metered
# system, or a system with no battery).
class SolarModel(BaseModel):
    available: bool = Field(description="True when the Envoy was read OK")
    reason: str | None = Field(
        default=None, description="When unavailable: not_configured | unreachable"
    )
    metered: bool = Field(
        default=False, description="True when consumption CTs are installed"
    )
    production: SolarSeriesModel | None = Field(default=None, description="Solar production")
    consumption: SolarSeriesModel | None = Field(
        default=None, description="Whole-home consumption (metered systems only)"
    )
    net_watts: int | None = Field(
        default=None,
        description="production - consumption; >0 surplus/exporting, <0 importing (metered only)",
    )
    power: SolarPowerModel | None = Field(
        default=None, description="Measured solar/grid/battery/load flows for the diagram"
    )
    battery: SolarBatteryModel | None = Field(
        default=None, description="Battery (IQ/Encharge) summary; absent if no storage"
    )
    self_sufficiency_percent: int | None = Field(
        default=None, description="Instantaneous % of home load not from the grid"
    )


@router.get("/solar", response_model=SolarModel, response_model_exclude_none=True)
async def get_solar():
    """Live solar snapshot (cached briefly server-side to smooth polling)."""
    return await solar.get_solar()


class SolarPanelModel(BaseModel):
    i: int = Field(description="1-based panel index (serials stay server-side)")
    watts: int | None = Field(default=None, description="Latest reported output, W")
    max_watts: int | None = Field(default=None, description="Max reported output, W")


class SolarPanelsModel(BaseModel):
    available: bool
    reason: str | None = None
    panels: list[SolarPanelModel] | None = None


@router.get("/solar/panels", response_model=SolarPanelsModel, response_model_exclude_none=True)
async def get_solar_panels():
    """Per-microinverter output for the array view (indexed, no serials)."""
    return await solar.get_panels()


class SolarSampleModel(BaseModel):
    ts: int = Field(description="When recorded, epoch seconds")
    prod_watts: int | None = Field(default=None, description="Production, W")
    cons_watts: int | None = Field(default=None, description="Consumption, W (metered)")
    net_watts: int | None = Field(default=None, description="Net flow, W (metered)")
    soc_percent: int | None = Field(default=None, description="Battery state of charge, %")
    battery_watts: int | None = Field(
        default=None, description="Battery flow, W (+discharging / -charging)"
    )


class SolarHistoryStatsModel(BaseModel):
    samples: int = Field(description="Number of samples in the window")
    peak_watts: int | None = Field(default=None, description="Peak production seen, W")
    peak_ts: int | None = Field(default=None, description="When the peak occurred, epoch seconds")
    latest_watts: int | None = Field(default=None, description="Most recent production, W")


class SolarHistoryModel(BaseModel):
    hours: int = Field(description="Width of the returned window, hours")
    samples: list[SolarSampleModel] = Field(description="Samples, oldest-first")
    stats: SolarHistoryStatsModel


@router.get("/solar/history", response_model=SolarHistoryModel)
def get_solar_history(hours: int = 24):
    """The intraday (default) production trend from the in-app sampler — empty
    until samples accumulate (or while solar is unconfigured)."""
    hours = max(1, min(hours, 720))
    since = time.time() - hours * 3600
    samples = db.recent_solar_samples(since_ts=since)
    return {"hours": hours, "samples": samples, "stats": summarize_history(samples)}
