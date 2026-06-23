#!/usr/bin/env bash
# One-shot deploy: unit tests -> build + (re)start the prod images -> e2e smoke.
# Collapses the per-change loop (test.sh, docker compose up --build, verify.sh)
# into a single gated command. Stops at the first failure.
#
#   scripts/deploy.sh             # full: test -> build -> smoke
#   scripts/deploy.sh --no-test   # build -> smoke only (skip the unit suites)
set -euo pipefail
cd "$(dirname "$0")/.."

run_tests=1
[ "${1:-}" = "--no-test" ] && run_tests=0

FRONTEND_PORT="${FRONTEND_PORT:-5173}"

if [ "$run_tests" = 1 ]; then
  echo "==> Unit suites (pytest + Vitest)"
  scripts/test.sh
fi

echo "==> Build + deploy prod (frontend + backend)"
# Compose waits for the backend to be HEALTHY before starting the frontend
# (depends_on: service_healthy), so both are ready when this returns.
docker compose up --build -d frontend backend

echo "==> Wait for the app to answer on :${FRONTEND_PORT}"
for _ in $(seq 1 30); do
  if curl -fsS "http://localhost:${FRONTEND_PORT}/" >/dev/null 2>&1; then break; fi
  sleep 1
done

echo "==> E2E smoke"
BASE_URL="http://localhost:${FRONTEND_PORT}" scripts/verify.sh

echo "==> Deployed + verified."
