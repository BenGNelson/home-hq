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
    containers.py    # /api/containers + /api/containers/{name}
    network.py       # /api/network  (host interface counters)
    diskio.py        # /api/diskio   (per-disk I/O counters from /proc/diskstats)
    raid.py          # /api/raid     (software-RAID state from /proc/mdstat)
    smart.py         # /api/smart    (per-drive SMART, from a host timer's JSON)
    storage.py       # /api/storage/trends  (SMART + capacity history)
    printer.py       # /api/printer  (cached snapshot from the MQTT client)
    plex.py          # /api/plex + library browser endpoints
  printer.py         # persistent MQTT client: telemetry parser + control commands
  camera.py          # on-demand chamber-camera reader (JPEG over TLS :6000)
  storage_history.py # background sampler: daily SMART+capacity → SQLite; projection
  space_usage.py     # background daily `du` of the mount → cached breakdown
```

Each feature is an `APIRouter` included by `main.py` under the `/api` prefix.
Adding a module = add a router file and one `include_router` line.

### Endpoints

| Endpoint | Returns | How |
|---|---|---|
| `GET /api/health` | liveness + server name | trivial |
| `GET /api/system` | CPU %, RAM used/total, uptime | `psutil` |
| `GET /api/disk` | total/used/free/% for the storage mount | `psutil.disk_usage` |
| `GET /api/containers` | name, status, image, uptime per container | Docker SDK → read-only socket proxy |
| `GET /api/containers/{name}` | one container's live stats (cpu/mem/net) | Docker SDK → read-only socket proxy |
| `GET /api/network` | per-interface byte counters | reads host `/proc/1/net/dev` |
| `GET /api/diskio` | per-disk cumulative read/write bytes (rates computed client-side) | parses host `/proc/diskstats` |
| `GET /api/raid` | software-RAID array state (healthy/degraded, rebuild %) | parses host `/proc/mdstat` |
| `GET /api/smart` | per-drive SMART health; role-tagged (raid/system/other) | reads a host timer's `smart.json` |
| `GET /api/smart/{name}/attributes` | one drive's full SMART attribute table (or NVMe health log), on demand | reads `smart.json` (kept out of the polled list) |
| `GET /api/drive-watchdog` | watched external drive's health + recent recovery events | reads the host watchdog's state JSON + its append-only event log (fills the SMART gap for USB enclosures) |
| `GET /api/storage/trends` | per-drive SMART history + capacity series + days-until-full projection | reads daily samples an in-app background thread records to SQLite |
| `GET /api/storage/space` | top-level "what's using space" breakdown of the mount | serves a cached daily `du` (a background thread scans; never on request) |
| `GET /api/alerts` | push-alert config + every rule's current state + recent log | from the background alert engine |
| `POST /api/alerts/test` | send a test push (confirm the pipe reaches the phone) | posts to ntfy |
| `GET /api/printer` | live 3D-printer telemetry (state/progress/temps/AMS) | cached snapshot from a persistent MQTT client (Bambu LAN) |
| `GET /api/printer/camera/stream` | live chamber-camera MJPEG feed | re-streams the printer's TLS frames (:6000) as `multipart/x-mixed-replace`; one connection, frames pushed as they arrive — what the UI uses |
| `GET /api/printer/camera` | single latest chamber-camera JPEG frame | the same on-demand reader, one frame per request (snapshot/fallback) |
| `POST /api/printer/command` | pause/resume/stop/light (allowlisted) | publishes over the MQTT connection |
| `GET /api/backups` | list encrypted config backups (read-only) | reads BACKUP_DIR (under the RAID mount) |
| `GET /api/readme` | the project README as markdown (in-app viewer) | reads the README mounted read-only |
| `GET /api/readme/asset/{name}` | a screenshot the README references | serves from the mounted docs image dir (bare filename only) |
| `GET /api/server-guide` | the host's own server guide as markdown | reads the SERVER_GUIDE_FILE mounted read-only (defaults to a committed example) |
| `GET /api/plex` | reachable? streams, transcodes, bandwidth | `PlexAPI` client |
| `GET /api/plex/now-playing` | active streams: who/what/where, progress, transcode | `PlexAPI` sessions |
| `GET /api/plex/recently-added` | newest items across libraries (poster strip) | `PlexAPI` |
| `GET /api/plex/libraries` | each library + item counts (+ key) | `PlexAPI` |
| `GET /api/plex/export` | full title manifest (on-demand backup) | `PlexAPI` (heavy) |
| `POST /api/plex/sync` | rebuild the media cache from Plex (background) | `PlexAPI` → SQLite |
| `GET /api/plex/sync/status` | running / last-synced / item count | SQLite meta |
| `GET /api/plex/library/{key}/items` | a library's items (movies or shows) | SQLite cache |
| `GET /api/plex/show/{key}/episodes` | one show's episodes, in order | SQLite cache |
| `GET /api/plex/item/{key}` | rich metadata for one item (detail page) | `PlexAPI` (on-demand) |
| `GET /api/plex/art/{key}` | item poster, proxied so the token stays server-side | `PlexAPI` + stream |

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
the mount on an interval and, on a confirmed wedge, runs the manual recovery
automatically: lazy-unmount → software USB reset (`usbreset`, falling back to a
sysfs authorized-toggle / driver re-bind) → filesystem repair → remount → verify.
It's the same privileged-host / unprivileged-app split as backups and SMART: the
script (root, on the host) does the unmount/reset/fsck; the container never does.

It's fully generic — drive identity (mount, UUID, optional USB `vendor:product`,
fstype, tuning) comes from `.env` under `WATCHDOG_*`, the repair tool is chosen by
filesystem type (or overridden), and it writes a small atomic state JSON
(`WATCHDOG_STATE_JSON`: health + last-recovery + recovery count). The backend
reads that file via the same `/smart` mount and serves it at
`/api/drive-watchdog`, so the **Drives** widget shows the watched drive's health
and self-recovery history — surfacing a drive that SMART can't read through a USB
bridge.

### Alerting (push notifications)

Most of the app is pull-on-demand, but you don't want to *watch* the dashboard to
learn a drive is failing. `app/alerting.py` is a background thread (started in the
lifespan, no-op unless `ALERTS_ENABLED`) that every `ALERT_INTERVAL` seconds
re-reads the same data the dashboard shows and pushes a phone notification when
something crosses into a bad state. Channel is **ntfy** (`app/notify.py`, a one
stdlib POST to `{NTFY_URL}/{NTFY_TOPIC}`) — push lands on the phone over normal
internet, so **no tailnet is needed to receive alerts** (only to tap through to
the dashboard).

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

Two of those deserve a note. **Printer-offline** fires *only* when the printer
vanishes mid-print (last state RUNNING/PAUSE) — a dead telemetry pipe, a crash,
or the upstream router's WAN IP drifting (which silently breaks the printer
host); a normal power-down while idle stays quiet. And a **dead-man's switch**:
each cycle the engine pings `HEALTHCHECK_PING_URL` (point it at an external check
like Healthchecks.io). If the loop — or the whole box — dies, the pings stop and
that external service alerts you. It's the one failure the app can't self-report,
so it's deliberately watched from outside.

### The printer: the one push-based source

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
a watched feed never idles out. `GET /api/printer/camera` still returns a single
latest frame as a snapshot/fallback. The camera is opt-in (`PRINTER_CAMERA`)
because it may need its own network reachability (e.g. a separate port-forward to
the printer).

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
fullscreen. The service worker intentionally does **not** cache `/api` — live
server data always hits the network (`navigateFallbackDenylist`). Icons are
rasterized from `public/favicon.svg` by `frontend/scripts/gen-icons.mjs` (run
manually if the favicon changes). Installability requires HTTPS, which the
Tailscale `serve` HTTPS hostname provides.

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
  is a plain least-squares fit (`project_capacity`), no dependency.
- **Module-local navigation.** Cross-library switching lives in the Plex module
  (a pill bar), not the global sidebar — the shell stays generic so every module
  isn't tempted to inject its own children into it.
- **Commit at meaningful milestones.** History reads like the build order — one
  coherent, working increment per commit.
- **`PlexAPI` packaging gotcha.** The PyPI package is `PlexAPI`; the Python
  import is `plexapi`. (`python-plexapi` is the project's source name, not the
  installable name.)
