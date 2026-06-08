import time

from app.config import settings
from app.routers import backups as B


def test_not_configured(monkeypatch):
    monkeypatch.setattr(settings, "age_recipient", "")
    monkeypatch.setattr(settings, "backup_dir", "")
    r = B.list_backups()
    assert r["configured"] is False
    assert r["available"] is False


def test_lists_only_age_files_newest_first(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "age_recipient", "age1example")
    monkeypatch.setattr(settings, "backup_dir", str(tmp_path))
    (tmp_path / "old.tar.gz.age").write_text("x")
    time.sleep(0.02)
    (tmp_path / "new.tar.gz.age").write_text("y")
    (tmp_path / "notes.txt").write_text("ignore me")

    r = B.list_backups()
    assert r["available"] and r["configured"]
    assert r["count"] == 2
    names = [b["name"] for b in r["backups"]]
    assert "notes.txt" not in names
    assert r["backups"][0]["modified"] >= r["backups"][1]["modified"]  # newest first
    assert r["last_backup"] == r["backups"][0]["modified"]


def test_dir_missing(monkeypatch):
    monkeypatch.setattr(settings, "age_recipient", "age1example")
    monkeypatch.setattr(settings, "backup_dir", "/no/such/dir")
    r = B.list_backups()
    assert r["available"] is False
    assert r["dir_present"] is False
