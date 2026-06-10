# Server Guide

> **This is an example template.** Home HQ shows it on the **Server Guide** page
> until you point `SERVER_GUIDE_FILE` (in `.env`) at your own markdown doc. Copy
> this, fill it in for your machine, keep your real one out of git, and it shows
> here instead. Think of it as your server's operator manual — the reference you
> wish you had at 2am.

## Machine

| | |
|---|---|
| **Hostname** | _your-host_ |
| **OS** | _e.g. Ubuntu 24.04 LTS_ |
| **CPU / RAM** | _e.g. 6-core / 16 GB_ |
| **Access** | _e.g. `ssh you@host`_ |

## Storage

| Drive | Role | Mount | Notes |
|---|---|---|---|
| _device_ | _OS / array / external_ | _mount point_ | _filesystem, health checks_ |

Document how to check array/disk health, how drives are laid out, and any
recovery steps you'd otherwise forget.

## Services

| Service | Where | Port | Key paths |
|---|---|---|---|
| _service_ | _bare-metal / docker_ | _port_ | _config + data locations_ |

For each service worth noting: how to check status, restart it, read its logs,
and where its config and data live.

## Background jobs & timers

| Unit | Type | Runs | Purpose | Script |
|---|---|---|---|---|
| _unit_ | _service / timer_ | _schedule_ | _what it does_ | _path_ |

Keep this current as you add scheduled jobs — it's the one place to see what runs
unattended. Audit with `systemctl list-timers --all`.

## Network & ports

| Port | Service | Notes |
|---|---|---|
| _port_ | _service_ | _LAN-only / forwarded / etc._ |

Note anything exposed to the internet and why.

## Security posture

Record the deliberate decisions: SSH auth method, firewall state, what's
internet-facing and how it's hardened, share permissions, secrets handling.

## Cheat sheets

Drop the commands you reach for most — container management, systemd, storage
checks — so they're one search away.
