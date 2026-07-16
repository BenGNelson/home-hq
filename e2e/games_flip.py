"""Targeted check for the Games -> Frog flip.

Games IS Frog now: the Library's Games entry opens the full-screen browser, the old
/library/games grid route redirects into it, and leaving Frog goes up to the Library
hub (not back to a grid that no longer exists). This drives those three routes.

    BASE_URL=http://localhost:5173 python games_flip.py
"""
import os
import sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:5173")
errors = []


def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        errors.append(msg)


with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context()
    page = context.new_page()
    # The Library hub renders section preview covers; some book/comic covers 404 on the
    # real library (the backend couldn't render one), logging a "Failed to load
    # resource" — environmental, unrelated to this routing change. A genuine app error
    # reads differently, so only those count.
    def on_console(m):
        if m.type == "error" and "Failed to load resource" not in m.text:
            errors.append(f"console.{m.type}: {m.text}")

    page.on("console", on_console)

    # 1. The retired grid route redirects into Frog.
    page.goto(f"{BASE}/library/games", wait_until="domcontentloaded")
    page.wait_for_url("**/frog", timeout=8000)
    check("/frog" in page.url, "/library/games redirects to /frog")

    # 2. The Library hub's "Games" card links straight to Frog (sectionHref).
    page.goto(f"{BASE}/library", wait_until="networkidle")
    games_card = page.locator('a[href="/frog"]')
    page.wait_for_selector('a[href="/frog"]', timeout=8000)
    check(games_card.count() >= 1, "the Library hub has a Games card that points at /frog")
    games_card.first.click()
    page.wait_for_url("**/frog", timeout=8000)
    check("/frog" in page.url, "clicking the hub's Games card opens Frog")

    # 3. Leaving Frog goes UP to the Library hub, not to a games grid.
    boot = page.locator('[data-testid="frog-boot"]')
    for _ in range(5):
        if page.locator('[data-testid="frog-shelf"]').count():
            break
        if boot.count():
            boot.click()
        page.wait_for_timeout(300)
    page.wait_for_selector('[data-testid="frog-shelf"]', timeout=5000)
    page.locator('[aria-label="Leave Frog"]').click()
    page.wait_for_url(lambda url: url.rstrip("/").endswith("/library"), timeout=8000)
    check(page.url.rstrip("/").endswith("/library"), "leaving Frog lands on the Library hub")

    context.close()
    browser.close()

if errors:
    print("\nFLIP CHECK FAILED:")
    for e in errors:
        print("  - " + e)
    sys.exit(1)
print("\nFLIP CHECK PASSED")
