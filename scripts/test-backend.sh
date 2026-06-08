#!/usr/bin/env bash
# Run the backend (pytest) suite inside the backend image, with the live source
# mounted and test-only deps installed ephemerally (kept out of the prod image).
# No host Python toolchain needed.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

exec docker compose -f "$REPO/docker-compose.yml" run --rm --no-deps \
  -v "$REPO/backend:/app" \
  backend sh -c "pip install -q -r requirements-dev.txt && pytest"
