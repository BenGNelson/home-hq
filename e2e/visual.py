#!/usr/bin/env python3
"""
Visual-regression capture + diff for Home HQ: drive the real running app in a
headless browser, screenshot every module page, and compare against a stored
baseline so an unintended layout/CSS shift is caught by eye-free pixel diff.

Scope + honesty: this is a LOCAL aid, not a CI gate. The screenshots are taken
from the live app, so they contain real host data (tailnet device names, Plex
titles, catalog rooms) and are gitignored — never committed to the public repo,
and never reproducible on CI's empty stack. It's also coarse: a live dashboard
has genuinely dynamic widgets (graphs, clocks, now-playing, sparklines) that will
differ between any two captures, so a small non-zero diff on those pages is
expected. Animations/transitions/carets are disabled and a per-page tolerance is
applied to keep the signal on real layout changes; treat a flagged page as
"go look", not "definitely broken".

Usage (via scripts/visual.sh, which runs it in the Playwright image):
    scripts/visual.sh                  # capture current + diff against baseline
    UPDATE_BASELINE=1 scripts/visual.sh  # (re)establish the baseline from current

Exits non-zero if any page exceeds the tolerance (baseline mode always exits 0).
"""
import os
import sys

from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("BASE_URL", "http://localhost:5173").rstrip("/")
UPDATE = os.environ.get("UPDATE_BASELINE") == "1"
# Fraction of changed pixels above which a page is flagged. Generous, because the
# live data widgets always move a little; tune down once dynamic regions are masked.
TOLERANCE = float(os.environ.get("VISUAL_TOLERANCE") or "0.02")

ROOT = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(ROOT, "screenshots")
BASELINE = os.path.join(SHOTS, "baseline")
CURRENT = os.path.join(SHOTS, "current")
DIFF = os.path.join(SHOTS, "diff")

# Same set the smoke test drives — keep them in sync.
PAGES = [
    "/dashboard", "/catalog", "/weather", "/plex", "/library", "/containers",
    "/storage", "/network", "/vpn", "/tailscale", "/speedtest", "/uptime",
    "/backups", "/alerts", "/printer", "/solar", "/adguard", "/guide",
    "/readme", "/server-guide",
]

# Kill motion + the blinking caret so two captures of an unchanged page match.
FREEZE_CSS = """
*, *::before, *::after {
  animation-duration: 0s !important; animation-delay: 0s !important;
  transition-duration: 0s !important; transition-delay: 0s !important;
  caret-color: transparent !important;
}
"""


def _name(path):
    return path.strip("/").replace("/", "_") or "root"


def capture(page, path, out_dir):
    page.goto(f"{BASE_URL}{path}", wait_until="domcontentloaded")
    page.get_by_text("Home HQ").first.wait_for(timeout=15000)
    page.add_style_tag(content=FREEZE_CSS)
    page.wait_for_timeout(1200)  # let data resolve + the freeze settle
    out = os.path.join(out_dir, _name(path) + ".png")
    page.screenshot(path=out, full_page=True)
    return out


def diff_ratio(a_path, b_path, diff_out):
    """Fraction of pixels that differ between two screenshots (0..1). Mismatched
    sizes count as a full change (a layout shift resized the page)."""
    a = Image.open(a_path).convert("RGB")
    b = Image.open(b_path).convert("RGB")
    if a.size != b.size:
        return 1.0
    d = ImageChops.difference(a, b)
    bbox = d.getbbox()
    if bbox is None:
        return 0.0
    # Count pixels with any channel delta beyond a small noise threshold.
    gray = d.convert("L").point(lambda v: 255 if v > 12 else 0)
    changed = gray.histogram()[255]  # the white (= changed) bucket
    total = a.size[0] * a.size[1]
    gray.save(diff_out)
    return changed / total


def main():
    for d in (BASELINE, CURRENT, DIFF):
        os.makedirs(d, exist_ok=True)

    flagged, missing_baseline = [], []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        for path in PAGES:
            name = _name(path)
            try:
                cur = capture(page, path, CURRENT)
            except Exception as e:
                print(f"FAIL {path}: capture error: {e}")
                flagged.append(path)
                continue

            if UPDATE:
                Image.open(cur).save(os.path.join(BASELINE, name + ".png"))
                print(f"base {path}")
                continue

            base = os.path.join(BASELINE, name + ".png")
            if not os.path.isfile(base):
                missing_baseline.append(path)
                print(f"??   {path} (no baseline yet)")
                continue
            ratio = diff_ratio(base, cur, os.path.join(DIFF, name + ".png"))
            mark = "ok  " if ratio <= TOLERANCE else "DIFF"
            if ratio > TOLERANCE:
                flagged.append(path)
            print(f"{mark} {path}  ({ratio*100:.2f}% changed)")
        browser.close()

    print()
    if UPDATE:
        print(f"BASELINE established: {len(PAGES)} pages -> {BASELINE}")
        return
    if missing_baseline:
        print(f"note: {len(missing_baseline)} page(s) had no baseline (run UPDATE_BASELINE=1 first)")
    if flagged:
        print(f"VISUAL DIFFS: {len(flagged)} page(s) over {TOLERANCE*100:.1f}% — review e2e/screenshots/diff/")
        for p_ in flagged:
            print(f"   - {p_}")
        sys.exit(1)
    print(f"VISUAL OK: all {len(PAGES)} pages within {TOLERANCE*100:.1f}% of baseline")


if __name__ == "__main__":
    main()
