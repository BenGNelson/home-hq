"""Targeted check for Frog's search screen (Phase 2).

Drives the real prod build with the keyboard (Frog has full keyboard parity), so it
runs on desktop Chromium with no gamepad and no touch. Asserts the things the unit
tests can't see: that X/`/` opens a 36-key grid, that typing narrows a live result
list, that dead keys dim, and that Down carries the cursor into the results.

    BASE_URL=http://localhost:5173 python frog_search.py
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
    page = browser.new_page()
    # Track console errors only while we're inside Frog; the player boots a WASM core
    # whose own console noise isn't ours to police here.
    track = [True]
    page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if (track[0] and m.type == "error") else None)

    page.goto(f"{BASE}/frog", wait_until="networkidle")

    # Boot dismisses on the second keypress (first = fast-forward, second = go).
    page.keyboard.press("Enter")
    page.keyboard.press("Enter")
    page.wait_for_selector('[data-testid="frog"]', timeout=5000)

    # `/` opens search from the shelf.
    page.keyboard.press("/")
    page.wait_for_selector('[data-testid="frog-search"]', timeout=5000)
    check(True, "search opens from the shelf")

    # A full 6×6 keyboard grid.
    keys = page.locator('[data-testid="frog-search"] [role="group"] button')
    check(keys.count() == 36, f"keyboard shows 36 keys (got {keys.count()})")

    # Empty query → no results yet.
    check(page.locator('[data-testid="frog-search-row"]').count() == 0, "no results before typing")

    # Type a partial word that spans systems — partial so dimming still discriminates
    # (the letters after "mari" are a real subset, not "everything is a space").
    for ch in "mari":
        page.keyboard.press(ch)
    page.wait_for_selector('[data-testid="frog-search-row"]', timeout=5000)
    rows = page.locator('[data-testid="frog-search-row"]')
    n = rows.count()
    check(n > 0, f"typing 'mari' produces results ({n})")
    first = rows.first.inner_text().lower()
    check("mari" in first, f"a result actually contains the query (got '{first.strip()[:40]}')")

    # Predictive dimming discriminates: SOME keys dim (dead ends) but not all — 'O'
    # (mari→mario) must stay live.
    dim = keys.evaluate_all("els => els.filter(e => Math.abs(parseFloat(getComputedStyle(e).opacity) - 0.35) < 0.01).length")
    check(0 < dim < 36, f"dead keys dim, but not the whole board ({dim}/36 dimmed)")

    # Backspace deletes a character and widens the list — a less specific query can
    # only match more (or the same).
    page.keyboard.press("Backspace")
    page.wait_for_timeout(150)
    widened = page.locator('[data-testid="frog-search-row"]').count()
    check(page.locator('[data-testid="frog-search"]').is_visible(), "still in search after a delete")
    check(widened >= n, f"deleting a character widens the results ({n} -> {widened})")

    # Re-type so we're back to a specific query, then RB (PageDown) is the express
    # lane from the keys into the results.
    page.keyboard.press("i")
    page.keyboard.press("PageDown")
    focused = page.locator('[data-testid="frog-search-row"][data-focused]')
    check(focused.count() == 1, "RB jumps focus into the results list")

    # ...and Enter on a focused result opens its game page; Enter again (Play is the
    # default focus) launches the player. Stop policing console errors once we leave
    # Frog for the emulator page.
    page.keyboard.press("Enter")
    page.wait_for_selector('[data-testid="frog-detail"]', timeout=5000)
    check(True, "Enter on a result opens its game page")
    track[0] = False
    page.keyboard.press("Enter")
    page.wait_for_url("**/library/play**", timeout=8000)
    check("/library/play" in page.url, "Enter on the game page (Play focused) launches the game")

    browser.close()

if errors:
    print("\nSEARCH CHECK FAILED:")
    for e in errors:
        print("  - " + e)
    sys.exit(1)
print("\nSEARCH CHECK PASSED")
