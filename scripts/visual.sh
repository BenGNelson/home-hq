#!/usr/bin/env bash
# Visual-regression capture + diff — drive the running app in a headless browser,
# screenshot every page, and compare against a stored baseline. A LOCAL aid (the
# screenshots hold real host data, so they're gitignored, not committed / not in
# CI). See e2e/visual.py for the caveats (live-data widgets always move a little).
#
#   scripts/visual.sh                    # capture + diff against the baseline
#   UPDATE_BASELINE=1 scripts/visual.sh  # (re)establish the baseline
#
# Requires the stack to be UP. Runs in the official Playwright image — no host
# Python/browser needed.
set -euo pipefail
cd "$(dirname "$0")/.."

BASE_URL="${BASE_URL:-http://localhost:5173}"
PLAYWRIGHT_VERSION="1.60.0"
IMAGE="mcr.microsoft.com/playwright/python:v${PLAYWRIGHT_VERSION}-noble"

echo "Visual regression against ${BASE_URL} (UPDATE_BASELINE=${UPDATE_BASELINE:-0})"
docker run --rm --network host \
  -v "$PWD/e2e":/e2e -w /e2e \
  -e BASE_URL="$BASE_URL" \
  -e UPDATE_BASELINE="${UPDATE_BASELINE:-}" \
  -e VISUAL_TOLERANCE="${VISUAL_TOLERANCE:-}" \
  "$IMAGE" \
  sh -c "pip install -q playwright==${PLAYWRIGHT_VERSION} pillow && python visual.py"
