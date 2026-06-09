"""
/api/raid — software-RAID (mdadm) array health, parsed from /proc/mdstat.

The host's /proc is mounted read-only at /host/proc (same mount the network
router uses), so we can read array state with no extra privileges — unlike
SMART, which needs root and is handled by a separate host timer.

/proc/mdstat looks like:

    Personalities : [raid6] [raid5] [raid4] ...
    md0 : active raid5 sdb2[0] sdc2[1] sdd2[3]
          8001273856 blocks super 1.2 level 5, 512k chunk, algorithm 2 [3/3] [UUU]
          bitmap: 0/30 pages [0KB], 65536KB chunk

`[3/3]` is [configured/active] devices and `[UUU]` is per-device up(U)/down(_).
A healthy array has active == configured and no `_`.
"""

import re

from fastapi import APIRouter

router = APIRouter()

_MDSTAT_PATHS = ("/host/proc/mdstat", "/proc/mdstat")

# A member token in the header line, e.g. "sdb2[0]" or "sdc2[1](F)".
_MEMBER_RE = re.compile(r"([A-Za-z0-9]+)\[\d+\](\([A-Z]\))?")
_HEADER_RE = re.compile(r"^(md\d+)\s*:\s*(\S+)\s+(\S+)\s+(.*)$")
_COUNT_RE = re.compile(r"\[(\d+)/(\d+)\]")
_STATUS_RE = re.compile(r"\[([U_]+)\]")
_RESYNC_RE = re.compile(r"(recovery|resync|reshape|check)\s*=\s*([\d.]+)%")


def _read_mdstat():
    for path in _MDSTAT_PATHS:
        try:
            with open(path) as fh:
                return fh.read()
        except FileNotFoundError:
            continue
    return None


def parse_mdstat(text):
    """Parse /proc/mdstat text into a list of array dicts."""
    arrays = []
    lines = text.splitlines()
    for i, line in enumerate(lines):
        header = _HEADER_RE.match(line)
        if not header:
            continue
        name, state, level, rest = header.groups()

        members, failed = [], []
        for tok in rest.split():
            m = _MEMBER_RE.match(tok)
            if not m:
                continue
            dev = m.group(1)
            members.append(dev)
            if m.group(2) and "F" in m.group(2):  # (F) = faulty
                failed.append(dev)

        # The following few lines hold the [n/m] counts, [U_…] status, and
        # any in-progress recovery/resync percentage.
        total = active = status = None
        resync = None
        for follow in lines[i + 1 : i + 4]:
            if status is None:
                cnt = _COUNT_RE.search(follow)
                st = _STATUS_RE.search(follow)
                if cnt:
                    total, active = int(cnt.group(1)), int(cnt.group(2))
                if st:
                    status = st.group(1)
            rs = _RESYNC_RE.search(follow)
            if rs and resync is None:
                resync = {
                    "action": rs.group(1),
                    "percent": float(rs.group(2)),
                    "detail": follow.strip(),
                }

        if status is not None:
            healthy = "_" not in status
        elif total is not None:
            healthy = active == total
        else:
            healthy = None

        arrays.append(
            {
                "name": name,
                "state": state,
                "level": level,
                "members": members,
                "failed": failed,
                "devices_total": total,
                "devices_active": active,
                "status": status,
                "healthy": healthy,
                "resync": resync,
            }
        )
    return arrays


@router.get("/raid")
def get_raid():
    text = _read_mdstat()
    if text is None:
        return {"available": False, "error": "mdstat not found"}
    return {"available": True, "arrays": parse_mdstat(text)}
