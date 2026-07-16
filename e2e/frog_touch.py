"""Targeted check for Frog by TOUCH (Phase 2 — the phone path).

Frog was born controller-first; this drives it as a phone with no controller would.
It runs in an emulated iPhone context (a coarse pointer), so Frog opens in touch
mode, and asserts the things that make it usable by thumb: a search button in the
header (a pad has X, a thumb had no way in at all before it), the device's own
keyboard instead of the 6×6 dead-key grid, tap-to-filter, tap-a-result-to-play, and
tap-a-console-to-drill-in.

    BASE_URL=http://localhost:5173 python frog_touch.py
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
    # An iPhone context: is_mobile + has_touch, so `(pointer: coarse)` is true and
    # Frog opens in touch mode with no gamepad anywhere. reduced_motion stills the
    # frog-float bob (Frog honours prefers-reduced-motion) so tiles are tap-stable.
    context = browser.new_context(**p.devices["iPhone 13"], reduced_motion="reduce")
    page = context.new_page()
    track = [True]
    page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if (track[0] and m.type == "error") else None)

    page.goto(f"{BASE}/frog", wait_until="networkidle")

    # Boot dismisses on a tap's `click` (its terminal event), so the whole gesture is
    # consumed while the boot is still on top — the dismissing tap can't fall through
    # onto a shelf tile, so this lands on the shelf, never inside a random console.
    boot = page.locator('[data-testid="frog-boot"]')
    for _ in range(4):
        if page.locator('[data-testid="frog-shelf"]').count():
            break
        if boot.count():
            boot.tap()
        page.wait_for_timeout(300)
    page.wait_for_selector('[data-testid="frog-shelf"]', timeout=5000)
    check(True, "boot dismisses to the shelf by tap (no ghost-click drill-in)")

    # Tap a console tile → its game list (drill-in by thumb, no controller).
    page.wait_for_selector('[data-testid="frog-system"]:not([disabled])', timeout=5000)
    page.locator('[data-testid="frog-system"]:not([disabled])').first.tap()
    page.wait_for_selector('[data-testid="frog-games"]', timeout=5000)
    check(True, "tapping a console opens its games")

    # Back to the shelf via the header ✕.
    page.locator('[aria-label="Back to the shelf"]').tap()
    page.wait_for_selector('[data-testid="frog-shelf"]', timeout=5000)

    # The header search button — the touch way in. On a pad this is X; by thumb it's
    # the only door, and it didn't exist before this change.
    page.locator('[aria-label="Search games"]').tap()
    page.wait_for_selector('[data-testid="frog-search"]', timeout=5000)
    check(True, "the header search button opens search by touch")

    # Touch gets the device keyboard, NOT the 6×6 grid.
    check(page.locator('[data-testid="frog-search-input"]').count() == 1, "search shows a native text field on touch")
    check(page.locator('[data-testid="frog-search"] [role="group"]').count() == 0, "the 6x6 grid is not shown on touch")

    # Type into the field → the list narrows, and a result actually matches.
    page.fill('[data-testid="frog-search-input"]', "mario")
    page.wait_for_selector('[data-testid="frog-search-row"]', timeout=5000)
    rows = page.locator('[data-testid="frog-search-row"]')
    n = rows.count()
    check(n > 0, f"typing filters the results ({n})")
    check("mario" in rows.first.inner_text().lower(), "a result contains the typed query")

    # Tap a result → its game page; Play there launches. Stop policing console errors
    # once we leave Frog for the emulator page.
    rows.first.tap()
    page.wait_for_selector('[data-testid="frog-detail"]', timeout=5000)
    check(True, "tapping a result opens its game page")
    track[0] = False
    page.locator('[data-testid="frog-detail-play"]').tap()
    page.wait_for_url("**/library/play**", timeout=8000)
    check("/library/play" in page.url, "Play on the game page launches the game")

    context.close()
    browser.close()

if errors:
    print("\nTOUCH CHECK FAILED:")
    for e in errors:
        print("  - " + e)
    sys.exit(1)
print("\nTOUCH CHECK PASSED")
