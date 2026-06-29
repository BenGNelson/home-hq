#!/usr/bin/env python3
"""
End-to-end SMOKE test for Home HQ: drive the real running app in a headless
browser and assert every module page renders (shell + non-empty content) with
zero console errors.

Shallow by design — it answers "does each page turn on without catching fire?",
not "is every feature correct" (that's what the unit suites are for). This is the
durable version of the one-off headless checks we used to hand-write per change:
it catches the class of bug the unit tests can't — bad imports, API-shape
mismatches, the nginx proxy, build/runtime errors, white-screen crashes.

Run via scripts/verify.sh (needs the stack UP). Exits non-zero on any failure,
so CI can gate on it. Targets the prod build on :5173 by default; set BASE_URL to
point elsewhere (e.g. the frontend-dev server on :5174).
"""
import os
import sys

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("BASE_URL", "http://localhost:5173").rstrip("/")

# console.error / pageerror substrings treated as benign (PWA/service-worker
# noise, etc.). Keep this tight — it's the escape hatch, not the rule.
BENIGN = ()


def _benign_response(url, status, rtype):
    """True for a non-OK response that is a by-design graceful <img onError>
    fallback, not a page failure. Kept TIGHT and per-route — a broken logo, PWA
    icon, Plex poster, or a cover route 5xx (e.g. a crashing renderer) is NOT
    benign and must still fail the smoke. Only:
      - a cover-route 404 (the cover is missing → placeholder tile), and
      - the chamber camera during warmup/off (404/503 → last-frame/placeholder)."""
    if rtype != "image":
        return False
    if status == 404 and "/cover" in url:
        return True
    if "/printer/camera" in url and status in (404, 503):
        return True
    return False

# (path, [text snippets that must be present]). An empty list = assert only that
# the shell rendered, the content area is non-empty, and there were no console
# errors. Content snippets are added for pages whose render we want to pin.
PAGES = [
    ("/dashboard", []),
    ("/catalog", ["Home Catalog"]),
    ("/weather", ["Weather"]),
    ("/plex", []),
    ("/library", []),
    ("/containers", []),
    ("/storage", []),
    ("/network", []),
    ("/vpn", []),
    ("/tailscale", []),
    ("/speedtest", []),
    ("/uptime", []),
    ("/backups", []),
    ("/alerts", []),
    ("/printer", []),
    ("/solar", []),
    ("/adguard", []),
    ("/guide", []),
    ("/readme", []),
    ("/server-guide", []),
    # Pin our own chrome text, not the embedded Swagger UI — the assertion stays
    # green regardless of the iframe's third-party (CDN-served) contents, but a
    # blank/crashed render of the page itself still fails the gate.
    ("/api-docs", ["interactive API reference"]),
]


def check_page(page, path, expect):
    """Load one page and return a list of problems (empty = healthy)."""
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))

    # Track non-OK responses so we can tell a benign cover-image 404 (the app's
    # by-design graceful fallback — every cover is an <img onError> that swaps to
    # an icon tile) from a real one (a failed API/JS/asset fetch is a true bug).
    bad = []  # (url, status, resource_type)
    page.on(
        "response",
        lambda r: bad.append((r.url, r.status, r.request.resource_type)) if r.status >= 400 else None,
    )

    page.goto(f"{BASE_URL}{path}", wait_until="domcontentloaded")
    # The "Home HQ" brand confirms the shell booted. Wait for it instead of
    # networkidle — the app polls /api continuously, so it's never network-idle.
    page.get_by_text("Home HQ").first.wait_for(timeout=15000)
    page.wait_for_timeout(800)

    problems = []
    if not page.locator("main").inner_text().strip():
        problems.append("main content is empty (blank/crash)")
    for text in expect:
        if page.get_by_text(text, exact=False).count() == 0:
            problems.append(f"missing expected text: {text!r}")

    # A non-OK response on a known graceful-fallback image route (cover miss,
    # camera warmup) is by-design; anything else (a 4xx/5xx on an API/script/
    # document, a broken non-cover image, or a cover-route 5xx) is a real problem.
    unexpected = [b for b in bad if not _benign_response(*b)]
    if unexpected:
        problems.append(f"unexpected non-OK responses: {unexpected}")
    # The browser logs a generic "Failed to load resource" console error per
    # non-OK response with no URL — so only treat those as real when there's an
    # unexpected response behind them (a benign image 404 carries no other signal).
    real = []
    for e in errors:
        if any(b in e for b in BENIGN):
            continue
        if "Failed to load resource" in e and not unexpected:
            continue  # benign cover-image 404
        real.append(e)
    if real:
        problems.append(f"console errors: {real}")
    return problems


def main():
    failures = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for path, expect in PAGES:
            page = browser.new_page()
            try:
                problems = check_page(page, path, expect)
            except Exception as e:  # a navigation/timeout/crash is itself a failure
                problems = [f"exception: {e}"]
            finally:
                page.close()
            if problems:
                failures.append((path, problems))
                print(f"FAIL {path}")
                for pr in problems:
                    print(f"      - {pr}")
            else:
                print(f"ok   {path}")
        browser.close()

    print()
    if failures:
        print(f"SMOKE FAILED: {len(failures)}/{len(PAGES)} page(s)")
        sys.exit(1)
    print(f"SMOKE PASSED: all {len(PAGES)} pages render cleanly")


if __name__ == "__main__":
    main()
