"""
Push notifications via ntfy (https://ntfy.sh or a self-hosted server).

We POST a message to {NTFY_URL}/{NTFY_TOPIC}; ntfy hands it to the phone's OS
push channel (APNs/FCM), so it arrives over the phone's normal internet — no
tailnet needed. The topic name acts as a shared secret, so use an unguessable
one. All config is in .env; if the topic is unset, notify() is a no-op.

Stdlib only (urllib) — no extra dependency for one small POST.
"""

from __future__ import annotations

import logging
import urllib.error
import urllib.request

from app.config import settings

log = logging.getLogger("home-hq.notify")

# ntfy priority: 1=min … 3=default … 5=urgent. We map friendly names.
_PRIORITIES = {"min", "low", "default", "high", "urgent"}


def configured() -> bool:
    return bool(settings.ntfy_url and settings.ntfy_topic)


def notify(
    message: str,
    title: str | None = None,
    priority: str = "default",
    tags: list[str] | None = None,
    click: str | None = None,
) -> bool:
    """Send one push via ntfy. Returns True on success, False otherwise.

    Never raises — alerting must not take down the caller (a background loop).
    Title/Priority/Tags ride as HTTP headers (ASCII); the body is UTF-8.
    """
    if not configured():
        log.info("notify: ntfy not configured (set NTFY_TOPIC) — skipping")
        return False

    url = f"{settings.ntfy_url.rstrip('/')}/{settings.ntfy_topic}"
    headers: dict[str, str] = {}
    if title:
        headers["Title"] = title
    if priority in _PRIORITIES:
        headers["Priority"] = priority
    if tags:
        headers["Tags"] = ",".join(tags)
    click = click or settings.alert_click_url
    if click:
        headers["Click"] = click
    if settings.ntfy_token:
        headers["Authorization"] = f"Bearer {settings.ntfy_token}"

    req = urllib.request.Request(
        url, data=message.encode("utf-8"), headers=headers, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return 200 <= resp.status < 300
    except (urllib.error.URLError, OSError) as exc:
        log.warning("notify: ntfy post failed: %s", exc)
        return False
