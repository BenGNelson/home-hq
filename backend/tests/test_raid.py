from app.routers.raid import parse_mdstat

HEALTHY = """Personalities : [raid6] [raid5] [raid4] [raid0] [raid1] [raid10]
md0 : active raid5 sdb2[0] sdc2[1] sdd2[3]
      8001273856 blocks super 1.2 level 5, 512k chunk, algorithm 2 [3/3] [UUU]
      bitmap: 0/30 pages [0KB], 65536KB chunk

unused devices: <none>
"""

DEGRADED = """Personalities : [raid5]
md0 : active raid5 sdb2[0] sdc2[1](F) sdd2[3]
      8001273856 blocks super 1.2 level 5, 512k chunk, algorithm 2 [3/2] [U_U]

unused devices: <none>
"""

REBUILDING = """Personalities : [raid5]
md0 : active raid5 sde2[4] sdb2[0] sdd2[3]
      8001273856 blocks super 1.2 level 5, 512k chunk, algorithm 2 [3/2] [U_U]
      [===>.................]  recovery = 18.4% (491520000/2667091285) finish=120.1min speed=100000K/sec

unused devices: <none>
"""

NONE = "Personalities : [raid6] [raid5]\nunused devices: <none>\n"


def test_healthy_array():
    arrays = parse_mdstat(HEALTHY)
    assert len(arrays) == 1
    a = arrays[0]
    assert a["name"] == "md0"
    assert a["level"] == "raid5"
    assert a["state"] == "active"
    assert a["members"] == ["sdb2", "sdc2", "sdd2"]
    assert a["failed"] == []
    assert a["devices_total"] == 3 and a["devices_active"] == 3
    assert a["status"] == "UUU"
    assert a["healthy"] is True
    assert a["resync"] is None


def test_degraded_array_flags_failed_member():
    a = parse_mdstat(DEGRADED)[0]
    assert a["healthy"] is False
    assert a["status"] == "U_U"
    assert a["devices_active"] == 2 and a["devices_total"] == 3
    assert a["failed"] == ["sdc2"]


def test_rebuilding_reports_recovery_progress():
    a = parse_mdstat(REBUILDING)[0]
    assert a["healthy"] is False  # still degraded while rebuilding
    assert a["resync"] is not None
    assert a["resync"]["action"] == "recovery"
    assert a["resync"]["percent"] == 18.4


def test_no_arrays():
    assert parse_mdstat(NONE) == []
