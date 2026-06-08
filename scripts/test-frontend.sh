#!/usr/bin/env bash
# Run the frontend (Vitest) suite inside the frontend image, with the live source
# mounted. node_modules comes from the image, so if you add a dev dependency
# rebuild first: docker compose build frontend
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

exec docker compose -f "$REPO/docker-compose.yml" run --rm --no-deps \
  -v "$REPO/frontend:/app" \
  frontend npx vitest run
