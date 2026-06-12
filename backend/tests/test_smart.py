import json

from app.config import settings
from app.routers.smart import assign_role, parse_attributes, parse_drive, parse_nvme_health

RAID_MEMBERS = {"sdb2", "sdc2", "sdd2"}

# A healthy SATA SSD: smart_status passed, zero reallocated/pending.
SATA_OK = {
    "name": "sda",
    "report": {
        "model_name": "CT240BX500SSD1",
        "user_capacity": {"bytes": 240057409536},
        "smart_status": {"passed": True},
        "temperature": {"current": 31},
        "power_on_time": {"hours": 12000},
        "power_cycle_count": 240,
        "ata_smart_attributes": {
            "table": [
                {"id": 5, "name": "Reallocated_Sector_Ct", "raw": {"value": 0}},
                {"id": 197, "name": "Current_Pending_Sector", "raw": {"value": 0}},
            ]
        },
    },
}

# A SATA drive starting to fail: reallocated + pending sectors present.
SATA_FAILING = {
    "name": "sdb",
    "report": {
        "model_name": "INLAND",
        "smart_status": {"passed": True},
        "ata_smart_attributes": {
            "table": [
                {"id": 5, "raw": {"value": 12}},
                {"id": 197, "raw": {"value": 3}},
            ]
        },
    },
}

# An NVMe drive with high wear.
NVME_WORN = {
    "name": "nvme0",
    "report": {
        "model_name": "Samsung 990",
        "nvme_total_capacity": 4000000000000,
        "smart_status": {"passed": True},
        "nvme_smart_health_information_log": {
            "temperature": 40,
            "percentage_used": 85,
            "media_errors": 0,
            "power_on_hours": 9000,
        },
    },
}

# A drive behind a USB bridge that blocks SMART passthrough.
UNSUPPORTED = {
    "name": "sde",
    "report": {
        "smartctl": {
            "messages": [{"string": "Unable to detect device type"}],
        }
    },
}


def test_healthy_sata():
    d = parse_drive(SATA_OK)
    assert d["supported"] is True
    assert d["passed"] is True
    assert d["model"] == "CT240BX500SSD1"
    assert d["temperature_c"] == 31
    assert d["power_on_hours"] == 12000
    assert d["reallocated"] == 0 and d["pending"] == 0
    assert d["warnings"] == []


def test_failing_sata_raises_warnings():
    d = parse_drive(SATA_FAILING)
    assert d["passed"] is True  # overall still "passed"...
    assert d["reallocated"] == 12 and d["pending"] == 3
    assert any("reallocated" in w for w in d["warnings"])  # ...but we warn anyway
    assert any("pending" in w for w in d["warnings"])


def test_hot_drive_warns():
    hot = {
        "name": "sdx",
        "report": {
            "smart_status": {"passed": True},
            "temperature": {"current": 70},
        },
    }
    d = parse_drive(hot)
    assert d["temperature_c"] == 70
    assert any("running hot" in w for w in d["warnings"])


def test_normal_temp_does_not_warn():
    # 58°C (seen on a real drive under load) must not trip the heat warning.
    warm = {"name": "sdy", "report": {"smart_status": {"passed": True}, "temperature": {"current": 58}}}
    assert parse_drive(warm)["warnings"] == []


def test_nvme_wear_warning():
    d = parse_drive(NVME_WORN)
    assert d["supported"] is True
    assert d["wear_percent"] == 85
    assert d["temperature_c"] == 40
    assert d["capacity_bytes"] == 4000000000000
    assert any("life used" in w for w in d["warnings"])


def test_unsupported_drive_captures_message():
    d = parse_drive(UNSUPPORTED)
    assert d["supported"] is False
    assert "Unable to detect" in d["message"]
    assert d["warnings"] == []


def test_role_raid_member():
    assert assign_role({"name": "sdb", "supported": True}, RAID_MEMBERS) == "raid"


def test_role_system_disk():
    # Internal disk that isn't in the array = the OS/boot disk.
    assert assign_role({"name": "sda", "supported": True}, RAID_MEMBERS) == "system"


def test_role_external_unreadable():
    # The USB-bridged drive can't be read → "other" (hidden in the UI).
    assert assign_role({"name": "sde", "supported": False}, RAID_MEMBERS) == "other"


def test_smart_endpoint_unavailable_when_file_missing(client, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "smart_json_path", str(tmp_path / "nope.json"))
    r = client.get("/api/smart")
    assert r.status_code == 200 and r.json() == {"available": False}


def test_smart_endpoint_reads_file(client, monkeypatch, tmp_path):
    f = tmp_path / "smart.json"
    f.write_text(json.dumps({"generated_at": 123, "drives": [SATA_OK]}))
    monkeypatch.setattr(settings, "smart_json_path", str(f))
    body = client.get("/api/smart").json()
    assert body["available"] is True and body["generated_at"] == 123
    assert body["drives"][0]["name"] == "sda" and body["drives"][0]["passed"] is True


# --- full attribute table (on-demand detail) ---

ATTR_DRIVE = {
    "name": "sda",
    "report": {
        "model_name": "CT240BX500SSD1",
        "ata_smart_attributes": {
            "table": [
                {
                    "id": 5,
                    "name": "Reallocated_Sector_Ct",
                    "value": 100,
                    "worst": 100,
                    "thresh": 10,
                    "when_failed": "",
                    "flags": {"prefailure": True},
                    "raw": {"value": 0, "string": "0"},
                },
                {
                    "id": 194,
                    "name": "Temperature_Celsius",
                    "value": 69,
                    "worst": 50,
                    "thresh": 0,
                    "when_failed": "",
                    "flags": {"prefailure": False},
                    "raw": {"value": 31, "string": "31"},
                },
            ]
        },
    },
}


def test_parse_attributes_maps_full_table():
    rows = parse_attributes(ATTR_DRIVE["report"])
    assert len(rows) == 2
    realloc = rows[0]
    assert realloc["id"] == 5 and realloc["name"] == "Reallocated_Sector_Ct"
    assert realloc["value"] == 100 and realloc["thresh"] == 10 and realloc["raw"] == "0"
    assert realloc["when_failed"] is None  # "" normalized to None
    assert realloc["prefailure"] is True


def test_parse_nvme_health_extracts_known_fields():
    health = parse_nvme_health(NVME_WORN["report"])
    assert health["percentage_used"] == 85 and health["power_on_hours"] == 9000
    assert parse_nvme_health(ATTR_DRIVE["report"]) is None  # ATA drive → no nvme log


def test_attributes_endpoint_returns_table(client, monkeypatch, tmp_path):
    f = tmp_path / "smart.json"
    f.write_text(json.dumps({"drives": [ATTR_DRIVE]}))
    monkeypatch.setattr(settings, "smart_json_path", str(f))
    body = client.get("/api/smart/sda/attributes").json()
    assert body["available"] is True and body["name"] == "sda"
    assert [a["id"] for a in body["attributes"]] == [5, 194]


def test_attributes_endpoint_unknown_drive(client, monkeypatch, tmp_path):
    f = tmp_path / "smart.json"
    f.write_text(json.dumps({"drives": [ATTR_DRIVE]}))
    monkeypatch.setattr(settings, "smart_json_path", str(f))
    assert client.get("/api/smart/sdz/attributes").json() == {"available": False}
