# e2e — end-to-end smoke tests

`smoke.py` drives the **real running app** in a headless browser and asserts every
module page renders (shell + non-empty content) with **zero console errors**.

It's deliberately *shallow* — a smoke test answers "does each page turn on
without catching fire?", not "is every feature correct." The unit suites
(`backend/tests`, `frontend/src/**/*.test.js`) cover logic in isolation; this
covers the thing they can't: the whole stack wired together (imports, API
shapes, the nginx proxy, build/runtime errors, white-screen crashes).

## Run it

The stack must be up (`docker compose up -d`). No host Python/Node/browser
needed — it runs in the official Playwright image:

```bash
scripts/verify.sh                                  # against prod build (:5173)
BASE_URL=http://localhost:5174 scripts/verify.sh   # against frontend-dev
```

Exits non-zero if any page fails, so it gates `scripts/deploy.sh` and CI.

## Adding a page

Add a `(path, [expected text])` tuple to `PAGES` in `smoke.py`. Leave the list
empty to assert only shell + non-empty content + no console errors; add text
snippets to pin a page's render.
