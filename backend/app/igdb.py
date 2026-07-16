"""
IGDB metadata client — enrich the Games library with screenshots, summaries,
genres, ratings, and developer/publisher (and, later, trailers) from IGDB.

IGDB is Twitch's games database; its API authenticates with a Twitch OAuth "app
access token" (the client-credentials grant). We mint one, cache it in-process
until it nears expiry, and send it with every `/games` query. Everything here is
defensive: no credentials configured, a network hiccup, a rate-limit, or bad
JSON all degrade to "no data" (None / unmatched) rather than raising — so one bad
lookup never breaks a collector pass or the app.

Two layers, split so the logic is unit-testable WITHOUT the network:
  - PURE helpers — the platform map, the search string, the APICalypse query
    body, match scoring/selection over candidate dicts, and flattening a chosen
    candidate into our stored fields.
  - NETWORKED helpers — the token mint and the POST to `/games`. Tests mock
    `requests`.

IGDB image ids (`cover.image_id`, `screenshots[].image_id`) are opaque strings;
`image_url()` builds the full URL and `igdb_sync` downloads them through the same
downscale pipeline the box art uses. Video ids are YouTube ids (used in M2).
"""

from __future__ import annotations

import logging
import re
import time
from difflib import SequenceMatcher

import requests

from app.library import base_title

log = logging.getLogger("home-hq.igdb")

# Our seven system labels (library.py's SECTIONS) → IGDB platform ids. A ROM
# whose label isn't here still gets a name-only search (platform filter omitted).
PLATFORM_IDS = {
    "Game Boy": 33,
    "Game Boy Color": 22,
    "Game Boy Advance": 24,
    "NES": 18,
    "Super Nintendo": 19,
    "Sega Genesis": 29,
    "Sega Master System": 64,
    "Sega Game Gear": 35,
}

_TOKEN_URL = "https://id.twitch.tv/oauth2/token"
_GAMES_URL = "https://api.igdb.com/v4/games"
_TIMEOUT = 15

# The fields pulled for every candidate. `total_rating` blends critic + user;
# we fall back to `rating` (user only) when it's absent.
_FIELDS = (
    "name,summary,first_release_date,rating,total_rating,"
    "genres.name,involved_companies.company.name,involved_companies.developer,"
    "involved_companies.publisher,cover.image_id,screenshots.image_id,"
    "videos.video_id,videos.name"
)

# Low-signal words dropped before token comparison, so article/preposition
# differences ("The Legend of Zelda" vs "Legend of Zelda, The") don't cost score.
_STOPWORDS = {"the", "a", "an", "of", "and", "to"}


# --- pure helpers ---------------------------------------------------------

def configured(settings) -> bool:
    """True when both Twitch credentials are set (else the feature is dormant)."""
    return bool(settings.igdb_client_id and settings.igdb_client_secret)


def search_string(name: str) -> str:
    """The IGDB `search` string for a ROM display-name: the tag-free base title
    (library.base_title strips (region)/[tag] suffixes and the ~alt~ form), with
    a No-Intro trailing-article comma fixed ('Zelda, The' → 'The Zelda') and
    separators softened so IGDB's search reaches subtitles."""
    core = base_title(name or "")
    core = re.sub(r"\b(.+?),\s*(the|a|an)\b", r"\2 \1", core)  # move the article
    core = core.replace(" - ", " ").replace(":", " ")
    return re.sub(r"\s+", " ", core).strip()


def query_body(name: str, platform_id: int | None, limit: int = 8) -> str:
    """The APICalypse body: a server-side `search` (fuzzy title match) narrowed to
    one platform, returning our fields. Double-quotes in the term are dropped so
    they can't break out of the search literal."""
    term = search_string(name).replace('"', "")
    where = f" where platforms = ({platform_id});" if platform_id else ""
    return f'search "{term}"; fields {_FIELDS};{where} limit {limit};'


def _tokens(name: str) -> list[str]:
    """Comparable word tokens of a title: tag-free, lowercased, punctuation split
    out, stopwords dropped."""
    core = base_title(name or "")
    words = re.findall(r"[a-z0-9]+", core)
    return [w for w in words if w not in _STOPWORDS]


def score(rom_name: str, igdb_name: str) -> float:
    """Similarity in [0, 1] between a ROM title and an IGDB title — article- and
    word-order-insensitive. A token Jaccard (handles reordering) blended with a
    character sequence ratio (handles small spelling/typo drift)."""
    a, b = _tokens(rom_name), _tokens(igdb_name)
    if not a or not b:
        return 0.0
    sa, sb = set(a), set(b)
    jaccard = len(sa & sb) / len(sa | sb)
    seq = SequenceMatcher(None, "".join(a), "".join(b)).ratio()
    return round(0.6 * jaccard + 0.4 * seq, 4)


def best_match(rom_name: str, candidates: list[dict], threshold: float = 0.6):
    """Pick the highest-scoring candidate at/above `threshold`. Returns
    (candidate, score); (None, best_score) when nothing qualifies — a definite
    'IGDB has nothing good for this ROM', which the caller caches as unmatched."""
    ranked = sorted(
        ((c, score(rom_name, c.get("name", ""))) for c in candidates),
        key=lambda cs: cs[1],
        reverse=True,
    )
    if ranked and ranked[0][1] >= threshold:
        return ranked[0]
    return (None, ranked[0][1] if ranked else 0.0)


def year_of(candidate: dict | None) -> int | None:
    """The release year from an IGDB candidate's `first_release_date` (a unix
    timestamp), or None. Cheap — used both by flatten() and by the matcher's
    lightweight candidate shortlist (no need to flatten a whole candidate for it)."""
    rel = (candidate or {}).get("first_release_date")
    if not rel:
        return None
    try:
        return time.gmtime(rel).tm_year
    except (ValueError, OSError, TypeError):
        return None


def flatten(candidate: dict | None) -> dict:
    """Flatten a chosen IGDB game dict into our stored fields (pure). Missing
    pieces come back as None / []."""
    if not candidate:
        return {}
    companies = candidate.get("involved_companies") or []

    def _company(role):
        for c in companies:
            if c.get(role) and c.get("company", {}).get("name"):
                return c["company"]["name"]
        return None

    year = year_of(candidate)
    rating = candidate.get("total_rating") or candidate.get("rating")
    return {
        "igdb_id": candidate.get("id"),
        "name": candidate.get("name"),
        "summary": candidate.get("summary"),
        "release_year": year,
        "rating": round(rating) if rating else None,
        "developer": _company("developer"),
        "publisher": _company("publisher"),
        "genres": [g["name"] for g in (candidate.get("genres") or []) if g.get("name")],
        "cover_image_id": (candidate.get("cover") or {}).get("image_id"),
        "screenshot_ids": [
            s["image_id"] for s in (candidate.get("screenshots") or []) if s.get("image_id")
        ],
        "videos": [
            {"id": v["video_id"], "name": v.get("name")}
            for v in (candidate.get("videos") or [])
            if v.get("video_id")
        ],
    }


def image_url(image_id: str, size: str = "t_screenshot_big") -> str:
    """Full IGDB image URL for an `image_id` at a size template
    (t_cover_big ≈ 264×374, t_screenshot_big ≈ 889×500, t_1080p, t_thumb)."""
    return f"https://images.igdb.com/igdb/image/upload/{size}/{image_id}.jpg"


# --- networked helpers ----------------------------------------------------

# In-process token cache. One app access token serves every request until it
# nears expiry (Twitch app tokens last ~60 days), so we rarely re-mint.
_token_cache: dict = {"value": None, "expires_at": 0.0}


def reset_token_cache() -> None:
    """Drop the cached token (used by tests; also forces a re-mint)."""
    _token_cache["value"] = None
    _token_cache["expires_at"] = 0.0


def _get_token(settings, now: float | None = None):
    """A valid app access token — cached, re-minted when missing or within 60s of
    expiry. None when unconfigured or the mint fails (a later pass retries)."""
    now = time.time() if now is None else now
    if not configured(settings):
        return None
    if _token_cache["value"] and now < _token_cache["expires_at"] - 60:
        return _token_cache["value"]
    try:
        resp = requests.post(
            _TOKEN_URL,
            params={
                "client_id": settings.igdb_client_id,
                "client_secret": settings.igdb_client_secret,
                "grant_type": "client_credentials",
            },
            timeout=_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
    except (requests.RequestException, ValueError) as exc:
        log.warning("igdb: token mint failed: %s", exc)
        return None
    token = data.get("access_token")
    if not token:
        return None
    _token_cache["value"] = token
    _token_cache["expires_at"] = now + float(data.get("expires_in", 3600))
    return token


def _post_games(token: str, settings, body: str):
    """POST an APICalypse body to /games → the parsed list, or None on any
    network/HTTP/JSON error (transient — the caller retries next pass)."""
    try:
        resp = requests.post(
            _GAMES_URL,
            headers={
                "Client-ID": settings.igdb_client_id,
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
            },
            data=body,
            timeout=_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
    except (requests.RequestException, ValueError) as exc:
        log.warning("igdb: query failed: %s", exc)
        return None
    return data if isinstance(data, list) else None


def fetch_by_id(igdb_id: int, settings) -> dict | None:
    """The full IGDB game dict for a specific id — used by a manual re-match, where
    the user picked a candidate and we need its full data (summary/screenshots/…),
    not just the shortlist's id+name. None on unconfigured / unreachable / not found.
    `igdb_id` is coerced to int, so it can't inject into the query."""
    if not configured(settings):
        return None
    token = _get_token(settings)
    if not token:
        return None
    body = f"fields {_FIELDS}; where id = {int(igdb_id)};"
    data = _post_games(token, settings, body)
    if not data:
        return None
    return data[0]


def lookup(name: str, label: str | None, settings) -> dict | None:
    """Look up one game by ROM display-name + system label. Returns:
        {matched, igdb, score, candidates}
    where `matched` is bool, `igdb` is the chosen candidate (or None), and
    `candidates` is the raw shortlist (kept for the later re-match picker).

    Returns None — meaning 'transient, don't cache, try again' — when IGDB is
    unconfigured or unreachable. A returned dict with matched=False is a definite
    'nothing good', which the caller caches so it isn't re-queried forever."""
    if not configured(settings):
        return None
    token = _get_token(settings)
    if not token:
        return None
    platform_id = PLATFORM_IDS.get(label or "")
    data = _post_games(token, settings, query_body(name, platform_id))
    if data is None:
        return None
    chosen, sc = best_match(name, data)
    return {"matched": chosen is not None, "igdb": chosen, "score": sc, "candidates": data[:8]}
