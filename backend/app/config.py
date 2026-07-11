"""
Central configuration for the Home HQ backend.

Everything host-specific (paths, ports, tokens, URLs) is read from the
environment here and NOWHERE ELSE in the code. That keeps secrets out of git
and makes the project reusable: anyone who clones it just supplies their own
.env. This is the "12-factor app" config principle.

pydantic-settings does three useful things for us:
  1. Reads values from environment variables (and a local .env in dev).
  2. Validates/coerces types (e.g. API_PORT becomes a real int).
  3. Gives us a single typed `settings` object to import anywhere.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # The attribute names are lowercase; pydantic matches them to the
    # UPPERCASE env vars case-insensitively (SERVER_NAME -> server_name).

    # --- Server / system ---
    server_name: str = "home-server"
    raid_mount: str = "/mnt/storage"
    # The OS/root filesystem to report on the System widget. Defaults to "/",
    # which inside the container is the overlay backed by the host's OS disk —
    # so usage matches the host root without an extra mount (verified on this
    # box). Override only if the container's root lives on a different device.
    system_disk_mount: str = "/"

    # --- Plex ---
    plex_url: str = "http://localhost:32400"
    plex_token: str = ""

    # --- Library (your owned games + reading content, played/read in-app) ---
    # Per-section content dirs. Keep them under RAID_MOUNT so they're readable via
    # the existing read-only RAID mount (no extra mount needed) — same trick as
    # BACKUP_DIR. Empty/missing = that section reports "not configured" and the
    # hub hides it. Read-only: the backend only lists + streams files, never
    # writes. Phase 1 ships the games section (Game Boy/Color .gb/.gbc + GBA .gba);
    # the reading sections (comics/books/papers) get their own dirs as they land.
    games_rom_dir: str = ""
    # Reading sections (each its own content dir under RAID_MOUNT, served by the
    # existing read-only mount). Papers = magazines / journals / PDFs, read in
    # the browser via PDF.js. Books = EPUB/MOBI/AZW3 (and PDFs), read via
    # foliate-js (the MOBI/AZW3 parser is built in — no server-side conversion).
    papers_dir: str = ""
    books_dir: str = ""
    # Textbooks = reference / informational books (programming, cooking, game
    # design, music theory, RPG, reference), same file types as Books but
    # organized into sub-category folders on disk, so the section browses as a
    # folder tree. Its own content dir under RAID_MOUNT (the host-side sorter
    # files books here vs into the fiction ebooks dir).
    textbooks_dir: str = ""
    # The host-side inbox sorter's drop zone + review pile (under RAID_MOUNT, read
    # via the existing read-only mount). HQ only OBSERVES these — it shows what's
    # waiting and what the sorter parked for review; it never moves files (that's
    # the host-side sorter's job). Unset = the inbox status card hides.
    inbox_dir: str = ""
    needs_review_dir: str = ""
    # Comics = CBZ/CBR/CB7 archives of page images, read page-by-page in the
    # browser (the backend extracts + downscales each page; see app/comics.py).
    comics_dir: str = ""
    # Audiobooks = folders of ordered audio files (a book = a folder, its files =
    # chapters), played in-browser by the audio player. Streamed via the same
    # range-capable /library/file, so no special endpoint.
    audiobooks_dir: str = ""
    # Books search index: a background worker parses each ebook's embedded
    # title/author into a small text-only SQLite cache so Books is searchable by
    # title or author. Set false to disable; interval is how often it re-scans
    # for new/changed files (unchanged files are skipped by mtime).
    books_index_enabled: bool = True
    books_index_interval: int = 3600
    # Where downloaded game box art is cached (a writable Docker volume, like the
    # SQLite DB). The backend matches each ROM to libretro-thumbnails art by its
    # No-Intro name, fetches it once, and serves it locally thereafter.
    covers_dir: str = "/data/covers"
    # Where game save states are stored (state blob + screenshot per slot). On
    # the same writable volume as the DB, which lives under the host's / — so
    # saves roam across devices AND ride the off-site restic backup (the RAID is
    # NOT in that backup). Capped per upload so a bad client can't fill the disk.
    games_saves_dir: str = "/data/saves"
    # Where Plex posters are cached (downscaled WebP, keyed by rating key) so
    # repeat loads skip the per-image Plex round-trip. Same writable volume.
    plex_art_dir: str = "/data/plex-art"
    # Where extracted book cover thumbnails are cached (WebP, keyed by a hash of
    # the item id). Same writable volume; a book's embedded cover is pulled on
    # first view, downscaled, and served locally thereafter — no covers for books
    # you never open (keeps the cache small even for a huge library).
    book_covers_dir: str = "/data/book-covers"
    # Textbook cover thumbnails — same on-demand WebP cache as book covers, but a
    # separate dir so a textbook and a fiction book that happen to share a
    # relative path can't collide on the same cache key.
    textbook_covers_dir: str = "/data/textbook-covers"
    # Where audiobook cover thumbnails are cached (WebP, keyed by a hash of the
    # book folder path). The cover comes from a folder image or the first
    # chapter's embedded art, extracted on first view.
    audiobook_covers_dir: str = "/data/audiobook-covers"
    # Where rendered magazine/paper cover thumbnails are cached (WebP, keyed by a
    # hash of the item id). A PDF has no embedded cover, so its first page is
    # rendered on first view (a magazine's first page is its cover).
    paper_covers_dir: str = "/data/paper-covers"
    # Where extracted comic pages are cached (downscaled WebP, keyed by a hash of
    # the comic id + page index). Same writable volume; a page is pulled from the
    # archive on first view and served locally thereafter, so paging is fast and
    # only comics you open take cache space.
    comic_pages_dir: str = "/data/comic-pages"

    # --- Backend ---
    api_port: int = 8000
    docker_socket: str = "/var/run/docker.sock"
    # SQLite cache for the Plex library browser (lives on a Docker volume so it
    # survives rebuilds). Not a secret, but configurable for non-Docker dev.
    db_path: str = "/data/homehq.db"
    # Container log viewer: a comma-separated list of container names whose logs
    # the /api/containers/{name}/logs endpoint refuses to return. Logs can carry
    # secrets/activity an app prints to stdout, so list the sensitive ones here
    # (e.g. a VPN gateway or a download client). Empty = every container's logs are readable
    # (still only over the LAN/tailnet — never the public internet).
    container_logs_exclude: str = ""

    # Comma-separated browser origins allowed to call the API cross-origin (CORS).
    # The SPA is served same-origin behind nginx, so it needs NOTHING here; leave
    # empty to deny all cross-origin browser access (the secure default). Only add
    # an origin if some other browser app must reach the API directly.
    cors_allow_origins: str = ""

    # --- Config backup (read-only listing; backups are created by a host script) ---
    backup_dir: str = ""  # where encrypted backups land (under RAID_MOUNT)
    age_recipient: str = ""  # public key — presence = "backups configured"
    backup_retention: int = 14

    # --- SMART drive health (collected by a host root timer; we only read it) ---
    smart_json_path: str = "/smart/smart.json"
    # State file written by the host external-drive watchdog (scripts/drive-
    # watchdog.sh), read via the same /smart mount. Lets the Drives widget show a
    # USB-bridged drive whose SMART can't be read through the enclosure.
    watchdog_state_path: str = "/smart/drive-watchdog.json"
    # Append-only recovery-event log (JSONL) the watchdog writes; read via the
    # same /smart mount so the Storage page can show recent wedge/recovery events.
    watchdog_events_path: str = "/smart/drive-watchdog-events.jsonl"
    # VPN egress state written by a host timer (scripts/vpn-health.py), read via
    # the same /smart mount. It records the protected container's public egress
    # IP vs the host's own (home) IP so the backend can flag a leak — the app
    # itself can't see the VPN namespace, so the host script does the lookup.
    vpn_json_path: str = "/smart/vpn.json"
    # Tailscale mesh status written by a host timer (scripts/tailscale-status.py),
    # read via the same /smart mount. The backend container has no tailscale
    # binary/socket, so the host script runs `tailscale status --json` for it.
    tailscale_json_path: str = "/smart/tailscale.json"

    # NVIDIA GPU stats written by a host timer (scripts/gpu-stats.py), read via
    # the same /smart mount. The backend container has no GPU passthrough or
    # nvidia-smi, so the host script runs it. Absent file -> the System widget
    # simply hides its GPU rows (host-agnostic: most installs have no GPU).
    gpu_json_path: str = "/smart/gpu.json"

    # Home Assistant curated-entity snapshot written by a host timer
    # (scripts/ha-state.py), read via the same /smart mount. The backend holds no
    # HA URL or token — the host script calls HA's REST /api/states with a
    # Long-Lived Access Token, trims to the allowlist, and writes ha.json. The
    # bridge is read-only (a glance + deep-link into HA), per the brain/cockpit
    # split. Absent file -> the Home widget simply hides itself.
    ha_json_path: str = "/smart/ha.json"
    # Live HA state for the catalog's entities, written by the same collector
    # (ha-state.py) as a second slice of its one /api/states fetch. Read via the
    # same /smart mount; the Home Catalog overlays these onto matching items.
    ha_catalog_state_path: str = "/smart/ha-catalog.json"

    # --- Alerting (push notifications via ntfy) ---
    # Push lands on the phone over normal internet (no tailnet needed). The topic
    # name is a shared secret — use an unguessable one. Empty topic disables push.
    alerts_enabled: bool = False
    ntfy_url: str = "https://ntfy.sh"
    ntfy_topic: str = ""
    ntfy_token: str = ""  # optional: self-hosted / reserved (auth) topics
    alert_click_url: str = ""  # optional URL opened when a notification is tapped
    alert_interval: int = 120  # seconds between rule evaluations
    alert_disk_percent: int = 95  # warn when a filesystem is at/above this % full
    alert_backup_max_age_days: int = 8  # warn if no fresh backup in this many days
    alert_db_max_mb: int = 200  # warn if the SQLite DB grows past this many MB
    # Dead-man's switch: the engine pings this URL every tick. Point it at an
    # external check (e.g. Healthchecks.io) that alerts YOU if the pings stop —
    # catches the box/backend/internet going dark, which it can't self-report.
    healthcheck_ping_url: str = ""

    # --- Storage trend history (in-app sampler → SQLite, powers the Storage page) ---
    storage_history_interval: int = 3600  # seconds between trend samples
    storage_history_days: int = 180  # retention + default query window (days)

    # --- Plex activity history (in-app sampler → SQLite, powers the Plex insights page) ---
    plex_history_interval: int = 300  # seconds between activity samples
    plex_history_days: int = 30  # retention window (days)

    # --- Speedtest / ISP monitor (in-app sampler → SQLite, runs the Ookla CLI) ---
    # All optional. The backend shells out to the Ookla `speedtest` binary (baked
    # into the image) on a schedule, stores each result, and serves the trend.
    # !! DATA COST: each gigabit test moves ~3.5 GB of traffic. Because that's a
    # surprising/expensive thing to do automatically, the scheduler is OFF by
    # default — set SPEEDTEST_ENABLED=true to opt in (then SPEEDTEST_INTERVAL
    # controls cadence; 6h = 4 tests/day ≈ 14 GB/day). The manual /run button
    # works regardless. SPEEDTEST_INTERVAL=0 also disables the schedule.
    speedtest_enabled: bool = False
    speedtest_interval: int = 21600  # seconds between scheduled tests (0 = manual-only)
    speedtest_retention_days: int = 365  # retention window (days) — a year so the chart's 1y range fills in
    speedtest_min_download: float = 0  # Mbps; >0 → alert when latest download is below it (0 = no alert)

    # --- Uptime monitoring (host prober → JSON, powers the Uptime page) ---
    # The probing itself is done by a host script (scripts/uptime-probe.py) so it
    # can reach LAN-restricted services the firewalled backend can't; it writes
    # uptime.json, which the backend reads via the same /smart mount as SMART.
    # The target list / interval are the host script's env (see .env.example).
    uptime_json_path: str = "/smart/uptime.json"

    # --- What's-eating-space (cached daily `du` of the storage mount) ---
    space_scan_enabled: bool = True  # set false to skip the heavy daily du scan
    space_scan_interval: int = 3600  # how often the thread checks if a scan is due
    space_scan_timeout: int = 900  # max seconds a single du may run

    # --- 3D printer (Bambu, LAN mode) ---
    # All optional: if printer_host/serial/access_code are unset the MQTT client
    # never starts and /api/printer reports available:false ("not configured").
    # The access code is a secret — it lives only in .env.
    printer_host: str = ""  # printer's LAN IP / hostname
    printer_serial: str = ""  # device serial (used in the MQTT topic)
    printer_access_code: str = ""  # LAN access code from the printer screen (secret)
    printer_name: str = "3D Printer"  # display label
    printer_mqtt_port: int = 8883  # Bambu LAN MQTT is TLS on 8883
    # Chamber camera (separate TLS stream on :6000). Off by default — it needs
    # its own network reachability (e.g. an extra port-forward) so it's opt-in.
    printer_camera: bool = False
    printer_camera_port: int = 6000
    # Drop the camera connection this many seconds after the last frame request,
    # freeing it for Bambu Studio. The MJPEG stream re-asserts interest each
    # frame, so this only fires once nobody is actually watching.
    printer_camera_idle_timeout: int = 10

    # --- Solar (Enphase Envoy / IQ Gateway, local API via pyenphase) ---
    # All optional: if envoy_host (plus either username/password or a token) are
    # unset, /api/solar reports available:false ("not configured"). The Envoy is
    # read over its local HTTPS API; on firmware 7+ pyenphase mints a token from
    # the Enlighten cloud using the homeowner login + the gateway serial (which it
    # auto-reads from the Envoy) and auto-refreshes it. Creds/token are secrets —
    # they live only in .env.
    envoy_host: str = ""  # Envoy's reachable host/IP (if behind a 2nd router, the forward's WAN IP)
    enphase_username: str = ""  # Enlighten (enphaseenergy.com) homeowner login
    enphase_password: str = ""  # Enlighten password (secret)
    enphase_token: str = ""  # optional: a pre-minted token used instead of user/pass
    solar_cache_ttl: int = 10  # seconds to reuse the last Envoy poll (smooths widget polling)
    # Intraday trend sampler (in-app, like the storage/plex/speedtest samplers):
    # records production/consumption to SQLite while the Envoy is reachable so the
    # Solar page can chart the day's curve. No-op until solar is configured.
    solar_history_interval: int = 300  # seconds between trend samples
    solar_history_days: int = 30  # retention window (days)

    # --- Weather (Open-Meteo — free, NO API key) ---
    # All optional: absent lat/lon => /api/weather reports available:false
    # ("not_configured"). We hit Open-Meteo's free public forecast API directly
    # (no key, no account) for current conditions + a 5-day forecast. The fetch is
    # ~4.5s from the container, so the result is cached aggressively — weather
    # changes slowly. units = "us" (°F / mph / inch) | "metric" (°C / km/h / mm).
    weather_lat: str = ""
    weather_lon: str = ""
    weather_units: str = "us"
    weather_cache_ttl: int = 600  # seconds to reuse the last Open-Meteo poll

    # --- Ad blocking (AdGuard Home — read-only stats glance) ---
    # All optional: absent adguard_host => /api/adguard reports available:false
    # ("not_configured"). The ad-blocking resolver itself is a SEPARATE host-side
    # service (its own container, filtering DNS for the phone over the mesh VPN);
    # HQ only READS its REST API for a stats glance (blocked %, top domains). The
    # admin password is a secret — it lives only in .env.
    adguard_host: str = ""  # base URL of the AdGuard admin/API (e.g. http://host:3000)
    adguard_username: str = ""  # AdGuard admin login
    adguard_password: str = ""  # AdGuard admin password (secret)
    adguard_cache_ttl: int = 30  # seconds to reuse the last AdGuard poll

    # --- In-app doc viewers (files mounted read-only into the container) ---
    # Under /readme & /srv-guide, not /app — see the mount note in
    # docker-compose.yml (the test runner bind-mounts ./backend over /app).
    readme_path: str = "/readme/README.md"
    readme_assets_dir: str = "/readme/docs/img"
    # The host's own server guide (markdown). Defaults to the committed example;
    # point SERVER_GUIDE_FILE at your real (gitignored) doc to show that instead.
    server_guide_path: str = "/srv-guide/SERVER_GUIDE.md"
    # The home catalog (YAML): a floor-by-floor inventory of the house — smart
    # devices (cross-referenced to HA), appliances, AND non-HA physical things
    # (tools, 3D printer, computers, infra). Defaults to the committed generic
    # example; point CATALOG_FILE at your real (gitignored, host-side) catalog to
    # show that instead. Read-only — the backend only parses + serves it.
    catalog_path: str = "/catalog/home-catalog.yaml"

    model_config = SettingsConfigDict(
        # In local (non-Docker) dev, also read a .env file sitting next to the repo.
        # In Docker, the values come from the environment instead (compose injects them),
        # so a missing .env here is fine.
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",  # ignore env vars we don't define (e.g. frontend's VITE_*)
    )


# Import this single instance everywhere: `from app.config import settings`
settings = Settings()
