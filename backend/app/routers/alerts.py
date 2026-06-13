"""
/api/alerts — push-alert status, recent history, and a manual test trigger.

The rule engine (app.alerting) runs in the background and pushes via ntfy on
state changes. This router just surfaces its current status + the log, plus a
test button to confirm the push pipe reaches your phone.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app import db, notify
from app.alerting import RULE_IDS, get_manager
from app.config import settings

router = APIRouter()


class AlertsModel(BaseModel):
    configured: bool = Field(description="True when ntfy is set up (push can be sent)")
    enabled: bool = Field(description="Whether the rule engine is running")
    # Rule statuses and recent log entries — passed through as dicts so no field
    # is filtered as the rule set / log schema evolves.
    rules: list[dict]
    recent: list[dict]


class MuteRequest(BaseModel):
    muted: bool = Field(description="True to silence the rule's pushes, false to resume")


class MuteResult(BaseModel):
    rule_id: str
    muted: bool


@router.get("/alerts", response_model=AlertsModel)
def get_alerts():
    manager = get_manager()
    rules = manager.status() if manager else []
    # Annotate each rule with its current mute state at request time (not the last
    # evaluation snapshot), so a just-toggled mute shows immediately.
    muted = db.muted_rule_ids()
    for r in rules:
        r["muted"] = r["id"] in muted
    return {
        "configured": notify.configured(),
        "enabled": settings.alerts_enabled,
        "rules": rules,
        "recent": db.recent_alert_log(20),
    }


@router.post("/alerts/{rule_id}/mute", response_model=MuteResult)
def set_alert_mute(rule_id: str, req: MuteRequest):
    """Mute or unmute one rule. A muted rule is still evaluated and shown, but
    sends no push — for silencing a known-noisy condition without stopping the
    whole engine. Persisted in SQLite, so it survives restarts."""
    if rule_id not in RULE_IDS:
        raise HTTPException(status_code=404, detail=f"Unknown alert rule: {rule_id}")
    db.set_rule_muted(rule_id, req.muted)
    return {"rule_id": rule_id, "muted": req.muted}


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
