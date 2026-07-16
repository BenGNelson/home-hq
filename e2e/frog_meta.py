"""Targeted check for Frog's RICH GAME PAGE (IGDB metadata).

When IGDB has matched a ROM, the game page fills with real data: a screenshot
backdrop behind the title, the summary + genres + rating, and a screenshot strip
you can open fullscreen. When it hasn't (a ROM hack / no key), the page falls
back to the basic cover + name layout. IGDB is external, so the metadata +
screenshot-image endpoints are mocked; everything else hits the real backend.

    BASE_URL=http://localhost:5173 python frog_meta.py
"""
import os
import sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:5173")
errors = []

# A 1x1 PNG, so the mocked screenshot/cover images decode instead of erroring.
_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000d49444154789c6360000002000100ffff03000006000557bffabc00"
    "00000049454e44ae426082"
)

RICH = {
    "matched": True,
    "configured": True,
    "igdb_id": 1234,
    "name": "Test Game",
    "summary": "A sweeping adventure across a haunted archipelago, rendered here "
    "only so the About block has something real to lay out and clamp.",
    "release_year": 1998,
    "rating": 87,
    "developer": "Testtendo",
    "publisher": "Testtendo",
    "genres": ["Adventure", "Puzzle"],
    "cover_image_id": "covtest",
    "screenshot_ids": ["shotA", "shotB", "shotC"],
    "videos": [],
}


def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        errors.append(msg)


def drill_to_game(page):
    """Boot → a system → its list → the first game's page."""
    boot = page.locator('[data-testid="frog-boot"]')
    for _ in range(6):
        if page.locator('[data-testid="frog-shelf"]').count():
            break
        if boot.count():
            boot.click(force=True)
        page.wait_for_timeout(300)
    page.wait_for_selector('[data-testid="frog-shelf"]', timeout=6000)
    page.locator('[data-testid="frog-system"]:not([disabled])').first.click(force=True)
    page.wait_for_selector('[data-testid="frog-row"]', timeout=5000)
    page.locator('[data-testid="frog-row"]').first.click(force=True)
    page.wait_for_selector('[data-testid="frog-detail"]', timeout=5000)


with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(service_workers="block", reduced_motion="reduce")
    matched = {"on": True}  # flipped for the degrade pass

    def meta_route(route):
        route.fulfill(json=RICH if matched["on"] else {"matched": False, "configured": True})

    def shot_route(route):
        route.fulfill(status=200, body=_PNG, content_type="image/png")

    page = context.new_page()
    page.on(
        "console",
        lambda m: errors.append(f"console.{m.type}: {m.text}")
        if (m.type == "error" and "Failed to load resource" not in m.text)
        else None,
    )
    page.route("**/api/library/games/meta*", meta_route)
    page.route("**/api/library/games/screenshot*", shot_route)

    # --- rich pass -----------------------------------------------------------
    page.goto(f"{BASE}/frog", wait_until="networkidle")
    drill_to_game(page)
    check(True, "picking a matched game opens its rich page")

    detail = page.locator('[data-testid="frog-detail"]')
    check("haunted archipelago" in detail.inner_text(), "the summary text renders")
    check("Adventure" in detail.inner_text(), "a genre chip renders")
    check("Testtendo" in detail.inner_text(), "the developer fact renders")
    hero = page.locator('[data-testid="frog-detail-hero"]')
    check(hero.count() == 1, "the screenshots are the hero banner (no separate strip)")
    check(page.locator('[data-testid="frog-detail-shot"]').count() == 0, "the old strip is gone")
    check(page.locator('[data-testid="frog-detail-play"]').count() == 1, "Play is still present")

    # Clicking the hero banner opens the fullscreen gallery; Escape closes it.
    hero.click(force=True)
    page.wait_for_selector('[data-testid="frog-lightbox"]', timeout=4000)
    check(True, "clicking the hero opens the screenshot gallery")
    page.keyboard.press("Escape")
    page.wait_for_selector('[data-testid="frog-lightbox"]', state="detached", timeout=4000)
    check(True, "the gallery closes")

    page.screenshot(path=os.environ.get("SHOT", "/work/frog_meta.png"), full_page=False)

    # --- degrade pass: an unmatched game falls back to the basic page --------
    matched["on"] = False
    page.goto(f"{BASE}/frog", wait_until="networkidle")
    drill_to_game(page)
    check(
        page.locator('[data-testid="frog-detail-hero"]').count() == 0,
        "an unmatched game shows no screenshot hero (basic page)",
    )
    check(
        page.locator('[data-testid="frog-detail-play"]').count() == 1,
        "the unmatched game still shows the basic page (Play present)",
    )

    context.close()
    browser.close()

if errors:
    print("\nMETA CHECK FAILED:")
    for e in errors:
        print("  - " + e)
    sys.exit(1)
print("\nMETA CHECK PASSED")
