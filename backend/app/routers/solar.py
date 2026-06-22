"""
/api/solar — a live glance at the Enphase solar system: current production,
whole-home consumption (metered systems only), net flow, and today/7-day/lifetime
energy. The backend reads the Envoy's local API directly via pyenphase (see
app/solar.py for the why + the auth model). available:false ("not_configured" |
"unreachable") whenever creds are missing or the gateway can't be reached, so the
UI degrades cleanly — same pattern as /api/printer and /api/ha.
"""

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app import solar

router = APIRouter()


class SolarSeriesModel(BaseModel):
    watts_now: int = Field(description="Current power, watts")
    watt_hours_today: int = Field(description="Energy since local midnight, Wh")
    watt_hours_last_7_days: int = Field(description="Energy over the last 7 days, Wh")
    watt_hours_lifetime: int = Field(description="Lifetime energy, Wh")


# Superset model. solar.get_solar() always returns `available`; the rest are
# dropped by response_model_exclude_none when absent (not_configured, or a
# non-metered system with no consumption).
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


@router.get("/solar", response_model=SolarModel, response_model_exclude_none=True)
async def get_solar():
    """Live solar snapshot (cached briefly server-side to smooth polling)."""
    return await solar.get_solar()
