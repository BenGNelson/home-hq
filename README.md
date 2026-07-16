# Home HQ

_AI-assisted build._

**A self-hosted personal platform for running your own server — a small shell that
modules plug into, grown over time.** One place for system health, storage,
containers, network, media, VPN, a 3D printer, and push alerting — all
reproducible from this repo and configured entirely through the environment.

The platform *is* the project; it never "finishes." Each feature is a
self-contained **module** that hangs off a common **shell** (nav + layout), so
the surface area grows without the core getting messier.

> Built to run a real home server. Every host-specific value — names, paths,
> tokens — comes from a gitignored `.env`, so there is **zero** personal or
> machine-identifying data in this repository. Clone it and point it at your own
> machine.

---

## What it does

| Module | What you get |
|---|---|
| **Dashboard** | At-a-glance widgets: CPU/RAM/OS-disk/uptime (plus GPU load/VRAM/encode sessions when an NVIDIA card is present), storage usage, RAID health, per-drive SMART, running containers, Plex now-playing + recently-added. Key cards are **back-lit by live state** — the System card glows by health (emerald → amber → rose), and Printer / Plex / Tailscale light up while a job is printing / a stream is live / the tailnet is connected. Each card **links through to its module's full page** (on desktop it lifts with a soft accent glow on hover). |
| **Plex** | A fast, searchable library browser backed by a local SQLite cache (movies, shows, episodes), with on-demand detail pages and token-safe proxied artwork (downscaled to cached WebP thumbnails so the poster strips load fast). **Insights** page charts activity over time — concurrent streams, transcode load, and bandwidth — with peak/stream-hours/busiest-hour stats from a lightweight in-app sampler. A **Watch Stats** page breaks down viewing **by person and content type** (donut charts + a leaderboard + most-watched titles) over **week / month / year / all-time**, computed live from Plex's own view history (each item's runtime cached for the hours tally). |
| **Library** | A mobile-first hub for the content you **own and consume directly** — the counterpart to Plex's streamed video. Play your **game ROMs** in the browser (Game Boy / GBA, NES, SNES, Genesis — a self-hosted, all-client-side EmulatorJS) with auto-fetched box art, an **in-game pause menu** (save/load a state, fast-forward, restart — the game blurs behind it, and loading a state drops you straight back in without a reload), and **saves that roam across devices**. Pick up a **Bluetooth controller** and the on-screen buttons get out of the way — the pad drives the game, its Menu button opens the pause menu, and a **Controls** screen lets you decide how the pad maps onto the game (keep the *letters*, so A means A — or keep the *positions*, so the bottom button stays the bottom button; there's no mapping that wins both, so it's yours to pick, and every button can be rebound on top, remembered per controller). Opening **Games** launches **Frog** — the library's full-screen games screen (a mascot that wears the colours of whichever machine you're pointing at, a shelf of consoles that never scrolls, "Jump back in" and Favorites rows (star a game on its page) so most sessions never touch the alphabet, and a search across every system). It's built for **both hands and thumbs**: a Bluetooth controller drives it end to end with a dead-key on-screen keyboard that dims the letters leading nowhere — and on a phone the same browser is fully **touch-navigable** (tap a console, tap a game to play, and search with the phone's own keyboard), switching between the two the moment you press a button or touch the glass. It **browses one system at a time** (a console tile → that console's games as an A–Z list, with letter-jumps so a big library is a couple of presses, not sixty). Picking a game opens **its own page** — a big Play, a **favourite** star, **save it for offline**, and its **save states** to jump straight back into (delete guarded by a confirm) — all in Frog's world, never a detour out. With an (optional, free) **IGDB** key the page turns into a proper game page — a screenshot glowing behind the title, the summary, genres and rating, and a **screenshot gallery** you can open fullscreen — matched to your ROMs automatically and cached locally; without a key (or for a ROM hack IGDB doesn't have) it quietly shows the basic page instead. And Frog **works offline** — with the server unreachable it shows the games you've downloaded and swaps the full library back in once you reconnect. Each frog even **holds a little drawing of its console**, so you can tell the two Game Boys apart at a glance. On a phone the in-game **touch controls** are built for thumbs: a d-pad you can slide across for real diagonals, proper multi-touch (hold left, keep tapping B), and hit areas bigger than the buttons you can see. Read your own **ebooks** (EPUB / MOBI / AZW3), **textbooks & reference books** (the same formats, organized into browsable sub-categories like Programming / Cooking / Game Design), **comics** (CBZ / CBR / CB7), and **magazines & papers** (PDF), and listen to **audiobooks** — each with **server-side reading/listening position** that follows you device to device, and cover art on every item. The **hub leads with your content** — the most-recent in-progress item becomes a radiant spotlight (one tap to resume), with cover-art shelves beneath. And **everything is downloadable for offline use**: a service worker caches a book, comic, audiobook, or ROM so it reads/plays with no connection, and your place still syncs back once you're online again. Each section hides until you point it at a folder. |
| **Containers** | Every Docker container with live status, image, uptime, and per-container CPU/mem/network detail, plus an on-demand **log viewer** (tail recent stdout/stderr; sensitive containers can be excluded via config). |
| **Printer** | Live 3D-printer telemetry (Bambu Lab over local MQTT, no cloud) — print state, progress, layer count, time remaining, nozzle/bed/chamber temps, and AMS filament (color-named, in-use spool highlighted). Optional live **chamber camera** (MJPEG stream on the Printer page) and **controls** (pause/resume/stop with a confirm guard, light toggle). Reads on the LAN while the printer stays cloud-connected; the module hides itself until a printer is configured. Logs each completed print to keep a **history with stats** (count, success rate, total print time). |
| **Solar** | Live **Enphase** solar with an energy-flow visual: a glowing radial production **gauge** beside an animated **4-node Solar · Battery · Grid · Home** flow. On systems with **IQ batteries** it shows state-of-charge (with the backup-reserve marker), usable energy, live charge/discharge, and a **self-sufficiency %**; plus warm energy tiles (today / 7-day / lifetime), a produced-vs-used balance, intraday production + battery-charge **curves** (with **today's peak** marked on the curve and called out by the gauge), and a **per-panel array** map (each microinverter shaded by output). Read straight from the Envoy's local API via `pyenphase` (the library HA's own integration uses), so it handles the firmware-7+ token auth and auto-refresh; the module hides itself until an Envoy is configured. |
| **Weather** | Current conditions (temp, feels-like, humidity, wind, today's high/low, with day/night condition icons) over a **sunrise→sunset arc** that rides the sun (or moon) to the location's current time, plus **UV-index** and expected-**precipitation** chips; and a **5-day forecast** as color-coded daily rows (lo→hi range bars) where **tapping a day expands its hourly breakdown** (temp + precipitation). A current-conditions **hero banner** also leads the Dashboard and links here. From **Open-Meteo** — free, no API key. Hides itself until a location is configured. |
| **Network** | Live per-interface throughput graphs, with rates computed client-side from cumulative counters (the backend stays stateless). |
| **VPN** | Egress **leak check** for a container routed through a VPN — compares its public exit IP against the host's own and flags a leak if they match (exit vs home shown side by side), so you can confirm the tunnel is actually carrying its traffic. A host timer does the lookup the unprivileged app can't; a match raises an urgent alert. |
| **Tailscale** | Lists every device on your tailnet — this host plus each peer — with online state, OS, Tailscale IP, last-seen, and which device (if any) is the **exit node**. Fed by a host timer running `tailscale status --json`; the module hides itself until that data exists. |
| **Speed** | ISP speed monitor — current **download / upload / ping** (with the time it was last measured) plus a **history chart** you can scope to the **last 24h / 7d / 30d / 90d / 1yr**, a **Run test** button, and an alert when download drops below a threshold. Runs the official Ookla CLI (baked into the image) on a schedule; configurable cadence (heads-up: each gigabit test moves ~3.5 GB), or set the interval to `0` for manual-only. |
| **Ad Blocking** | A read-only glance at an **AdGuard Home** DNS resolver — blocked %, total/blocked query counts, protection on/off, and the top blocked domains. The resolver itself runs as a separate service (filtering DNS for chosen devices); HQ just reads its API for a dashboard gauge, with pausing/blocklists left to AdGuard's own UI. Hides itself until configured. |
| **Storage** | The disk deep-dive: capacity with a growth projection ("full in ~N weeks") and a **what's-using-space breakdown**, RAID array health in plain language, **live per-disk I/O graphs**, and per-drive SMART with temperature/wear **trend charts** from daily samples kept in SQLite. |
| **Backups** | Lists the host's `age`-encrypted config backups (the encrypt step is a privileged host script; the app only reads the output). |
| **Alerts** | A background rule engine that watches the same data the dashboard shows and pushes a phone notification (via **ntfy**) when something crosses into a bad state — RAID degraded, a SMART warning, a container down, a print finished/failed, a VPN leak, and more. Edge-triggered (no spam), with a deep-link straight to the relevant page on tap, a per-rule **mute** toggle to silence a known-noisy condition, and a dead-man's-switch heartbeat. |
| **Uptime** | Per-service availability monitoring — current up/down, uptime % (24h/7d), latency, and a recent history sparkline for each configured service. A host-side prober checks each target so it can reach even firewall-restricted services. |
| **Home** | A thin, read-only glance at a curated handful of **Home Assistant** entities (laundry state, battery levels, humidity, presence, …), each row deep-linking into HA for control. HQ is the infra cockpit; HA stays the smart-home brain — this is a glance + handoff, not a second smart-home UI. A host timer pulls the allowlist from HA's API with a Long-Lived token; the widget hides itself until that's set up. |
| **Home Catalog** | A floor-by-floor inventory of the whole house — the smart devices (cross-referenced to Home Assistant) *and* everything HA never sees: tools, a 3D printer, computers, appliances, network gear. **Live device state** is overlaid on items wired to HA (a lock's status, a thermostat's temp), each deep-linking into HA for control. Searchable, filterable (in-HA / to-confirm), with at-a-glance stats. It's reference + handoff, not a control surface — the catalog is a host-side YAML you own (set `CATALOG_FILE`); ships with a generic example. |
| **Under the Hood** | An in-app living guide explaining each module, endpoint, and the technologies behind them. |
| **Server Guide** | Renders your own server's markdown operations doc in-app (set `SERVER_GUIDE_FILE`); ships with an example template. |

Every endpoint that touches an external system (Docker, Plex, a mount) **degrades
gracefully** — it returns an `available: false` state instead of erroring, so a
widget can always render something sensible even when a subsystem is down.

**Three docs, three audiences:** this **README** explains the *project* (for
anyone evaluating or installing it); **Under the Hood** explains the *software*
(in-app, for understanding how Home HQ works); the **Server Guide** documents
*your machine* (your own markdown ops doc, kept private, rendered in-app).

---

## Screenshots

> All screenshots are rendered against generic sample data — no real host,
> media, or personal information.

### Dashboard

![Home HQ dashboard](docs/img/dashboard.png)

### Solar — live energy flow & a back-lit production gauge

![Solar module](docs/img/solar.png)

### Weather — sunrise→sunset arc, conditions & a 5-day forecast

![Weather module](docs/img/weather.png)

### 3D printer — live telemetry, controls & chamber camera

![3D Printer module](docs/img/printer.png)

### Storage — capacity projection, RAID & SMART trends

![Storage module](docs/img/storage.png)

### Five built-in themes

One dashboard, cycling through all five palettes — Slate · Carbon · Olive · Crimson · Midnight:

![Theme palettes cycling](docs/img/themes.webp)

### More modules

<table>
  <tr>
    <td width="50%"><b>Plex library</b><br/><img src="docs/img/plex.png" alt="Plex module"/></td>
    <td width="50%"><b>Plex insights</b><br/><img src="docs/img/plex-insights.png" alt="Plex insights module"/></td>
  </tr>
  <tr>
    <td width="50%"><b>Containers</b><br/><img src="docs/img/containers.png" alt="Containers module"/></td>
    <td width="50%"><b>Live network throughput</b><br/><img src="docs/img/network.png" alt="Network module"/></td>
  </tr>
  <tr>
    <td width="50%"><b>Push alerts</b><br/><img src="docs/img/alerts.png" alt="Alerts module"/></td>
    <td width="50%"><b>Tailscale mesh</b><br/><img src="docs/img/tailscale.png" alt="Tailscale module"/></td>
  </tr>
  <tr>
    <td width="50%"><b>Encrypted config backups</b><br/><img src="docs/img/backups.png" alt="Backups module"/></td>
    <td width="50%" align="center"><b>Theme picker</b><br/><img src="docs/img/theme-picker.png" width="62%" alt="Theme picker — live preview tiles"/></td>
  </tr>
</table>

### Mobile (installable PWA)

Responsive layout with a slide-in nav drawer; installs to the phone home screen.

<p>
  <img src="docs/img/mobile-dashboard.png" width="31%" alt="Mobile dashboard"/>
  <img src="docs/img/mobile-nav.png" width="31%" alt="Mobile navigation drawer"/>
  <img src="docs/img/mobile-plex.png" width="31%" alt="Mobile Plex module"/>
</p>

---

## Architecture at a glance

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

- **Frontend** — React + Vite + Tailwind. A **module registry** in `App.jsx` is
  the single seam the platform grows along; the `Shell` renders the sidebar
  (a slide-in drawer on phones) and the active page. Polls the API for live data.
- **Backend** — FastAPI. Each feature is an `APIRouter` mounted under `/api`.
  Data comes from `psutil` (system), the Docker SDK via a read-only socket proxy
  (containers), host `/proc` (network, disk I/O, RAID), `PlexAPI`, and the printer
  over local MQTT (`paho-mqtt`). Every host-specific target is read from config.
  Interactive OpenAPI docs (Swagger UI / ReDoc) are auto-generated and served at
  `/api/docs`, `/api/redoc`, and `/api/openapi.json`.
- **Background workers** — a few daemon threads started in the app lifespan: a
  persistent printer MQTT client, the alert rule engine (pushes via ntfy), and
  lightweight samplers that record SMART/capacity and Plex-activity history. Work
  that needs root (SMART, the VPN egress check, the drive watchdog) lives in
  **privileged host scripts** that write small state files the app reads —
  keeping the app itself unprivileged.
- **Data** — mostly live/ephemeral. The stateful pieces are all **SQLite**: the
  Plex library cache (instant search/sort, rebuildable), plus history/log tables
  for storage trends, Plex insights, print history, and the alert state.

**The full design — endpoints, data flow, the config model, drive-health
split, PWA, and a decision log explaining *why* each choice was made — is in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).**

### Tech stack

`React` · `Vite` · `Tailwind CSS` · `react-router` · `lucide-react` · `vite-plugin-pwa` —
`FastAPI` · `pydantic-settings` · `psutil` · `Docker SDK` · `PlexAPI` ·
`paho-mqtt` · `Pillow` · `libarchive` · `SQLite` — `nginx` · `Docker Compose` · `ntfy` · `pytest` · `Vitest`.

---

## Quick start

```bash
git clone <this-repo> home-hq && cd home-hq
cp .env.example .env          # then edit .env with your real values
docker compose up --build -d  # production build (nginx) on :5173
```

Open `http://localhost:5173`. The backend API is at `:8000` (e.g.
`http://localhost:8000/api/health`). nginx serves the SPA and reverse-proxies
`/api` to the backend, so the browser sees a single origin.

### Configuration

All config lives in `.env` (gitignored); `.env.example` (committed) documents
every value with placeholders only. Nothing secret is ever committed.

| Variable | Meaning |
|---|---|
| `SERVER_NAME` | Display name for this host |
| `RAID_MOUNT` | Storage mount the disk/backup widgets report |
| `PLEX_URL` / `PLEX_TOKEN` | Plex address + token (optional; degrades if unset) |
| `GAMES_ROM_DIR` | Folder of game ROMs for the Library's Games section, under `RAID_MOUNT` (optional; section hides if unset). Install the engine once with `scripts/fetch-emulatorjs.sh`. |
| `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` | Twitch app credentials that unlock **rich game pages** (screenshots/summary/genres/rating from IGDB). Register a free app at [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) (OAuth redirect `http://localhost`, category "Application Integration"). Optional — unset = every game shows its basic page. A background matcher looks each ROM up once and caches it (art in `IGDB_ART_DIR`). |
| `PAPERS_DIR` / `BOOKS_DIR` / `TEXTBOOKS_DIR` / `COMICS_DIR` / `AUDIOBOOKS_DIR` | Folders for the Library's content sections under `RAID_MOUNT` (optional; each section hides if unset). `PAPERS_DIR` = PDFs (magazines/papers); `BOOKS_DIR` = ebooks (EPUB/MOBI/AZW3 + PDFs); `TEXTBOOKS_DIR` = reference/informational books (same formats, organized into sub-category folders); `COMICS_DIR` = comics (CBZ/CBR/CB7); `AUDIOBOOKS_DIR` = audiobooks (folders of audio files). |
| `API_PORT` | Host port the backend listens on |
| `DOCKER_SOCKET` | Host Docker socket path, mounted into the backend |
| `AGE_RECIPIENT` / `BACKUP_DIR` / `BACKUP_RETENTION` | Config-backup settings (optional) |
| `PRINTER_HOST` / `PRINTER_SERIAL` / `PRINTER_ACCESS_CODE` | 3D-printer connection over local MQTT (optional; module hides if unset) |
| `ALERTS_ENABLED` / `NTFY_URL` / `NTFY_TOPIC` | Push alerts via ntfy (optional) |
| `HA_URL` / `HA_TOKEN` / `HA_ENTITIES` | Home Assistant glance: base URL, a Long-Lived Access Token, and the comma-separated entity allowlist to surface (optional; widget hides if unset). The token stays in `.env` only. |
| `ENVOY_HOST` / `ENPHASE_USERNAME` / `ENPHASE_PASSWORD` | Enphase solar: the Envoy's host/IP + your Enlighten login (`pyenphase` mints + auto-refreshes the local token). Optional; module hides if unset. Creds stay in `.env` only. |
| `WEATHER_LAT` / `WEATHER_LON` / `WEATHER_UNITS` | Weather location (decimal coordinates) + units (`us`/`metric`). Optional; module hides if unset. Open-Meteo — no API key. |
| `CATALOG_FILE` | Path to your home-catalog YAML for the **Home Catalog** module (optional; shows a generic example until set). See `docs/home-catalog.example.yaml` for the schema. Your real catalog stays out of git. |
| `SPEEDTEST_INTERVAL` / `SPEEDTEST_MIN_DOWNLOAD` | Speedtest cadence in seconds (`0` = manual-only; ~3.5 GB/gigabit test) + the Mbps threshold below which a slow-internet alert fires (`0` = off). |
| `VITE_API_BASE` | Base path the frontend uses to call the API |

`.env.example` documents the full set (printer camera, alert thresholds, VPN
state path, server-guide file, and more).

### Production vs. dev

The always-on `frontend` service is a **production build served by nginx**.
For hot-reload development, the `frontend-dev` service (compose `dev` profile)
runs the Vite dev server alongside it:

```bash
docker compose up -d                               # production (nginx) on :5173
docker compose --profile dev up -d frontend-dev    # + Vite hot-reload on :5174
```

The production build is also an **installable PWA** (web manifest + service
worker that precaches the app shell but never `/api`), so it installs to a phone
home screen. Installability requires HTTPS (e.g. behind a TLS-terminating proxy).

---

## Adding a module

This is the whole point of the architecture: a new feature is a **router on the
backend** and an **entry in the frontend registry** — nothing else changes.

**Backend** — add `backend/app/routers/foo.py` exposing an `APIRouter`, then one
`include_router(foo.router)` line in `main.py`. It's mounted under `/api/foo`.

**Frontend** — add one entry to the `modules` array and one matching `<Route>` in
`frontend/src/App.jsx`:

```jsx
import { Home, Sparkles } from 'lucide-react' // icons are Lucide components

const modules = [
  { id: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: Home, group: 'Overview' },
  // ...
  { id: 'foo', label: 'Foo', path: '/foo', icon: Sparkles, group: 'System' },   // ← new module
]
```

The `group` decides which labeled sidebar section it lands in (sections render in
the order their groups first appear). The `Shell` picks up the nav entry
automatically; the route renders your page.
Use the shared `useApi(path, interval)` hook to poll your endpoint and get
`{ data, error, loading }` for free.

---

## Testing

Tests run in the project's containers — no host Python/Node/browser toolchain
needed. Two layers:

```bash
scripts/test.sh     # unit: backend (pytest) + frontend (Vitest)
scripts/verify.sh   # e2e smoke: drive the running app in a real browser (needs the stack up)
scripts/deploy.sh   # one-shot: test.sh -> build + deploy prod -> verify.sh
```

**Unit** tests use an isolated temp SQLite DB per test and cover the cache logic,
graceful-degradation paths, and the library-query/search/sort logic; frontend
unit tests cover the pure helpers (formatting, the table sorter). **E2e smoke**
(`e2e/smoke.py`, via the Playwright image) loads every module page in a headless
browser and asserts it renders with no console errors — catching the wired-
together bugs unit tests can't (imports, API shapes, the nginx proxy, build
errors). See the Testing section of
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for details.

---

## Project layout

```
home-hq/
  backend/            # FastAPI: config + /api/* routers + SQLite cache
    app/routers/      # one file per feature (system, disk, containers, …)
    tests/            # pytest
  frontend/           # React + Vite + Tailwind
    src/App.jsx       # the module registry (the growth seam)
    src/shell/        # responsive layout frame
    src/modules/      # one folder per module
    src/lib/          # useApi polling, rate math, format helpers
  scripts/            # host-side helpers (backup, SMART collector, drive watchdog, test runners)
  docs/ARCHITECTURE.md
  docker-compose.yml
  .env.example        # committed; copy to .env (gitignored) and fill in
```

---

## License

[MIT](LICENSE) — do whatever you like; no warranty.
