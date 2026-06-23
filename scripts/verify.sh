#!/usr/bin/env bash
# E2E smoke test — drive the running app in a real (headless) browser and assert
# every module page renders with no console errors. The durable replacement for
# one-off headless checks; also run in CI.
#
# Requires the stack to be UP (docker compose up -d). Runs in the official
# Playwright image, so no host Python / Node / browser is needed.
#
#   scripts/verify.sh                                  # prod build on :5173
#   BASE_URL=http://localhost:5174 scripts/verify.sh   # frontend-dev hot-reload
#
# Exits non-zero if any page fails (so it gates CI / the deploy script).
set -euo pipefail
cd "$(dirname "$0")/.."

BASE_URL="${BASE_URL:-http://localhost:5173}"
# Pin Playwright to the image's bundled browser version to avoid a mismatch.
PLAYWRIGHT_VERSION="1.60.0"
IMAGE="mcr.microsoft.com/playwright/python:v${PLAYWRIGHT_VERSION}-noble"

echo "E2E smoke against ${BASE_URL}"
docker run --rm --network host \
  -v "$PWD/e2e":/e2e -w /e2e \
  -e BASE_URL="$BASE_URL" \
  "$IMAGE" \
  sh -c "pip install -q playwright==${PLAYWRIGHT_VERSION} && python smoke.py"
