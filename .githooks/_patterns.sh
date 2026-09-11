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
#
# 10.0.0.0/8 is RFC1918 too and is DELIBERATELY NOT LISTED. Reviewed 2026-08-13:
# no machine on this fleet is on a 10.x network (the LAN is 192.168.1.0/24 and
# the tailnet is 100.64/10, both covered above), so a real 10.x address cannot
# leak from here — while `10.0.0.5` is the established fake-host PLACEHOLDER in
# .env.example and the printer tests across two repos. Adding the range would
# block commits on a dozen intentional placeholders and reduce no real risk.
# **If a 10.x network ever joins the fleet, add it here and migrate those
# placeholders first** (to `<host>`, or RFC 5737's 192.0.2.0/24, which is
# reserved for documentation and matches nothing above).
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
