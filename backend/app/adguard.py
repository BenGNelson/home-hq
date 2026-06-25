"""
AdGuard Home — a live read of the ad-blocking DNS resolver's stats.

The ad-blocking itself is a SEPARATE host-side service: AdGuard Home runs in its
own container and filters DNS for the phone over the mesh VPN. Home HQ only READS
it — a glance at how much it's blocking — keeping the platform's read-mostly
posture (pausing / blocklist config is done in AdGuard's own UI, not here).

We hit AdGuard's REST API directly (like Plex or Weather, a data source HQ owns):
  GET /control/stats   -> query totals + top blocked domains
  GET /control/status  -> protection on/off
authenticated with the admin login (HTTP Basic Auth).

Config (all in .env; absent host => available:false / "not_configured"):
  ADGUARD_HOST                 base URL of the AdGuard admin/API (e.g. http://host:3000)
  ADGUARD_USERNAME/PASSWORD    the AdGuard admin login (password is a secret)
  ADGUARD_CACHE_TTL            seconds to reuse the last poll

The shaping is a pure function so it's unit-tested without a live resolver. Any
failure degrades to available:false rather than raising — the app-wide pattern,
same as solar.py / weather.py.
"""

import time

import requests

from app.config import settings

# Module-level success cache (mirrors weather.py): only successful reads are
# stored, so a transient blip doesn't pin a bad result for the full TTL.
_cache = {"ts": 0.0, "data": None, "ttl": 0.0}

# How many top blocked domains to surface (the page lists them; the widget a few).
_TOP_N = 10

# The blocked-query counters AdGuard splits its total across; summing them matches
# the "blocked" percentage AdGuard's own dashboard headlines.
_BLOCKED_KEYS = (
    "num_blocked_filtering",
    "num_replaced_safebrowsing",
    "num_replaced_safesearch",
    "num_replaced_parental",
)


def is_configured() -> bool:
    """True when we have the AdGuard API base URL to read."""
    return bool(settings.adguard_host)


def _int(x):
    """Round to a whole number, tolerating None/non-numbers (a missing field
    shouldn't crash the read into 'unreachable')."""
    return round(x) if isinstance(x, (int, float)) else None


def _blocked_count(stats) -> int:
    """Total blocked = filtering + safebrowsing + safesearch + parental."""
    return sum(int(stats.get(k) or 0) for k in _BLOCKED_KEYS)


def _top_domains(stats) -> list:
    """AdGuard's `top_blocked_domains` is a list of single-key {domain: count}
    dicts; flatten to [{"domain", "count"}], sorted by count descending and
    capped at _TOP_N. AdGuard usually returns them pre-sorted, but we sort here
    so the "descending" contract is self-enforcing (and the cap keeps the true
    top N). Defensive — a malformed entry is skipped rather than raising."""
    out = []
    for entry in stats.get("top_blocked_domains") or []:
        if not isinstance(entry, dict) or not entry:
            continue
        domain, count = next(iter(entry.items()))
        out.append({"domain": str(domain), "count": _int(count) or 0})
    out.sort(key=lambda r: r["count"], reverse=True)
    return out[:_TOP_N]


def shape(stats, status) -> dict:
    """AdGuard /control/stats + /control/status -> the /api/adguard payload
    (pure, unit-tested). Percent is blocked/total, guarded against divide-by-zero
    on a fresh resolver with no queries yet."""
    total = int(stats.get("num_dns_queries") or 0)
    blocked = _blocked_count(stats)
    percent = round(blocked / total * 100, 1) if total else 0.0
    return {
        "available": True,
        "protection_enabled": bool(status.get("protection_enabled")),
        "total_queries": total,
        "blocked_queries": blocked,
        "blocked_percent": percent,
        "top_blocked_domains": _top_domains(stats),
    }


def _get(path: str):
    """One authenticated GET against the AdGuard API; raises on transport/HTTP
    error or a non-JSON body (caught by get_adguard)."""
    auth = None
    # Only send Basic Auth when BOTH are set — a half-filled credential just
    # earns a 401 (→ "unreachable") with no hint why. AdGuard requires both.
    if settings.adguard_username and settings.adguard_password:
        auth = (settings.adguard_username, settings.adguard_password)
    resp = requests.get(f"{settings.adguard_host.rstrip('/')}{path}", auth=auth, timeout=10)
    resp.raise_for_status()
    return resp.json()


def get_adguard() -> dict:
    """Current AdGuard snapshot, or available:false on any problem.

    Cached for `adguard_cache_ttl` seconds to smooth the widget's polling. Only
    successes are cached — a transient error just retries on the next call."""
    if not is_configured():
        return {"available": False, "reason": "not_configured"}

    now = time.monotonic()
    if _cache["data"] is not None and now - _cache["ts"] < _cache["ttl"]:
        return _cache["data"]

    try:
        stats = _get("/control/stats")
        status = _get("/control/status")
        result = shape(stats, status)
    except (requests.RequestException, ValueError):
        # ValueError covers a non-JSON / malformed body (resp.json()). Don't cache
        # the failure — let the next call retry.
        return {"available": False, "reason": "unreachable"}

    _cache.update(ts=time.monotonic(), data=result, ttl=settings.adguard_cache_ttl)
    return result
