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
    ("/guide", []),
    ("/readme", []),
    ("/server-guide", []),
]


def check_page(page, path, expect):
    """Load one page and return a list of problems (empty = healthy)."""
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))

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
    real = [e for e in errors if not any(b in e for b in BENIGN)]
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
