#!/usr/bin/env python3
"""
Record NVIDIA GPU stats into a JSON file the Home HQ backend reads.

Runs on the HOST via a systemd timer — see home-hq-gpu.{service,timer}.example.
The backend runs in a container with no GPU passthrough and no `nvidia-smi`, so
(exactly like SMART, the VPN check, Tailscale, and the drive watchdog) a small
host script gathers the facts and writes them where the app reads them
read-only. Nothing here is secret or host-specific, so it's safe to commit.

It shells out to `nvidia-smi --query-gpu=... --format=csv` and keeps the fields
the dashboard shows: name, GPU utilization %, VRAM used/total, temperature, the
active NVENC encoder-session count (the GPU's main job on a Plex box), and power
draw. Config (all optional) comes from the environment:

  NVIDIA_SMI_BIN  path to nvidia-smi   (default: nvidia-smi, found on PATH)
  GPU_JSON        output path          (default: /var/lib/home-hq/gpu.json)
"""

import json
import os
import subprocess
import time

SMI_BIN = os.environ.get("NVIDIA_SMI_BIN", "nvidia-smi")
OUT = os.environ.get("GPU_JSON", "/var/lib/home-hq/gpu.json")

# Order matters — it must match the parsing in _parse_row() below.
FIELDS = (
    "name",
    "utilization.gpu",
    "memory.used",
    "memory.total",
    "temperature.gpu",
    "encoder.stats.sessionCount",
    "power.draw",
)


def _num(value, cast):
    """nvidia-smi prints '[N/A]' / '[Not Supported]' for fields a card lacks —
    map those (and anything unparseable) to None instead of crashing."""
    try:
        return cast(value)
    except (TypeError, ValueError):
        return None


def _parse_row(row):
    """One CSV line (no units) -> a shaped GPU dict, or None if it's malformed."""
    parts = [p.strip() for p in row.split(",")]
    if len(parts) != len(FIELDS):
        return None
    name, util, used, total, temp, enc, power = parts
    return {
        "name": name or "GPU",
        "utilization_percent": _num(util, int),
        "memory_used_mb": _num(used, int),
        "memory_total_mb": _num(total, int),
        "temperature_c": _num(temp, int),
        "encoder_sessions": _num(enc, int),
        "power_watts": _num(power, float),
    }


def run_query():
    """`nvidia-smi --query-gpu=...` -> list of GPU dicts, or None if unreadable."""
    try:
        res = subprocess.run(
            [SMI_BIN, f"--query-gpu={','.join(FIELDS)}",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=15,
        )
        if res.returncode != 0:
            return None
        gpus = [g for g in (_parse_row(line) for line in res.stdout.splitlines()
                            if line.strip()) if g]
        return gpus or None
    except (OSError, subprocess.SubprocessError):
        return None


def main():
    gpus = run_query()
    if gpus is None:
        # No NVIDIA driver / nvidia-smi absent / no GPU. Write a minimal file so
        # the backend can tell "no GPU here" from "the timer never ran".
        data = {"updated": int(time.time()), "available": False}
    else:
        data = {"updated": int(time.time()), "available": True, "gpus": gpus}

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(data, fh)
    os.replace(tmp, OUT)  # atomic swap so the reader never sees a half-written file
    os.chmod(OUT, 0o644)


if __name__ == "__main__":
    main()
