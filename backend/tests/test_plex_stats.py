"""Tests for the Plex watch-stats aggregator (pure, no DB / no Plex).

PRIVACY: every name, account id, and title here is invented — real watch history
is other people's PII and must never appear in code, tests, or comments. We use
obviously-fake users (alice / bob) and made-up titles.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.plex_stats import build_watch_stats

NOW = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

# Fake accountID -> display name. Made-up ids; account 0 maps to "Server".
ID_TO_NAME = {0: "Server", 11: "alice", 22: "bob"}

# Fake runtimes (ms) keyed by made-up ratingKeys. A 1h movie = 3_600_000 ms.
_DURATIONS = {
    100: 3_600_000,   # 1.0 h
    101: 1_800_000,   # 0.5 h
    200: 1_200_000,   # 20 min episode
    201: None,        # unknown runtime → counts as a play, 0 hours
}


def _dur(rk):
    return _DURATIONS.get(rk)


def _entry(account_id, days_ago, kind, title, rating_key, show=None):
    """A fake history entry mirroring the PlexAPI fields we read."""
    return SimpleNamespace(
        accountID=account_id,
        viewedAt=NOW - timedelta(days=days_ago),
        type=kind,
        title=title,
        grandparentTitle=show,
        ratingKey=rating_key,
    )


def test_empty_history_is_zeroed():
    stats = build_watch_stats([], ID_TO_NAME, _dur, now=NOW)
    for period in ("week", "month", "year", "all"):
        p = stats["periods"][period]
        assert p["total_plays"] == 0
        assert p["total_hours"] == 0.0
        assert p["by_user"] == []
        assert p["by_type"] == {}
        assert p["top"] == []


def test_per_user_play_counts_and_sorting():
    entries = [
        _entry(11, 1, "movie", "Film A", 100),
        _entry(11, 2, "movie", "Film B", 101),
        _entry(22, 1, "movie", "Film C", 100),
    ]
    week = build_watch_stats(entries, ID_TO_NAME, _dur, now=NOW)["periods"]["week"]
    assert week["total_plays"] == 3
    # Sorted by plays desc: alice (2) before bob (1).
    assert [u["user"] for u in week["by_user"]] == ["alice", "bob"]
    assert week["by_user"][0] == {"user": "alice", "plays": 2, "hours": 1.5}
    assert week["by_user"][1] == {"user": "bob", "plays": 1, "hours": 1.0}


def test_windowing_buckets_by_age():
    # One entry in each window plus one just outside the year window.
    entries = [
        _entry(11, 1, "movie", "ThisWeek", 100),     # week, month, year, all
        _entry(11, 15, "movie", "ThisMonth", 100),   # month, year, all
        _entry(11, 100, "movie", "ThisYear", 100),   # year, all
        _entry(11, 400, "movie", "LongAgo", 100),    # all only
    ]
    periods = build_watch_stats(entries, ID_TO_NAME, _dur, now=NOW)["periods"]
    assert periods["week"]["total_plays"] == 1
    assert periods["month"]["total_plays"] == 2
    assert periods["year"]["total_plays"] == 3
    assert periods["all"]["total_plays"] == 4


def test_hours_summed_from_lookup_including_unknown_duration():
    entries = [
        _entry(11, 1, "movie", "OneHour", 100),       # 1.0 h
        _entry(11, 1, "movie", "HalfHour", 101),      # 0.5 h
        _entry(11, 1, "episode", "NoRuntime", 201, show="Show X"),  # None → 0 h
    ]
    week = build_watch_stats(entries, ID_TO_NAME, _dur, now=NOW)["periods"]["week"]
    assert week["total_plays"] == 3
    assert week["total_hours"] == 1.5  # 1.0 + 0.5 + 0 (unknown runtime)


def test_by_type_counts():
    entries = [
        _entry(11, 1, "movie", "Film A", 100),
        _entry(22, 1, "episode", "Ep 1", 200, show="Show X"),
        _entry(22, 1, "episode", "Ep 2", 200, show="Show X"),
    ]
    week = build_watch_stats(entries, ID_TO_NAME, _dur, now=NOW)["periods"]["week"]
    assert week["by_type"] == {"movie": 1, "episode": 2}


def test_top_titles_ordering_and_episode_rollup():
    # Episodes roll up under their show (grandparentTitle); a binge of "Show X"
    # should outrank the single movie.
    entries = [
        _entry(11, 1, "episode", "Ep 1", 200, show="Show X"),
        _entry(11, 1, "episode", "Ep 2", 200, show="Show X"),
        _entry(22, 1, "episode", "Ep 3", 200, show="Show X"),
        _entry(11, 1, "movie", "Film A", 100),
    ]
    top = build_watch_stats(entries, ID_TO_NAME, _dur, now=NOW)["periods"]["week"]["top"]
    assert top[0] == {"title": "Show X", "plays": 3, "type": "episode"}
    assert top[1] == {"title": "Film A", "plays": 1, "type": "movie"}


def test_top_is_capped_at_five():
    entries = [
        _entry(11, 1, "movie", f"Film {i}", 100 + i) for i in range(7)
    ]
    top = build_watch_stats(entries, ID_TO_NAME, _dur, now=NOW)["periods"]["week"]["top"]
    assert len(top) == 5


def test_movie_uses_title_episode_uses_show():
    entries = [
        _entry(11, 1, "movie", "Movie Title", 100),
        _entry(11, 1, "episode", "Episode Title", 200, show="Show Title"),
    ]
    titles = {t["title"] for t in build_watch_stats(entries, ID_TO_NAME, _dur, now=NOW)["periods"]["week"]["top"]}
    assert titles == {"Movie Title", "Show Title"}


def test_account_zero_maps_to_server():
    entries = [_entry(0, 1, "movie", "Film A", 100)]
    week = build_watch_stats(entries, ID_TO_NAME, _dur, now=NOW)["periods"]["week"]
    assert week["by_user"][0]["user"] == "Server"


def test_naive_now_is_treated_as_utc():
    naive_now = datetime(2026, 1, 1, 12, 0, 0)  # no tzinfo
    entries = [_entry(11, 1, "movie", "Film A", 100)]
    week = build_watch_stats(entries, ID_TO_NAME, _dur, now=naive_now)["periods"]["week"]
    assert week["total_plays"] == 1
