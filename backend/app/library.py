"""
Library — the owned-content hub's pure logic (no FastAPI here, so it's all
unit-tested like uptime.py / tailscale.py).

The Library is one section per content type. Each section reads from a content
dir (under RAID_MOUNT, so the existing read-only RAID mount serves it — no extra
mount) and recognizes a set of file extensions. Phase 1 ships the **games**
section; comics/books/papers slot in here later by adding a SECTION entry + a
dir setting, with no router changes.

Two things this module owns:
  - listing a section's items (recursive scan, ignoring unknown extensions)
  - safe_path(): resolving a listed item's id back to an absolute path WITHOUT
    letting a crafted id escape the content dir (the security boundary for the
    file-streaming endpoint — see routers/library.py)
"""

import hashlib
import os
import re
import urllib.parse


# Each section: a stable key, display label + icon, "kind" (how the frontend
# opens an item — play vs read), the settings attribute holding its content dir,
# and the recognized extensions mapped to per-item metadata.
#
#   games:  ext -> {"label": <system name>, "core": <EmulatorJS core>}
#
# Reading sections will carry their own per-ext metadata (e.g. the reader engine)
# when they're added; the framework doesn't care what's in the dict.
SECTIONS = [
    {
        "key": "games",
        "label": "Games",
        "icon": "🎮",
        "kind": "play",
        "dir_setting": "games_rom_dir",
        "formats": {
            ".gb": {"label": "Game Boy", "core": "gb"},
            ".gbc": {"label": "Game Boy Color", "core": "gb"},
            ".gba": {"label": "Game Boy Advance", "core": "gba"},
        },
    },
    {
        "key": "papers",
        "label": "Magazines & Papers",
        "icon": "📰",
        "kind": "read",
        "dir_setting": "papers_dir",
        # Plain titles: these are real document names ("Science News - March 25,
        # 2023"), not No-Intro ROM filenames, so don't run the ROM cleanup (which
        # would strip parenthetical info). `reader` tells the frontend which
        # engine renders the item.
        "title_style": "plain",
        "formats": {
            ".pdf": {"label": "PDF", "reader": "pdf"},
        },
    },
]

_SECTIONS_BY_KEY = {s["key"]: s for s in SECTIONS}


def get_section(key):
    """Return the section definition for `key`, or None."""
    return _SECTIONS_BY_KEY.get(key)


def section_dir(section, settings):
    """The configured content dir for a section ('' if unset)."""
    return getattr(settings, section["dir_setting"], "") or ""


def is_configured(section, settings):
    """True when the section's content dir is set and exists on disk."""
    rom_dir = section_dir(section, settings)
    return bool(rom_dir) and os.path.isdir(rom_dir)


def _ext(name):
    return os.path.splitext(name)[1].lower()


# --- display title cleanup (No-Intro filenames → human titles) -------------
# ROM filenames are raw No-Intro style: "Legend of Zelda, The - The Minish Cap
# (USA)". clean_title() turns that into "The Legend of Zelda: The Minish Cap".
# The raw filename stays the item id (for streaming); only the display changes.
_TAG_RE = re.compile(r"\s*[\(\[][^\)\]]*[\)\]]")  # a (...) or [...] tag group
_ARTICLE_RE = re.compile(r"^(.*?),\s+(The|A|An)\b(.*)$", re.IGNORECASE)
_LEADING_ARTICLE_RE = re.compile(r"^(the|a|an)\s+", re.IGNORECASE)


def clean_title(stem):
    """Strip region/version tags, move a trailing article to the front, and turn
    the ' - ' subtitle separator into ': '. Falls back to the raw stem if the
    cleanup empties it (e.g. a name that's all tags)."""
    name = _TAG_RE.sub("", stem).strip()
    m = _ARTICLE_RE.match(name)
    if m:
        name = f"{m.group(2)} {m.group(1)}{m.group(3)}"
    name = name.replace(" - ", ": ")
    name = re.sub(r"\s{2,}", " ", name).strip()
    return name or stem


def display_name(section, item_id):
    """Human title for an item id (its basename stem). A "plain" section keeps
    real document names verbatim; otherwise apply the No-Intro ROM cleanup."""
    stem = os.path.splitext(os.path.basename(item_id))[0]
    return stem if section.get("title_style") == "plain" else clean_title(stem)


def sort_key(title):
    """Alphabetical key that ignores a leading article, so 'The Legend of Zelda'
    files under L, not T."""
    return _LEADING_ARTICLE_RE.sub("", (title or "").lower())


# --- box art (libretro-thumbnails, matched by No-Intro name) ---------------
# The libretro-thumbnails project keys art by the exact No-Intro filename, per
# system. We map our extensions to the right system repo and apply libretro's
# filename character substitution, so a ROM's art URL is derivable from its id.
_THUMBNAIL_REPO_BY_EXT = {
    ".gb": "Nintendo_-_Game_Boy",
    ".gbc": "Nintendo_-_Game_Boy_Color",
    ".gba": "Nintendo_-_Game_Boy_Advance",
}
# libretro replaces these characters in thumbnail filenames with '_'.
_THUMB_ILLEGAL = set('&*/:`<>?\\|')


def thumbnail_url(item_id, kind="Named_Boxarts"):
    """The libretro-thumbnails URL for an item's art (boxart by default), or None
    if the extension has no known system repo. kind ∈ {Named_Boxarts,
    Named_Titles, Named_Snaps}."""
    repo = _THUMBNAIL_REPO_BY_EXT.get(_ext(item_id))
    if not repo:
        return None
    stem = os.path.splitext(os.path.basename(item_id))[0]
    safe = "".join("_" if c in _THUMB_ILLEGAL else c for c in stem)
    return (
        f"https://raw.githubusercontent.com/libretro-thumbnails/{repo}"
        f"/master/{kind}/{urllib.parse.quote(safe)}.png"
    )


def list_items(section, settings):
    """Recursively list a section's items. Each item's `id` is its path relative
    to the content dir (POSIX-style) — safe_path() maps it back with a traversal
    guard. Unknown extensions are ignored. Returns [] if the dir is unset/missing.
    Items are sorted by (label, name) so the UI can group them stably."""
    rom_dir = section_dir(section, settings)
    if not rom_dir or not os.path.isdir(rom_dir):
        return []
    formats = section["formats"]
    root = os.path.realpath(rom_dir)
    items = []
    for dirpath, _dirs, files in os.walk(root):
        for fn in files:
            meta = formats.get(_ext(fn))
            if not meta:
                continue
            full = os.path.join(dirpath, fn)
            try:
                size = os.path.getsize(full)
            except OSError:
                size = None
            items.append(
                {
                    "id": os.path.relpath(full, root).replace(os.sep, "/"),
                    "name": display_name(section, fn),
                    "label": meta.get("label"),
                    "core": meta.get("core"),
                    "reader": meta.get("reader"),
                    "size": size,
                }
            )
    items.sort(key=lambda it: ((it["label"] or "").lower(), sort_key(it["name"])))
    return items


def safe_path(section, settings, item_id):
    """Resolve a listed item's id to an absolute path, but ONLY if it stays
    inside the section's content dir AND has a recognized extension. Returns None
    on any traversal attempt (../, absolute path, symlink escape), unknown
    extension, or a miss. This is the security boundary for file streaming."""
    rom_dir = section_dir(section, settings)
    if not rom_dir or not item_id:
        return None
    if _ext(item_id) not in section["formats"]:
        return None
    root = os.path.realpath(rom_dir)
    target = os.path.realpath(os.path.join(root, item_id))
    # Must be strictly within root (realpath collapses ../ and resolves symlinks,
    # so an escape can't survive this check).
    if target != root and not target.startswith(root + os.sep):
        return None
    if not os.path.isfile(target):
        return None
    return target


# --- save states (server-side, roam across devices) ------------------------
# Each game's states live in a dir keyed by a hash of the game id (so the raw
# ROM filename — with spaces/parens — never becomes a path), and each slot is a
# backend-assigned millisecond timestamp. Both the dir key and the digits-only
# slot are derived/validated here, so a request can't traverse out of the saves
# root.
_SLOT_RE = re.compile(r"^\d+$")


def saves_game_dir(saves_root, game_id):
    """The directory holding a game's save states (keyed by a hash of its id)."""
    key = hashlib.sha1((game_id or "").encode()).hexdigest()
    return os.path.join(saves_root, key)


def save_state_files(saves_root, game_id, slot):
    """(state_path, screenshot_path) for a slot, or (None, None) if the inputs
    are missing/invalid. `slot` must be digits only — that's the traversal
    guard (it can never contain a path separator or '..')."""
    if not saves_root or not game_id or not _SLOT_RE.match(str(slot or "")):
        return None, None
    d = saves_game_dir(saves_root, game_id)
    return os.path.join(d, f"{slot}.state"), os.path.join(d, f"{slot}.png")


def list_save_states(saves_root, game_id):
    """A game's save states, newest first: [{slot, created_ms, has_shot}]. The
    slot id IS the creation time (ms), so no sidecar metadata is needed."""
    if not saves_root or not game_id:
        return []
    d = saves_game_dir(saves_root, game_id)
    if not os.path.isdir(d):
        return []
    states = []
    for fn in os.listdir(d):
        if not fn.endswith(".state"):
            continue
        sid = fn[: -len(".state")]
        if not _SLOT_RE.match(sid):
            continue
        states.append(
            {
                "slot": sid,
                "created_ms": int(sid),
                "has_shot": os.path.isfile(os.path.join(d, f"{sid}.png")),
            }
        )
    states.sort(key=lambda s: s["created_ms"], reverse=True)
    return states


def sections_summary(settings):
    """For the hub landing: every section with whether it's configured and how
    many items it currently holds. Hidden/unconfigured sections still appear with
    configured=False so the hub can show a 'set me up' hint."""
    out = []
    for s in SECTIONS:
        configured = is_configured(s, settings)
        out.append(
            {
                "key": s["key"],
                "label": s["label"],
                "icon": s["icon"],
                "kind": s["kind"],
                "configured": configured,
                "count": len(list_items(s, settings)) if configured else 0,
            }
        )
    return out
