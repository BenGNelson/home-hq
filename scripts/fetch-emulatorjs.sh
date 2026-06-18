#!/usr/bin/env bash
# Fetch a PINNED EmulatorJS engine + cores into frontend/public/emulatorjs/ for
# fully self-hosted, offline play (no third-party calls at play time). The output
# is gitignored (~300 MB of third-party WASM) — re-run this to install or bump
# the pinned version, then rebuild the frontend image.
#
# Requires 7z (p7zip) to extract the release archive:
#   sudo apt-get install -y p7zip-full      # Debian/Ubuntu
#
# ALTERNATIVE (no download): skip self-hosting and load the engine from the
# official pinned CDN instead — set EMULATORJS_DATA in frontend/src/lib/library.js
# to 'https://cdn.emulatorjs.org/4.2.3/data/'. emulator.html allows that origin.
set -euo pipefail

VERSION="4.2.3"   # pin: github.com/EmulatorJS/EmulatorJS/releases
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$REPO/frontend/public/emulatorjs"
URL="https://github.com/EmulatorJS/EmulatorJS/releases/download/v${VERSION}/${VERSION}.7z"

SEVENZIP="$(command -v 7z || command -v 7za || true)"
if [ -z "$SEVENZIP" ]; then
  echo "error: 7z not found — needed to extract the EmulatorJS release." >&2
  echo "  Install it:  sudo apt-get install -y p7zip-full" >&2
  echo "  (Or use the pinned CDN instead — see the header of this script.)" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading EmulatorJS v${VERSION} (~300 MB)…"
curl -fL "$URL" -o "$TMP/ejs.7z"

echo "Extracting…"
"$SEVENZIP" x -y -o"$TMP/x" "$TMP/ejs.7z" >/dev/null

# Locate the engine root (the folder containing loader.js) within the archive,
# without assuming its exact layout.
LOADER="$(find "$TMP/x" -name loader.js | head -1 || true)"
if [ -z "$LOADER" ]; then
  echo "error: loader.js not found in the archive — layout may have changed." >&2
  exit 1
fi
SRC="$(dirname "$LOADER")"

echo "Installing into $DEST"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -a "$SRC/." "$DEST/"

echo "Done. Now rebuild + deploy the frontend:"
echo "  docker compose up --build -d frontend"
