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
| **Dashboard** | At-a-glance widgets: CPU/RAM/uptime, storage usage, RAID health, per-drive SMART, running containers, Plex now-playing + recently-added. |
| **Plex** | A fast, searchable library browser backed by a local SQLite cache (movies, shows, episodes), with on-demand detail pages and token-safe proxied artwork. **Insights** page charts activity over time — concurrent streams, transcode load, and bandwidth — with peak/stream-hours/busiest-hour stats from a lightweight in-app sampler. |
| **Library** | A mobile-first hub for content you **own and consume directly** — the counterpart to Plex's streamed video. Play your game ROMs in the browser (Game Boy / Color / GBA via a self-hosted, pinned EmulatorJS engine, all client-side so the server stays a file server) straight from your storage, with **auto-fetched box art** (matched by name from libretro-thumbnails, cached + proxied), cleaned-up titles, a per-game **detail page**, and a **Recently Played** row. Built on a generic section framework + a read-only, range-capable, traversal-guarded file streamer, so comics, ebooks, and subscription PDFs slot in next. Hides sections you haven't configured. |
| **Containers** | Every Docker container with live status, image, uptime, and per-container CPU/mem/network detail, plus an on-demand **log viewer** (tail recent stdout/stderr; sensitive containers can be excluded via config). |
| **Printer** | Live 3D-printer telemetry (Bambu Lab over local MQTT, no cloud) — print state, progress, layer count, time remaining, nozzle/bed/chamber temps, and AMS filament (color-named, in-use spool highlighted). Optional live **chamber camera** (MJPEG stream on the Printer page) and **controls** (pause/resume/stop with a confirm guard, light toggle). Reads on the LAN while the printer stays cloud-connected; the module hides itself until a printer is configured. Logs each completed print to keep a **history with stats** (count, success rate, total print time). |
| **Network** | Live per-interface throughput graphs, with rates computed client-side from cumulative counters (the backend stays stateless). |
| **VPN** | Egress **leak check** for a VPN-routed container — compares its public exit IP against the host's own and flags a leak if they match (exit vs home shown side by side, with the forwarded port). A host timer does the lookup the unprivileged app can't; a leak raises an urgent alert. |
| **Tailscale** | Lists every device on your tailnet — this host plus each peer — with online state, OS, Tailscale IP, last-seen, and which device (if any) is the **exit node**. Fed by a host timer running `tailscale status --json`; the module hides itself until that data exists. |
| **Storage** | The disk deep-dive: capacity with a growth projection ("full in ~N weeks") and a **what's-using-space breakdown**, RAID array health in plain language, **live per-disk I/O graphs**, and per-drive SMART with temperature/wear **trend charts** from daily samples kept in SQLite. |
| **Backups** | Lists the host's `age`-encrypted config backups (the encrypt step is a privileged host script; the app only reads the output). |
| **Alerts** | A background rule engine that watches the same data the dashboard shows and pushes a phone notification (via **ntfy**) when something crosses into a bad state — RAID degraded, a SMART warning, a container down, a print finished/failed, a VPN leak, and more. Edge-triggered (no spam), with a deep-link straight to the relevant page on tap, a per-rule **mute** toggle to silence a known-noisy condition, and a dead-man's-switch heartbeat. |
| **Uptime** | Per-service availability monitoring — current up/down, uptime % (24h/7d), latency, and a recent history sparkline for each configured service. A host-side prober checks each target so it can reach even firewall-restricted services. |
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
    <td width="50%"><b>VPN egress leak check</b><br/><img src="docs/img/vpn.png" alt="VPN module"/></td>
  </tr>
  <tr>
    <td width="50%"><b>Encrypted config backups</b><br/><img src="docs/img/backups.png" alt="Backups module"/></td>
    <td width="50%"></td>
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

`React` · `Vite` · `Tailwind CSS` · `react-router` · `vite-plugin-pwa` —
`FastAPI` · `pydantic-settings` · `psutil` · `Docker SDK` · `PlexAPI` ·
`paho-mqtt` · `SQLite` — `nginx` · `Docker Compose` · `ntfy` · `pytest` · `Vitest`.

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
| `API_PORT` | Host port the backend listens on |
| `DOCKER_SOCKET` | Host Docker socket path, mounted into the backend |
| `AGE_RECIPIENT` / `BACKUP_DIR` / `BACKUP_RETENTION` | Config-backup settings (optional) |
| `PRINTER_HOST` / `PRINTER_SERIAL` / `PRINTER_ACCESS_CODE` | 3D-printer connection over local MQTT (optional; module hides if unset) |
| `ALERTS_ENABLED` / `NTFY_URL` / `NTFY_TOPIC` | Push alerts via ntfy (optional) |
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
const modules = [
  { id: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: '🏠', group: 'Overview' },
  // ...
  { id: 'foo', label: 'Foo', path: '/foo', icon: '✨', group: 'System' },   // ← new module
]
```

The `group` decides which labeled sidebar section it lands in (sections render in
the order their groups first appear). The `Shell` picks up the nav entry
automatically; the route renders your page.
Use the shared `useApi(path, interval)` hook to poll your endpoint and get
`{ data, error, loading }` for free.

---

## Testing

Tests run in the project's containers — no host Python/Node toolchain needed.

```bash
scripts/test.sh   # runs backend (pytest) + frontend (Vitest) suites
```

Backend tests use an isolated temp SQLite DB per test and cover the cache logic,
graceful-degradation paths, and the library-query/search/sort logic. Frontend
tests cover the pure helpers (formatting, the table sorter). See the Testing
section of [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for details.

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
