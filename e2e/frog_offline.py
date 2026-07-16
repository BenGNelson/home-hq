"""Targeted check for Frog OFFLINE (Phase 2 — the airplane-mode path).

Frog is built from the library API. Offline that API is gone, so Frog falls back to
the games you've DOWNLOADED (the on-device IndexedDB manifest) — the same fallback the
rest of the Library uses. This seeds one downloaded game, forces the app offline (the
/api/health probe fails), and asserts Frog degrades to a local-first shelf: an
"Offline" chip, the downloaded game's system enabled, and the game reachable.

Then it RECONNECTS (health + library come back) and asserts Frog swaps the full
library in by itself — the chip clears and games that weren't downloaded appear —
proving the item source prefers the live API and re-fetches on the offline→online edge
(no polling), which was the crux of the review that shaped this design.

    BASE_URL=http://localhost:5173 python frog_offline.py
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


SEED = """
async () => {
  const put = (entry) => new Promise((resolve, reject) => {
    const req = indexedDB.open('home-hq-offline', 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('downloads')) db.createObjectStore('downloads', { keyPath: 'key' })
    }
    req.onsuccess = () => {
      const db = req.result
      const t = db.transaction('downloads', 'readwrite')
      t.objectStore('downloads').put(entry)
      t.oncomplete = () => { db.close(); resolve() }
      t.onerror = () => reject(t.error)
    }
    req.onerror = () => reject(req.error)
  })
  await put({ key: 'games:demo1', section: 'games', id: 'demo1',
             name: 'Offline Test Quest', core: 'gba', urls: [], bytes: 123, date: Date.now() })
  await put({ key: 'books:ignore', section: 'books', id: 'ignore', name: 'Not a game', urls: [], bytes: 1, date: Date.now() })
}
"""

# What the server hands back once we're "reconnected": the downloaded game PLUS games
# that were never downloaded (a different system), so their appearance proves the full
# library swapped in rather than the offline manifest lingering.
ONLINE_GAMES = {
    "configured": True,
    "count": 3,
    "items": [
        {"id": "demo1", "name": "Offline Test Quest", "core": "gba", "label": "Game Boy Advance"},
        {"id": "onl1", "name": "Online Only Adventure", "core": "snes", "label": "Super Nintendo"},
        {"id": "onl2", "name": "Second Online Game", "core": "snes", "label": "Super Nintendo"},
    ],
}

with sync_playwright() as p:
    browser = p.chromium.launch()
    # Block the service worker: on the prod PWA the SW forwards /api/health to the
    # live backend (which is up), so route interception never sees it and the app
    # never goes "offline". Blocking it sends every fetch through page.route.
    context = browser.new_context(service_workers="block")
    page = context.new_page()
    errors_on = [True]

    # Simulating offline means the browser logs a "Failed to load resource" for every
    # fetch we block. Those are the CONDITION under test, not a regression — the app is
    # supposed to weather them. A genuine app error (an uncaught throw, a React error)
    # reads differently, so only those count.
    def on_console(m):
        if errors_on[0] and m.type == "error" and "Failed to load resource" not in m.text:
            errors.append(f"console.{m.type}: {m.text}")

    page.on("console", on_console)

    # A stateful network: `net["up"]` flips from offline to online mid-test.
    net = {"up": False}

    def health(route):
        route.fulfill(status=200, body="ok") if net["up"] else route.fulfill(status=503, body="down")

    def games(route):
        route.fulfill(json=ONLINE_GAMES) if net["up"] else route.abort()

    page.route("**/api/health*", health)
    page.route("**/api/library/games*", games)

    # Land once to get an origin, seed the manifest, then load Frog offline.
    page.goto(f"{BASE}/frog", wait_until="domcontentloaded")
    page.evaluate(SEED)
    page.reload(wait_until="domcontentloaded")

    # Dismiss the boot by clicking it (dismisses on the click's terminal event).
    boot = page.locator('[data-testid="frog-boot"]')
    for _ in range(5):
        if page.locator('[data-testid="frog-shelf"]').count():
            break
        if boot.count():
            boot.click()
        page.wait_for_timeout(300)
    page.wait_for_selector('[data-testid="frog-shelf"]', timeout=5000)
    check(True, "Frog boots offline (no library API) to the shelf")

    # The offline chip tells you why the shelf is sparse.
    page.wait_for_selector('[data-testid="frog-offline"]', timeout=5000)
    check(page.locator('[data-testid="frog-offline"]').count() == 1, "the Offline chip is shown")

    # The seeded GBA download makes exactly one system enabled; the rest are empty.
    page.wait_for_selector('[data-testid="frog-system"]:not([disabled])', timeout=5000)
    enabled = page.locator('[data-testid="frog-system"]:not([disabled])')
    check(enabled.count() == 1, f"exactly one system is playable offline (got {enabled.count()})")

    # Drill in → the downloaded game is there; then back out to the shelf.
    enabled.first.click()
    page.wait_for_selector('[data-testid="frog-games"]', timeout=5000)
    body = page.locator('[data-testid="frog-games"]').inner_text().lower()
    check("offline test quest" in body, "the downloaded game is listed in its system")
    page.locator('[aria-label="Back to the shelf"]').click()
    page.wait_for_selector('[data-testid="frog-shelf"]', timeout=5000)

    # RECONNECT: the server comes back. The window 'online' event kicks a health
    # re-probe (now 200), online flips true, and the offline→online edge re-fetches the
    # library — no navigation, no manual reload.
    net["up"] = True
    page.evaluate("() => window.dispatchEvent(new Event('online'))")
    # The full library swaps in: two SNES games that were never downloaded appear, and
    # the Offline chip clears.
    page.wait_for_selector('[data-testid="frog-offline"]', state="detached", timeout=8000)
    check(page.locator('[data-testid="frog-offline"]').count() == 0, "the Offline chip clears on reconnect")
    page.wait_for_function(
        """() => document.querySelectorAll('[data-testid="frog-system"]:not([disabled])').length === 2""",
        timeout=8000,
    )
    check(page.locator('[data-testid="frog-system"]:not([disabled])').count() == 2,
          "the full library swaps in (the online-only system now shows)")

    # And the online-only game is reachable — proving it's the live library, not the
    # lingering manifest.
    page.locator('[data-testid="frog-system"]:not([disabled])').last.click()
    page.wait_for_selector('[data-testid="frog-games"]', timeout=5000)
    online_body = page.locator('[data-testid="frog-games"]').inner_text().lower()
    check("online only adventure" in online_body, "a never-downloaded game is now listed")

    context.close()
    browser.close()

if errors:
    print("\nOFFLINE CHECK FAILED:")
    for e in errors:
        print("  - " + e)
    sys.exit(1)
print("\nOFFLINE CHECK PASSED")
