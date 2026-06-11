"""
/api/alerts — push-alert status, recent history, and a manual test trigger.

The rule engine (app.alerting) runs in the background and pushes via ntfy on
state changes. This router just surfaces its current status + the log, plus a
test button to confirm the push pipe reaches your phone.
"""

from fastapi import APIRouter, HTTPException

from app import db, notify
from app.alerting import get_manager
from app.config import settings

router = APIRouter()


@router.get("/alerts")
def get_alerts():
    manager = get_manager()
    return {
        "configured": notify.configured(),
        "enabled": settings.alerts_enabled,
        "rules": manager.status() if manager else [],
        "recent": db.recent_alert_log(20),
    }


@router.post("/alerts/test")
def send_test_alert():
    if not notify.configured():
        raise HTTPException(
            status_code=503,
            detail="ntfy not configured — set NTFY_URL and NTFY_TOPIC in .env",
        )
    ok = notify.notify(
        "Test alert from Home HQ. If this reached your phone, push works ✅",
        title="Home HQ",
        priority="default",
        tags=["desktop_computer"],
    )
    if not ok:
        raise HTTPException(status_code=502, detail="ntfy rejected the message")
    return {"ok": True}
