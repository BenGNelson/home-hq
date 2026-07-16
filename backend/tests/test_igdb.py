"""Tests for the IGDB client — the pure matching/shaping logic, plus the token
cache and lookup with `requests` stubbed (no network). Mirrors test_weather: the
HTTP round-trips are faked so fresh/expired/error paths are deterministic."""

import time

import pytest

from app import db, igdb
from app.config import settings


@pytest.fixture(autouse=True)
def _creds(monkeypatch):
    """Configure IGDB creds and start every test with a cold token cache."""
    monkeypatch.setattr(settings, "igdb_client_id", "cid")
    monkeypatch.setattr(settings, "igdb_client_secret", "secret")
    igdb.reset_token_cache()
    yield
    igdb.reset_token_cache()


class _Resp:
    """A minimal stand-in for a requests.Response."""

    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            import requests

            raise requests.HTTPError(f"status {self.status_code}")

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


# --- pure: configuration + search/query strings ---------------------------

def test_configured_needs_both_creds(monkeypatch):
    assert igdb.configured(settings) is True
    monkeypatch.setattr(settings, "igdb_client_secret", "")
    assert igdb.configured(settings) is False


def test_search_string_moves_trailing_article_and_softens_separators():
    assert igdb.search_string("Legend of Zelda, The - Oracle of Seasons (USA)") == (
        "the legend of zelda oracle of seasons"
    )
    assert igdb.search_string("Super Mario Bros. 3 (USA)") == "super mario bros. 3"


def test_query_body_includes_platform_filter_and_escapes_quotes():
    body = igdb.query_body('Metroid "Prime"', 24)
    assert 'search "metroid prime";' in body
    assert "where platforms = (24);" in body
    assert "fields " in body and "limit 8;" in body


def test_query_body_omits_where_without_platform():
    assert "where platforms" not in igdb.query_body("Tetris", None)


# --- pure: scoring + selection --------------------------------------------

def test_score_is_article_and_order_insensitive():
    assert igdb.score("Legend of Zelda, The", "The Legend of Zelda") == pytest.approx(1.0)
    assert igdb.score("Super Mario World", "Sonic the Hedgehog") < 0.3


def test_best_match_picks_top_over_threshold():
    cands = [
        {"id": 1, "name": "Some Other Game"},
        {"id": 2, "name": "The Legend of Zelda: Link's Awakening"},
    ]
    chosen, sc = igdb.best_match("Legend of Zelda, The - Link's Awakening (USA)", cands)
    assert chosen["id"] == 2 and sc >= 0.6


def test_best_match_returns_none_below_threshold():
    cands = [{"id": 9, "name": "Completely Unrelated Title"}]
    chosen, sc = igdb.best_match("Pokemon Crystal Clear (hack)", cands)
    assert chosen is None and 0.0 <= sc < 0.6


def test_best_match_empty_candidates():
    assert igdb.best_match("anything", []) == (None, 0.0)


# --- pure: flattening a candidate -----------------------------------------

def test_flatten_extracts_dev_publisher_year_rating_and_media():
    candidate = {
        "id": 7,
        "name": "The Legend of Zelda: Oracle of Seasons",
        "summary": "A Link adventure.",
        "first_release_date": 971136000,  # 2000
        "total_rating": 84.7,
        "rating": 70.0,
        "genres": [{"name": "Adventure"}, {"name": "Puzzle"}],
        "involved_companies": [
            {"developer": True, "company": {"name": "Capcom"}},
            {"publisher": True, "company": {"name": "Nintendo"}},
        ],
        "cover": {"image_id": "covA"},
        "screenshots": [{"image_id": "s1"}, {"image_id": "s2"}, {}],
        "videos": [{"video_id": "yt1", "name": "Trailer"}, {"name": "no id"}],
    }
    out = igdb.flatten(candidate)
    assert out["igdb_id"] == 7
    assert out["release_year"] == 2000
    assert out["rating"] == 85  # rounded total_rating, preferred over rating
    assert out["developer"] == "Capcom" and out["publisher"] == "Nintendo"
    assert out["genres"] == ["Adventure", "Puzzle"]
    assert out["cover_image_id"] == "covA"
    assert out["screenshot_ids"] == ["s1", "s2"]
    assert out["videos"] == [{"id": "yt1", "name": "Trailer"}]


def test_flatten_none_and_sparse():
    assert igdb.flatten(None) == {}
    sparse = igdb.flatten({"id": 1, "name": "X"})
    assert sparse["developer"] is None and sparse["screenshot_ids"] == []
    assert sparse["rating"] is None and sparse["release_year"] is None


def test_image_url_builds_size_template():
    assert igdb.image_url("abc") == (
        "https://images.igdb.com/igdb/image/upload/t_screenshot_big/abc.jpg"
    )
    assert "t_cover_big" in igdb.image_url("abc", "t_cover_big")


# --- token cache (requests stubbed) ---------------------------------------

def test_token_minted_once_then_cached(monkeypatch):
    calls = []

    def fake_post(url, **kw):
        calls.append(url)
        return _Resp({"access_token": "TOK", "expires_in": 5000})

    monkeypatch.setattr(igdb.requests, "post", fake_post)
    assert igdb._get_token(settings, now=1000) == "TOK"
    assert igdb._get_token(settings, now=1001) == "TOK"  # cached
    assert len(calls) == 1


def test_token_refreshed_near_expiry(monkeypatch):
    tokens = iter(["T1", "T2"])

    def fake_post(url, **kw):
        return _Resp({"access_token": next(tokens), "expires_in": 100})

    monkeypatch.setattr(igdb.requests, "post", fake_post)
    assert igdb._get_token(settings, now=0) == "T1"
    # Within 60s of the 100s expiry → re-mint.
    assert igdb._get_token(settings, now=50) == "T2"


def test_token_none_when_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "igdb_client_id", "")
    assert igdb._get_token(settings) is None


def test_token_none_on_network_error(monkeypatch):
    import requests

    def boom(url, **kw):
        raise requests.ConnectionError("down")

    monkeypatch.setattr(igdb.requests, "post", boom)
    assert igdb._get_token(settings, now=0) is None


# --- lookup end to end (requests stubbed) ---------------------------------

def test_lookup_matches_and_returns_candidates(monkeypatch):
    def fake_post(url, **kw):
        if "oauth2" in url:
            return _Resp({"access_token": "TOK", "expires_in": 5000})
        return _Resp([
            {"id": 1, "name": "Unrelated"},
            {"id": 2, "name": "Super Mario World"},
        ])

    monkeypatch.setattr(igdb.requests, "post", fake_post)
    result = igdb.lookup("Super Mario World (USA)", "Super Nintendo", settings)
    assert result["matched"] is True
    assert result["igdb"]["id"] == 2
    assert len(result["candidates"]) == 2


def test_lookup_unmatched_is_a_definite_result(monkeypatch):
    def fake_post(url, **kw):
        if "oauth2" in url:
            return _Resp({"access_token": "TOK", "expires_in": 5000})
        return _Resp([{"id": 9, "name": "Nothing Alike At All"}])

    monkeypatch.setattr(igdb.requests, "post", fake_post)
    result = igdb.lookup("Pokemon Brown (hack)", "Game Boy", settings)
    assert result is not None and result["matched"] is False
    assert result["igdb"] is None


def test_lookup_none_when_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "igdb_client_id", "")
    assert igdb.lookup("Tetris", "Game Boy", settings) is None


def test_lookup_none_on_query_error(monkeypatch):
    import requests

    def fake_post(url, **kw):
        if "oauth2" in url:
            return _Resp({"access_token": "TOK", "expires_in": 5000})
        raise requests.ConnectionError("down")

    monkeypatch.setattr(igdb.requests, "post", fake_post)
    assert igdb.lookup("Tetris", "Game Boy", settings) is None


# --- db round-trip (igdb_meta cache) --------------------------------------

def test_db_upsert_and_get_roundtrips_json_columns():
    db.upsert_igdb_meta(
        "gb/Zelda.gb",
        {
            "igdb_id": 42,
            "matched": True,
            "name": "Link's Awakening",
            "summary": "Wake the Wind Fish.",
            "release_year": 1993,
            "rating": 89,
            "developer": "Nintendo",
            "publisher": "Nintendo",
            "genres": ["Adventure"],
            "cover_image_id": "cov",
            "screenshot_ids": ["s1", "s2"],
            "videos": [{"id": "yt", "name": "Trailer"}],
            "candidates": [{"id": 42, "name": "Link's Awakening", "release_year": 1993}],
            "confidence": 0.95,
            "source": "auto",
            "rom_mtime": 111.0,
        },
    )
    got = db.get_igdb_meta("gb/Zelda.gb")
    assert got["matched"] is True and got["igdb_id"] == 42
    assert got["genres"] == ["Adventure"]
    assert got["screenshot_ids"] == ["s1", "s2"]
    assert got["videos"] == [{"id": "yt", "name": "Trailer"}]
    assert got["confidence"] == 0.95


def test_db_get_missing_is_none():
    assert db.get_igdb_meta("nope.gb") is None


def test_db_upsert_overwrites_and_counts():
    db.upsert_igdb_meta("a.gb", {"matched": True, "source": "auto", "rom_mtime": 1.0})
    db.upsert_igdb_meta("b.gb", {"matched": False, "source": "auto", "rom_mtime": 2.0})
    # Re-match a.gb (an override) — same row, new source.
    db.upsert_igdb_meta("a.gb", {"matched": True, "source": "manual", "igdb_id": 7})
    total, matched = db.count_igdb_meta()
    assert total == 2 and matched == 1  # a.gb matched, b.gb unmatched
    assert db.get_igdb_meta("a.gb")["source"] == "manual"


def test_db_mtimes_and_prune():
    db.upsert_igdb_meta("keep.gb", {"matched": True, "source": "auto", "match_version": "1", "rom_mtime": 5.0})
    db.upsert_igdb_meta("gone.gb", {"matched": False, "source": "auto", "rom_mtime": 6.0})
    mtimes = db.igdb_mtimes()
    assert mtimes["keep.gb"] == (5.0, "auto", "1")  # (rom_mtime, source, match_version)
    db.delete_igdb_meta_many(["gone.gb"])
    assert "gone.gb" not in db.igdb_mtimes()


# --- matcher pass logic (IgdbMatcher.match_once) --------------------------

from app import igdb_sync  # noqa: E402


def _matcher_env(monkeypatch, items, lookup, mtimes=None):
    """Stub the matcher's world: the games listing, path resolution, ROM mtimes,
    and igdb.lookup — no filesystem, no network, no rate-limit sleeps."""
    monkeypatch.setattr(igdb_sync, "_RATE_DELAY", 0)
    monkeypatch.setattr(igdb_sync.library, "get_section", lambda k: {"key": "games"})
    monkeypatch.setattr(igdb_sync.library, "is_configured", lambda *a: True)
    monkeypatch.setattr(igdb_sync.library, "list_items", lambda *a: items)
    monkeypatch.setattr(igdb_sync.library, "safe_path", lambda s, st, gid: "/roms/" + gid)
    monkeypatch.setattr(
        igdb_sync.os.path, "getmtime", lambda p: (mtimes or {}).get(p.split("/roms/")[-1], 100.0)
    )
    monkeypatch.setattr(igdb_sync.igdb, "lookup", lookup)


def _hit(*_a):
    return {"matched": True, "igdb": {"id": 1, "name": "A"}, "score": 0.9, "candidates": []}


def test_match_once_stores_and_prunes_on_complete_pass(monkeypatch):
    db.upsert_igdb_meta("stale.gb", {"matched": True, "source": "auto", "match_version": "1", "rom_mtime": 1.0})
    _matcher_env(monkeypatch, [{"id": "a.gb", "name": "A", "label": "Game Boy"}], _hit)
    assert igdb_sync.IgdbMatcher(True, 3600).match_once() == 1
    assert db.get_igdb_meta("a.gb")["matched"] is True
    assert db.get_igdb_meta("stale.gb") is None  # gone from listing → pruned on a complete pass


def test_match_once_empty_listing_does_not_wipe_cache(monkeypatch):
    # A transient empty listing (mount glitch) must NOT prune the whole cache.
    db.upsert_igdb_meta("keep.gb", {"matched": True, "source": "auto", "match_version": "1", "rom_mtime": 1.0})
    _matcher_env(monkeypatch, [], lambda *a: None)
    igdb_sync.IgdbMatcher(True, 3600).match_once()
    assert db.get_igdb_meta("keep.gb") is not None


def test_match_once_aborts_after_consecutive_failures(monkeypatch):
    items = [{"id": f"{i}.gb", "name": str(i), "label": "Game Boy"} for i in range(20)]
    calls = {"n": 0}

    def failing(*_a):
        calls["n"] += 1
        return None  # IGDB down / bad creds

    _matcher_env(monkeypatch, items, failing)
    igdb_sync.IgdbMatcher(True, 3600).match_once()
    assert calls["n"] == igdb_sync._MAX_FAILS  # bailed, didn't machine-gun all 20


def test_match_once_skips_unchanged_current_version(monkeypatch):
    db.upsert_igdb_meta(
        "a.gb", {"matched": True, "source": "auto", "match_version": igdb_sync._MATCH_VERSION, "rom_mtime": 100.0}
    )
    calls = {"n": 0}

    def counting(*_a):
        calls["n"] += 1
        return _hit()

    _matcher_env(monkeypatch, [{"id": "a.gb", "name": "A", "label": "Game Boy"}], counting, {"a.gb": 100.0})
    igdb_sync.IgdbMatcher(True, 3600).match_once()
    assert calls["n"] == 0  # unchanged + current version → skipped (no re-query)


def test_match_once_relooks_up_old_version(monkeypatch):
    db.upsert_igdb_meta("a.gb", {"matched": True, "source": "auto", "match_version": "0", "rom_mtime": 100.0})
    calls = {"n": 0}

    def counting(*_a):
        calls["n"] += 1
        return _hit()

    _matcher_env(monkeypatch, [{"id": "a.gb", "name": "A", "label": "Game Boy"}], counting, {"a.gb": 100.0})
    igdb_sync.IgdbMatcher(True, 3600).match_once()
    assert calls["n"] == 1  # stale logic version → re-looked-up


def test_match_once_leaves_manual_override_untouched(monkeypatch):
    db.upsert_igdb_meta("a.gb", {"matched": True, "source": "manual", "igdb_id": 7, "rom_mtime": 100.0})
    calls = {"n": 0}

    def counting(*_a):
        calls["n"] += 1
        return _hit()

    _matcher_env(monkeypatch, [{"id": "a.gb", "name": "A", "label": "Game Boy"}], counting, {"a.gb": 100.0})
    igdb_sync.IgdbMatcher(True, 3600).match_once()
    assert calls["n"] == 0 and db.get_igdb_meta("a.gb")["igdb_id"] == 7  # override survives


# --- HTTP endpoints (TestClient) ------------------------------------------

def _seed(game_id="gb/Zelda.gb"):
    db.upsert_igdb_meta(
        game_id,
        {
            "igdb_id": 42,
            "matched": True,
            "name": "Link's Awakening",
            "summary": "Wake the Wind Fish.",
            "release_year": 1993,
            "rating": 89,
            "developer": "Nintendo",
            "publisher": "Nintendo",
            "genres": ["Adventure", "Puzzle"],
            "cover_image_id": "cov",
            "screenshot_ids": ["s1", "s2"],
            "videos": [{"id": "yt", "name": "Trailer"}],
            "candidates": [],
            "confidence": 0.95,
            "source": "auto",
            "rom_mtime": 1.0,
        },
    )


def test_meta_endpoint_degrades_when_not_looked_up(client, monkeypatch):
    # Dormant: no creds → configured=False (the autouse fixture set them).
    monkeypatch.setattr(settings, "igdb_client_id", "")
    monkeypatch.setattr(settings, "igdb_client_secret", "")
    r = client.get("/api/library/games/meta", params={"id": "gb/unknown.gb"})
    assert r.status_code == 200
    body = r.json()
    assert body["matched"] is False and body["configured"] is False


def test_meta_endpoint_returns_cached_row(client):
    _seed()
    body = client.get("/api/library/games/meta", params={"id": "gb/Zelda.gb"}).json()
    assert body["matched"] is True
    assert body["genres"] == ["Adventure", "Puzzle"]
    assert body["screenshot_ids"] == ["s1", "s2"]
    assert body["videos"][0]["id"] == "yt"
    assert body["release_year"] == 1993 and body["rating"] == 89


def test_screenshot_rejects_foreign_image_id(client):
    _seed()
    # An id this game doesn't reference is refused (not an open proxy).
    assert client.get(
        "/api/library/games/screenshot", params={"id": "gb/Zelda.gb", "shot": "evil"}
    ).status_code == 404


def test_screenshot_404_when_unmatched(client):
    assert client.get(
        "/api/library/games/screenshot", params={"id": "gb/none.gb", "shot": "s1"}
    ).status_code == 404


def test_meta_status_endpoint(client):
    body = client.get("/api/library/games/meta/status").json()
    assert "configured" in body and "looked_up" in body


def test_meta_reports_can_rematch_from_candidates(client):
    db.upsert_igdb_meta(
        "gb/z.gb",
        {"matched": True, "source": "auto", "igdb_id": 1, "screenshot_ids": [],
         "candidates": [{"id": 1, "name": "Z"}]},
    )
    body = client.get("/api/library/games/meta", params={"id": "gb/z.gb"}).json()
    assert body["can_rematch"] is True


# --- re-match ("Wrong game?") ---------------------------------------------

def test_fetch_by_id_returns_full_game(monkeypatch):
    def fake_post(url, **kw):
        if "oauth2" in url:
            return _Resp({"access_token": "TOK", "expires_in": 5000})
        return _Resp([{"id": 42, "name": "Zelda", "summary": "hi"}])

    monkeypatch.setattr(igdb.requests, "post", fake_post)
    g = igdb.fetch_by_id(42, settings)
    assert g["id"] == 42 and g["name"] == "Zelda"


def test_fetch_by_id_none_when_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "igdb_client_id", "")
    assert igdb.fetch_by_id(42, settings) is None


def test_fetch_by_id_none_on_empty(monkeypatch):
    def fake_post(url, **kw):
        if "oauth2" in url:
            return _Resp({"access_token": "TOK", "expires_in": 5000})
        return _Resp([])

    monkeypatch.setattr(igdb.requests, "post", fake_post)
    assert igdb.fetch_by_id(42, settings) is None


def test_candidates_endpoint_returns_shortlist_and_current(client):
    db.upsert_igdb_meta(
        "gb/z.gb",
        {"matched": True, "source": "auto", "igdb_id": 42,
         "candidates": [{"id": 1, "name": "A", "release_year": 1990},
                        {"id": 42, "name": "Z", "release_year": 1993}]},
    )
    body = client.get("/api/library/games/meta/candidates", params={"id": "gb/z.gb"}).json()
    assert body["current"] == 42 and len(body["candidates"]) == 2
    assert body["candidates"][0]["name"] == "A"


def test_candidates_empty_when_no_row(client):
    assert client.get(
        "/api/library/games/meta/candidates", params={"id": "nope.gb"}
    ).json() == {"candidates": [], "current": None}


def _rematch_env(monkeypatch, fetch=None):
    from app.routers import library as libr
    monkeypatch.setattr(libr.library, "safe_path", lambda *a: "/roms/z.gb")
    monkeypatch.setattr(libr.os.path, "getmtime", lambda p: 9.0)
    if fetch is not None:
        monkeypatch.setattr(libr.igdb, "fetch_by_id", fetch)


def test_rematch_to_candidate_stores_manual_and_keeps_candidates(client, monkeypatch):
    db.upsert_igdb_meta(
        "gb/z.gb",
        {"matched": True, "source": "auto", "igdb_id": 1, "name": "Wrong",
         "candidates": [{"id": 42, "name": "Z", "release_year": 1993}], "rom_mtime": 5.0},
    )
    _rematch_env(monkeypatch, fetch=lambda i, s: {"id": 42, "name": "Zelda", "summary": "ok"})
    r = client.post("/api/library/games/meta", json={"id": "gb/z.gb", "igdb_id": 42})
    assert r.status_code == 200 and r.json() == {"matched": True}
    row = db.get_igdb_meta("gb/z.gb")
    assert row["source"] == "manual" and row["igdb_id"] == 42 and row["name"] == "Zelda"
    assert row["candidates"] == [{"id": 42, "name": "Z", "release_year": 1993}]  # preserved


def test_rematch_clear_sets_cleared_and_keeps_candidates(client, monkeypatch):
    db.upsert_igdb_meta(
        "gb/z.gb",
        {"matched": True, "source": "auto", "igdb_id": 1,
         "candidates": [{"id": 42, "name": "Z"}], "rom_mtime": 5.0},
    )
    _rematch_env(monkeypatch)
    r = client.post("/api/library/games/meta", json={"id": "gb/z.gb", "igdb_id": None})
    assert r.status_code == 200 and r.json() == {"matched": False}
    row = db.get_igdb_meta("gb/z.gb")
    assert row["source"] == "cleared" and row["matched"] is False
    assert row["candidates"] == [{"id": 42, "name": "Z"}]


def test_rematch_404_for_unknown_rom(client):
    # games unconfigured → safe_path None → 404 (guards against arbitrary ids)
    assert client.post(
        "/api/library/games/meta", json={"id": "gb/nope.gb", "igdb_id": 1}
    ).status_code == 404


def test_rematch_502_when_fetch_fails_leaves_row_untouched(client, monkeypatch):
    db.upsert_igdb_meta("gb/z.gb", {"matched": True, "source": "auto", "igdb_id": 1, "candidates": []})
    _rematch_env(monkeypatch, fetch=lambda i, s: None)
    r = client.post("/api/library/games/meta", json={"id": "gb/z.gb", "igdb_id": 999})
    assert r.status_code == 502
    assert db.get_igdb_meta("gb/z.gb")["source"] == "auto"  # unchanged
