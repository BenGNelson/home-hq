"""
/api/weather — current conditions + a 5-day forecast from Open-Meteo (free, no
API key). available:false ("not_configured" when lat/lon are unset | "unreachable"
when the upstream call fails) so the UI degrades cleanly — same pattern as
/api/solar and /api/ha. See app/weather.py for the fetch + the pure shaping.
"""

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app import weather

router = APIRouter()


class CurrentModel(BaseModel):
    temp: float | None = Field(default=None, description="Current temperature, in temp_unit")
    feels_like: float | None = Field(
        default=None, description="Apparent ('feels like') temperature, in temp_unit"
    )
    humidity: int | None = Field(default=None, description="Relative humidity, percent")
    wind_speed: float | None = Field(default=None, description="Wind speed, in wind_unit")
    wind_dir: int | None = Field(default=None, description="Wind direction, degrees (0-360)")
    code: int | None = Field(default=None, description="WMO weather code (0-99)")
    is_day: bool = Field(description="True during daylight at the location")


class DailyModel(BaseModel):
    date: str = Field(description="Forecast day, YYYY-MM-DD (location-local)")
    code: int | None = Field(default=None, description="WMO weather code (0-99) for the day")
    hi: float | None = Field(default=None, description="Daytime high, in temp_unit")
    lo: float | None = Field(default=None, description="Overnight low, in temp_unit")
    precip_prob: int | None = Field(
        default=None, description="Max chance of precipitation, percent"
    )


# Superset model. weather.get_weather() always returns `available`; the rest are
# dropped by response_model_exclude_none when absent (not_configured / unreachable).
class WeatherModel(BaseModel):
    available: bool = Field(description="True when Open-Meteo was read OK")
    reason: str | None = Field(
        default=None, description="When unavailable: not_configured | unreachable"
    )
    current: CurrentModel | None = Field(default=None, description="Current conditions")
    daily: list[DailyModel] | None = Field(
        default=None, description="Up to 5 days of daily forecast"
    )
    temp_unit: str | None = Field(default=None, description="Temperature unit label, °F | °C")
    wind_unit: str | None = Field(default=None, description="Wind speed unit label, mph | km/h")


@router.get("/weather", response_model=WeatherModel, response_model_exclude_none=True)
def get_weather():
    """Current conditions + 5-day forecast (cached server-side; the upstream
    call is slow and weather changes slowly). Sync def so Starlette runs the
    blocking fetch in a threadpool."""
    return weather.get_weather()
