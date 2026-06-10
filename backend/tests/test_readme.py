from app.config import settings


def test_readme_served_when_present(client, monkeypatch, tmp_path):
    f = tmp_path / "README.md"
    f.write_text("# Hello\n\nSome docs.")
    monkeypatch.setattr(settings, "readme_path", str(f))
    body = client.get("/api/readme").json()
    assert body["available"] is True
    assert body["markdown"].startswith("# Hello")


def test_readme_degrades_when_missing(client, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "readme_path", str(tmp_path / "nope.md"))
    body = client.get("/api/readme").json()
    assert body == {"available": False, "markdown": ""}


def test_asset_served_from_dir(client, monkeypatch, tmp_path):
    (tmp_path / "shot.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    monkeypatch.setattr(settings, "readme_assets_dir", str(tmp_path))
    r = client.get("/api/readme/asset/shot.png")
    assert r.status_code == 200
    assert r.content.startswith(b"\x89PNG")


def test_missing_asset_is_404(client, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "readme_assets_dir", str(tmp_path))
    assert client.get("/api/readme/asset/nope.png").status_code == 404


def test_asset_path_traversal_rejected(client, monkeypatch, tmp_path):
    # A secret sitting one level above the assets dir must never be reachable.
    (tmp_path / "secret.txt").write_text("private")
    assets = tmp_path / "img"
    assets.mkdir()
    monkeypatch.setattr(settings, "readme_assets_dir", str(assets))
    # Encoded traversal resolves to a name with slashes → not our bare-name route,
    # and the explicit basename check rejects anything that isn't a plain filename.
    assert client.get("/api/readme/asset/%2e%2e%2fsecret.txt").status_code == 404
