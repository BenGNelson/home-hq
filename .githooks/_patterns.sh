# Sourced by the git hooks. Builds $FORBIDDEN — a regex alternation of the
# things this repo must never contain (host identifiers, attribution trailers,
# secrets).
#
# TWO layers, and both matter:
#
#   1. BASELINE — generic patterns compiled in below. They need no local setup,
#      so a FRESH CLONE is protected immediately. This is the important property:
#      without a baseline, a clone lacking patterns.local silently passes
#      everything while still looking like it is enforcing.
#
#   2. patterns.local — the exact host literals for this machine (one POSIX
#      extended-regex per line; blank lines and "#" comments ignored). Gitignored,
#      so the literal values are ENFORCED without ever being committed.
#      See patterns.local.example.
#
# The hooks exclude .githooks/ from their own scan, so naming the patterns here
# does not trip them.

# --- layer 1: generic baseline, always on ------------------------------------
# AI / assistant attribution. Deliberately does NOT match a bare "AI", so the one
# sanctioned "_AI-assisted build._" line in README.md is not caught.
_baseline_ai='claude|anthropic|co-authored-by'

# Host identifiers: RFC1918 LAN ranges, the Tailscale CGNAT range (100.64-127.x),
# any tailnet domain, and absolute home paths on Linux or macOS.
_baseline_host='192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.'
_baseline_host="$_baseline_host"'|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.'
_baseline_host="$_baseline_host"'|\.ts\.net|/home/[a-z_][a-z0-9_-]*/|/Users/[a-z_][a-z0-9_-]*/'

FORBIDDEN="$_baseline_ai|$_baseline_host"

# --- layer 2: this machine's literals ----------------------------------------
_hooks_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_pat_file="$_hooks_dir/patterns.local"
if [ -f "$_pat_file" ]; then
  while IFS= read -r _line || [ -n "$_line" ]; do
    case "$_line" in '' | \#*) continue ;; esac
    FORBIDDEN="$FORBIDDEN|$_line"
  done < "$_pat_file"
fi
