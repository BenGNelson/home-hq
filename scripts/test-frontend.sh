#!/usr/bin/env bash
# Run the frontend (Vitest) suite inside the dev image (which has node + deps;
# the default `frontend` service is the nginx production image and has neither).
# node_modules comes from the image, so if you add a dev dependency rebuild
# first: docker compose build frontend-dev
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

exec docker compose -f "$REPO/docker-compose.yml" --profile dev run --rm --no-deps \
  -v "$REPO/frontend:/app" \
  frontend-dev npx vitest run
