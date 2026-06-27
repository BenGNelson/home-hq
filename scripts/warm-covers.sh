#!/usr/bin/env bash
# Warm the Library cover cache — pre-extract covers so the hub + browse pages
# show art immediately instead of filling in lazily on first scroll. Covers are
# extracted on demand and cached (a comic's first page, a rendered PDF page, an
# embedded ebook/audiobook image), so this just visits every cover URL once to
# populate the cache.
#
# Idempotent and safe to re-run: already-cached covers return instantly, and a
# coverless item is remembered as a miss (not re-extracted).
#
# Requires the stack to be UP. Talks to the backend over the API.
#
#   scripts/warm-covers.sh                       # papers + audiobooks + comics
#   scripts/warm-covers.sh comics papers books   # named sections (books/games heavy)
#   scripts/warm-covers.sh all                   # every section (slow first run)
#
# books + games are large (thousands of items) — warming them is a one-time pass
# that can take several minutes; the hub previews already cover the common case.
set -euo pipefail
cd "$(dirname "$0")/.."

API="${API:-http://localhost:8000/api}"
PAR="${PAR:-6}"  # concurrent cover fetches

sections=("$@")
[ ${#sections[@]} -eq 0 ] && sections=(papers audiobooks comics)
[ "${sections[0]}" = "all" ] && sections=(games papers books audiobooks comics)

# The cover URL path + the field the id comes from differ per section. Audiobooks
# key the cover on the book *folder* (the top path segment of a chapter id); the
# rest key on the item id.
cover_url_for() {
  case "$1" in
    games)      echo "library/games/cover?id=" ;;
    papers)     echo "library/papers/cover?id=" ;;
    books)      echo "library/books/cover?id=" ;;
    comics)     echo "library/comics/cover?id=" ;;
    audiobooks) echo "library/audiobooks/cover?path=" ;;
  esac
}

for section in "${sections[@]}"; do
  base=$(cover_url_for "$section")
  if [ -z "$base" ]; then echo "skip unknown section: $section"; continue; fi

  # Books is search-indexed (no flat list); the empty query returns all of them.
  if [ "$section" = books ]; then
    list_url="$API/library/books/search?q=&limit=100000"
  else
    list_url="$API/library/$section"
  fi

  # Extract the cover refs (ids, or distinct folders for audiobooks) as URL-
  # encoded query values, one per line.
  refs=$(curl -s "$list_url" | python3 -c "
import sys, json, urllib.parse
d = json.load(sys.stdin)
items = d.get('items') or []
sec = '$section'
if sec == 'audiobooks':
    # Mirror backend library._audiobook_folders: a book = a chapter's parent dir.
    seen, out = set(), []
    for it in items:
        cid = it.get('id') or ''
        f = cid.rsplit('/', 1)[0] if '/' in cid else ''
        if f and f not in seen:
            seen.add(f); out.append(f)
    refs = out
else:
    refs = [it['id'] for it in items if it.get('id')]
for r in refs:
    print(urllib.parse.quote(r, safe=''))
")
  n=$(printf '%s\n' "$refs" | grep -c . || true)
  echo "warming $section: $n covers (parallel $PAR)…"
  printf '%s\n' "$refs" | grep . | \
    xargs -P "$PAR" -I{} curl -s -o /dev/null "$API/${base}{}" || true
  echo "  $section done"
done
echo "cover warm complete."
