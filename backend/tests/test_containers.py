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


# --- container logs ---------------------------------------------------------

def test_clamp_tail_bounds_and_defaults():
    assert C._clamp_tail(50) == 50
    assert C._clamp_tail(0) == 1  # floor
    assert C._clamp_tail(-5) == 1
    assert C._clamp_tail(10_000) == C._LOGS_TAIL_MAX  # ceiling
    assert C._clamp_tail("not a number") == C._LOGS_TAIL_DEFAULT
    assert C._clamp_tail(None) == C._LOGS_TAIL_DEFAULT


def test_excluded_log_names_parses_and_lowercases(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "container_logs_exclude", "Gluetun, downloader ,")
    assert C._excluded_log_names() == {"gluetun", "downloader"}
    monkeypatch.setattr(settings, "container_logs_exclude", "")
    assert C._excluded_log_names() == set()


def test_decode_log_lines_handles_bytes_and_bad_utf8():
    assert C._decode_log_lines(b"a\nb\n") == ["a", "b"]
    assert C._decode_log_lines(b"ok\n\xff") == ["ok", "�"]  # bad byte -> replacement
    assert C._decode_log_lines("x\ny") == ["x", "y"]


def test_decode_log_lines_strips_ansi_color():
    raw = b"\x1b[31m2026-01-01 ERROR boom\x1b[0m\n\x1b[32mok\x1b[0m\n"
    assert C._decode_log_lines(raw) == ["2026-01-01 ERROR boom", "ok"]


class _FakeContainer:
    name = "homeassistant"

    def logs(self, **kw):
        # Echo the args we care about so the test can assert tail/timestamps.
        assert kw["timestamps"] is True and kw["stream"] is False
        return f"line1\nline2 tail={kw['tail']}\n".encode()


class _FakeClient:
    def __init__(self, container=None, raise_notfound=False):
        self._c = container
        self._notfound = raise_notfound

    def containers_get(self, name):  # pragma: no cover - shim, see get()
        return self.get(name)

    @property
    def containers(self):
        client = self

        class _C:
            def get(self, name):
                import docker

                if client._notfound:
                    raise docker.errors.NotFound("nope")
                return client._c

        return _C()


def test_logs_endpoint_returns_tailed_lines(client, monkeypatch):
    import docker

    monkeypatch.setattr(docker, "from_env", lambda: _FakeClient(container=_FakeContainer()))
    body = client.get("/api/containers/homeassistant/logs?tail=5").json()
    assert body["available"] is True and body["found"] is True
    assert body["name"] == "homeassistant"
    assert body["tail"] == 5
    assert body["lines"] == ["line1", "line2 tail=5"]


def test_logs_endpoint_withholds_excluded_container(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "container_logs_exclude", "gluetun,downloader")
    # Excluded names short-circuit before Docker is even contacted.
    body = client.get("/api/containers/GLUETUN/logs").json()
    assert body["available"] is False and body["excluded"] is True
    assert "disabled" in body["reason"].lower()


def test_logs_endpoint_not_found(client, monkeypatch):
    import docker

    monkeypatch.setattr(docker, "from_env", lambda: _FakeClient(raise_notfound=True))
    body = client.get("/api/containers/ghost/logs").json()
    assert body == {"found": False}
