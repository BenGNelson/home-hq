#!/usr/bin/env bash
# One-shot Lighthouse audit of the running app (performance / accessibility /
# best-practices / SEO / PWA). A diagnostic, not a gate. Runs in the Playwright
# image (bundled Chromium) so no host browser/node is needed. Lighthouse is
# pinned to v11 because v12 dropped the PWA category.
#
#   scripts/lighthouse.sh            # audit :5173, write report + JSON to OUT
#   BASE_URL=http://localhost:5174 scripts/lighthouse.sh
#
# Reports land in OUT (default ./lighthouse-report/, gitignored — they reference
# the local URL and are diagnostics, not source). Prints the category scores.
set -euo pipefail
cd "$(dirname "$0")/.."

BASE_URL="${BASE_URL:-http://localhost:5173}"
OUT="${OUT:-$PWD/lighthouse-report}"
LH_VERSION="11.7.1"
IMAGE="mcr.microsoft.com/playwright:v1.60.0-noble"
mkdir -p "$OUT"

echo "Lighthouse (@$LH_VERSION) against ${BASE_URL} -> ${OUT}"
docker run --rm --network host -v "$OUT":/out -w /out "$IMAGE" bash -lc "
  npm i -g lighthouse@${LH_VERSION} >/tmp/npm.log 2>&1 || { tail -5 /tmp/npm.log; exit 1; }
  CHROME_PATH=\$(ls /ms-playwright/chromium*/chrome-linux*/chrome 2>/dev/null | head -1)
  CHROME_PATH=\"\$CHROME_PATH\" lighthouse '${BASE_URL}' \
    --quiet --chrome-flags='--headless=new --no-sandbox --disable-dev-shm-usage' \
    --output=json --output=html --output-path=/out/report \
    --only-categories=performance,accessibility,best-practices,seo,pwa
  node -e '
    const d=require(\"/out/report.report.json\");
    for(const [k,c] of Object.entries(d.categories))
      console.log(\"  \"+c.title.padEnd(16), c.score==null?\"n/a\":Math.round(c.score*100));
  '
"
echo "Full report: ${OUT}/report.report.html"
