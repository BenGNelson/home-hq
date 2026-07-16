"""Targeted check for Frog's "Wrong game?" re-match control.

When IGDB matches the wrong game, the game page offers a picker to choose the
right IGDB entry (from the shortlisted candidates) or clear it back to the basic
page — controller- and touch-drivable. IGDB is external, so meta / candidates /
the re-match POST are mocked with a stateful backend: picking an option flips
which game the meta endpoint then returns.

    BASE_URL=http://localhost:5173 python frog_rematch.py
"""
import json
import os
import re
import sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:5173")
errors = []

_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000d49444154789c6360000002000100ffff03000006000557bffabc00"
    "00000049454e44ae426082"
)
NAMES = {100: "First Game", 200: "Second Game"}
CANDIDATES = [
    {"id": 100, "name": "First Game", "release_year": 1990},
    {"id": 200, "name": "Second Game", "release_year": 1995},
]
state = {"igdb_id": 100, "matched": True, "fail": False}
posts = []


def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        errors.append(msg)


def meta_body():
    if not state["matched"]:
        return {"matched": False, "configured": True, "can_rematch": True}
    return {
        "matched": True, "configured": True, "can_rematch": True,
        "igdb_id": state["igdb_id"], "name": NAMES[state["igdb_id"]],
        # The page title is the ROM's own name; the metadata (this summary) is what
        # a re-match changes — so the summary carries the id for the assertions.
        "summary": f"Summary for {NAMES[state['igdb_id']]}, mocked for the re-match check.",
        "release_year": 1990, "rating": 80, "developer": "Dev", "publisher": "Pub",
        "genres": ["Adventure"], "cover_image_id": "cov",
        "screenshot_ids": ["s1", "s2"], "videos": [],
    }


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(service_workers="block", reduced_motion="reduce")
    page = ctx.new_page()
    page.on(
        "console",
        lambda m: errors.append(f"console.{m.type}: {m.text}")
        if (m.type == "error" and "Failed to load resource" not in m.text)
        else None,
    )

    def meta_route(route):
        if route.request.method == "POST":
            body = json.loads(route.request.post_data or "{}")
            posts.append(body)
            if state["fail"]:
                route.fulfill(status=502, json={})
                return
            if body.get("igdb_id") is None:
                state["matched"] = False
            else:
                state["igdb_id"] = body["igdb_id"]
                state["matched"] = True
            route.fulfill(json={"matched": state["matched"]})
        else:
            route.fulfill(json=meta_body())

    # Regexes so the patterns don't overlap: meta(?…|end) is the GET+POST meta
    # endpoint (NOT /meta/candidates or /meta/status).
    page.route(re.compile(r"/api/library/games/meta(\?|$)"), meta_route)
    page.route(
        re.compile(r"/api/library/games/meta/candidates"),
        lambda r: r.fulfill(json={"candidates": CANDIDATES, "current": state["igdb_id"]}),
    )
    page.route(re.compile(r"/api/library/games/screenshot"), lambda r: r.fulfill(status=200, body=_PNG, content_type="image/png"))

    page.goto(f"{BASE}/frog", wait_until="networkidle")
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

    detail = page.locator('[data-testid="frog-detail"]')
    check("First Game" in detail.inner_text(), "the page shows the (wrongly) matched game")
    fix = page.locator('[data-testid="frog-detail-fix"]')
    check(fix.count() == 1, "a matched game offers the 'Wrong game?' control")

    # Open the picker and choose the OTHER candidate.
    fix.click(force=True)
    page.wait_for_selector('[data-testid="frog-rematch"]', timeout=4000)
    opts = page.locator('[data-testid="frog-rematch-option"]')
    check(opts.count() == 2, f"the picker lists the candidates ({opts.count()})")
    page.get_by_test_id("frog-rematch-option").filter(has_text="Second Game").click(force=True)
    page.wait_for_selector('[data-testid="frog-rematch"]', state="detached", timeout=4000)
    check(len(posts) == 1 and posts[-1].get("igdb_id") == 200, "picking re-matches to that IGDB id")
    page.wait_for_function("() => document.querySelector('[data-testid=\"frog-detail\"]').innerText.includes('Second Game')", timeout=4000)
    check(True, "the page redraws as the re-matched game")

    # A failing re-match (server 502) keeps the picker open with an error, not a
    # silent close that leaves the user thinking it worked.
    state["fail"] = True
    page.get_by_test_id("frog-detail-fix").click(force=True)
    page.wait_for_selector('[data-testid="frog-rematch"]', timeout=4000)
    page.get_by_test_id("frog-rematch-option").filter(has_text="First Game").click(force=True)
    page.wait_for_selector('[data-testid="frog-rematch-error"]', timeout=4000)
    check(page.locator('[data-testid="frog-rematch"]').count() == 1, "a failed re-match keeps the picker open with an error")
    state["fail"] = False
    page.get_by_role("button", name="Cancel").click(force=True)
    page.wait_for_selector('[data-testid="frog-rematch"]', state="detached", timeout=4000)

    # Now clear it → the basic page (no hero), but the fix control stays.
    page.get_by_test_id("frog-detail-fix").click(force=True)
    page.wait_for_selector('[data-testid="frog-rematch"]', timeout=4000)
    page.get_by_test_id("frog-rematch-clear").click(force=True)
    page.wait_for_function("() => !document.querySelector('[data-testid=\"frog-detail-hero\"]')", timeout=4000)
    check(posts[-1].get("igdb_id") is None, "Clear sends a null re-match")
    check(page.locator('[data-testid="frog-detail-play"]').count() == 1, "cleared game shows the basic page")
    check(page.locator('[data-testid="frog-detail-fix"]').count() == 1, "the fix control stays (not a one-way trap)")

    ctx.close()
    browser.close()

if errors:
    print("\nREMATCH CHECK FAILED:")
    for e in errors:
        print("  - " + e)
    sys.exit(1)
print("\nREMATCH CHECK PASSED")
