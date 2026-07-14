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
        # `core` is the EmulatorJS system name (it auto-selects the libretro core
        # — see src/emulator.js's default-core table; the frontend's LIBRETRO_CORE
        # mirrors the defaults for offline asset caching). All of these are 8/16-bit
        # 2D systems: the cores run full-speed in WASM on a phone and map cleanly
        # to the dpad + face-button touch overlay. Emulation is entirely client-
        # side — the backend only lists + range-streams the ROM bytes, so adding a
        # system adds zero server load.
        "formats": {
            ".gb": {"label": "Game Boy", "core": "gb"},
            # GBC routed through mGBA (the `gba` core) instead of gambatte: the
            # gambatte core crashes GBC games on iOS Safari (~15s in), while mGBA
            # — which also emulates GB/GBC — is proven stable for GBA on the same
            # device. mGBA auto-detects the GBC ROM.
            ".gbc": {"label": "Game Boy Color", "core": "gba"},
            ".gba": {"label": "Game Boy Advance", "core": "gba"},
            ".nes": {"label": "NES", "core": "nes"},
            # SNES: both .sfc (the native ext) and the older .smc dumper format.
            ".sfc": {"label": "Super Nintendo", "core": "snes"},
            ".smc": {"label": "Super Nintendo", "core": "snes"},
            # Sega Genesis / Mega Drive — the common cartridge dump extensions.
            # NOT .bin: it's ambiguous (Atari 2600, PS1 disc tracks also use it),
            # and the scan maps one extension to exactly one system.
            ".md": {"label": "Sega Genesis", "core": "segaMD"},
            ".gen": {"label": "Sega Genesis", "core": "segaMD"},
            ".smd": {"label": "Sega Genesis", "core": "segaMD"},
            ".sms": {"label": "Sega Master System", "core": "segaMS"},
            # Game Gear shares the Master System era + the genesis_plus_gx core;
            # essentially free to include alongside the Master System.
            ".gg": {"label": "Sega Game Gear", "core": "segaGG"},
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
    {
        "key": "books",
        "label": "Books",
        "icon": "📖",
        "kind": "read",
        "dir_setting": "books_dir",
        # Real book titles, not No-Intro ROM names → keep them verbatim. EPUB /
        # MOBI / AZW3 render client-side via foliate-js (the `epub` reader hint);
        # a PDF book falls back to the PDF.js reader, same as Papers.
        "title_style": "plain",
        "formats": {
            ".epub": {"label": "EPUB", "reader": "epub"},
            ".mobi": {"label": "MOBI", "reader": "epub"},
            ".azw3": {"label": "AZW3", "reader": "epub"},
            ".prc": {"label": "MOBI", "reader": "epub"},  # Mobipocket — foliate reads it
            ".pdf": {"label": "PDF", "reader": "pdf"},
        },
    },
    {
        "key": "textbooks",
        "label": "Textbooks",
        "icon": "📚",
        "kind": "read",
        "dir_setting": "textbooks_dir",
        # Reference / informational books (programming, cooking, game design,
        # music theory, RPG, general reference) — the same file types as Books,
        # opened by the same readers (EPUB/MOBI/AZW3 → foliate; PDF → PDF.js).
        # Unlike the (huge, flat, search-first) Books section, Textbooks is
        # organized into sub-category folders on disk, so it browses as a folder
        # tree (same shape as Comics). The host-side inbox sorter is what files
        # new books here vs into fiction; HQ only reads.
        "title_style": "plain",
        "formats": {
            ".pdf": {"label": "PDF", "reader": "pdf"},
            ".epub": {"label": "EPUB", "reader": "epub"},
            ".mobi": {"label": "MOBI", "reader": "epub"},
            ".azw3": {"label": "AZW3", "reader": "epub"},
            ".prc": {"label": "MOBI", "reader": "epub"},
        },
    },
    {
        "key": "audiobooks",
        "label": "Audiobooks",
        "icon": "🎧",
        "kind": "listen",
        "dir_setting": "audiobooks_dir",
        # A book = a folder of ordered audio files (its chapters). Real names kept
        # verbatim. Streamed by the existing range-capable /library/file; the
        # browser <audio> element + Media Session drive playback. (Audible .aa/.aax
        # are DRM and won't play in a browser, so they're not recognized.)
        "title_style": "plain",
        "formats": {
            ".mp3": {"label": "Audio"},
            ".m4a": {"label": "Audio"},
            ".m4b": {"label": "Audio"},
            ".aac": {"label": "Audio"},
            ".ogg": {"label": "Audio"},
            ".opus": {"label": "Audio"},
            ".flac": {"label": "Audio"},
            ".wav": {"label": "Audio"},
        },
    },
    {
        "key": "comics",
        "label": "Comics",
        "icon": "🦸",
        "kind": "read",
        "dir_setting": "comics_dir",
        # Real titles, kept verbatim. CBZ/CBR/CB7 are zip/rar/7z archives of page
        # images, read page-by-page by the `comic` reader (the backend extracts +
        # downscales each page — see app/comics.py); a bare .rar is treated the
        # same (comic dumps often use it).
        "title_style": "plain",
        "formats": {
            ".cbz": {"label": "Comic", "reader": "comic"},
            ".cbr": {"label": "Comic", "reader": "comic"},
            ".cb7": {"label": "Comic", "reader": "comic"},
            ".rar": {"label": "Comic", "reader": "comic"},
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


def item_reader(section, item_id):
    """The reader engine for an item id (e.g. 'pdf' or 'epub'), from its
    extension's format metadata — or None for a play-kind / unknown item."""
    return section["formats"].get(_ext(item_id), {}).get("reader")


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
    ".nes": "Nintendo_-_Nintendo_Entertainment_System",
    ".sfc": "Nintendo_-_Super_Nintendo_Entertainment_System",
    ".smc": "Nintendo_-_Super_Nintendo_Entertainment_System",
    ".md": "Sega_-_Mega_Drive_-_Genesis",
    ".gen": "Sega_-_Mega_Drive_-_Genesis",
    ".smd": "Sega_-_Mega_Drive_-_Genesis",
    ".sms": "Sega_-_Master_System_-_Mark_III",
    ".gg": "Sega_-_Game_Gear",
}
# libretro replaces these characters in thumbnail filenames with '_'.
_THUMB_ILLEGAL = set('&*/:`<>?\\|')


def thumbnail_repo(item_id):
    """The libretro-thumbnails system repo for an item, or None if its extension
    has no known system."""
    return _THUMBNAIL_REPO_BY_EXT.get(_ext(item_id))


def boxart_url(repo, name, kind="Named_Boxarts"):
    """The libretro-thumbnails URL for an explicit boxart `name` (no extension) in
    a system `repo`. kind ∈ {Named_Boxarts, Named_Titles, Named_Snaps}."""
    safe = "".join("_" if c in _THUMB_ILLEGAL else c for c in name)
    return (
        f"https://raw.githubusercontent.com/libretro-thumbnails/{repo}"
        f"/master/{kind}/{urllib.parse.quote(safe)}.png"
    )


def thumbnail_url(item_id, kind="Named_Boxarts"):
    """The libretro-thumbnails URL for an item's art by its EXACT No-Intro name, or
    None if the extension has no known system repo."""
    repo = thumbnail_repo(item_id)
    if not repo:
        return None
    stem = os.path.splitext(os.path.basename(item_id))[0]
    return boxart_url(repo, stem, kind)


def boxart_tree_url(repo):
    """The GitHub API URL listing a system repo's file tree (used to build the
    base-title fallback index when an exact-name match misses)."""
    return f"https://api.github.com/repos/libretro-thumbnails/{repo}/git/trees/master?recursive=1"


# --- base-title fallback (No-Intro tags ↔ libretro variants) ----------------
# A ROM's No-Intro name often differs from libretro-thumbnails only in its
# trailing (region)/(version) tags — e.g. our "Golden Axe (USA, Europe, Brazil)"
# is filed by libretro as "Golden Axe (USA, Europe, Brazil) (En)". The base title
# (everything before the first " (" or " [" tag) matches, so when the exact name
# 404s we fall back to matching on the base title and picking the best regional
# variant from the system's boxart listing.
_BASE_TITLE_RE = re.compile(r"\s*[\(\[].*$")  # strip from the first ( or [ tag
# region/version preference when several variants share a base title
_BOXART_REGION_PREF = ("usa", "world", "europe", "japan")


def base_title(name):
    """The tag-free base of a ROM/boxart name, lowercased, for fuzzy matching:
    'Golden Axe (USA, Europe, Brazil) (En)' → 'golden axe'. Also drops a No-Intro
    '~' alternate title ('A ~ B' → 'a') so an alt-named ROM still matches."""
    stripped = _BASE_TITLE_RE.sub("", name).strip()
    return stripped.split(" ~ ")[0].strip().lower()


def pick_boxart(stem, names):
    """From libretro boxart `names` (bare, no extension), pick the best match for a
    ROM `stem` by base title — preferring USA → World → Europe → Japan, then the
    shortest name. Returns the chosen name, or None if no base title matches."""
    want = base_title(stem)
    if not want:
        return None
    candidates = [n for n in names if base_title(n) == want]
    if not candidates:
        return None

    def rank(n):
        low = n.lower()
        for i, region in enumerate(_BOXART_REGION_PREF):
            if region in low:
                return i
        return len(_BOXART_REGION_PREF)

    return min(candidates, key=lambda n: (rank(n), len(n)))


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
            # Hidden files are never content. A Mac copying over SMB leaves an
            # AppleDouble sidecar ("._Game.gba") next to every real file — same
            # extension, so it would otherwise scan in as a phantom item.
            if fn.startswith("."):
                continue
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


def safe_dir(section, settings, path):
    """Resolve a folder path within a section to an absolute dir, with the same
    traversal guard as safe_path (but for a directory, not a file). Returns None
    on any escape attempt or if it isn't an existing directory."""
    rom_dir = section_dir(section, settings)
    if not rom_dir or not path:
        return None
    root = os.path.realpath(rom_dir)
    target = os.path.realpath(os.path.join(root, path))
    if target != root and not target.startswith(root + os.sep):
        return None
    return target if os.path.isdir(target) else None


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


def sram_file(saves_root, game_id):
    """Path to a game's in-game battery save (SRAM / .sav) — ONE per game (the
    game's own save, distinct from snapshot save states). None if inputs missing.
    Lives in the same per-game dir, keyed by a hash of the id (no traversal)."""
    if not saves_root or not game_id:
        return None
    return os.path.join(saves_game_dir(saves_root, game_id), "sram.bin")


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


# How many cover refs to surface per section for the hub's peek tiles. A handful
# is enough to dress a card; the frontend renders the first few and any that have
# no cover fall back to an icon tile.
_PREVIEW_COUNT = 6


def _audiobook_folders(items):
    """The distinct book folders of audiobook chapter items, in listing order. An
    audiobook is the folder that directly holds its chapter files, so a book = a
    chapter's parent dir (`rsplit`, not the top path segment) — that handles books
    nested under a collection/author dir, and it's exactly what the audiobook
    cover endpoint keys on. Dedup via a set so this stays O(n) on the hot
    /library hub poll."""
    seen = set()
    folders = []
    for it in items:
        cid = it.get("id") or ""
        folder = cid.rsplit("/", 1)[0] if "/" in cid else ""
        if folder and folder not in seen:
            seen.add(folder)
            folders.append(folder)
    return folders


def _section_units(section, items):
    """(count, preview-refs) for a section. Most sections count items directly and
    preview their first few ids. Audiobooks are the exception: their unit is the
    book *folder* (not each chapter file), and the cover endpoint keys on the
    folder path — so both the count and the preview refs come from the folders."""
    if section["key"] == "audiobooks":
        folders = _audiobook_folders(items)
        return len(folders), folders[:_PREVIEW_COUNT]
    refs = [it["id"] for it in items[:_PREVIEW_COUNT] if it.get("id")]
    return len(items), refs


def inbox_status(settings):
    """Read-only view of the host-side sorter's drop zone + review pile, for the
    Library hub's status card. HQ never moves files (the RAID mount is read-only,
    by design) — this only reports what's waiting in the inbox and what the sorter
    parked in _needs_review/ (with the reason from each item's sidecar).

    Returns {configured, inbox_count, review_count, inbox: [...names], review:
    [{name, reason}]}. `configured` is False when neither dir is set, so the card
    can hide."""
    inbox_dir = getattr(settings, "inbox_dir", "") or ""
    review_dir = getattr(settings, "needs_review_dir", "") or ""
    if not inbox_dir and not review_dir:
        return {"configured": False, "inbox_count": 0, "review_count": 0,
                "inbox": [], "review": []}

    inbox = _list_inbox_entries(inbox_dir)
    review = []
    if review_dir and os.path.isdir(review_dir):
        for name in sorted(os.listdir(review_dir)):
            if name.startswith(".") or name.endswith((".review.json", ".part")):
                continue
            review.append({"name": name, "reason": _review_reason(review_dir, name)})
    return {
        "configured": True,
        "inbox_count": len(inbox),
        "review_count": len(review),
        "inbox": inbox,
        "review": review,
    }


def _list_inbox_entries(inbox_dir):
    """Top-level inbox entry names (files + folders), skipping hidden files and
    the sorter's own scratch files."""
    if not inbox_dir or not os.path.isdir(inbox_dir):
        return []
    return [
        name
        for name in sorted(os.listdir(inbox_dir))
        if not name.startswith(".") and not name.endswith((".review.json", ".part"))
    ]


def _review_reason(review_dir, name):
    """The sorter's reason for parking `name`, from its '<name>.review.json'
    sidecar — or None if there isn't one."""
    sidecar = os.path.join(review_dir, name + ".review.json")
    try:
        with open(sidecar) as fh:
            import json

            return json.load(fh).get("reason")
    except (OSError, ValueError):
        return None


def sections_summary(settings):
    """For the hub landing: every section with whether it's configured, how many
    items it currently holds, and a few cover refs (`preview`) so the hub can show
    real art in one fetch. Hidden/unconfigured sections still appear with
    configured=False so the hub can show a 'set me up' hint."""
    out = []
    for s in SECTIONS:
        configured = is_configured(s, settings)
        # One listing pass feeds both the count and the preview refs.
        items = list_items(s, settings) if configured else []
        count, preview = _section_units(s, items)
        out.append(
            {
                "key": s["key"],
                "label": s["label"],
                "icon": s["icon"],
                "kind": s["kind"],
                "configured": configured,
                "count": count,
                "preview": preview,
            }
        )
    return out
