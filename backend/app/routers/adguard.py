"""
/api/adguard — a live glance at the AdGuard Home ad-blocking resolver: DNS queries
seen, queries blocked, the blocked %, protection on/off, and the top blocked
domains. The backend reads AdGuard's REST API directly (see app/adguard.py).
Read-only — pausing / blocklist config is done in AdGuard's own UI, true to the
platform's read-mostly posture. available:false ("not_configured" | "unreachable")
whenever the host is unset or unreachable, so the UI degrades cleanly — same
pattern as /api/solar and /api/weather.
"""

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app import adguard

router = APIRouter()


class BlockedDomainModel(BaseModel):
    domain: str = Field(description="The blocked domain")
    count: int = Field(description="Times blocked in the stats window")


# Superset model. adguard.get_adguard() always returns `available`; the rest are
# dropped by response_model_exclude_none when absent (e.g. on not_configured).
class AdguardModel(BaseModel):
    available: bool = Field(description="True when AdGuard was read OK")
    reason: str | None = Field(
        default=None, description="When unavailable: not_configured | unreachable"
    )
    protection_enabled: bool | None = Field(
        default=None, description="Whether DNS filtering is currently on"
    )
    total_queries: int | None = Field(
        default=None, description="DNS queries in the stats window"
    )
    blocked_queries: int | None = Field(
        default=None,
        description="Queries blocked (filters + safebrowsing/safesearch/parental)",
    )
    blocked_percent: float | None = Field(
        default=None, description="Blocked queries as a percentage of the total"
    )
    top_blocked_domains: list[BlockedDomainModel] | None = Field(
        default=None, description="Most-blocked domains, descending"
    )


@router.get("/adguard", response_model=AdguardModel, response_model_exclude_none=True)
def get_adguard():
    """Live AdGuard Home snapshot (cached briefly server-side to smooth polling)."""
    return adguard.get_adguard()
