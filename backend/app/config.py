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

    # --- Plex ---
    plex_url: str = "http://localhost:32400"
    plex_token: str = ""

    # --- Backend ---
    api_port: int = 8000
    docker_socket: str = "/var/run/docker.sock"
    # SQLite cache for the Plex library browser (lives on a Docker volume so it
    # survives rebuilds). Not a secret, but configurable for non-Docker dev.
    db_path: str = "/data/homehq.db"

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
    # Dead-man's switch: the engine pings this URL every tick. Point it at an
    # external check (e.g. Healthchecks.io) that alerts YOU if the pings stop —
    # catches the box/backend/internet going dark, which it can't self-report.
    healthcheck_ping_url: str = ""

    # --- Storage trend history (in-app sampler → SQLite, powers the Storage page) ---
    storage_history_interval: int = 3600  # seconds between trend samples
    storage_history_days: int = 180  # retention + default query window (days)

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

    # --- In-app doc viewers (files mounted read-only into the container) ---
    # Under /readme & /srv-guide, not /app — see the mount note in
    # docker-compose.yml (the test runner bind-mounts ./backend over /app).
    readme_path: str = "/readme/README.md"
    readme_assets_dir: str = "/readme/docs/img"
    # The host's own server guide (markdown). Defaults to the committed example;
    # point SERVER_GUIDE_FILE at your real (gitignored) doc to show that instead.
    server_guide_path: str = "/srv-guide/SERVER_GUIDE.md"

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
