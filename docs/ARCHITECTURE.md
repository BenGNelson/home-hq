# Home HQ — Architecture

A self-hosted personal platform: a small **shell** (nav + layout) that
**modules** plug into, grown over time. The platform is the project; it never
"finishes." Each module is a self-contained feature that hangs off the shell.

Everything runs in Docker and is reproducible from this repo. No host-specific
values live in the code — they come from the environment — so the repo is safe
to publish and anyone can clone and run it against their own machine.

---

## High-level shape

```
┌─────────────┐     HTTP/JSON      ┌──────────────┐
│  Frontend   │  ───────────────▶  │   Backend    │
│  (shell +   │  ◀───────────────  │   /api/*     │
│   modules)  │     live status    └──────┬───────┘
└─────────────┘                           │
                    reads from:           │
        ┌───────────┬───────────┬─────────┼──────────┬──────────────┐
        ▼           ▼           ▼         ▼          ▼              ▼
  Docker socket  system     host /proc  Plex API  SQLite cache  (more later)
                  stats     (net counters)        (media browser)
```

- **Frontend** — React + Vite + Tailwind. Renders the module nav + pages, polls
  the API for live status. Dev: Vite dev server with HMR, proxying `/api` to the
  backend. Production (later): static build behind Nginx.
- **Backend** — exposes `/api/*`; gathers data from Docker, the system, host
  `/proc` (network counters), and Plex. Every host-specific target comes from
  config, never hardcoded.
- **Data** — mostly live/ephemeral. The one exception is a **SQLite cache** for
  the Plex library browser (the first stateful feature). Reach for a bigger store
  only when a module needs more than a rebuildable cache.

---

## Backend design

FastAPI app. One concern per file:

```
backend/app/
  main.py            # creates the app, CORS, mounts routers, inits the DB
  config.py          # pydantic-settings: reads ALL host values from env
  db.py              # SQLite cache (media browser): schema, migrations, helpers
  routers/
    system.py        # /api/system
    disk.py          # /api/disk
    containers.py    # /api/containers + /api/containers/{name} + /{name}/logs
    network.py       # /api/network  (host interface counters)
    vpn.py           # /api/vpn      (VPN egress leak check, from a host timer's JSON)
    tailscale.py     # /api/tailscale (tailnet device list, from a host timer's JSON)
    uptime.py        # /api/uptime   (service availability, from a host prober's JSON)
    ha.py            # /api/ha       (curated Home Assistant entities, from a host timer's JSON)
    diskio.py        # /api/diskio   (per-disk I/O counters from /proc/diskstats)
    raid.py          # /api/raid     (software-RAID state from /proc/mdstat)
    smart.py         # /api/smart    (per-drive SMART, from a host timer's JSON)
    storage.py       # /api/storage/trends  (SMART + capacity history)
    printer.py       # /api/printer  (cached snapshot from the MQTT client)
    plex.py          # /api/plex + library browser endpoints
    library.py       # /api/library  (owned-content hub: list + range-stream files)
  library.py         # pure: section framework, listing, the path-traversal guard
  printer.py         # persistent MQTT client: telemetry parser + control commands
  camera.py          # on-demand chamber-camera reader (JPEG over TLS :6000)
  storage_history.py # background sampler: daily SMART+capacity → SQLite; projection
  plex_history.py    # background sampler: Plex activity → SQLite; insights stats
  space_usage.py     # background daily `du` of the mount → cached breakdown
```

Each feature is an `APIRouter` included by `main.py` under the `/api` prefix.
Adding a module = add a router file and one `include_router` line.

**Interactive API docs.** FastAPI generates an OpenAPI schema from the routes
automatically; the docs are served *under `/api`* (so they ride the same nginx
reverse-proxy as the API and need no extra proxy rule):

- `/api/docs` — Swagger UI (interactive, try-it-out)
- `/api/redoc` — ReDoc (reference layout)
- `/api/openapi.json` — the raw schema

Each `include_router` passes a `tags=[...]` so the endpoints group by domain
(System / Storage / Network / Plex / Printer / Alerts / Docs) instead of one
flat list; the tag descriptions live in `main.py`'s `tags_metadata`. The
sidebar's Docs group has an "API" link to `/api/docs`.

**Typed responses (incremental).** Most endpoints return plain dicts (and many
*degrade* to `{available: false}` when a source is down), so the schema would
otherwise show them as generic objects. Endpoints get a Pydantic `response_model`
for a typed, described schema. Two patterns, both keeping the data unchanged:

- **Degrading endpoints** (those that drop to a smaller `{available: false}` /
  `{found: false}` shape — disk, network, diskio, raid, backups, drive-watchdog,
  vpn, tailscale, smart, containers, storage/space, printer, and the plex
  status/now-playing/recently-added/libraries) use a **superset** model:
  `available` plus every data field as `Optional`, paired with
  `response_model_exclude_none=True`. A bare `response_model` would *filter out*
  any field not in the model; the superset lists them all, and `exclude_none`
  then drops the ones that are null in a given response — so both the lean
  failure shape and the full success shape go over the wire exactly as before.
  The only on-the-wire change vs. an untyped dict is that an explicitly-`null`
  field is now *omitted*, which every consumer already treats identically (it
  gates each field on truthy / `!= null`).
- **Always-full endpoints** (system, health, storage/trends, printer/history,
  plex/insights, plex/sync/status, alerts, readme, server-guide) use a plain
  model **without** `exclude_none`, so any legitimately-null field (e.g. a
  metric point's `value`, a `success_rate` with no prints yet) stays present and
  byte-identical.

Deliberately left untyped: the endpoints that return raw `dict(r)` SQLite rows
(`/plex/library/{key}/items`, `/plex/show/{key}/episodes`, `/plex/item/{key}`,
`/plex/export`) — their columns are dynamic and a model would silently filter
one — and the non-JSON responses (chamber camera JPEG/MJPEG, Plex art, README
image assets). Verification for every typed endpoint: capture the live response,
add the model, diff the response key-paths — the only allowed change is dropped
`null` keys, never an added or renamed field.

### Endpoints

| Endpoint | Returns | How |
|---|---|---|
| `GET /api/health` | liveness + server name | trivial |
| `GET /api/system` | CPU %, RAM used/total, uptime | `psutil` |
| `GET /api/disk` | total/used/free/% for the storage mount | `psutil.disk_usage` |
| `GET /api/containers` | name, status, image, uptime per container | Docker SDK → read-only socket proxy |
| `GET /api/containers/{name}` | one container's live stats (cpu/mem/net) | Docker SDK → read-only socket proxy |
| `GET /api/containers/{name}/logs?tail=N` | recent stdout/stderr (tail-limited, timestamped) | Docker SDK → read-only socket proxy; honors `CONTAINER_LOGS_EXCLUDE` |
| `GET /api/network` | per-interface byte counters | reads host `/proc/1/net/dev` |
| `GET /api/vpn` | VPN egress leak check (exit IP vs home IP) | reads a host timer's `vpn.json` |
| `GET /api/tailscale` | tailnet devices (online state, exit node, last seen) | reads a host timer's `tailscale.json` |
| `GET /api/uptime` | per-service availability — status, uptime % (24h/7d), latency | reads a host prober's `uptime.json` |
| `GET /api/ha` | curated Home Assistant entities (glance + deep-link), self-hides when unconfigured | reads a host timer's `ha.json` |
| `GET /api/storage/db` | SQLite file size + per-table row counts (growth visibility) | stats the DB file + `COUNT(*)` per table |
| `GET /api/diskio` | per-disk cumulative read/write bytes (rates computed client-side) | parses host `/proc/diskstats` |
| `GET /api/raid` | software-RAID array state (healthy/degraded, rebuild %) | parses host `/proc/mdstat` |
| `GET /api/smart` | per-drive SMART health; role-tagged (raid/system/other) | reads a host timer's `smart.json` |
| `GET /api/smart/{name}/attributes` | one drive's full SMART attribute table (or NVMe health log), on demand | reads `smart.json` (kept out of the polled list) |
| `GET /api/drive-watchdog` | watched external drive's health + recent recovery events | reads the host watchdog's state JSON + its append-only event log (fills the SMART gap for USB enclosures) |
| `GET /api/storage/trends` | per-drive SMART history + capacity series + days-until-full projection | reads daily samples an in-app background thread records to SQLite |
| `GET /api/storage/space` | top-level "what's using space" breakdown of the mount | serves a cached daily `du` (a background thread scans; never on request) |
| `GET /api/alerts` | push-alert config + every rule's current state (incl. muted) + recent log | from the background alert engine |
| `POST /api/alerts/test` | send a test push (confirm the pipe reaches the phone) | posts to ntfy |
| `POST /api/alerts/{rule_id}/mute` | mute/unmute one rule (silence its pushes; still watched) | persists in SQLite `alert_mutes` |
| `GET /api/printer` | live 3D-printer telemetry (state/progress/temps/AMS) | cached snapshot from a persistent MQTT client (Bambu LAN) |
| `GET /api/printer/camera/stream` | live chamber-camera MJPEG feed | re-streams the printer's TLS frames (:6000) as `multipart/x-mixed-replace`; one connection, frames pushed as they arrive — what the UI uses |
| `GET /api/printer/camera` | single latest chamber-camera JPEG frame | the same on-demand reader, one frame per request (snapshot/fallback) |
| `POST /api/printer/command` | pause/resume/stop/light (allowlisted) | publishes over the MQTT connection |
| `GET /api/printer/history` | completed-print log + stats (count, success rate, total time) | reads prints logged to SQLite on each RUNNING→terminal transition |
| `GET /api/backups` | list encrypted config backups (read-only) | reads BACKUP_DIR (under the RAID mount) |
| `GET /api/readme` | the project README as markdown (in-app viewer) | reads the README mounted read-only |
| `GET /api/readme/asset/{name}` | a screenshot the README references | serves from the mounted docs image dir (bare filename only) |
| `GET /api/server-guide` | the host's own server guide as markdown | reads the SERVER_GUIDE_FILE mounted read-only (defaults to a committed example) |
| `GET /api/plex` | reachable? streams, transcodes, bandwidth | `PlexAPI` client |
| `GET /api/plex/now-playing` | active streams: who/what/where, progress, transcode | `PlexAPI` sessions |
| `GET /api/plex/insights?hours=` | activity trends (streams/transcodes/bandwidth) + stats | SQLite (in-app sampler) |
| `GET /api/plex/recently-added` | newest items across libraries (poster strip) | `PlexAPI` |
| `GET /api/plex/libraries` | each library + item counts (+ key) | `PlexAPI` |
| `GET /api/plex/export` | full title manifest (on-demand backup) | `PlexAPI` (heavy) |
| `POST /api/plex/sync` | rebuild the media cache from Plex (background) | `PlexAPI` → SQLite |
| `GET /api/plex/sync/status` | running / last-synced / item count | SQLite meta |
| `GET /api/plex/library/{key}/items` | a library's items (movies or shows) | SQLite cache |
| `GET /api/plex/show/{key}/episodes` | one show's episodes, in order | SQLite cache |
| `GET /api/plex/item/{key}` | rich metadata for one item (detail page) | `PlexAPI` (on-demand) |
| `GET /api/plex/art/{key}` | item poster, proxied so the token stays server-side | downscaled to a small WebP, disk-cached by rating key so repeat loads skip the Plex round-trip |
| `GET /api/library` | every section + whether it's configured + item count (the hub landing) | scans the per-section content dirs |
| `GET /api/library/{section}` | one section's items (the browse list) | recursive scan of the section's dir |
| `GET /api/library/books/search?q=&limit=` | search Books by title/author | queries the `book_meta` cache (empty `q` = first results alphabetically) |
| `GET /api/library/books/index-status` | book-indexer progress | from the indexer + cache count (drives the "indexing…" UI) |
| `GET /api/library/books/cover?id=` | a book's cover art (cached) | extracts the embedded cover from the EPUB/MOBI on first view, downscales to a small WebP, serves locally thereafter (404 → titled placeholder) |
| `GET /api/library/comics/info?id=` | a comic's page count | reads the CBZ/CBR/CB7 archive's image entries (via libarchive) |
| `GET /api/library/comics/cover?id=` | a comic's cover = page 0 (cached) | extracts the first page, downscales small for the browse grid |
| `GET /api/library/comics/page?id=&n=` | one comic page (cached) | extracts page `n` from the archive, downscales to a reading-size WebP, serves locally thereafter |
| `GET /api/library/file?section=&id=` | stream one item's bytes (range-capable) | `FileResponse` from the section dir, traversal-guarded |
| `GET /api/library/games/cover?id=` | a game's box art (cached) | prefers a custom image dropped beside the ROM, else libretro-thumbnails by No-Intro name (following libretro's text-pointer pseudo-symlinks); downscaled to a cached WebP (404 → placeholder) |
| `POST /api/library/games/save-states` | upload a save state (blob + screenshot) | multipart; backend-assigned ms slot id; size-capped; stored under `/data/saves` |
| `GET /api/library/games/save-states?id=` | a game's save states, newest first | lists the slots in the game's saves dir |
| `GET /api/library/games/save-state?id=&slot=` | a save state's bytes | `FileResponse` — the `EJS_loadStateURL` target for resuming |
| `GET /api/library/games/save-state/screenshot?id=&slot=` | a save state's screenshot | `FileResponse` (the detail-page thumbnail) |
| `DELETE /api/library/games/save-states?id=&slot=` | delete a save state | removes the slot's files |
| `POST /api/library/games/sram` | store a game's in-game battery save (SRAM) | multipart; one `.sav` per game (overwritten); size-capped; also marks the game last-played |
| `GET /api/library/games/sram?id=` | a game's in-game battery save | `FileResponse` — the player seeds the emulator's FS with this on open (404 when none yet) |
| `GET /api/library/continue` | the unified "Jump back in" shelf | merges in-progress reading items + recently-played games, newest first; a game counts as in-progress on any play (incl. an in-game save), and resumes by booting (in-game Continue), not a save-state slot; skips entries whose file is gone |
| `GET /api/library/reading-progress/item?section=&id=` | one item's saved position (page/total or locator/fraction) | the reader fetches this on open to resume |
| `PUT /api/library/reading-progress` | save reading position (upsert) | body `{section,id,page,total}` (PDF) or `{section,id,locator,fraction}` (ebook); validated against a real item |
| `DELETE /api/library/reading-progress?section=&id=` | remove a document from the shelf | clears its bookmark |
| `GET /api/library/pins?section=` | pinned (starred) folders | from `pinned_folders`; the UI deep-links to each |
| `POST /api/library/pins` | pin a folder | body `{section,path}`; 404 unless the path is a real folder (has items under it) |
| `DELETE /api/library/pins?section=&path=` | unpin a folder | — |
| `GET /api/library/listen-progress?book=` | an audiobook's saved position | `{chapter_id, position_s}` — the player resumes from it |
| `PUT /api/library/listen-progress` | save listening position (upsert) | body `{book_id,chapter_id,position_s}`; chapter is traversal-validated |
| `DELETE /api/library/listen-progress?book=` | drop an audiobook from the shelf | clears its position |
| `GET /api/library/audiobooks/cover?path=` | a book's cover (cached) | a folder image, else the first chapter's embedded art (mutagen), downscaled to WebP (404 → 🎧 placeholder) |
| `DELETE /api/library/games/last-played?id=` | remove a game from the shelf | clears the marker; keeps the save files |

**Graceful degradation:** every endpoint that touches an external system
(Docker, Plex, a mount) catches failures and returns a friendly
`available: false` / `reachable: false` / `configured: false` state instead of
erroring, so a widget can always render something sensible.

---

## Config & secrets (12-factor)

The repo holds **logic**; the machine holds **values**.

- All host-specific values are read from the environment in `config.py` and
  nowhere else.
- `.env` (gitignored) holds the real values. `.env.example` (committed) documents
  every variable with placeholders only.
- `docker-compose.yml` references `${VARS}`, so the committed file has no secrets.
- Secrets (e.g. the Plex token) live only in `.env`.

| Variable | Meaning |
|---|---|
| `SERVER_NAME` | display name for the host |
| `RAID_MOUNT` | storage mount the disk widget reports |
| `PLEX_URL` / `PLEX_TOKEN` | Plex address + token |
| `API_PORT` | host port the backend listens on |
| `DOCKER_SOCKET` | host Docker socket path, mounted into the backend |
| `DB_PATH` | SQLite file path (on a Docker volume); has a sane default |
| `VITE_API_BASE` | base path the frontend uses to call the API |

---

## Frontend design

React + Vite + Tailwind (v4). A **module registry** in `App.jsx` is the single
seam the platform grows along — each entry declares a nav item (with a `group`)
+ route; `lib/nav.js`'s pure `groupModules()` folds the flat list into ordered,
labeled sidebar sections, and the `Shell` renders them (a slide-in drawer on
phones) plus the active page. The shell is an **app-shell layout**: the viewport
is bounded (`h-screen`) so the sidebar and the content scroll independently —
the Docs section stays pinned at the bottom regardless of page length. The
`Docs` group (reference material) renders apart at the bottom.

```
frontend/src/
  App.jsx            # module registry + routes
  shell/Shell.jsx    # sidebar + responsive layout frame
  lib/               # useApi (polling), useRates, format helpers
  components/        # shared UI: Graph, MediaTable, MediaDetail, SyncControl, …
  modules/
    dashboard/       # widgets (system, storage, plex, containers)
    plex/            # Plex page, LibraryBrowser, ShowBrowser, MovieDetail
    library/         # owned-content hub (Library), GamesList, Player (iframe)
    containers/      # container list + live detail
    network/         # live per-interface throughput graphs
```

Key shared pieces: `useApi(path, interval)` polls and exposes
`{data, error, loading}`; `MediaTable` is one searchable/sortable table reused
for movies and episodes; live graphs derive rates client-side from cumulative
counters so the backend stays stateless.

`lib/hostLocal.js` merges an optional, gitignored `host.local.jsx` at runtime
(via `import.meta.glob`, so the build works with or without it) — per-container
descriptions for the guide, plus an opt-in `url` that renders a **quick-link**
to a container's web UI (Containers tab, dashboard widget, and guide). Links are
built against `window.location.hostname`, so the same entry resolves whether the
box is reached over the LAN or by its Tailscale name; it's opt-in per container
because not every published port is a web UI, and only what a reverse proxy
fronts is reachable over the tailnet. Committed code stays generic — the real
links live only in the gitignored file.

## Plex library browser (the one stateful feature)

A **sync** job (`POST /api/plex/sync`, background thread) walks Plex once and
fills a SQLite `media_items` table with movies, shows, and episodes (title,
year, runtime, resolution, codec, file size, season/episode, …). The browser
then reads from SQLite, so search/sort/pagination are instant and don't hit
Plex per keystroke. The cache is **rebuildable** — a Refresh re-syncs it.

The split: **lists are cached** (browsed, searched, sorted); **single-item
detail + posters are on-demand** from Plex (viewed occasionally, not searched —
no reason to store long summaries or binary art). Posters are **proxied** through
`/api/plex/art/{key}` so the Plex token never reaches the browser.

## Library (owned content: games, papers, books, comics, audiobooks)

Where Plex streams *video*, the **Library** is the hub for content you **own and
consume directly** — ROMs you play, ebooks (EPUB/MOBI/AZW3), comics (CBZ/CBR/CB7),
audiobooks, and the PDFs from newspaper/magazine subscriptions — read/played/heard
**in-app**, mobile-first.

**Section framework.** `app/library.py` (pure, unit-tested) defines an ordered
list of **sections**, each with a content dir (a `.env` path under `RAID_MOUNT`,
so the existing read-only RAID mount serves it — no extra mount), recognized file
extensions, and per-item metadata. Sections so far: **games**
(`.gb` → the `gb` core, `.gbc`/`.gba` → `gba`/mGBA — GBC uses mGBA because
gambatte crashes GBC games on iOS Safari), **papers** (Magazines &
Papers — `.pdf`, read in-browser via PDF.js), **books** (EPUB/MOBI/AZW3 read
via foliate-js, plus `.pdf` falling back to PDF.js), and **comics**
(CBZ/CBR/CB7 read page-by-page). A section also carries a
`title_style` (ROM filenames get the No-Intro cleanup; document names are kept
verbatim) and a `reader` hint per format (`pdf` | `epub` | `comic`) so the frontend knows
which engine to open. Adding a content type is a new SECTION entry + a dir
setting, no router changes. `routers/library.py` is the thin HTTP layer: `/library` (hub summary),
`/library/{section}` (browse list), and `/library/file` (stream). Sections
degrade like everything else — `configured: false` when their dir is unset, so
the hub shows a hint.

**The streaming endpoint is the security boundary.** `safe_path()` resolves a
listed item's id (its path relative to the content dir) to an absolute path with
`os.path.realpath` and refuses anything that lands outside the dir or lacks a
recognized extension — so `../`, an absolute path, or a symlink escape all 404.
The dir is mounted read-only; the backend only lists + streams, never writes.
`FileResponse` honors the `Range` header (206 partial content), so a reader or
emulator fetches only the bytes it needs — cheap for ROMs, important for the
large scanned PDFs the reading sections will serve.

**Engines run client-side; the server is just a file server.** Rendering happens
on the device (an emulator core, or a reader), so the server stays a dumb byte-streamer
no matter how much is played/read — and the work scales with the phone, not the
box. The engines: **EmulatorJS** (games); **PDF.js** for the **papers** section
and any PDF book (lazily imported as its own chunk, *legacy* build for broad iOS
support, rendering one page at a time to a canvas with swipe/buttons); and
**foliate-js** for the **books** section's EPUB/MOBI/AZW3 — also lazily imported,
it sniffs the format by magic bytes and parses MOBI/AZW3 itself, so there's **no
server-side conversion**. `/library/read` is a small dispatcher that picks the
reader from the item's `reader` hint. foliate renders each book into a `blob:`
iframe that (a WebKit quirk) must run with `allow-scripts`, so a
**Content-Security-Policy** on the app shell (`frontend/nginx.conf`) is the real
boundary there — it allows our inline theme script and the reader's `blob:`
iframe/styles/fonts, same-origin everything else.

A per-route **error boundary** (`components/ErrorBoundary.jsx`, wrapping the
routed content in `Shell`, keyed by pathname) means a crash inside one screen —
notably a reader engine throwing during render or **teardown** — shows a
contained fallback instead of unmounting the whole app to a blank screen. The
ebook reader also guards foliate's teardown in a try/catch (some books open
blank, and tearing down a half-rendered view can throw during React's unmount —
that's the source of the crash; the boundary is the backstop).

**Comics are the one server-assisted reader.** A comic is a CBZ/CBR/CB7 archive
of page images (zip/rar/7z). Browsers can't read RAR/7z, and the scanned pages
are often huge, so — unlike the client-side game/PDF/ebook engines — the backend
does the work: `app/comics.py` uses **libarchive** (one binding for all three
formats) to list a comic's pages in natural filename order and extract one page's
bytes, and the router downscales each page to a reading-size WebP and caches it
(keyed by a hash of the id + page index), exactly like the cover proxies. The
`comic` reader is then a dumb `<img>` pager that fetches `/comics/page?n=`,
prefetches the next page, and bookmarks by `page` like a PDF. Page extraction is
lazy + cached, so only comics you open take cache space. The browse UI is a
**folder browser** that mirrors the library on disk at any depth (it builds the
tree client-side from the flat item paths via `browseFolder` — no backend
change): you drill in folder-by-folder (e.g. a per-series tree) instead of
rendering thousands of covers at once, the issue grid **paginates** (60 at a
time) so even a flat mega-folder stays responsive, and a client-side **search**
filters every comic by name. You can **pin (star) any folder** — a `(section,
path)` row in `pinned_folders` (server-side, so it roams) surfaces on a "Pinned"
shelf at the top of the section, so a deep, frequently-revisited folder (the next
issue in a series) is one tap away instead of a re-drill. The same
`reading_progress` table gives the roaming bookmark.

**Magazines & Papers reuse the same folder browser** (without the cover grid or
pins — PDFs have no cheap cover render, so papers are plain tap rows): drop a
series' PDFs in a subfolder under `PAPERS_DIR` and it collapses to one series row
you drill into for its issues, built from the same `browseFolder` + a client-side
`searchItems` across every paper. A flat folder still just lists its PDFs, so it's
backward-compatible and entirely user-controlled (organize on disk = organize in
the UI). `searchComics` was renamed `searchItems` now that two sections share it.

**Audiobooks reuse the folder browser; a book is a folder of chapter files.** The
`audiobooks` section reads a tree where a leaf folder of ordered audio files *is*
a book and the files are its chapters (natural-sorted client-side). The player is
a plain `<audio>` element streaming each chapter from the same range-capable
`/library/file` — the one change there is that audio is served with a real MIME
type (`audio/mpeg` etc., via `_media_type`) so iOS Safari will play it (ROMs/PDFs
stay `octet-stream`, read as bytes by their engines). It auto-advances chapters,
and the **Media Session API** wires the iOS lock-screen / Control-Center transport
+ background playback. Position resumes from a dedicated `listen_progress` table
(`book_id` → `chapter_id` + `position_s`), saved debounced as you listen — so it
roams across devices and joins the Jump-back-in shelf as a `listen` entry. **Cover
art** comes from a folder image or the first chapter's embedded art (ID3 APIC /
MP4 `covr` / FLAC pictures via **mutagen**), downscaled + cached like the other
covers and also fed to the Media Session lock-screen artwork. (Audible `.aa/.aax`
are DRM and not recognized.)
Still planned: per-item **offline download** for airplane-mode reading. DRM-free
content only.

**"Jump back in" — one resume shelf across content types.** Reading position is
server-side in a `reading_progress` table keyed by `(section, item_id)`: PDFs
bookmark by `page`/`total`, while ebooks (no stable pages) bookmark by a foliate
location string (`locator`, a CFI) plus a 0..1 `fraction` — both readers
self-resume on open. Games record a `game_progress` "last played" marker
on any play — when a save state OR an in-game (SRAM) save is written (the on-disk
save dir is a *hash* of the game id, so this table holds the real id + core to
resume + show art); the game then resumes by booting to its in-game Continue, not
a save-state slot. Both **roam across
devices** and ride the backup. The Library hub's **Jump back in** shelf merges
them — `GET /library/continue` returns in-progress documents (resume to the
saved page) and recently-played games (boot to their in-game Continue), newest
first — so one tap skips the drill-down. Each kind's remove clears only its
marker (`reading_progress` row, or `game_progress` row), never the content or
the save files; the shelf also skips entries whose underlying file is gone.

**Books are search-first, backed by a metadata index.** A large ebook library
(10k+ files) is unbrowseable as a flat list, so the Books section is a search box
that queries a **`book_meta` cache** (title + author per book) rather than
returning the whole library. A background indexer (`book_sync.py`, started from
the lifespan like the other samplers) parses each file's *embedded* metadata once
— EPUB via zip+OPF, MOBI/AZW3 via the EXTH header (`bookmeta.py`, stdlib-only) —
falling back to the cleaned filename when a file has no title. It re-scans only
changed files (by mtime) and prunes rows for deleted files. The cache is
**text-only** (no covers, no copies), so it stays a few MB even for a huge
library. `GET /library/books/search` then matches title OR author
case-insensitively; naming is normalized for **display only** (the files on disk
are never touched — the mount is read-only).

**Book covers are extracted on demand, not indexed.** Search results show cover
thumbnails via `GET /library/books/cover?id=`, which pulls the embedded cover out
of the EPUB (OPF manifest) or MOBI (EXTH 201 → the indexed image record) the
first time a book is viewed, downscales it to a small WebP (`images.to_thumbnail`,
the same path as game box art / Plex posters), and caches it keyed by a hash of
the id. A book with no cover (or a PDF) is remembered as a `.miss` → 404 and the
UI shows a titled placeholder. Doing this lazily — rather than during indexing —
keeps the on-disk cache tiny: only books you actually open ever get a cover file,
so the metadata index stays text-only and a huge library costs nothing extra
until browsed.

**The emulator runs in an isolated `<iframe>`.** EmulatorJS sets many `window.*`
globals and has no clean teardown, so it lives in a static page,
`public/emulator.html`, that boots the engine from query params (`core`, `rom`,
`data`). The React `Player` just renders that page in an iframe and removes it to
tear the engine fully down — nothing leaks into the SPA. `emulator.html`
allowlists its `data` (engine) source to a same-origin path or the official
EmulatorJS CDN, so the param can't be abused to load arbitrary script.

**The engine is self-hosted + pinned.** `scripts/fetch-emulatorjs.sh` downloads a
pinned EmulatorJS release (v4.2.3) into `frontend/public/emulatorjs/` (gitignored,
~300 MB of third-party WASM — reproducible like `node_modules`, not committed), so
play time makes no third-party calls. The build excludes it from the PWA precache
(`globIgnores`) and nginx caches it hard. A one-line switch (`EMULATORJS_DATA` in
`lib/library.js`) points the engine at the pinned CDN instead, for a zero-download
setup.

**Mobile-first, real routes.** The player and (later) readers are routes
(`/library/play`, `/library/read`), not overlays, so the phone's back gesture
exits — the native expectation — and items are deep-linkable. The player is also
deliberately *not* auto-fullscreened: its top-bar **Exit** stays visible, which
is the only way out in the installed PWA (no browser chrome).

**Presentation: titles, art, recents.** Filenames are raw No-Intro
(`Legend of Zelda, The - The Minish Cap (USA)`); a pure `clean_title()` strips
region/version tags, moves the trailing article, and turns ` - ` into `: `
(`The Legend of Zelda: The Minish Cap`), and the list sorts ignoring a leading
article. The raw filename stays the streaming id — only the display changes.
**Box art** comes from **libretro-thumbnails**, keyed by the exact No-Intro name
per system: `/api/library/games/cover` matches, fetches once, downscales to a
small **WebP** thumbnail in a covers cache (a writable volume), and serves it
locally thereafter — same "cache + proxy" shape as Plex artwork (which gets the
same WebP-thumbnail treatment, see `app/images.py`); a no-match (e.g. a ROM hack)
is remembered as a miss and the UI shows a titled placeholder. Two refinements
make matching robust: libretro stores some boxarts as a tiny **text-pointer**
file naming the canonical `.png` (a pseudo-symlink for alternate ROM names), which
the proxy now **follows**; and a **custom cover dropped beside the ROM** (same
basename, e.g. `My Hack.png`) takes precedence over libretro — the durable
override for hacks or name mismatches. Each game gets a **detail page** (cover +
title + Play). **Recently played** is tracked **client-side** (localStorage, this
device) for now — consistent with in-browser saves; it graduates to the backend
with save roaming.

**Game saves roam — two systems, both server-synced + backed up.** Both live
under `/data/saves` (a writable volume on the host's `/`, so they **roam across
devices AND ride the off-site restic backup** — the RAID is *not* in that
backup), one per-game folder keyed by a hash of the id.
- **In-game battery save (SRAM) — the everyday one.** The game's own "Save" →
  "Continue". `emulator.html` polls the live SRAM as you play and POSTs it to
  `POST /library/games/sram` (overwriting one `.sav` per game); on open it seeds
  the emulator's FS with the latest so Continue resumes your spot anywhere. This
  is what a normal "open the game and keep playing" uses — opening a game does
  **not** auto-load a save state (that would snapshot-restore an older SRAM over
  it). An in-game save also marks the game last-played for the Jump-back-in shelf.
- **Save states — explicit snapshots.** The engine fires `EJS_onSaveState` (state
  blob + screenshot) when you hit Save State in-game; the iframe POSTs it to
  `POST /library/games/save-states`. A game's detail page lists its states
  (screenshot thumbnails), and **Resume** relaunches with `EJS_loadStateURL`
  pointed at the chosen state's bytes. Slot ids are backend-assigned millisecond
  timestamps (digits only) — also the traversal guard for the file paths.

## Config backup (host script, app only lists)

Reproduce the server if the OS disk dies. A host script (`scripts/backup.sh`,
run by a systemd timer as root) tars the config listed in `backup.includes`
(per-host, gitignored), streams it through gzip into **`age`**, and writes an
encrypted bundle to `BACKUP_DIR`. It encrypts to a **public key only**
(`AGE_RECIPIENT`) — the private key never touches the server — so a compromised
host still can't read its own backups. Retrieval is SSH/rsync + the private key,
off-box. The Home HQ app stays unprivileged: it only **lists** the encrypted
files (`/api/backups`, via the read-only RAID mount). The script + unit templates
are committed and generic; the real path list and recipient live outside git.

## Drive health (RAID + SMART)

Two layers, split by how privileged the data is:

- **RAID** (`/api/raid`) is read live from the host's `/proc/mdstat` (already
  mounted for the network module) — no privilege needed — so a drive dropping
  out of the array shows up within the widget's 30-second poll.
- **SMART** (`/api/smart`) needs root + raw device access, which the container
  deliberately lacks. So a host root timer (`scripts/smart-health.py`, daily)
  dumps each disk's `smartctl -j` output to `smart.json`; the backend only
  **reads** it (mounted `/smart` read-only) and summarizes — same split as the
  config backup. The collector retries USB-NVMe bridge drivers for external
  enclosures. The backend tags each drive `raid` / `system` / `other` (by
  cross-referencing `/proc/mdstat`), so the UI can label the OS disk vs array
  members and hide unreadable external disks.

### External-drive watchdog (host script)

Some USB-to-SATA/NVMe bridges periodically **wedge** — a region of I/O starts
erroring while the device stays "connected", blocking reads and writes — and the
only fix is to power-cycle the bridge. `scripts/drive-watchdog.sh` is an optional
host daemon (a systemd service with `Restart=always`, not a timer) that probes
the mount on an interval and recovers automatically. It's the same
privileged-host / unprivileged-app split as backups and SMART: the script (root,
on the host) does the unmount/reset/fsck; the container never does.

It distinguishes **two failure modes**, because they need opposite handling
(decision log below):

- **Soft wedge** — the partition node is still on the block layer but I/O hangs.
  A software USB reset here *is* the right tool (it's a protocol-level "replug" of
  a still-attached bridge): lazy-unmount → `usbreset` (falling back to a sysfs
  authorized-toggle / driver re-bind) → filesystem repair → remount → verify.
- **Hard wedge** — the bridge firmware hangs hard and the node **drops off the
  block layer entirely** (gone from `lsblk`, `by-uuid` symlink missing) even
  though the enclosure still shows in `lsusb`. A software reset **cannot** recover
  this — none of those resets cut power, so they can't reboot hung firmware, and
  the deauthorize fallback can leave the device detached (escalating the wedge, or
  knocking a drive you *just* replugged back offline). So the watchdog does **not**
  reset here: it detaches the stale mountpoint, flags `needs-manual-replug` (an
  honest, actionable state the **Drives** widget shows as a red *replug* badge and
  the alert engine fires on), and polls cheaply until the node returns — then a
  plain remount (or repair-then-remount, if the unclean drop left the FS dirty)
  brings it back with no reset at all. A power-switchable hub + `uhubctl` could
  later automate the power-cycle, but for a disposable drive a manual replug is the
  pragmatic choice.

It's fully generic — drive identity (mount, UUID, optional USB `vendor:product`,
fstype, tuning) comes from `.env` under `WATCHDOG_*`, the repair tool is chosen by
filesystem type (or overridden), and it writes a small atomic state JSON
(`WATCHDOG_STATE_JSON`: health + last-recovery + recovery count). The backend
reads that file via the same `/smart` mount and serves it at
`/api/drive-watchdog`, so the **Drives** widget shows the watched drive's health
and self-recovery history — surfacing a drive that SMART can't read through a USB
bridge.

## VPN egress health (host script)

If you route a container's traffic through a VPN (a common privacy setup), you
want to *prove* it's actually masked — and catch a leak where traffic falls back
to your home connection. The backend can't see into the VPN container's network
namespace (and reaches Docker only through the read-only socket proxy, so it
can't `docker exec`), so this is another privileged-host / unprivileged-app
split. `scripts/vpn-health.py` (a host timer) looks up two public IPs — the
host's own, and the one seen from *inside* the VPN container — and writes them to
`vpn.json`. The backend reads that via the same `/smart` mount, and
**`/api/vpn`** computes the verdict: if the VPN egress IP equals the home IP it's
a **leak**; if the container isn't running it's **down** (benign — the
kill-switch means no traffic, so it isn't alarmed on); otherwise **protected**.
The **VPN** page shows the exit vs home IPs side by side, and a leak raises an
urgent push alert. The script is generic (`VPN_CONTAINER`, `VPN_IP_CHECK_URL`)
and commits clean — no host or service specifics.

The exit lookup tries a JSON geo service (ipinfo) first, then falls back to
plain-text IP echoes (`VPN_IP_FALLBACK_URLS`): popular shared VPN exit IPs get
HTTP 429'd by ipinfo's free tier regardless of our request rate, and without the
fallback that would read as a false "down". The fallbacks return only the IP —
which is exactly what the leak verdict compares — so geo/org just goes blank.

## Tailscale mesh status (host script)

If the host is on a [Tailscale](https://tailscale.com) tailnet (the same mesh
that lets you reach this dashboard from anywhere without opening ports), the
**Tailscale** page lists every device on it — this host plus each peer — with
its online state, OS, Tailscale IP, last-seen time, and whether any device is
acting as the exit node. The backend container has no `tailscale` binary or
socket, so — same split as SMART and the VPN check — `scripts/tailscale-status.py`
(a host timer) runs `tailscale status --json`, trims it to the displayed subset,
and writes `tailscale.json`. The backend reads it via the same `/smart` mount;
**`/api/tailscale`** does the shaping (online counts, online-first sort,
exit-node detection, stale check) in a pure, unit-tested `summarize()`. The
script deliberately drops the tailnet's login email, keeping only the MagicDNS
domain, so nothing identifying is committed or even written to the state file.

## Uptime monitoring (host prober)

The **Uptime** page shows each configured service's current status, uptime %
(24h / 7d), latency, and a recent up/down sparkline. The probing is a **host
script** (`scripts/uptime-probe.py`, a systemd timer) rather than in-app for a
concrete reason: the backend container is firewalled away from LAN-restricted
services (UFW limits Home Assistant, qBittorrent, etc. to the LAN subnet, and the
container's source is the Docker subnet), so it can only reach internet-open
ports. The host can reach everything via localhost — the same privileged-host /
unprivileged-app split as SMART/VPN/Tailscale. Each run probes every target
("up" = it answered at all, even an HTTP 401, so auth-gated services don't read
as down) and updates `uptime.json`: a `last` result, a short raw `samples`
history for the sparkline, and `hourly` {up, total} buckets the backend turns
into the uptime %s. The file is self-bounding — samples are capped and buckets
pruned to the retention window. `GET /api/uptime` reads it and shapes it in a
pure summarizer.

## Home Assistant glance (host script)

**Guiding principle: HA is the brain, Home HQ is the cockpit.** Home Assistant
owns every device integration, automation, and the full control surface; HQ just
surfaces a *curated handful* of HA entities at a glance and **deep-links into HA
for control**. This is a thin, **read-only** bridge — deliberately NOT a second
smart-home UI (the same lesson as the backed-out camera wall).

The mechanism is the now-familiar privileged-host / unprivileged-app split. The
backend container holds no HA URL or token, so a host timer
(`scripts/ha-state.py`) calls HA's REST `GET /api/states` with a **Long-Lived
Access Token**, keeps only the `HA_ENTITIES` allowlist (in display order), trims
each to `{entity_id, name, state, unit, device_class}`, and writes `ha.json`. The
backend reads it via the same `/smart` mount; **`/api/ha`** shapes it (domain
split, entity normalization, stale check) in a pure, unit-tested `summarize()`.
Each `HA_ENTITIES` item may be `entity_id` or `entity_id|Custom label` (same
`Name|value` shape as `UPTIME_TARGETS`) — the label overrides HA's friendly name
in the glance, so a verbose integration name reads cleanly without touching HA.
The dashboard's **Home** widget renders the rows — an icon + label + value, with
low batteries tinted — each linking into HA's history view for that entity. It
**self-hides** when HA isn't wired up (`not_configured` / no file), and shows
"unreachable" only when the collector ran but the HTTP call failed.

The HA token is the one secret in this collector, so — unlike the others —
nothing here is committed with a real value: `HA_TOKEN` lives only in the
gitignored `.env`, never in the repo or the container. Read-only by design: no
service calls, no control proxying, and (per the notifications stance) no alert
rules on HA entities. Control is HA's job — the deep-link hands off to it.

## Database growth guardrails

Three in-app samplers (storage, plex, uptime-via-host) plus the alert log write
to one SQLite file, so its growth is bounded and visible. **Retention pruning**
caps steady-state by time. A **hard row cap** per sampler table (`_cap_table`,
run on each write) is the backstop: if a bug ever looped inserts, the oldest rows
past the cap are dropped, so the file can't balloon between prune cycles.
`GET /api/storage/db` exposes the file size + per-table counts (shown on the
Storage page), and an alert rule pushes if the file crosses `ALERT_DB_MAX_MB`.
Separately, the Compose services set a `json-file` log driver with
`max-size`/`max-file` so a container's stdout can't fill the disk either (the
default driver is unbounded).

## Alerting (push notifications)

Most of the app is pull-on-demand, but you don't want to *watch* the dashboard to
learn a drive is failing. `app/alerting.py` is a background thread (started in the
lifespan, no-op unless `ALERTS_ENABLED`) that every `ALERT_INTERVAL` seconds
re-reads the same data the dashboard shows and pushes a phone notification when
something crosses into a bad state. Channel is **ntfy** (`app/notify.py`, a one
stdlib POST to `{NTFY_URL}/{NTFY_TOPIC}`) — push lands on the phone over normal
internet, so **no tailnet is needed to receive alerts** (only to tap through to
the dashboard). Set `ALERT_CLICK_URL` to the app's base origin and each alert
**deep-links** to the page it's about (a RAID/SMART alert opens Storage, a print
alert opens Printer, …) via an ntfy `Click` header.

Each rule's `check()` returns a *key* identifying the current condition (or
`None` for OK); we **edge-trigger** on key changes — `None→X` fires, `X→Y`
re-fires (the problem changed), `X→None` sends a "resolved" for sustained
conditions. State is persisted in SQLite (`alert_state`/`alert_log`) so a restart
doesn't re-announce everything, and a rule's first-ever sighting is recorded
*silently* so enabling alerts (or a finished print on the bed) doesn't spam.
Rules carry their own emoji so alerts read at a glance: 💾 backup, 🚨 RAID, 💽
SMART, 🗄️ capacity, 🔌 external drive, 📦 containers, 🖨️ printer (done/failed),
⏸ paused (catches filament runout — the stage reads "Changing filament"), ⚠️
printer HMS faults, 🛰️ printer-offline-mid-print.

A few of those deserve a note. **Printer-offline** fires *only* when the printer
vanishes mid-print (last state RUNNING/PAUSE) — a dead telemetry pipe, a crash,
or the upstream router's WAN IP drifting (which silently breaks the printer
host); a normal power-down while idle stays quiet. The **external-drive** rule
fires on the drive's *last-reported* health even when the watchdog's state file
is **stale**: during a hard wedge the watchdog backs off for minutes between
probes, so its report ages past the stale window while it's still managing a
known-bad drive — and treating stale as "clear" used to flap the alert
unhealthy→resolved→unhealthy every few minutes. Staleness is still surfaced in
the UI; it just no longer *clears* an active drive-unhealthy alert (a
stale-but-healthy report stays quiet). And a **dead-man's switch**: each cycle
the engine pings `HEALTHCHECK_PING_URL` (point it at an external check like
Healthchecks.io). If the loop — or the whole box — dies, the pings stop and that
external service alerts you. It's the one failure the app can't self-report, so
it's deliberately watched from outside.

Any single rule can be **muted** from the Alerts page (`POST /api/alerts/{rule_id}/mute`,
persisted in the `alert_mutes` table — a row's presence means muted). A muted rule
is still evaluated and shown (so you can see it's active), but sends no push, and
it still *consumes its edge* silently — so unmuting resumes notifications on the
next state change rather than replaying whatever it's doing at that moment. It's
for silencing one known-noisy condition without killing the whole engine.

## The printer: the one push-based source

Every endpoint above is **pull** — it gathers data when the request arrives. A
3D printer is different: in Bambu's LAN mode it *publishes* a telemetry blob to
a local MQTT broker (TLS on :8883, auth = `bblp` + the printer's access code).
So `app/printer.py` keeps a **persistent MQTT client** alive for the process
lifetime (started/stopped from the FastAPI lifespan). It subscribes to
`device/<serial>/report`, sends a `pushall` on connect to get the full state
once, then **deep-merges** each subsequent partial delta into a cached state
dict (guarded by a lock, since paho runs its own network thread). `/api/printer`
just returns the latest cached snapshot, mapped through a pure `parse_state()`
(the unit-tested core). Availability degrades like everything else: it reports
`not_configured` (no env set), `no_data` (connected, nothing yet), or `offline`
(no message within 60s / disconnected) instead of erroring. All host-specific
values (host, serial, access code) come from `.env`; nothing printer-specific is
committed.

**Controls** reuse that same MQTT connection: `POST /api/printer/command`
publishes an allowlisted command (pause/resume/stop/light) to the printer's
request topic. **The chamber camera** (`app/camera.py`) is separate — the P1
series has no RTSP, so it streams JPEG frames over an authenticated TLS socket
on :6000. That reader connects *on demand* (only while the UI is watching) and
disconnects after a short idle (`PRINTER_CAMERA_IDLE_TIMEOUT`), so it doesn't
contend with Bambu Studio's own live view. The UI consumes it as a live MJPEG
feed: `GET /api/printer/camera/stream` re-streams the frames as
`multipart/x-mixed-replace`, so a plain `<img>` swaps them in place over one
connection (no per-frame refetch); a streamer re-asserts interest as it plays so
a watched feed never idles out. `GET /api/printer/camera` returns a single latest
frame as a snapshot. The camera is opt-in (`PRINTER_CAMERA`) because it may need
its own network reachability (e.g. a separate port-forward to the printer).

**Client-side stream-vs-snapshot fallback.** WebKit (every browser on iOS, and
Safari on macOS) does not reliably render `multipart/x-mixed-replace` in an
`<img>` — it sticks on "connecting" and paints the broken-image glyph. So
`Camera.jsx` chooses a render path: `lib/camera.js`'s pure `prefersSnapshot(ua)`
puts WebKit straight onto **snapshot polling** (re-fetch `/api/printer/camera`
~1/s) while Blink/Gecko use the smoother MJPEG stream. Two safety nets make it
robust regardless of UA quirks (iPadOS reports a Mac UA; iOS Chrome is WebKit
under the hood): the stream path **times out into snapshot mode** if no frame
renders within a grace window, and snapshot polling **preloads each frame
off-screen and only swaps the visible `<img>` on success**, so a 503 during the
camera's on-demand warmup keeps the last good frame (or the "connecting" overlay)
up instead of flashing a broken image. Snapshot mode trades frame rate for
working-everywhere.

---

## Packaging

Frontend + backend each in a container, wired by one `docker-compose.yml`.

- The backend reads container status through a **docker-socket-proxy** (read the
  note below — it does not touch the raw socket) and mounts the **storage mount**
  read-only for disk status.
- Run everything with `docker compose up --build -d`.

### Frontend: production vs. dev

The always-on `frontend` service is a **production build served by nginx**
(multi-stage `frontend/Dockerfile`: Vite build → static files on nginx). nginx
serves the SPA (with an index.html fallback for client-side routes) and
reverse-proxies `/api` to the backend, so the browser sees one origin — the same
contract the dev server's Vite proxy provides, so no app code changes between
the two.

For hot-reload development, `frontend-dev` (compose **`dev` profile**) runs the
Vite dev server on host port 5174, alongside production on 5173:

```bash
docker compose up -d                          # production (nginx) on :5173
docker compose --profile dev up -d frontend-dev   # + hot-reload on :5174
```

### PWA

The production build is an installable Progressive Web App (`vite-plugin-pwa`):
a web manifest (`frontend/vite.config.js`) plus a service worker that precaches
the built app shell, so it installs to a phone home screen and launches
fullscreen. Icons are rasterized from `public/favicon.svg` by
`frontend/scripts/gen-icons.mjs` (run manually if the favicon changes).
Installability requires HTTPS, which the Tailscale `serve` HTTPS hostname
provides.

The service worker is a **custom** one we own (`frontend/src/sw.js`, built via
vite-plugin-pwa's `injectManifest` strategy) rather than the auto-generated
`generateSW` — so the caching is exactly what we declare, which is the
foundation of the offline feature (below).

### Offline foundation

The Library's offline mode lets a downloaded book/PDF/comic be read on a plane
(the server unreachable over the tailnet). Its foundation — built before any
download UI — is:

- **Custom SW with exactly two caches** (`frontend/src/lib/offlineConfig.js`):
  `hq-shell` (the precached app shell — the one thing cached without an explicit
  download) and `hq-offline` (content bytes). The fetch strategy: a request in
  `hq-offline` is served **cache-first** (so a downloaded item reads offline with
  **zero reader changes** — the readers request the same `/api/library/file` and
  `/comics/page` URLs; the SW answers from cache); navigations are network-first
  with a shell fallback (so the app boots offline); precached shell assets are
  cache-first; **everything else goes to the network and is never cached.**
- **The single-writer rule:** the *only* thing that writes to `hq-offline` is the
  explicit `downloadJob()` in `offlineStore.js`. There is no runtime/opportunistic
  caching, so every byte on the device is either the named shell or a download the
  user chose — which is what makes the storage manager's accounting trustworthy
  (`auditCache()` cross-checks the real cache against the manifest to *prove* it).
- **Downloads manifest** (`offlineStore.js`): an IndexedDB record per download
  (`{key, section, id, name, type, urls, bytes, date}`) — the index behind the
  "Downloaded" shelf, per-item badges, and the storage manager. The pure
  accounting (`auditCache`, `summarizeStorage`, `downloadKey`) is unit-tested;
  the IndexedDB / Cache Storage / `storage.estimate()`+`persist()` I/O is thin.
- **Offline detector** (`lib/online.jsx`): `OnlineProvider` + `useOnline()` probe
  `/api/health` (NOT `navigator.onLine`, which only means the radio is up — over
  the tailnet the radio can be online while the server is unreachable).
- **Reading-position local cache + write-sync outbox** (`lib/progressOutbox.js`):
  one per-item IndexedDB store does two jobs. Every reader and the audiobook
  player saves your spot through `saveProgress()`, which writes the position
  (keyed by `readingKey`/`listenKey`, stamped `updatedAt`, `synced:false`) and
  then PUTs it to the existing `/library/reading-progress` /
  `/library/listen-progress` endpoints. The per-page save is debounced and that
  timer is canceled on unmount, so the page readers also flush the latest
  position on exit/background via `useSaveOnExit` (the audiobook player already
  saved on exit) — without it, turning a page and immediately leaving lost that
  spot, so a downloaded item could reopen at page 1 offline. **(1) Sync:** offline the PUT fails and
  the entry stays `synced:false`; the `OutboxFlusher` component
  (`components/OutboxFlusher.jsx`, runs on mount-if-online and every
  offline→online edge) replays unsynced entries. App-driven, **NOT SW Background
  Sync** (iOS Safari lacks it). **(2) Resume cache:** a synced entry is **kept,
  not deleted** — so a downloaded item opened offline can resume where you left
  off (the server holds the position too, but it's unreachable offline; deleting
  on sync was the bug that sent offline reopens back to page 1). `resolveResume()`
  picks the source (pure `chooseResume`): an **unsynced** local entry (offline
  progress) always wins; else **online** the server is authoritative (roams
  across devices); else the **local** copy (offline / server-failed). The
  server fetch is bounded by a short timeout so an optimistic online flag can't
  hang the reader. Last-write-wins is enforced by **compare-and-set**: an entry is
  marked synced only if its `updatedAt` still matches the value just sent, and the
  flush sends the *freshest* value per key (not a stale snapshot) — so a newer
  save can never be clobbered by an in-flight stale one; a 4xx stops retrying
  while a 5xx/network error stays unsynced. The pure helpers (`chooseResume`, the
  keys) are unit-tested; the IndexedDB/fetch I/O is thin.
- **Download button** (`modules/library/DownloadButton.jsx`): a compact control
  in the reader top bars that calls `downloadJob()` with the URLs that make up an
  item. A PDF/ebook is one `/library/file` URL; a **comic** is the asymmetric
  case — the browser can't unpack CBZ/CBR/CB7, so the reader fetches
  server-rendered pages, and an offline comic must pre-cache **its info endpoint
  + cover + every page image** (`/comics/info`, `/comics/cover`, `/comics/page?n=`
  for all N). `downloadJob` reports a single 0..1 `fraction` — within-file bytes
  for a one-file download, per-file across a many-file one — so the bar is smooth
  for a 100+ MB magazine and a 145-page comic alike. An **audiobook** download
  caches every chapter file and stores the **chapter list in the manifest entry**,
  so the player runs offline without the live folder-browse; offline,
  `AudiobooksList` reads the book's chapters from the manifest and routes via
  `downloadHref()` (audiobooks open the `?path=` player, not the `/library/read`
  dispatcher). The SW synthesizes **206 Partial Content** from a cached body for
  range requests on **media** responses (audio/video) — iOS Safari won't play a
  cached `<audio>` served as a plain 200 — while non-media (PDFs) keep the full
  200 pdf.js is happy with. A **game** download is the most involved: it caches
  the ROM + its libretro core (both non-thread variants — `gb`→gambatte,
  `gba`/`gbc`→mgba) and, once, the shared **EmulatorJS engine** (`emulator.html`
  + the core-agnostic `/emulatorjs/` assets) as a distinct `emulator` manifest
  entry that the storage manager shows as its own "Emulator engine" line.
  `ensureEmulatorEngine()` runs before a game download (via the button's
  `onBefore`). The SW no longer bypasses `/emulator.html` + `/emulatorjs/` — it
  serves them from cache when downloaded (the host page is matched by bare path
  since it carries per-game query params), so the emulator iframe, engine, core,
  and ROM all come from cache offline. The ROM (and any resume save state) are
  loaded by `emulator.html` itself via `fetch`+blob URL rather than EmulatorJS's
  own XHR, since a service-worker-intercepted XHR for a large binary stalls on
  iOS. **Two save systems, both ours to persist** (EmulatorJS persists neither
  reliably):
  - The game's in-game **battery save (SRAM)** — Pokémon's own "Save" → "Continue"
    — is the *everyday* save. EmulatorJS doesn't keep it across sessions, so
    `emulator.html` **polls the live SRAM itself** (every 5s + on page-hide, via
    `getSaveFile(true)`, which flushes the core's battery RAM to the FS) — a poll,
    not EmulatorJS's `saveSaveFiles` event, because that event doesn't fire before
    the iframe is torn down on exit. Each change is written to a local cache and
    POSTed to `/library/games/sram` (one `.sav` per game, roams + offline). On open
    it seeds the emulator's FS (`FS.writeFile(getSaveFilePath())` + `loadSaveFiles()`)
    with the latest (local cache first, else server) so "Continue" works on any
    device and offline. **Opening a game boots normally and the SRAM Continue loads
    your spot — save states are NOT auto-loaded** (a save state restores the whole
    machine, incl. an older SRAM, so auto-loading one would clobber the newer
    in-game save).
  - **Save states** (the snapshot button) are the deliberate "freeze this exact
    moment" system — captured via `EJS_onSaveState` (with a screenshot), listed on
    the detail page to resume from. The locally-captured copies live in a
    `hq-game-saves` cache shown as a "Game saves" storage line. The engine bundle
  is versioned (`ENGINE_VERSION`) and the SW serves `emulator.html` network-first
  (refreshing the cached copy) so engine-page changes reach a device without a
  re-download. Once
  downloaded, the reader/player requests the same URLs and the SW serves them from
  cache — verified end-to-end that a downloaded PDF renders with
  the tailnet off (pdf.js range requests fall back cleanly to the cached full
  response, so no 206 synthesis is needed).
- **Reaching downloads offline:** the Library hub shows a **Downloaded** shelf
  read straight from the IndexedDB manifest (no server call), so it's the entry
  point to your content when the server is unreachable; and the Shell shows a
  global **offline banner** (from `useOnline`) so the empty cockpit widgets are
  explained. The SW also fails gracefully — an offline fetch it can't fulfil
  resolves to `Response.error()` rather than rejecting `respondWith()` (which
  would surface an ugly "FetchEvent.respondWith received an error" in the UI).
- **Downloads page + storage manager** (`modules/library/Downloads.jsx`,
  `/library/downloads`): a first-class destination (linked from the hub's
  Downloaded shelf and the offline banner) that reads ONLY local sources, so it
  works fully offline. It leads with our **exact** accounting — the app-shell
  size (`shellBytes()`, summed from the real cache) + each download — rather than
  `storage.estimate()`'s usage figure, which browsers pad for privacy and which
  is shown only as a secondary "approx" quota caption. **Verify storage** runs
  `auditStorage()` (which normalizes manifest vs. cache URLs to absolute, then
  `auditCache()`) to prove no bytes sit outside the listed downloads. Per-item
  delete and clear-all call `removeDownload()` (cache entries + manifest row).
- **Download state is visible everywhere:** browse rows (papers, books) show a
  "✓ offline" `SavedBadge` for items already downloaded (`useDownloaded()` reads
  the manifest into a key set), so you can tell what's saved without opening it.
  And when offline, the sidebar dims every module that needs the server (all but
  the Library), so the nav reads as "only the Library works right now".
- **No dead ends:** a reader's Close uses history-back (`goBack` in `lib/nav.js`)
  so it returns to wherever you opened it from — the Downloads/hub view offline,
  the section list online (with scroll preserved) — falling back to a route only
  when there's no in-app history. And each readable section list (papers, books),
  when offline, renders its **downloaded subset** from the manifest
  (`OfflineSection`) instead of erroring, so closing a reader never lands on a
  broken page.
  _Note for testing: Playwright's `set_offline` does NOT block localhost, so
  simulate a unreachable server by aborting `**/api/**` instead — SW cache hits
  make no network request, so downloads still serve while live calls fail._
  _The audit-grade storage manager, comics multi-file download, the dedicated
  offline landing, and the reading-position write-sync outbox are all built (see
  the outbox bullet above); offline mode is feature-complete across all media
  types._

### A note on the Docker socket

Mounting the raw socket would give the backend visibility into all containers —
but a `:ro` mount only protects the socket *file*, not the Docker API, so a
compromised backend could still create privileged containers and escape to the
host. So the backend does **not** mount the socket. Instead a
**`docker-socket-proxy`** (a tiny HAProxy) holds the socket and exposes only the
read-only container endpoints (`CONTAINERS=1`, `POST=0`) on an `internal` Docker
network. The backend talks to it via `DOCKER_HOST=tcp://docker-socket-proxy:2375`
(`docker.from_env()` picks that up — no app code change). To stay within that
allow-list we read each container's image *name* from the container data we
already have, rather than calling the (forbidden) image-inspect endpoint. Net
effect: a backend compromise can list containers and read stats, nothing more —
no image/network/secret introspection, no writes, no host reach to the proxy
(it isn't published or routable off its internal network).

**Container logs** ride the same proxy (`GET /containers/{id}/logs` is a
container endpoint, so `CONTAINERS=1` already permits it — no extra grant). The
detail endpoint still withholds env vars, mounts, and command args, but a
separate `/containers/{name}/logs` endpoint serves recent stdout/stderr on
demand. That's an informed reversal of the original "never expose logs" stance:
logs can contain whatever an app prints (an accidentally-logged secret, or
activity like torrent names), so it's only sound because the UI is reachable
only over the LAN/tailnet (UFW drops public traffic; no funnel) and the tailnet
is single-user. `CONTAINER_LOGS_EXCLUDE` withholds named containers (a VPN or
torrent client — the most sensitive and the ones you'd `docker logs` over SSH
anyway). The endpoint is read-only and tail-limited; it never streams full
history.

---

## Testing

Tests run in the project's containers — no host Python/Node toolchain needed.
`scripts/test.sh` runs both suites; run it before committing, and add or update
a test whenever you change a helper, query, parser, or endpoint.

- **Backend — pytest** (`backend/tests/`). Each test gets an isolated temp SQLite
  DB (autouse fixture monkeypatches `settings.db_path` to a tmp file, then
  `init_db()`), so the cache logic is tested for real without touching the live
  DB. Coverage: the container/network/backup/Plex helpers, graceful-degradation
  paths (Docker down, `/proc` missing), and the library-query logic — episode
  exclusion, search, the sort whitelist with its injection-safe fallback,
  pagination, and episode ordering. Test-only deps live in `requirements-dev.txt`
  and are installed ephemerally by the runner, never baked into the prod image.
- **Frontend — Vitest** (`*.test.js` beside the source). Covers the pure logic:
  the `format.js` helpers and the `MediaTable` `compare` sorter. UI rendering is
  intentionally not tested — the value is in the helpers. Vitest is a dev
  dependency in the image, so after adding a frontend dev dep, rebuild the image
  (`docker compose build frontend`) before the runner can see it.

---

## How a request flows (example: `/api/system`)

```
.env  ──compose injects env──▶  container env
                                     │
                          config.py reads it ──▶ settings (typed)
                                     │
browser ──GET /api/system──▶ main.py ──▶ routers/system.py
                                     │
                          psutil reads the host kernel
                                     │
                          ◀── JSON: cpu/ram/uptime ──
```

Because containers share the host kernel, `psutil` already reports the host's
CPU/RAM/uptime. Disk is the exception — it needs the host path mounted in, which
is why compose mounts the storage path.

---

## Roadmap

- **Phase 1 (done):** shell + server status dashboard (system, disk, containers,
  plex) + live network graphs. Frontend built (React/Vite/Tailwind).
- **Phase 2 (current):** richer modules. Plex library browser with a searchable
  SQLite cache + per-item detail pages (the first stateful feature).
- **Next:** config backup module (age-encrypted to the RAID); an in-app "How it
  works" doc; production serve behind Nginx.
- **Remote access:** reach the dashboard and a shell privately over a mesh VPN
  rather than opening firewall ports.
- **Observability (later):** metrics + dashboards once there's more to watch.

---

## Decision log

Short record of *why* things are the way they are, so future changes have context.

- **FastAPI (Python) backend.** The data sources have clean Python libraries —
  `psutil` (system), the Docker SDK (containers), `PlexAPI` (Plex) — which makes
  the status endpoints nearly trivial.
- **All config from the environment.** Keeps secrets out of git and makes the
  project reusable by anyone who clones it. One rule, enforced everywhere.
- **No host identifiers in committed files** — not even in comments. Hostnames,
  IPs, and mount paths are host-specific values, so they live in `.env`. This
  keeps the repo publishable and privacy-safe.
- **Graceful degradation over hard failures.** A homelab dashboard should keep
  rendering even when one subsystem is down; endpoints report an "unavailable"
  state instead of throwing.
- **Docker socket mounted, proxy planned.** Pragmatic for Phase 1; the
  socket-proxy hardening is a deliberate later step, not an oversight.
- **SQLite for the media browser, not Postgres.** The browser needs fast
  search/sort over a few thousand rows that are fully rebuildable from Plex.
  SQLite (a single file on a Docker volume, stdlib `sqlite3`, no ORM) is the
  right-sized tool; it stays trivially small (~MBs) and adds zero infrastructure.
- **Cache the lists, fetch detail on-demand.** What's browsed/searched/sorted
  (movies, shows, episodes) is cached; a single detail view and its poster are
  fetched live (not searched, viewed rarely). Keeps the DB lean and the data
  model honest about what actually benefits from caching.
- **Proxy Plex images through the backend.** The poster URL carries the Plex
  token; serving it via `/api/plex/art/{key}` keeps the token server-side and out
  of the browser/DOM.
- **Backups: host script encrypts, app only lists.** Asymmetric `age` means the
  server holds only the public key and can never decrypt — the right model when
  the threat is the server itself being compromised. Keeping the encrypt step in
  a root host script (not the container) means the unprivileged app never needs
  read access to all that config; it just lists the encrypted output.
- **Client-side rate computation.** Live network/throughput graphs derive rates
  from cumulative counters in the browser, so the backend stays stateless (no
  time-series storage) in this phase.
- **Storage trends: an in-app sampler, not a host timer.** The early-failure
  signal for disks is the *trend* (rising temperature/wear, growing usage), not a
  point-in-time reading. The data is already exposed by `/api/smart`, `/api/raid`
  and `/api/disk`; we only need to remember it over time. So rather than a
  privileged host timer (like `smart-health.py`), a lightweight background thread
  in the app upserts one row per UTC day into SQLite — idempotent, retention-
  pruned, and unprivileged. This is the one deliberate exception to "backend stays
  stateless": low-rate daily samples, not live counters. Capacity days-until-full
  is a plain least-squares fit (`project_capacity`), no dependency. **Plex
  insights** (`plex_history.py`) follows the same pattern — an in-app thread
  appends a Plex activity sample every few minutes (only while reachable), and
  `summarize_insights` aggregates them into peak concurrency, stream-hours,
  transcode share, and the busiest hour.
- **Module-local navigation.** Cross-library switching lives in the Plex module
  (a pill bar), not the global sidebar — the shell stays generic so every module
  isn't tempted to inject its own children into it.
- **Commit at meaningful milestones.** History reads like the build order — one
  coherent, working increment per commit.
- **`PlexAPI` packaging gotcha.** The PyPI package is `PlexAPI`; the Python
  import is `plexapi`. (`python-plexapi` is the project's source name, not the
  installable name.)
- **Library: a generic section framework, client-side engines, a file server
  backend.** The owned-content hub could have been one page per content type;
  instead it's a single section framework so games/comics/books/papers share one
  list/stream/guard path and the backend stays a dumb (read-only, range-capable)
  file server — all rendering is client-side. The emulator lives in an isolated
  iframe (no clean teardown otherwise) and the engine is self-hosted + version-
  pinned (gitignored, like `node_modules`) so play time makes no third-party
  calls. Player/readers are real routes, not overlays, because the target is
  mobile, where the back gesture must exit. This is the same "deep-link, don't
  reimplement" spirit applied inversely: video stays in Plex; owned, directly-read
  content that Plex handles poorly (ROMs, comics, ebooks, subscription PDFs) lives
  here.
- **Deep-link out to sibling apps, don't reimplement them.** HQ is the infra
  cockpit; a full smart-home platform (Home Assistant) is a separate, better tool
  for device state and control. So the seam is a one-tap **external nav link**
  from the sidebar into that app, not a reimplemented UI inside HQ. The link is
  host-specific (its target host/port varies per instance), so it's declared in
  the gitignored host-local config as `navLinks` and appended to the registry by
  `hostNavLinks()` — self-hiding when unset, resolved against the current
  hostname so it works on the LAN or over Tailscale. Same generic mechanism is
  reusable for any future sibling app.
- **Delayed, shape-matched loading skeletons (opt-in per widget).** Every
  dashboard widget fetches its own endpoint on mount, so there's an unavoidable
  null→data gap on first paint (the System widget's is the most visible — its
  `/system` endpoint blocks ~300ms on `cpu_percent`). Rather than a bare
  "loading…" line that pops in and shifts layout, a widget may pass the shared
  `Widget` frame a `skeleton` node shaped like its real body; the frame reserves
  that height immediately and fades the skeleton in only after a short delay
  (`useDelayedFlag`), so a fast load never flashes a placeholder. Most widgets
  reuse a generic `WidgetSkeleton` (N label/value rows + M bars); the System,
  Storage, Drives, Plex, and Containers cards opt in. It's keyed off `loading`
  (not the absence of children, since a multi-child widget passes a truthy
  `children` array even before its data lands). It stays opt-in — widgets that
  self-hide when unconfigured (Printer, Tailscale) skip it so they never flash a
  skeleton and then vanish on installs without them.
- **Game saves: the in-game battery save (SRAM) is the everyday one; save states
  are explicit snapshots; and we own persistence for both.** EmulatorJS persists
  neither across sessions in our setup (it has browser storage for the ROM and for
  save states but none for SRAM, and even its save-state persistence is unreliable
  through our iframe teardown). Two non-obvious choices fell out of debugging it on
  a real device: (1) **capture SRAM by polling** the live save (`getSaveFile`)
  every few seconds + on page-hide, *not* via EmulatorJS's `saveSaveFiles` event —
  the event doesn't fire before the iframe is destroyed on exit, so saves were
  lost. (2) **Don't auto-load a save state when opening a game** — a save state
  restores the entire machine *including the SRAM frozen at that moment*, so
  auto-loading the newest state on open silently rewound the player's latest
  in-game save. Opening a game now just boots, and the seeded SRAM + the game's own
  "Continue" is the resume; save states stay a deliberate "jump to an exact moment"
  feature. Both sync to `/data/saves` (roam + backup); the local captures sit in a
  separate `hq-game-saves` cache so the downloads storage audit stays exact.
- **Page title lives in the shell, not each page.** The persistent top bar shows
  the current section's name, resolved from the route by `activeModule()` in
  `lib/nav.js` (longest matching path prefix, so a deep route like
  `/plex/movie/123` still titles as "Plex"). Module pages no longer render their
  own top-level `<h2>` — it duplicated the nav label and left the top bar empty
  on desktop. Pages keep only *contextual* headings (a movie title, a library
  name, a Library sub-section). One title, one place, no empty bar.
- **One BackLink for every "go back" affordance.** Detail, list, and reader
  pages all return via a shared `components/BackLink.jsx` ("← Label", muted,
  `to` for a route or `onClick` for history-back) instead of each hand-rolling a
  styled `<Link>`. Keeps back navigation visually identical everywhere.
- **GPU stats via the same host-script pattern (`/api/gpu`).** The backend
  container has no GPU passthrough and no `nvidia-smi`, so it can't read GPU load
  itself — exactly the SMART/VPN/Tailscale situation. A host timer
  (`scripts/gpu-stats.py`) runs `nvidia-smi --query-gpu=…` and writes
  `gpu.json`, which the backend reads via the existing read-only `/smart` mount
  and shapes in a pure `summarize()`. The System dashboard widget adds a GPU +
  VRAM bar fed by `/api/gpu`; the rows self-hide when it's unavailable, so the
  open-source default (no GPU) shows nothing. We surface
  `encoder.stats.sessionCount` (active NVENC sessions) rather than a flaky
  encoder-% — on a Plex box "2 encode sessions" is the meaningful number.
- **Library section nav lives in the Library area, not the global sidebar.**
  Library is a deep sub-app (Games/Books/Comics/Audiobooks/Papers behind one
  nav item), and those sections are data-driven (`/api/library` reflects what's
  configured), so promoting them to the sidebar would mean a dynamic, data-aware
  global nav. Instead a `LibraryNav` pill bar (fed by `libraryNavSections()`)
  shows an "All" pill back to the hub plus the configured, non-empty sections —
  so you hop between them directly without bouncing through the hub, while the
  sidebar stays a static registry. The pill bar renders **once** in a persistent
  `LibraryLayout` (a parent route with an `<Outlet/>`) that wraps the five
  section list routes, so switching sections swaps only the content below — the
  bar stays mounted instead of unmounting/remounting (which made it flicker and
  refetch `/api/library` on every hop). The hub and the detail/player/reader
  routes sit outside the layout (they never showed the switcher).
- **Two-up layouts switch at `sm` (640px), not `md` (768px).** A small tablet in
  portrait (e.g. an 8.3" tablet ≈ 744px wide) sits *just under* Tailwind's `md`,
  so a `md:`-gated two-column layout would leave it on the cramped single-column
  phone view despite having room for two. The multi-column surfaces — the
  dashboard widget masonry, the VPN exit-vs-home comparison, and the Containers
  list+detail master view — therefore go two-up at `sm`, which covers portrait
  tablets (and large phones in landscape) while narrow phones stay single-column.
  The nav itself intentionally stays a slide-in drawer at that width (the
  persistent 224px sidebar only appears at `md`+): on a portrait tablet a fixed
  sidebar would eat the width the content just reclaimed, and a hamburger is a
  fine touch affordance. Rotating to landscape (≈1133px, well past `md`) brings
  the sidebar back.
