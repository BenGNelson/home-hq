"""Targeted check for Frog's GAME PAGE (the landing screen).

Picking a game now opens its page — cover, Play, favourite, download, and its save
states — instead of launching straight in. This drills into it and drives the parts a
plain screenshot can't: that snapshots list, that delete is guarded by a confirm (and
the confirm can be cancelled), and that a snapshot launches the player WITH its slot.

Save states are server-stored (created in-game), so the save-states API is mocked to
return two snapshots; everything else hits the real backend.

    BASE_URL=http://localhost:5173 python frog_detail.py
"""
import os
import sys
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:5173")
errors = []


def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        errors.append(msg)


SLOT_A = int(time.time() * 1000) - 3_600_000  # an hour ago
SLOT_B = int(time.time() * 1000) - 90_000_000  # a day-ish ago
deletes = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(service_workers="block", reduced_motion="reduce")
    page = context.new_page()
    page.on(
        "console",
        lambda m: errors.append(f"console.{m.type}: {m.text}")
        if (m.type == "error" and "Failed to load resource" not in m.text)
        else None,
    )

    remaining = [SLOT_A, SLOT_B]  # stateful: a DELETE actually removes the slot

    def save_states(route):
        if route.request.method == "DELETE":
            deletes.append(route.request.url)
            for s in (SLOT_A, SLOT_B):
                if f"slot={s}" in route.request.url and s in remaining:
                    remaining.remove(s)
            route.fulfill(status=200, body="{}")
        else:
            route.fulfill(json={"states": [{"slot": s} for s in remaining]})

    page.route("**/api/library/games/save-states*", save_states)

    page.goto(f"{BASE}/frog", wait_until="networkidle")
    boot = page.locator('[data-testid="frog-boot"]')
    for _ in range(6):
        if page.locator('[data-testid="frog-shelf"]').count():
            break
        if boot.count():
            boot.click()
        page.wait_for_timeout(300)
    page.wait_for_selector('[data-testid="frog-shelf"]', timeout=5000)

    # Drill in: a system → its list → a game → its page.
    page.locator('[data-testid="frog-system"]:not([disabled])').first.click(force=True)
    page.wait_for_selector('[data-testid="frog-row"]', timeout=5000)
    page.locator('[data-testid="frog-row"]').first.click(force=True)
    page.wait_for_selector('[data-testid="frog-detail"]', timeout=5000)
    check(True, "picking a game opens its page (not straight into the game)")

    # The page has Play, favourite, download, and the two mocked snapshots.
    for tid, name in [("frog-detail-play", "Play"), ("frog-detail-fav", "favourite"), ("frog-detail-dl", "download")]:
        check(page.locator(f'[data-testid="{tid}"]').count() == 1, f"the page shows the {name} action")
    rows = page.locator('[data-testid="frog-save-row"]')
    check(rows.count() == 2, f"the save states are listed ({rows.count()})")

    # Delete is guarded: request it, then CANCEL — no delete goes out.
    rows.first.locator('[aria-label="Delete this save state"]').click(force=True)
    page.wait_for_selector('[data-testid="frog-confirm"]', timeout=4000)
    check(True, "deleting a save asks to confirm first")
    page.get_by_text("Keep").click()
    page.wait_for_selector('[data-testid="frog-confirm"]', state="detached", timeout=4000)
    check(len(deletes) == 0, "cancelling the confirm deletes nothing")

    # Now confirm it — a DELETE for that slot goes out.
    rows.first.locator('[aria-label="Delete this save state"]').click(force=True)
    page.wait_for_selector('[data-testid="frog-confirm-yes"]', timeout=4000)
    page.locator('[data-testid="frog-confirm-yes"]').click()
    page.wait_for_function("() => !document.querySelector('[data-testid=\"frog-confirm\"]')", timeout=4000)
    check(len(deletes) == 1 and f"slot={SLOT_A}" in deletes[0], "confirming deletes exactly that snapshot")

    # SLOT_A is now really gone (optimistic + server), so the one remaining snapshot is
    # SLOT_B — launching it carries ITS slot into the player (never the deleted one).
    page.locator('[data-testid="frog-save-row"]').first.locator("button").first.click(force=True)
    page.wait_for_url("**/library/play**", timeout=8000)
    check(f"slot={SLOT_B}" in page.url, "launching the remaining snapshot carries its slot (not the deleted one)")

    context.close()
    browser.close()

if errors:
    print("\nDETAIL CHECK FAILED:")
    for e in errors:
        print("  - " + e)
    sys.exit(1)
print("\nDETAIL CHECK PASSED")
