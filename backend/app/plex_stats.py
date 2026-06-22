"""
Plex watch statistics — per-user, per-type play counts and hours watched over a
few rolling windows (week / month / year / all-time), computed LIVE from Plex's
own watch history.

The real dataset is small (a few hundred history entries, fetched in ~0.1s), so
the endpoint queries Plex on each (short-TTL-cached) call rather than running a
background sampler. The history XML omits each entry's runtime, so to total
*hours* we look the runtime up once per item (fetchItem) and cache it
persistently (db.plex_item_durations) — a one-time cost per item.

`build_watch_stats` is a PURE function (no I/O) so it's cheaply unit-tested with
fake entries; the orchestrator below wires it to the live Plex client + caches.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

# Window length (in days) for each rolling period. `all` (no cutoff) is handled
# specially below.
_PERIOD_DAYS = {"week": 7, "month": 30, "year": 365}
_PERIODS = ("week", "month", "year", "all")


def _empty_period() -> dict:
    return {
        "total_plays": 0,
        "total_hours": 0.0,
        "by_user": [],
        "by_type": {},
        "top": [],
    }


def _viewed_at(entry):
    """A history entry's watch time as an aware UTC datetime, or None."""
    va = getattr(entry, "viewedAt", None)
    if va is None:
        return None
    # Plex gives naive local datetimes; treat a naive value as UTC so the
    # windowing is consistent (relative comparisons only, so the choice is safe).
    if va.tzinfo is None:
        return va.replace(tzinfo=timezone.utc)
    return va


def _top_title(entry):
    """The title used for the 'top' chart. Episodes roll up under their show so
    a binge counts toward the show, not 99 individual episodes."""
    if getattr(entry, "type", None) == "episode":
        return getattr(entry, "grandparentTitle", None) or getattr(entry, "title", None) or "Unknown"
    return getattr(entry, "title", None) or "Unknown"


def _aggregate(entries, id_to_name, duration_ms_lookup) -> dict:
    """Roll a list of (already window-filtered) entries into one period summary."""
    total_plays = 0
    total_ms = 0
    user_plays: dict[str, int] = {}
    user_ms: dict[str, int] = {}
    by_type: dict[str, int] = {}
    top_plays: dict[tuple[str, str], int] = {}

    for e in entries:
        total_plays += 1

        name = id_to_name.get(getattr(e, "accountID", None), "Unknown")
        user_plays[name] = user_plays.get(name, 0) + 1

        kind = getattr(e, "type", None) or "unknown"
        by_type[kind] = by_type.get(kind, 0) + 1

        ms = duration_ms_lookup(getattr(e, "ratingKey", None))
        ms = ms or 0  # None / unfetchable → contributes 0 hours but still a play
        total_ms += ms
        user_ms[name] = user_ms.get(name, 0) + ms

        key = (_top_title(e), kind)
        top_plays[key] = top_plays.get(key, 0) + 1

    def hours(ms: int) -> float:
        return round(ms / 3_600_000.0, 1)

    # Users sorted by play count desc, then name for a stable tie-break.
    by_user = sorted(
        (
            {"user": u, "plays": p, "hours": hours(user_ms.get(u, 0))}
            for u, p in user_plays.items()
        ),
        key=lambda r: (-r["plays"], r["user"]),
    )

    # Top 5 titles by play count (title, then type for a stable tie-break).
    top = sorted(
        (
            {"title": title, "plays": plays, "type": kind}
            for (title, kind), plays in top_plays.items()
        ),
        key=lambda r: (-r["plays"], r["title"], r["type"]),
    )[:5]

    return {
        "total_plays": total_plays,
        "total_hours": hours(total_ms),
        "by_user": by_user,
        "by_type": by_type,
        "top": top,
    }


def build_watch_stats(entries, id_to_name, duration_ms_lookup, now=None) -> dict:
    """Aggregate Plex history `entries` into per-period watch stats. PURE.

    Args:
        entries: history entries, each with .accountID, .viewedAt (datetime),
            .type, .title, .grandparentTitle, .ratingKey.
        id_to_name: {accountID: display name}.
        duration_ms_lookup: callable(ratingKey) -> int|None (cached runtime ms).
            None / 0 means unknown runtime → the play still counts, 0 hours.
        now: reference time (aware datetime); defaults to current UTC.

    Returns {"periods": {"week"|"month"|"year"|"all": <period summary>}} where a
    period summary is {total_plays, total_hours (1 dp), by_user, by_type, top}.
    Window for each period is the trailing N days relative to `now`; `all` is
    every entry. Empty input → every period is the zeroed shape.
    """
    if now is None:
        now = datetime.now(timezone.utc)
    elif now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    # Precompute each entry's viewed-at once, dropping entries with no timestamp.
    stamped = [(e, _viewed_at(e)) for e in entries]
    stamped = [(e, va) for (e, va) in stamped if va is not None]

    cutoffs = {p: now - timedelta(days=d) for p, d in _PERIOD_DAYS.items()}

    periods: dict[str, dict] = {}
    for period in _PERIODS:
        if period == "all":
            bucket = [e for (e, _va) in stamped]
        else:
            cutoff = cutoffs[period]
            bucket = [e for (e, va) in stamped if va >= cutoff]
        periods[period] = _aggregate(bucket, id_to_name, duration_ms_lookup)

    return {"periods": periods}


# --- Live orchestrator -----------------------------------------------------


def _build_id_to_name(server) -> dict:
    """Map Plex accountID -> display name. Account 0 (the owner row) has an empty
    name; surface it as 'Server' so its plays aren't labelled 'Unknown'."""
    id_to_name: dict = {}
    for acct in server.systemAccounts():
        aid = getattr(acct, "accountID", None)
        if aid is None:
            continue
        name = (getattr(acct, "name", "") or "").strip()
        id_to_name[aid] = name or "Server"
    return id_to_name


def _duration_lookup(server):
    """A duration_ms_lookup backed by the persistent cache, lazily populating it
    from Plex on a miss. Returns 0 for media that can't be fetched (deleted), and
    stores that 0 so we don't refetch it next time."""
    from app import db

    def lookup(rating_key):
        if rating_key is None:
            return 0
        cached = db.get_item_duration(rating_key)
        if cached is not None:
            return cached  # may be 0 (the unfetchable sentinel)
        duration = 0
        try:
            item = server.fetchItem(int(rating_key))
            duration = int(getattr(item, "duration", None) or 0)
        except Exception:
            duration = 0  # deleted/unfetchable → count the play, 0 hours
        db.set_item_duration(rating_key, duration)
        return duration

    return lookup


def compute_watch_stats(server, maxresults=200000, now=None) -> dict:
    """Fetch history + accounts + cached durations from a live PlexServer and
    aggregate. Raises on any Plex error — the router wraps this and degrades to
    an available:false body."""
    # `all` needs the full history; year is the longest finite window, so a single
    # fetch covers every period. The cap is a safety bound set well above any
    # realistic home-server lifetime history so it never silently truncates the
    # 'all'/'year' totals (PlexAPI's own default is ~10M).
    entries = server.history(maxresults=maxresults)
    id_to_name = _build_id_to_name(server)
    lookup = _duration_lookup(server)
    stats = build_watch_stats(entries, id_to_name, lookup, now=now)
    stats["available"] = True
    return stats
