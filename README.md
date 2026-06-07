# Home HQ

A self-hosted personal platform I own end to end. A small **shell** (nav + layout)
that **modules** plug into. Phase 1 module: a **server status dashboard**.

Everything runs in Docker and is reproducible from this repo. No host-specific
values live in the code — they come from the environment (see below), so this
repo is safe to publish and clone.

## Quick start

```bash
git clone <this-repo> home-hq && cd home-hq
cp .env.example .env      # then edit .env with your real values
docker compose up --build
```

The API is then at `http://<host>:${API_PORT}` (default 8000), e.g.
`http://localhost:8000/api/health`.

## Configuration

All config lives in `.env` (gitignored). `.env.example` documents every value
with placeholders. Nothing secret is ever committed.

| Variable | Meaning |
|---|---|
| `SERVER_NAME` | Display name for this host |
| `RAID_MOUNT` | Storage mount reported by the disk widget |
| `PLEX_URL` / `PLEX_TOKEN` | Plex server address + token (token added later) |
| `API_PORT` | Host port the backend listens on |
| `DOCKER_SOCKET` | Path to the host Docker socket (mounted into the backend) |
| `VITE_API_BASE` | Base path the frontend uses to call the API |

## Layout

```
home-hq/
  frontend/   # React + Vite + Tailwind (build step 4-5)
  backend/    # FastAPI — config + /api/* endpoints
  docker-compose.yml
  .env.example  (committed)   .env (gitignored)
```

## Status

Phase 1 in progress: scaffold + config layer + `/api/system` + `/api/health` done.
Next endpoints: `/api/disk`, `/api/containers`, `/api/plex`.
