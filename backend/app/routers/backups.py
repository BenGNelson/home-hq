"""
/api/backups — list the age-encrypted config backups (read-only).

The backups are CREATED by a host script + systemd timer (see scripts/), NOT by
this app. The container only sees BACKUP_DIR (which sits under the read-only RAID
mount) and lists what's there. There is deliberately no download or decrypt
endpoint: retrieval happens off-box via SSH/rsync, and only the private key
(never on this server) can decrypt — so the app's exposure is just a file listing.
"""

import os

from fastapi import APIRouter

from app.config import settings

router = APIRouter()


@router.get("/backups")
def list_backups():
    configured = bool(settings.age_recipient)
    d = settings.backup_dir

    if not d or not os.path.isdir(d):
        return {
            "available": False,
            "configured": configured,
            "dir_present": False,
            "retention": settings.backup_retention,
            "backups": [],
        }

    items = []
    try:
        for name in os.listdir(d):
            if not name.endswith(".age"):
                continue
            try:
                st = os.stat(os.path.join(d, name))
            except OSError:
                continue
            items.append(
                {"name": name, "size_bytes": st.st_size, "modified": int(st.st_mtime)}
            )
    except OSError as exc:
        return {
            "available": False,
            "configured": configured,
            "error": str(exc),
            "backups": [],
        }

    items.sort(key=lambda x: x["modified"], reverse=True)
    return {
        "available": True,
        "configured": configured,
        "dir_present": True,
        "count": len(items),
        "last_backup": items[0]["modified"] if items else None,
        "retention": settings.backup_retention,
        "backups": items,
    }
