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
