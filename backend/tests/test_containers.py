from datetime import datetime, timedelta, timezone

from app.routers import containers as C


def test_uptime_none_for_unstarted():
    assert C._uptime_seconds("") is None
    assert C._uptime_seconds("0001-01-01T00:00:00Z") is None


def test_uptime_parses_nanosecond_timestamp():
    started = datetime.now(timezone.utc) - timedelta(seconds=120)
    iso = started.strftime("%Y-%m-%dT%H:%M:%S.123456789Z")
    up = C._uptime_seconds(iso)
    assert up is not None and 110 <= up <= 130


def test_cpu_percent_matches_docker_formula():
    stats = {
        "cpu_stats": {
            "cpu_usage": {"total_usage": 200},
            "system_cpu_usage": 2000,
            "online_cpus": 2,
        },
        "precpu_stats": {
            "cpu_usage": {"total_usage": 100},
            "system_cpu_usage": 1000,
        },
    }
    # (100/1000) * 2 * 100 = 20.0
    assert C._cpu_percent(stats) == 20.0


def test_cpu_percent_handles_zero_and_missing():
    assert C._cpu_percent({}) is None
    idle = {
        "cpu_stats": {"cpu_usage": {"total_usage": 100}, "system_cpu_usage": 1000, "online_cpus": 1},
        "precpu_stats": {"cpu_usage": {"total_usage": 100}, "system_cpu_usage": 1000},
    }
    assert C._cpu_percent(idle) == 0.0


def test_mem_usage_subtracts_inactive_file():
    stats = {"memory_stats": {"usage": 100, "limit": 1000, "stats": {"inactive_file": 20}}}
    assert C._mem_usage(stats) == (80, 1000, 8.0)
    assert C._mem_usage({}) == (None, None, None)


def test_ports_never_leak_host_ip():
    attrs = {
        "NetworkSettings": {
            "Ports": {
                "8080/tcp": [{"HostIp": "0.0.0.0", "HostPort": "8080"}],
                "9000/tcp": None,
            }
        }
    }
    out = C._ports(attrs)
    assert "8080/tcp -> 8080" in out
    assert "9000/tcp (exposed)" in out
    assert all("0.0.0.0" not in p for p in out)


def test_containers_endpoint_degrades_when_docker_down(client, monkeypatch):
    import docker

    def boom():
        raise docker.errors.DockerException("no docker")

    monkeypatch.setattr(docker, "from_env", boom)
    body = client.get("/api/containers").json()
    assert body["available"] is False
    assert body["containers"] == []
