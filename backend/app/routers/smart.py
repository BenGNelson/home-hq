"""
/api/smart — per-drive SMART health, read from a JSON file a host timer writes.

SMART needs root + raw device access, which the (deliberately unprivileged)
backend container doesn't have. So a host-side systemd timer runs
`scripts/smart-health.py` as root, dumps each disk's `smartctl -j` output to
`smart.json`, and we just read + summarize that here. Same split as the config
backup: privileged work on the host, the app only reads the result.

The file may not exist yet (timer hasn't run) — we degrade to available:false.
"""

import json

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.config import settings
from app.routers import raid

router = APIRouter()


# Both endpoints degrade to {available:false}; all the data fields are Optional
# and dropped by response_model_exclude_none, so the shapes are unchanged.
class SmartDriveModel(BaseModel):
    name: str | None = None
    supported: bool = Field(description="False when SMART can't be read (e.g. a USB bridge)")
    model: str | None = None
    passed: bool | None = Field(default=None, description="SMART overall self-assessment")
    temperature_c: int | None = None
    power_on_hours: int | None = None
    power_cycles: int | None = None
    capacity_bytes: int | None = None
    reallocated: int | None = None
    pending: int | None = None
    wear_percent: int | None = Field(default=None, description="NVMe life used %")
    media_errors: int | None = None
    message: str | None = Field(default=None, description="Why SMART was unreadable, if so")
    warnings: list[str] = []
    role: str | None = Field(default=None, description="raid | system | other")


class SmartModel(BaseModel):
    available: bool = Field(description="False when no SMART state file exists yet")
    generated_at: int | None = Field(default=None, description="When the host timer wrote the file")
    drives: list[SmartDriveModel] | None = None


class SmartAttrRowModel(BaseModel):
    id: int | None = None
    name: str | None = None
    value: int | None = None
    worst: int | None = None
    thresh: int | None = None
    raw: str | None = Field(default=None, description="Vendor raw value string")
    when_failed: str | None = None
    prefailure: bool | None = None


class NvmeHealthModel(BaseModel):
    temperature: int | None = None
    available_spare: int | None = None
    available_spare_threshold: int | None = None
    percentage_used: int | None = None
    data_units_read: int | None = None
    data_units_written: int | None = None
    power_cycles: int | None = None
    power_on_hours: int | None = None
    unsafe_shutdowns: int | None = None
    media_errors: int | None = None
    num_err_log_entries: int | None = None


class SmartAttributesModel(BaseModel):
    available: bool
    name: str | None = None
    model: str | None = None
    attributes: list[SmartAttrRowModel] | None = None
    nvme: NvmeHealthModel | None = Field(default=None, description="NVMe health log (ATA drives → null)")


def _raid_member_disks():
    """Base disk names that belong to a software-RAID array (e.g. {'sdb','sdc'}).

    mdstat lists members as partitions (sdb2); a disk is a member if any of its
    partitions appears, which we detect by prefix.
    """
    text = raid._read_mdstat()
    if not text:
        return set()
    members = set()
    for array in raid.parse_mdstat(text):
        members.update(array.get("members") or [])
    return members


def assign_role(drive, raid_members):
    """Classify a drive so the UI can label/filter it:
    'raid'   — a member of the storage array,
    'other'  — external/unreadable (e.g. a USB-bridged disk); hidden in the UI,
    'system' — an internal disk that isn't in the array (the OS/boot disk).
    """
    name = drive.get("name") or ""
    if name and any(member.startswith(name) for member in raid_members):
        return "raid"
    if not drive.get("supported"):
        return "other"
    return "system"


def _attr(table, attr_id):
    """Raw value of an ATA SMART attribute by id, or None."""
    for attr in table:
        if attr.get("id") == attr_id:
            return (attr.get("raw") or {}).get("value")
    return None


def parse_drive(entry):
    """Summarize one drive's raw `smartctl -j` report into display fields."""
    name = entry.get("name")
    report = entry.get("report") or {}
    out = {
        "name": name,
        "supported": False,
        "model": report.get("model_name"),
        "passed": None,
        "temperature_c": None,
        "power_on_hours": None,
        "power_cycles": None,
        "capacity_bytes": None,
        "reallocated": None,
        "pending": None,
        "wear_percent": None,
        "media_errors": None,
        "message": None,
        "warnings": [],
    }

    status = report.get("smart_status")
    if not status or "passed" not in status:
        # Couldn't read SMART (e.g. a USB enclosure that blocks passthrough).
        meta = report.get("smartctl") or {}
        msgs = [m.get("string", "") for m in (meta.get("messages") or [])]
        out["message"] = "; ".join(filter(None, msgs)) or "SMART data unavailable"
        return out

    out["supported"] = True
    out["passed"] = status.get("passed")
    out["temperature_c"] = (report.get("temperature") or {}).get("current")
    out["power_on_hours"] = (report.get("power_on_time") or {}).get("hours")
    out["power_cycles"] = report.get("power_cycle_count")
    out["capacity_bytes"] = (report.get("user_capacity") or {}).get(
        "bytes"
    ) or report.get("nvme_total_capacity")

    table = (report.get("ata_smart_attributes") or {}).get("table") or []
    out["reallocated"] = _attr(table, 5)  # Reallocated_Sector_Ct
    out["pending"] = _attr(table, 197)  # Current_Pending_Sector

    nvme = report.get("nvme_smart_health_information_log")
    if nvme:
        out["wear_percent"] = nvme.get("percentage_used")
        out["media_errors"] = nvme.get("media_errors")
        if out["temperature_c"] is None:
            out["temperature_c"] = nvme.get("temperature")
        if out["power_on_hours"] is None:
            out["power_on_hours"] = nvme.get("power_on_hours")

    # Surface early-warning conditions even when the overall verdict is "passed".
    if out["passed"] is False:
        out["warnings"].append("SMART overall self-assessment FAILED")
    if out["reallocated"]:
        out["warnings"].append(f"{out['reallocated']} reallocated sectors")
    if out["pending"]:
        out["warnings"].append(f"{out['pending']} pending sectors")
    if out["media_errors"]:
        out["warnings"].append(f"{out['media_errors']} media errors")
    if out["wear_percent"] is not None and out["wear_percent"] >= 80:
        out["warnings"].append(f"{out['wear_percent']}% life used")
    if out["temperature_c"] is not None and out["temperature_c"] >= 65:
        out["warnings"].append(f"running hot ({out['temperature_c']}°C)")

    return out


def parse_attributes(report):
    """Full ATA SMART attribute table → display rows (the on-demand detail view).

    Each entry keeps the normalized value/worst/threshold plus the vendor raw
    string and any failure marker, so the UI can show the complete table.
    """
    table = (report.get("ata_smart_attributes") or {}).get("table") or []
    rows = []
    for a in table:
        raw = a.get("raw") or {}
        rows.append(
            {
                "id": a.get("id"),
                "name": a.get("name"),
                "value": a.get("value"),
                "worst": a.get("worst"),
                "thresh": a.get("thresh"),
                "raw": raw.get("string"),
                "when_failed": a.get("when_failed") or None,
                "prefailure": (a.get("flags") or {}).get("prefailure"),
            }
        )
    return rows


# NVMe drives have no ATA attribute table — they report a health log instead.
_NVME_FIELDS = (
    "temperature",
    "available_spare",
    "available_spare_threshold",
    "percentage_used",
    "data_units_read",
    "data_units_written",
    "power_cycles",
    "power_on_hours",
    "unsafe_shutdowns",
    "media_errors",
    "num_err_log_entries",
)


def parse_nvme_health(report):
    log = report.get("nvme_smart_health_information_log")
    if not log:
        return None
    return {k: log.get(k) for k in _NVME_FIELDS if log.get(k) is not None}


@router.get("/smart/{name}/attributes", response_model=SmartAttributesModel,
            response_model_exclude_none=True)
def get_smart_attributes(name: str):
    """The full SMART attribute table for one drive, fetched on demand when its
    row is expanded (kept out of the polled /smart list to keep that lean)."""
    try:
        with open(settings.smart_json_path) as fh:
            data = json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {"available": False}
    for raw in data.get("drives", []):
        if raw.get("name") == name:
            report = raw.get("report") or {}
            return {
                "available": True,
                "name": name,
                "model": report.get("model_name"),
                "attributes": parse_attributes(report),
                "nvme": parse_nvme_health(report),
            }
    return {"available": False}


@router.get("/smart", response_model=SmartModel, response_model_exclude_none=True)
def get_smart():
    try:
        with open(settings.smart_json_path) as fh:
            data = json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {"available": False}

    raid_members = _raid_member_disks()
    drives = []
    for raw in data.get("drives", []):
        parsed = parse_drive(raw)
        parsed["role"] = assign_role(parsed, raid_members)
        drives.append(parsed)
    return {
        "available": True,
        "generated_at": data.get("generated_at"),
        "drives": drives,
    }
