#!/usr/bin/env bash
#
# Home HQ — external-drive watchdog.
#
# Some USB-to-SATA/NVMe bridges periodically *wedge*: a region of I/O starts
# erroring while the device stays "connected", which blocks reads AND writes
# (on NTFS the driver must read $MFT before writing). It looks like a dead drive
# but the raw sectors are fine again after a power-cycle of the bridge.
#
# This watchdog probes the mount on an interval; on a confirmed wedge it does the
# same recovery you'd do by hand: lazy-unmount -> (optional) software USB reset
# (== a physical replug) -> filesystem repair -> remount, then verifies. If the
# drive is merely unmounted, it just remounts (no reset needed). It also writes a
# small JSON state file so a dashboard can show health / last recovery.
#
# Runs on the HOST via a systemd service (Restart=always), as root — it needs to
# unmount, reset USB, and fsck. The app container never does any of this.
#
# Everything drive-specific comes from the repo .env, so this file is generic:
#   WATCHDOG_MOUNT     mount point to watch                 (required)
#   WATCHDOG_UUID      filesystem UUID of the partition     (required)
#   WATCHDOG_USB_ID    USB "vendor:product" of the bridge   (optional; enables
#                      the software bridge reset, e.g. 0bda:9210)
#   WATCHDOG_FSTYPE    filesystem type                      (optional; auto-
#                      detected from the device if unset)
#   WATCHDOG_REPAIR_CMD override the repair command         (optional; receives
#                      the device path as its last argument)
#   WATCHDOG_LABEL     display label for logs/state         (optional)
#   WATCHDOG_STATE_JSON where to write the state file       (optional)
#   WATCHDOG_LOG       log file                             (optional)
#   WATCHDOG_CHECK_INTERVAL / _PROBE_TIMEOUT / _FAIL_THRESHOLD /
#   WATCHDOG_COOLDOWN / _BACKOFF                            (optional tuning)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load only the WATCHDOG_* settings from the repo .env (values already in the
# environment win). We deliberately DON'T `source` the whole file: this runs as a
# root daemon, and the .env holds unrelated secrets plus values with spaces (e.g.
# a printer name) that aren't valid shell — sourcing would execute them. Reading
# our own keys is both safer and tolerant of any other line.
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/../.env}"
if [[ -f "$ENV_FILE" ]]; then
  while IFS='=' read -r key val; do
    [[ "$key" == WATCHDOG_* ]] || continue
    val="${val%$'\r'}"                  # tolerate CRLF line endings
    val="${val#[\"\']}"; val="${val%[\"\']}"   # strip optional surrounding quotes
    [[ -n "${!key:-}" ]] || printf -v "$key" '%s' "$val"
  done < "$ENV_FILE"
fi

MOUNT="${WATCHDOG_MOUNT:?WATCHDOG_MOUNT not set (the mount point to watch)}"
UUID="${WATCHDOG_UUID:?WATCHDOG_UUID not set (filesystem UUID of the partition)}"
BYUUID="/dev/disk/by-uuid/${UUID}"

USB_ID="${WATCHDOG_USB_ID:-}"           # "vendor:product"; empty disables reset
VENDOR="${USB_ID%%:*}"
PRODUCT="${USB_ID##*:}"

LABEL="${WATCHDOG_LABEL:-external-drive}"
LOG_FILE="${WATCHDOG_LOG:-/var/log/home-hq-drive-watchdog.log}"
STATE_JSON="${WATCHDOG_STATE_JSON:-/var/lib/home-hq/drive-watchdog.json}"
HEALTH_FILE="${MOUNT%/}/.home-hq-watchdog-probe"

CHECK_INTERVAL="${WATCHDOG_CHECK_INTERVAL:-30}"   # seconds between probes
PROBE_TIMEOUT="${WATCHDOG_PROBE_TIMEOUT:-20}"     # max seconds a probe may hang
FAIL_THRESHOLD="${WATCHDOG_FAIL_THRESHOLD:-2}"    # bad probes before we act
COOLDOWN="${WATCHDOG_COOLDOWN:-60}"               # settle time after recovery
BACKOFF="${WATCHDOG_BACKOFF:-300}"                # pause after a failed recovery

# Filesystem type drives the repair tool; auto-detect if the user didn't pin it.
FSTYPE="${WATCHDOG_FSTYPE:-}"
if [[ -z "$FSTYPE" ]]; then
  FSTYPE="$(blkid -s TYPE -o value "$BYUUID" 2>/dev/null || true)"
fi

# Tracked for the state file.
RECOVERY_COUNT=0
LAST_RECOVERY="null"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Atomically publish a tiny health snapshot a dashboard can read. Best-effort:
# never let a state-write failure disturb the watchdog loop.
write_state() {
  local healthy="$1" note="${2:-}"
  [[ -n "$STATE_JSON" ]] || return 0
  mkdir -p "$(dirname "$STATE_JSON")" 2>/dev/null || return 0
  local tmp="${STATE_JSON}.tmp"
  printf '{"label":"%s","mount":"%s","fstype":"%s","healthy":%s,"last_check":%s,"last_recovery":%s,"recovery_count":%s,"note":"%s"}\n' \
    "$LABEL" "$MOUNT" "$FSTYPE" "$healthy" "$(date +%s)" "$LAST_RECOVERY" "$RECOVERY_COUNT" "$note" \
    > "$tmp" 2>/dev/null || return 0
  mv -f "$tmp" "$STATE_JSON" 2>/dev/null && chmod 644 "$STATE_JSON" 2>/dev/null
}

# Healthy = mounted AND a small read+write+delete completes within PROBE_TIMEOUT.
# The timeout catches the "hung in D-state" variant where I/O never returns.
probe_healthy() {
  mountpoint -q "$MOUNT" || return 1
  timeout "$PROBE_TIMEOUT" bash -c \
    'echo ok > "'"$HEALTH_FILE"'" && cat "'"$HEALTH_FILE"'" >/dev/null && rm -f "'"$HEALTH_FILE"'"' \
    2>/dev/null
}

# Find the enclosure's sysfs USB node (e.g. "1-10") by vendor:product.
find_usb_dev() {
  local d
  for d in /sys/bus/usb/devices/*; do
    [[ -f "$d/idVendor" ]] || continue
    if [[ "$(cat "$d/idVendor" 2>/dev/null)" == "$VENDOR" ]] &&
       [[ "$(cat "$d/idProduct" 2>/dev/null)" == "$PRODUCT" ]]; then
      basename "$d"
      return 0
    fi
  done
  return 1
}

# Software power-cycle the bridge. Prefer USBDEVFS_RESET (closest to a replug,
# usually keeps the device node); fall back to deauthorize/reauthorize, then to
# driver unbind/bind. No-op (returns 1) when no USB id is configured.
reset_usb() {
  [[ -n "$USB_ID" ]] || { log "no WATCHDOG_USB_ID set — skipping bridge reset"; return 1; }
  local dev busnum devnum path
  dev="$(find_usb_dev)" || { log "USB device $USB_ID not found for reset"; return 1; }
  busnum="$(cat "/sys/bus/usb/devices/$dev/busnum" 2>/dev/null)"
  devnum="$(cat "/sys/bus/usb/devices/$dev/devnum" 2>/dev/null)"
  if command -v usbreset >/dev/null && [[ -n "$busnum" && -n "$devnum" ]]; then
    path="/dev/bus/usb/$(printf '%03d' "$busnum")/$(printf '%03d' "$devnum")"
    log "Resetting USB bridge at $path (sysfs $dev)"
    usbreset "$path" >>"$LOG_FILE" 2>&1 && return 0
  fi
  log "usbreset unavailable/failed; trying authorized toggle on $dev"
  if echo 0 > "/sys/bus/usb/devices/$dev/authorized" 2>/dev/null; then
    sleep 2
    echo 1 > "/sys/bus/usb/devices/$dev/authorized" 2>/dev/null && return 0
  fi
  log "authorized toggle failed; trying driver unbind/bind on $dev"
  echo "$dev" > /sys/bus/usb/drivers/usb/unbind 2>/dev/null
  sleep 3
  echo "$dev" > /sys/bus/usb/drivers/usb/bind 2>/dev/null
}

# Wait for the partition to re-appear after a reset.
wait_for_device() {
  local i
  for i in $(seq 1 40); do
    [[ -e "$BYUUID" ]] && return 0
    sleep 1
  done
  return 1
}

# Filesystem repair, chosen by type (or overridden via WATCHDOG_REPAIR_CMD).
# Clears the "dirty" flag a hard yank leaves behind so the mount succeeds.
repair_fs() {
  local dev="$BYUUID"
  if [[ -n "${WATCHDOG_REPAIR_CMD:-}" ]]; then
    log "Running repair override: $WATCHDOG_REPAIR_CMD $dev"
    # shellcheck disable=SC2086 — intentional word-split so args in the var work.
    $WATCHDOG_REPAIR_CMD "$dev" >>"$LOG_FILE" 2>&1 || true
    return
  fi
  case "$FSTYPE" in
    ntfs)            ntfsfix "$dev"        >>"$LOG_FILE" 2>&1 || true ;;
    ext2|ext3|ext4)  e2fsck -p -f "$dev"   >>"$LOG_FILE" 2>&1 || true ;;
    exfat)           fsck.exfat -y "$dev"  >>"$LOG_FILE" 2>&1 || true ;;
    vfat|fat|msdos)  fsck.vfat -a "$dev"   >>"$LOG_FILE" 2>&1 || true ;;
    *)               log "no repair command for fstype '${FSTYPE:-unknown}' — skipping fsck" ;;
  esac
}

# Full wedge recovery: detach, reset bridge, repair filesystem, remount.
# Relies on an /etc/fstab entry for $MOUNT (so options stay host-specific).
recover_full() {
  log "Wedge confirmed on $LABEL — full recovery (umount -> reset -> repair -> mount)"
  timeout 10 umount "$MOUNT" 2>/dev/null || umount -l "$MOUNT" 2>/dev/null
  reset_usb
  if ! wait_for_device; then
    log "ERROR: $BYUUID did not re-appear after reset"
    return 1
  fi
  log "Device back; repairing filesystem ($FSTYPE)"
  repair_fs
  mount "$MOUNT" 2>>"$LOG_FILE"
  sleep 2
  if probe_healthy; then
    RECOVERY_COUNT=$((RECOVERY_COUNT + 1))
    LAST_RECOVERY="$(date +%s)"
    log "Recovery SUCCESS — $MOUNT is healthy again (total recoveries: $RECOVERY_COUNT)"
    write_state true "recovered"
    return 0
  fi
  log "Recovery did NOT restore health"
  return 1
}

log "drive-watchdog starting for $LABEL ($MOUNT, ${FSTYPE:-unknown fs}); probe every ${CHECK_INTERVAL}s, threshold ${FAIL_THRESHOLD}"

fails=0
recover_fails=0
while true; do
  if probe_healthy; then
    fails=0
    recover_fails=0
    write_state true "ok"
    sleep "$CHECK_INTERVAL"
    continue
  fi

  # Cheap case: simply not mounted (e.g. a clean unmount) — just remount it.
  if ! mountpoint -q "$MOUNT"; then
    log "$MOUNT not mounted — attempting plain remount"
    if [[ -e "$BYUUID" ]] && mount "$MOUNT" 2>>"$LOG_FILE" && probe_healthy; then
      log "Remounted cleanly"
      fails=0; recover_fails=0
      write_state true "remounted"
      sleep "$COOLDOWN"
      continue
    fi
  fi

  fails=$((fails + 1))
  log "Health probe failed ($fails/$FAIL_THRESHOLD)"
  write_state false "probe-failed"
  if [[ "$fails" -lt "$FAIL_THRESHOLD" ]]; then
    sleep "$CHECK_INTERVAL"
    continue
  fi

  if recover_full; then
    fails=0; recover_fails=0
    sleep "$COOLDOWN"
  else
    recover_fails=$((recover_fails + 1))
    log "Recovery attempt #$recover_fails failed; backing off ${BACKOFF}s"
    write_state false "recovery-failed"
    fails=0
    sleep "$BACKOFF"
  fi
done
