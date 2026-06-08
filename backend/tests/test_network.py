from app.routers import network as N

# A realistic /proc/net/dev: 2 header lines, then "iface: rx ... tx ...".
SAMPLE = """Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
  eth0: 1000 5 0 0 0 0 0 0 2000 6 0 0 0 0 0 0
    lo: 50 1 0 0 0 0 0 0 50 1 0 0 0 0 0 0
 veth9: 9 1 0 0 0 0 0 0 9 1 0 0 0 0 0 0
tailscale0: 300 3 0 0 0 0 0 0 400 4 0 0 0 0 0 0
"""


def test_read_net_dev_parses_and_skips_virtual(tmp_path):
    p = tmp_path / "net_dev"
    p.write_text(SAMPLE)
    by_name = {i["name"]: i for i in N._read_net_dev(str(p))}

    assert set(by_name) == {"eth0", "tailscale0"}  # lo + veth skipped
    assert by_name["eth0"]["rx_bytes"] == 1000
    assert by_name["eth0"]["tx_bytes"] == 2000
    assert by_name["tailscale0"]["tx_bytes"] == 400


def test_get_network_degrades_when_proc_missing(monkeypatch):
    monkeypatch.setattr(N, "HOST_NET_DEV", "/no/such/proc/net/dev")
    res = N.get_network()
    assert res["available"] is False
    assert res["interfaces"] == []
