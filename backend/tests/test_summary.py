from app.routers import summary as S


def test_system_ok_and_warn():
    ok = S.summarize_system({"cpu": {"percent": 10}, "memory": {"percent": 40}})
    assert ok["status"] == "ok" and "RAM 40%" in ok["detail"]
    warn = S.summarize_system({"cpu": {"percent": 5}, "memory": {"percent": 95}})
    assert warn["status"] == "warn"


def test_storage_thresholds_and_raid():
    assert S.summarize_storage({"available": True, "percent": 50}, None)["status"] == "ok"
    assert S.summarize_storage({"available": True, "percent": 88}, None)["status"] == "warn"
    assert S.summarize_storage({"available": True, "percent": 97}, None)["status"] == "down"
    # A degraded array forces down regardless of capacity.
    degraded = S.summarize_storage(
        {"available": True, "percent": 50}, {"arrays": [{"healthy": False}]}
    )
    assert degraded["status"] == "down" and "degraded" in degraded["detail"]
    healthy = S.summarize_storage(
        {"available": True, "percent": 50}, {"arrays": [{"healthy": True}]}
    )
    assert healthy["status"] == "ok" and "RAID ok" in healthy["detail"]


def test_storage_unavailable():
    assert S.summarize_storage({"available": False}, None)["status"] == "unknown"


def test_drives_ok_warn_fail():
    drives = {
        "available": True,
        "drives": [
            {"role": "system", "passed": True, "warnings": []},
            {"role": "raid", "passed": True, "warnings": []},
        ],
    }
    assert S.summarize_drives(drives)["status"] == "ok"
    drives["drives"][1]["warnings"] = ["3 reallocated sectors"]
    assert S.summarize_drives(drives)["status"] == "warn"
    drives["drives"][1]["passed"] = False
    assert S.summarize_drives(drives)["status"] == "down"


def test_drives_ignores_external_and_handles_no_data():
    # 'other' (external) drives don't count toward health.
    only_external = {"available": True, "drives": [{"role": "other", "warnings": ["x"]}]}
    assert S.summarize_drives(only_external)["status"] == "ok"
    assert S.summarize_drives({"available": False})["status"] == "unknown"


def test_plex_states():
    assert S.summarize_plex({"configured": False})["status"] == "unknown"
    assert S.summarize_plex({"configured": True, "reachable": False})["status"] == "down"
    one = S.summarize_plex({"configured": True, "reachable": True, "streams": 1})
    assert one["status"] == "ok" and one["detail"] == "1 stream"
    two = S.summarize_plex({"configured": True, "reachable": True, "streams": 2})
    assert two["detail"] == "2 streams"


def test_containers_up_and_partial():
    full = {
        "available": True,
        "containers": [{"status": "running"}, {"status": "running"}],
    }
    assert S.summarize_containers(full) == {"status": "ok", "detail": "2 up"}
    partial = {
        "available": True,
        "containers": [{"status": "running"}, {"status": "exited"}],
    }
    assert S.summarize_containers(partial)["status"] == "warn"
    assert S.summarize_containers(partial)["detail"] == "1/2 up"
