"""Tests for the /proc/diskstats parser: device filtering + sector→byte math."""

from app.routers.diskio import parse_diskstats

# Real-ish /proc/diskstats lines: whole disks, a partition, an md array, and
# virtual devices we want to drop. Columns: major minor name reads rd_merged
# sectors_read ms_read writes wr_merged sectors_written ...
SAMPLE = """\
   8       0 sda 1000 0 4000 500 2000 0 8000 600 0 0 0
   8       1 sda1 50 0 200 10 5 0 40 2 0 0 0
   8      16 sdb 10 0 20 5 30 0 80 7 0 0 0
   9       0 md0 100 0 400 0 200 0 1600 0 0 0 0
 259       0 nvme0n1 7 0 14 1 9 0 24 2 0 0 0
 259       1 nvme0n1p1 1 0 2 0 1 0 2 0 0 0 0
   7       0 loop0 0 0 0 0 0 0 0 0 0 0 0
 253       0 dm-0 5 0 10 0 5 0 10 0 0 0 0
"""


def test_keeps_whole_disks_and_md_drops_partitions_and_virtual():
    names = [d["name"] for d in parse_diskstats(SAMPLE)]
    assert names == ["sda", "sdb", "md0", "nvme0n1"]
    # Partitions, loop and dm devices are excluded.
    for dropped in ("sda1", "nvme0n1p1", "loop0", "dm-0"):
        assert dropped not in names


def test_converts_sectors_to_bytes():
    sda = next(d for d in parse_diskstats(SAMPLE) if d["name"] == "sda")
    # sectors_read = col index 5 = 4000; sectors_written = index 9 = 8000.
    assert sda["read_bytes"] == 4000 * 512
    assert sda["write_bytes"] == 8000 * 512


def test_ignores_short_or_garbage_lines():
    text = (
        "garbage\n"  # too few fields
        "   8   0 sdy\n"  # too few fields
        "   8   0 sdz 1 2 notanumber 4 5 6 7\n"  # non-numeric sector count
    )
    assert parse_diskstats(text) == []
