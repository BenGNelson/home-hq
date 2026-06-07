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
│   widgets)  │     live status    └──────┬───────┘
└─────────────┘                           │
                          reads from:     │
              ┌───────────────┬───────────┼───────────────┐
              ▼               ▼           ▼               ▼
        Docker socket    system stats   Plex API    (Postgres — later)
```

- **Frontend** — renders the module nav + dashboard widgets, polls the API for
  live status. (Build step 4–5; not built yet.)
- **Backend** — exposes `/api/*`; gathers data from Docker, the system, and Plex.
  Every host-specific target comes from config, never hardcoded.
- **Data** — none in Phase 1 (status is live/ephemeral). Add Postgres the first
  time a module needs to remember things.

---

## Backend design

FastAPI app. One concern per file:

```
backend/app/
  main.py            # creates the app, CORS, mounts routers under /api
  config.py          # pydantic-settings: reads ALL host values from env
  routers/
    system.py        # /api/system
    disk.py          # /api/disk
    containers.py    # /api/containers
    plex.py          # /api/plex
```

Each feature is an `APIRouter` included by `main.py` under the `/api` prefix.
Adding a module = add a router file and one `include_router` line.

### Endpoints (Phase 1)

| Endpoint | Returns | How |
|---|---|---|
| `GET /api/health` | liveness + server name | trivial |
| `GET /api/system` | CPU %, RAM used/total, uptime | `psutil` |
| `GET /api/disk` | total/used/free/% for the storage mount | `psutil.disk_usage` |
| `GET /api/containers` | name, status, image, uptime per container | Docker SDK over the socket |
| `GET /api/plex` | reachable? + active stream count | `PlexAPI` client |

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
| `VITE_API_BASE` | base path the frontend uses to call the API |

---

## Packaging

Frontend + backend each in a container, wired by one `docker-compose.yml`.

- The backend mounts the host **Docker socket** (read the note below) and the
  **storage mount** read-only, so it can report container and disk status.
- Run everything with `docker compose up --build`.

### A note on the Docker socket

Mounting the socket gives the backend visibility into all containers. A `:ro`
mount protects the socket *file* but does not make the Docker API read-only.
The proper hardening is a **docker-socket-proxy** that exposes only the
read endpoints we need — planned as a later step.

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

- **Phase 1 (current):** shell + server status dashboard (system, disk,
  containers, plex). No database.
- **After Phase 1:** a lightweight **module registry** so new modules register
  their nav entry + routes in one place; then introduce Postgres and the first
  persistent module.
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
- **Commit at meaningful milestones.** History reads like the build order — one
  coherent, working increment per commit.
- **`PlexAPI` packaging gotcha.** The PyPI package is `PlexAPI`; the Python
  import is `plexapi`. (`python-plexapi` is the project's source name, not the
  installable name.)
