# Sourced by the git hooks. Builds $FORBIDDEN — a regex alternation of the
# things this repo must never contain (host identifiers, attribution trailers,
# secrets — whatever you list).
#
# The actual values live in the gitignored .githooks/patterns.local (one POSIX
# extended-regex per line; blank lines and "#" comments ignored), so the literal
# host values are ENFORCED without ever being committed. See patterns.local.example.
_hooks_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FORBIDDEN=""
_pat_file="$_hooks_dir/patterns.local"
if [ -f "$_pat_file" ]; then
  while IFS= read -r _line || [ -n "$_line" ]; do
    case "$_line" in '' | \#*) continue ;; esac
    if [ -z "$FORBIDDEN" ]; then
      FORBIDDEN="$_line"
    else
      FORBIDDEN="$FORBIDDEN|$_line"
    fi
  done < "$_pat_file"
fi
