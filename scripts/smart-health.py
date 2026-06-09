#!/usr/bin/env python3
"""
Collect per-disk SMART health into a JSON file the Home HQ backend reads.

Runs as root via a systemd timer (see home-hq-smart.{service,timer}.example),
because smartctl needs root + raw device access. The backend container stays
unprivileged and only reads the output file. Re-run anytime; output is atomic.

Output path: $SMART_JSON or /var/lib/home-hq/smart.json
Each disk's raw `smartctl -j` report is stored verbatim under "report"; the
backend summarizes it (so the parsing logic stays unit-tested in Python).
"""

import json
import os
import subprocess
import time

OUT = os.environ.get("SMART_JSON", "/var/lib/home-hq/smart.json")


def list_disks():
    """Physical disks only (skip partitions, loop, rom)."""
    res = subprocess.run(
        ["lsblk", "-dno", "NAME,TYPE"], capture_output=True, text=True
    )
    disks = []
    for line in res.stdout.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[1] == "disk":
            disks.append(parts[0])
    return disks


# USB-NVMe bridge drivers smartctl can use when the default open fails — many
# external enclosures (Realtek/JMicron/ASMedia) need an explicit -d type.
_USB_NVME_TYPES = ("sntrealtek", "sntjmicron", "sntasmedia")


def _run_smartctl(dev, extra=None):
    """Raw `smartctl -j` for /dev/<dev>. smartctl emits JSON even on error."""
    try:
        res = subprocess.run(
            ["smartctl", "-j", "-H", "-A", "-i", *(extra or []), f"/dev/{dev}"],
            capture_output=True,
            text=True,
            timeout=60,
        )
        return json.loads(res.stdout)
    except Exception as exc:  # noqa: BLE001 — record any failure, keep going
        return {"smartctl": {"messages": [{"string": str(exc)}]}}


def _opened(report):
    """True if smartctl actually read the device (vs. a failed open)."""
    return isinstance(report, dict) and report.get("smart_status") is not None


def smart_report(dev):
    report = _run_smartctl(dev)
    if _opened(report):
        return report
    # Default open failed (common for USB enclosures). Retry with the known
    # USB-NVMe bridge drivers and return the first that actually reads.
    for dtype in _USB_NVME_TYPES:
        alt = _run_smartctl(dev, ["-d", dtype])
        if _opened(alt):
            return alt
    return report  # keep the original error message


def main():
    drives = [{"name": d, "report": smart_report(d)} for d in list_disks()]
    data = {"generated_at": int(time.time()), "drives": drives}

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(data, fh)
    os.replace(tmp, OUT)  # atomic swap so readers never see a half-written file
    os.chmod(OUT, 0o644)


if __name__ == "__main__":
    main()
