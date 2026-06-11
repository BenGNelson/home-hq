#!/usr/bin/env bash
#
# Home HQ — config backup.
#
# Tars the paths listed in backup.includes (+ a few generated manifests),
# gzips, and age-encrypts the archive to AGE_RECIPIENT (a PUBLIC key), writing
# the result to BACKUP_DIR and pruning old ones.
#
# Runs on the HOST via a systemd timer, as root (it reads root-owned config).
# It only ever ENCRYPTS — the private key is never on this machine — so a
# compromised server still can't read its own backups. The tar is streamed
# straight into age, so an unencrypted archive never lands on disk.
#
# Config comes from the repo .env (AGE_RECIPIENT, BACKUP_DIR, BACKUP_RETENTION);
# the list of what to back up comes from backup.includes (gitignored, per-host).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load just the backup-related keys from .env (values already in the environment
# win). We deliberately DON'T `source` the whole file: under `set -e` a value
# with a space (e.g. PRINTER_NAME=Bambu P1S) would make bash try to run a word as
# a command and abort the backup. Reading our own keys is robust to any line.
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/../.env}"
if [[ -f "$ENV_FILE" ]]; then
  while IFS='=' read -r key val; do
    [[ "$key" == AGE_* || "$key" == BACKUP_* ]] || continue
    val="${val%$'\r'}"                  # tolerate CRLF line endings
    val="${val#[\"\']}"; val="${val%[\"\']}"   # strip optional surrounding quotes
    [[ -n "${!key:-}" ]] || printf -v "$key" '%s' "$val"
  done < "$ENV_FILE"
fi

: "${AGE_RECIPIENT:?AGE_RECIPIENT not set (put the public key in .env)}"
: "${BACKUP_DIR:?BACKUP_DIR not set}"
RETENTION="${BACKUP_RETENTION:-14}"
INCLUDES_FILE="${INCLUDES_FILE:-$SCRIPT_DIR/backup.includes}"

[[ -f "$INCLUDES_FILE" ]] || {
  echo "includes file not found: $INCLUDES_FILE" >&2
  exit 1
}
command -v age >/dev/null || {
  echo "age is not installed (sudo apt install age)" >&2
  exit 1
}

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y-%m-%d-%H%M)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Generated manifests — guide a rebuild without restoring everything wholesale.
MAN="$WORK/manifests"
mkdir -p "$MAN"
apt-mark showmanual            >"$MAN/apt-manual.txt"        2>/dev/null || true
systemctl list-unit-files --state=enabled >"$MAN/systemd-enabled.txt" 2>/dev/null || true
docker image ls --format '{{.Repository}}:{{.Tag}}' >"$MAN/docker-images.txt" 2>/dev/null || true
mdadm --detail --scan         >"$MAN/mdadm.txt"             2>/dev/null || true
crontab -l                    >"$MAN/crontab-root.txt"      2>/dev/null || true

# Build the list of paths that actually exist (skip + warn on missing).
EXISTING=()
while IFS= read -r line; do
  [[ -e "$line" ]] && EXISTING+=("$line") || echo "skip (missing): $line" >&2
done < <(grep -vE '^\s*(#|$)' "$INCLUDES_FILE")

OUT="$BACKUP_DIR/home-hq-config-$STAMP.tar.gz.age"

# Stream: tar -> gzip -> age. Leading slashes stripped so paths are relative.
# DB/log files excluded to keep the bundle small (e.g. Home Assistant's sqlite).
# tar exit 1 = benign warnings (a file changed while reading); 2+ = real error.
set +e
tar -czf - \
    --exclude='*.db' --exclude='*.db-*' --exclude='*.log' \
    --warning=no-file-changed \
    -C / "${EXISTING[@]#/}" \
    -C "$WORK" manifests \
  | age -r "$AGE_RECIPIENT" -o "$OUT"
rc=("${PIPESTATUS[@]}")
set -e

if [[ "${rc[1]}" -ne 0 ]]; then
  echo "age failed (${rc[1]})" >&2
  rm -f "$OUT"
  exit 1
fi
if [[ "${rc[0]}" -gt 1 ]]; then
  echo "tar failed (${rc[0]})" >&2
  rm -f "$OUT"
  exit 1
fi

chmod 644 "$OUT"  # encrypted, so safe to let the (read-only) UI list it
echo "wrote $OUT ($(du -h "$OUT" | cut -f1))"

# Prune: keep the newest $RETENTION, delete the rest.
ls -1t "$BACKUP_DIR"/home-hq-config-*.tar.gz.age 2>/dev/null \
  | tail -n +"$((RETENTION + 1))" \
  | xargs -r rm -f
