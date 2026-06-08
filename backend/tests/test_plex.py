from datetime import datetime, timezone
from types import SimpleNamespace

from app import db
from app.routers import plex as P

ADDED = datetime(2020, 1, 1, tzinfo=timezone.utc)


def _media(res="1080", codec="h264", size=123):
    return SimpleNamespace(videoResolution=res, videoCodec=codec, parts=[SimpleNamespace(size=size)])


# --- pure helpers -----------------------------------------------------------

def test_res_height():
    assert P._res_height("4k") == 2160
    assert P._res_height("1080") == 1080
    assert P._res_height("sd") == 480
    assert P._res_height(None) == 0
    assert P._res_height("weird") == 0


def test_media_meta():
    assert P._media_meta(SimpleNamespace(media=[_media()])) == ("1080", "h264", 123)
    assert P._media_meta(SimpleNamespace(media=[])) == (None, None, None)
    assert P._media_meta(SimpleNamespace(media=None)) == (None, None, None)


def test_sort_columns_are_safe_strings():
    assert "title" in P._SORT_COLUMNS
    assert all(isinstance(v, str) for v in P._SORT_COLUMNS.values())


def test_row_builders_have_17_columns_and_right_type():
    section = SimpleNamespace(key=1, title="Movies")
    movie = SimpleNamespace(ratingKey=10, title="M", year=2000, duration=1000, media=[_media()], addedAt=ADDED)
    show = SimpleNamespace(ratingKey=20, title="S", year=1999, leafCount=10, addedAt=ADDED)
    ep = SimpleNamespace(
        ratingKey=21, title="E", year=2001, duration=1200, media=[_media()], addedAt=ADDED,
        parentIndex=2, index=5, grandparentTitle="S", grandparentRatingKey=20,
    )
    mrow, srow, erow = P._movie_row(section, movie), P._show_row(section, show), P._episode_row(section, ep)

    for row in (mrow, srow, erow):
        assert len(row) == 17
    assert mrow[3] == "movie"
    assert srow[3] == "show" and srow[11] == 10            # episodes count
    assert erow[3] == "episode"
    assert erow[13] == 2 and erow[14] == 5 and erow[16] == "20"  # season, episode, grandparent_key


# --- DB-backed query logic --------------------------------------------------

def test_library_items_excludes_episodes_filters_and_sorts(insert_item):
    insert_item(rating_key="m1", library_key="1", type="movie", title="Alpha", res_height=1080, file_size=100)
    insert_item(rating_key="m2", library_key="1", type="movie", title="Beta", res_height=2160, file_size=900)
    insert_item(rating_key="s1", library_key="3", type="show", title="Show", episodes=5)
    insert_item(rating_key="e1", library_key="3", type="episode", title="Ep", grandparent_key="s1", season=1, episode_num=1)

    movies = P.library_items("1")
    assert movies["total"] == 2
    assert {i["title"] for i in movies["items"]} == {"Alpha", "Beta"}

    shows = P.library_items("3")  # episodes excluded from the library listing
    assert shows["total"] == 1 and shows["items"][0]["type"] == "show"

    by_size = P.library_items("1", sort="size", order="desc")
    assert by_size["items"][0]["title"] == "Beta"

    found = P.library_items("1", search="alph")
    assert found["total"] == 1 and found["items"][0]["title"] == "Alpha"

    page = P.library_items("1", sort="title", order="asc", limit=1, offset=0)
    assert len(page["items"]) == 1 and page["items"][0]["title"] == "Alpha" and page["total"] == 2


def test_library_items_unknown_sort_falls_back_safely(insert_item):
    insert_item(rating_key="m1", library_key="1", title="Z")
    insert_item(rating_key="m2", library_key="1", title="A")
    res = P.library_items("1", sort="; DROP TABLE media_items; --")
    assert res["total"] == 2  # bad sort key ignored, no injection


def test_show_episodes_ordered_by_season_then_episode(insert_item):
    insert_item(rating_key="s1", library_key="3", type="show", title="Show")
    insert_item(rating_key="e2", type="episode", title="B", grandparent_key="s1", season=1, episode_num=2)
    insert_item(rating_key="e1", type="episode", title="A", grandparent_key="s1", season=1, episode_num=1)
    insert_item(rating_key="e3", type="episode", title="C", grandparent_key="s1", season=2, episode_num=1)

    res = P.show_episodes("s1")
    assert res["show"] == "Show" and res["total"] == 3
    assert [(e["season"], e["episode_num"]) for e in res["episodes"]] == [(1, 1), (1, 2), (2, 1)]


def test_sync_status_defaults_then_reads_meta():
    st = P.sync_status()
    assert st["status"] == "never" and st["item_count"] == 0 and st["last_synced"] is None

    db.set_meta("last_synced", 123)
    db.set_meta("item_count", 5)
    db.set_meta("sync_status", "idle")
    st2 = P.sync_status()
    assert st2["last_synced"] == 123 and st2["item_count"] == 5 and st2["status"] == "idle"
