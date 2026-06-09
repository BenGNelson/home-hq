import json

from app.config import settings
from app.routers.smart import parse_drive

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
