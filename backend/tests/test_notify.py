"""Tests for the ntfy notifier (mocked HTTP — no real network)."""

import urllib.request

from app import notify
from app.config import settings


class _Resp:
    def __init__(self, status):
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_noop_when_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "ntfy_topic", "")
    assert notify.notify("hi") is False


def test_posts_to_topic_with_headers(monkeypatch):
    monkeypatch.setattr(settings, "ntfy_url", "https://ntfy.example")
    monkeypatch.setattr(settings, "ntfy_topic", "my-topic")
    monkeypatch.setattr(settings, "ntfy_token", "")
    monkeypatch.setattr(settings, "alert_click_url", "")

    captured = {}

    def fake_urlopen(req, timeout=None):
        captured["url"] = req.full_url
        captured["data"] = req.data
        captured["method"] = req.get_method()
        captured["headers"] = dict(req.headers)
        return _Resp(200)

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    ok = notify.notify("hello", title="T", priority="high", tags=["bell", "warning"])

    assert ok is True
    assert captured["url"] == "https://ntfy.example/my-topic"
    assert captured["data"] == b"hello"
    assert captured["method"] == "POST"
    assert captured["headers"]["Title"] == "T"
    assert captured["headers"]["Priority"] == "high"
    assert captured["headers"]["Tags"] == "bell,warning"


def test_ignores_unknown_priority(monkeypatch):
    monkeypatch.setattr(settings, "ntfy_url", "https://ntfy.example")
    monkeypatch.setattr(settings, "ntfy_topic", "t")
    monkeypatch.setattr(settings, "ntfy_token", "")
    monkeypatch.setattr(settings, "alert_click_url", "")

    captured = {}

    def fake_urlopen(req, timeout=None):
        captured["headers"] = dict(req.headers)
        return _Resp(200)

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    notify.notify("hi", priority="bogus")
    assert "Priority" not in captured["headers"]


def test_returns_false_on_network_error(monkeypatch):
    monkeypatch.setattr(settings, "ntfy_url", "https://ntfy.example")
    monkeypatch.setattr(settings, "ntfy_topic", "t")

    def boom(req, timeout=None):
        raise OSError("network down")

    monkeypatch.setattr(urllib.request, "urlopen", boom)
    assert notify.notify("hello") is False
