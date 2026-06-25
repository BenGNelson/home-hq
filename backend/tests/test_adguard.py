"""Tests for the AdGuard (ad-blocking) shaping + config gating — the pure logic
only. The live HTTP call isn't exercised here (get_adguard's network path is only
reached when configured); these cover shape(), the helpers, and degradation."""

from app import adguard
from app.config import settings


def _stats(**kw):
    base = dict(
        num_dns_queries=1000,
        num_blocked_filtering=150,
        num_replaced_safebrowsing=10,
        num_replaced_safesearch=0,
        num_replaced_parental=5,
        top_blocked_domains=[
            {"ads.example.com": 42},
            {"track.example.net": 17},
        ],
    )
    base.update(kw)
    return base


def test_blocked_count_sums_all_block_categories():
    # 150 filtering + 10 safebrowsing + 0 safesearch + 5 parental = 165
    assert adguard._blocked_count(_stats()) == 165


def test_blocked_count_tolerates_missing_keys():
    assert adguard._blocked_count({"num_blocked_filtering": 3}) == 3
    assert adguard._blocked_count({}) == 0


def test_top_domains_flattens_and_caps():
    out = adguard._top_domains(_stats())
    assert out == [
        {"domain": "ads.example.com", "count": 42},
        {"domain": "track.example.net", "count": 17},
    ]
    # Cap at _TOP_N.
    many = _stats(top_blocked_domains=[{f"d{i}.com": i} for i in range(50)])
    assert len(adguard._top_domains(many)) == adguard._TOP_N


def test_top_domains_sorts_descending_before_capping():
    # Unsorted upstream must come back highest-count-first, and the cap keeps the
    # true top N (not just the first N in array order).
    unsorted = {"top_blocked_domains": [{"a.com": 5}, {"b.com": 99}, {"c.com": 40}]}
    out = adguard._top_domains(unsorted)
    assert [r["domain"] for r in out] == ["b.com", "c.com", "a.com"]


def test_top_domains_skips_malformed_entries():
    out = adguard._top_domains({"top_blocked_domains": [{}, "nope", {"good.com": 1}]})
    assert out == [{"domain": "good.com", "count": 1}]


def test_top_domains_missing_key_is_empty():
    assert adguard._top_domains({}) == []


def test_shape_computes_percent_and_flags():
    out = adguard.shape(_stats(), {"protection_enabled": True})
    assert out["available"] is True
    assert out["protection_enabled"] is True
    assert out["total_queries"] == 1000
    assert out["blocked_queries"] == 165
    assert out["blocked_percent"] == 16.5  # 165 / 1000
    assert out["top_blocked_domains"][0]["domain"] == "ads.example.com"


def test_shape_guards_divide_by_zero_on_fresh_resolver():
    # A just-started resolver with no queries must not crash on percent.
    out = adguard.shape({"num_dns_queries": 0}, {"protection_enabled": False})
    assert out["blocked_percent"] == 0.0
    assert out["total_queries"] == 0
    assert out["protection_enabled"] is False


def test_is_configured_needs_host():
    saved = settings.adguard_host
    try:
        settings.adguard_host = ""
        assert adguard.is_configured() is False
        settings.adguard_host = "http://adguard.local:3000"
        assert adguard.is_configured() is True
    finally:
        settings.adguard_host = saved


def test_get_adguard_reports_not_configured_when_unset():
    saved = settings.adguard_host
    try:
        settings.adguard_host = ""
        assert adguard.get_adguard() == {"available": False, "reason": "not_configured"}
    finally:
        settings.adguard_host = saved
