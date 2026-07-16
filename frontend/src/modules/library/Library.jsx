import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useApi, API_BASE } from '../../lib/useApi.js'
import { useOnline } from '../../lib/online.jsx'
import { allEntries } from '../../lib/offlineStore.js'
import {
  libraryHeadline,
  resumeHref,
  downloadHref,
  sectionIcon,
  sectionAccent,
  continueAccentKey,
  textbookCoverUrl,
  sectionHref,
} from '../../lib/library.js'
import { progressLabel, progressFraction } from '../../lib/reading.js'
import { formatAgo, formatSize } from '../../lib/format.js'
import { radiantBackdrop, glowFilter } from '../../lib/glow.js'
import { ACCENT_HOVER } from '../../lib/moduleAccent.js'
import { SkeletonLine, AccentArrow } from '../../components/ui.jsx'
import { Inbox, FileQuestion } from 'lucide-react'
import RemoveButton from './RemoveButton.jsx'
import GameCover from './GameCover.jsx'
import BookCover from './BookCover.jsx'
import ComicCover from './ComicCover.jsx'
import AudiobookCover from './AudiobookCover.jsx'
import PaperCover from './PaperCover.jsx'

// Render a section's Lucide icon (mapping lives in lib/library.js, shared with
// the offline section headers).
function SectionIcon({ id, className }) {
  const Icon = sectionIcon(id)
  return <Icon className={className} aria-hidden="true" />
}

// The single source of truth for "which cover component renders a given
// section", so the hub's peek tiles and its resume cards can't drift apart. Each
// adapter takes a content item and emits the section's cover (the audiobook
// cover keys on a folder path, the rest on an item id).
const SECTION_COVERS = {
  games: (item, cls) => <GameCover game={item} className={cls} />,
  books: (item, cls) => <BookCover book={item} className={cls} />,
  textbooks: (item, cls) => <BookCover book={item} src={textbookCoverUrl(item.id)} className={cls} />,
  comics: (item, cls) => <ComicCover comic={item} className={cls} />,
  papers: (item, cls) => <PaperCover paper={item} className={cls} />,
  audiobooks: (item, cls) => <AudiobookCover path={item.id} alt={item.name} className={cls} />,
}

// The right cover for one section's preview ref. Returns null for an unknown
// section so the peek row just thins.
function SectionCover({ sectionKey, refId }) {
  const render = SECTION_COVERS[sectionKey]
  return render ? render({ id: refId, name: '' }) : null
}

// The Library hub: your owned content, played/read in-app. Mobile-first. A
// radiant "spotlight" at the top resumes the most-recent in-progress item (with
// the rest on a slim shelf beneath it), then a grid of section cards that each
// peek at their real cover art and drill into the section's browse page.
export default function Library() {
  const { data, error, loading } = useApi('/library', 30000)
  const { online } = useOnline()
  const sections = data?.sections ?? []

  return (
    <div className="space-y-5">
      {/* Offline, the failure is expected and explained by the global banner —
          only surface a raw error when we're actually online. */}
      {error && online && <p className="text-sm text-rose-400">unavailable — {error}</p>}

      {/* The resume surface: spotlight hero + the rest of "jump back in". Self-
          hides when nothing is in progress. */}
      <JumpBackIn />

      {/* Inbox status — what the host-side sorter has waiting / parked for
          review. Read-only (HQ observes, the host-side sorter acts). Self-hides
          when the inbox is clear. */}
      <InboxStatus />

      {loading && !data ? (
        <SectionsSkeleton />
      ) : (
        data && (
          <>
            <p className="text-sm text-slate-400">{libraryHeadline(data)}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {sections.map((s) => (
                <SectionCard key={s.key} s={s} />
              ))}
            </div>
          </>
        )
      )}

      {/* Downloads sit at the bottom so the content sections are the quick taps;
          offline you reach Downloads via the banner anyway. */}
      <Downloaded />
    </div>
  )
}

// --- loading skeletons (reserve each section's shape so nothing bounces) -----

function ShelfHeading({ children }) {
  return <h3 className="text-sm font-medium uppercase tracking-wide text-slate-500">{children}</h3>
}

// The section-cards grid placeholder (the resume spotlight skeleton is owned by
// JumpBackIn, so it isn't repeated here).
function SectionsSkeleton() {
  return (
    <div className="space-y-5">
      <SkeletonLine className="h-4 w-40" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4"
          >
            <div className="mb-3 flex items-center gap-3">
              <div className="h-5 w-5 animate-pulse rounded bg-slate-800" />
              <SkeletonLine className="h-4 w-24" />
              <SkeletonLine className="ml-auto h-5 w-10" />
            </div>
            <div className="flex gap-2">
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j} className="aspect-[3/4] w-1/4 animate-pulse rounded bg-slate-800" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// The Downloaded cover-grid placeholder.
function DownloadedSkeleton() {
  return (
    <section className="space-y-2">
      <ShelfHeading>Downloaded</ShelfHeading>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-1">
            <div className="aspect-[3/4] w-full animate-pulse rounded-lg bg-slate-800" />
            <SkeletonLine className="h-3 w-full" />
          </div>
        ))}
      </div>
    </section>
  )
}

// The host-side inbox sorter's status, read-only. Shows what's still waiting in
// the drop zone and what the sorter parked as ambiguous (with its reason) so you
// know there's something to clear via the host-side /sort-inbox step. HQ never moves
// files — the RAID is mounted read-only here, by design. Self-hides when the
// inbox + review pile are both empty (or the dirs aren't configured).
function InboxStatus() {
  const { data } = useApi('/library/inbox-status', 30000)
  if (!data || !data.configured) return null
  const { inbox_count, review_count, review } = data
  if (inbox_count === 0 && review_count === 0) return null

  return (
    <section className="space-y-2">
      <ShelfHeading>Inbox</ShelfHeading>
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          <span className="flex items-center gap-2 text-slate-200">
            <Inbox className="h-4 w-4 text-amber-400" aria-hidden="true" />
            <span className="font-medium tabular-nums">{inbox_count}</span> waiting to sort
          </span>
          {review_count > 0 && (
            <span className="flex items-center gap-2 text-slate-200">
              <FileQuestion className="h-4 w-4 text-rose-400" aria-hidden="true" />
              <span className="font-medium tabular-nums">{review_count}</span> need a review
            </span>
          )}
        </div>
        {review_count > 0 && (
          <ul className="mt-3 space-y-1.5">
            {review.slice(0, 6).map((it) => (
              <li key={it.name} className="text-xs">
                <span className="block truncate text-slate-300">{it.name}</span>
                {it.reason && <span className="block truncate text-slate-500">{it.reason}</span>}
              </li>
            ))}
            {review.length > 6 && (
              <li className="text-xs text-slate-500">+{review.length - 6} more…</li>
            )}
          </ul>
        )}
        <p className="mt-3 text-xs text-slate-500">
          New drops are filed automatically; ambiguous items wait here for a manual sort.
        </p>
      </div>
    </section>
  )
}

// The unified resume surface. The most-recent in-progress item becomes the
// radiant spotlight; the rest sit on a slim shelf beneath it (the old "Jump back
// in", folded in so there's a single resume surface, not two stacked). ✕ removes
// an item from the shelf (clears the bookmark / last-played marker — never the
// save files). Hidden when nothing is in progress.
function JumpBackIn() {
  const navigate = useNavigate()
  const { data, loading } = useApi('/library/continue', 30000)
  const [removed, setRemoved] = useState(() => new Set())

  const key = (it) => `${it.kind}:${it.id}`
  const items = (data?.items ?? []).filter((it) => !removed.has(key(it)))
  if (loading && !data)
    return (
      <section className="space-y-3">
        <ShelfHeading>Jump back in</ShelfHeading>
        <div className="h-28 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/40" />
      </section>
    )
  if (items.length === 0) return null

  const remove = (it) => {
    setRemoved((prev) => new Set(prev).add(key(it))) // optimistic
    const url =
      it.kind === 'play'
        ? `${API_BASE}/library/games/last-played?id=${encodeURIComponent(it.id)}`
        : it.kind === 'listen'
          ? `${API_BASE}/library/listen-progress?book=${encodeURIComponent(it.id)}`
          : `${API_BASE}/library/reading-progress?section=${encodeURIComponent(
              it.section
            )}&id=${encodeURIComponent(it.id)}`
    fetch(url, { method: 'DELETE' }).catch(() => {})
  }

  const [hero, ...rest] = items

  return (
    <section className="space-y-3">
      <ShelfHeading>Jump back in</ShelfHeading>
      <SpotlightHero entry={hero} onResume={() => navigate(resumeHref(hero))} onRemove={() => remove(hero)} />
      {rest.length > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {rest.map((it) => (
            <ContinueCard
              key={key(it)}
              entry={it}
              onResume={() => navigate(resumeHref(it))}
              onRemove={() => remove(it)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

// The cover for a resume item, via the same section→cover map the peek tiles
// use (so the two surfaces never drift). A resume item carries its section as a
// kind (play→games, listen→audiobooks) or an explicit reading `section`; with no
// cover source it falls back to a titled tile.
function resumeSectionKey(entry) {
  return continueAccentKey(entry) // play→games, listen→audiobooks, else entry.section
}
function ResumeCover({ entry, className }) {
  const render = SECTION_COVERS[resumeSectionKey(entry)]
  if (render) return render(entry, className)
  return (
    <div className={`flex aspect-[3/4] items-center justify-center rounded-lg bg-slate-800 p-2 text-center ${className}`}>
      <span className="line-clamp-4 text-xs font-medium text-slate-300">{entry.name}</span>
    </div>
  )
}

// A resume item's sub-label — shared by the spotlight hero and the shelf cards
// so the wording stays in lockstep. Games/audiobooks show when they were last
// touched; documents show reading progress.
function resumeSubLabel(entry) {
  if (entry.kind === 'play') return `Saved ${formatAgo(entry.updated_ms / 1000)}`
  if (entry.kind === 'listen') return `Last played ${formatAgo(entry.updated_ms / 1000)}`
  return progressLabel(entry.page, entry.total, entry.fraction)
}

// The radiant spotlight for the single most-recent in-progress item. The one
// allowed radiance moment on the hub (the section grid below stays a calm
// surface) — a back-lit accent in the item's section colour, its cover glowing
// like a light source, with a resume call to action.
function SpotlightHero({ entry, onResume, onRemove }) {
  const accent = sectionAccent(continueAccentKey(entry))
  const isPlay = entry.kind === 'play'
  const isListen = entry.kind === 'listen'
  const sub = resumeSubLabel(entry)
  const pct = isPlay || isListen ? null : Math.round(progressFraction(entry.page, entry.total, entry.fraction) * 100)

  return (
    <div
      className="relative overflow-hidden rounded-2xl border p-4 sm:p-5"
      style={{ borderColor: `rgba(${accent.rgb},0.35)`, background: radiantBackdrop(accent.rgb, 0.18) }}
    >
      <button onClick={onResume} className="flex w-full items-center gap-4 text-left active:opacity-90">
        <div className="w-16 shrink-0 sm:w-20" style={{ filter: glowFilter(accent.rgb, 0.5) }}>
          <ResumeCover entry={entry} className="w-full" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium uppercase tracking-wide" style={{ color: `rgb(${accent.rgb})` }}>
            {isPlay ? 'Resume game' : isListen ? 'Keep listening' : 'Continue reading'}
          </div>
          <div className="truncate text-lg font-semibold text-slate-100">{entry.name}</div>
          <div className="truncate text-sm text-slate-400">{sub}</div>
          {pct != null && (
            <span className="mt-2 block h-1 max-w-xs overflow-hidden rounded bg-slate-800">
              <span className="block h-full" style={{ width: `${pct}%`, background: `rgb(${accent.rgb})` }} />
            </span>
          )}
        </div>
      </button>
      <RemoveButton onClick={onRemove} label="Remove from Jump back in" className="absolute right-2 top-2 h-9 w-9" />
    </div>
  )
}

// Items saved for offline reading, straight from the on-device manifest (no
// server call) — so this is the entry point to your downloads when the server
// is unreachable (on a plane). Newest first; tap to open in the right reader
// (which loads the cached copy via the service worker). Hidden until you've
// saved one.
function Downloaded() {
  const [entries, setEntries] = useState(null)

  useEffect(() => {
    let alive = true
    allEntries()
      .then((e) => alive && setEntries(e))
      .catch(() => alive && setEntries([]))
    return () => {
      alive = false
    }
  }, [])

  if (entries === null) return <DownloadedSkeleton />
  // The shared emulator engine is infrastructure (shown on the Downloads page),
  // not a content tile.
  const content = entries.filter((e) => e.section !== 'emulator')
  if (content.length === 0) return null
  const sorted = [...content].sort((a, b) => (b.date || 0) - (a.date || 0))
  // A grid that grows downward (not a cramped horizontal strip) makes use of the
  // screen. The hub is a teaser — cap it and let "Manage" show the full set.
  const CAP = 12
  const items = sorted.slice(0, CAP)

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium uppercase tracking-wide text-slate-500">Downloaded</h3>
        <Link to="/library/downloads" className="text-xs text-slate-400 active:text-slate-200">
          {sorted.length > CAP ? `See all ${sorted.length} ›` : 'Manage ›'}
        </Link>
      </div>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {items.map((e) => (
          <Link key={e.key} to={downloadHref(e)} className="block active:opacity-80">
            <div className="flex aspect-[3/4] items-center justify-center rounded-lg bg-slate-800 p-2 text-center">
              <span className="line-clamp-5 text-xs font-medium text-slate-300">{e.name}</span>
            </div>
            <span className="mt-1 block truncate text-xs text-slate-200">{e.name}</span>
            <span className="block truncate text-[11px] text-slate-500">{formatSize(e.bytes)}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}

function ContinueCard({ entry, onResume, onRemove }) {
  const isPlay = entry.kind === 'play'
  const isListen = entry.kind === 'listen'
  const sub = resumeSubLabel(entry)

  return (
    <div className="relative w-24 shrink-0">
      <button onClick={onResume} className="block w-full text-left active:opacity-80">
        <ResumeCover entry={entry} className="w-full rounded-lg" />
        <span className="mt-1 block truncate text-xs text-slate-200">{entry.name}</span>
        <span className="block truncate text-[11px] text-slate-500">{sub}</span>
        {!isPlay && !isListen && (
          <span className="mt-1 block h-1 overflow-hidden rounded bg-slate-800">
            <span
              className="block h-full bg-sky-500"
              style={{
                width: `${Math.round(progressFraction(entry.page, entry.total, entry.fraction) * 100)}%`,
              }}
            />
          </span>
        )}
      </button>
      <RemoveButton onClick={onRemove} label="Remove from Jump back in" className="absolute right-1 top-1 h-9 w-9" />
    </div>
  )
}

// A section's peek tile: its accent icon, label + count, and a row of real cover
// art (from the section's preview refs) that hints at what's inside. Taps into
// the section's browse page. Stays a calm card (no per-card glow) so the grid
// reads as one surface — the radiance is reserved for the spotlight above.
function SectionCard({ s }) {
  const enabled = s.configured && s.count > 0
  const accent = sectionAccent(s.key)
  const preview = (s.preview ?? []).slice(0, 4)
  const sub = !s.configured ? 'not set up yet' : s.count === 0 ? 'empty' : null

  const inner = (
    // On desktop hover the card lifts + glows in its section's accent (the same
    // treatment the dashboard widgets use, via ACCENT_HOVER + the --accent var).
    // Touch just navigates on tap (active:bg). Disabled sections stay calm.
    <div
      className={`overflow-hidden rounded-2xl border p-4 ${
        enabled
          ? `border-slate-800 bg-slate-900/60 active:bg-slate-800 ${ACCENT_HOVER}`
          : 'border-slate-800 bg-slate-900/30 transition-colors'
      }`}
      style={enabled ? { '--accent': `rgb(${accent.rgb})` } : undefined}
    >
      <div className="flex items-center gap-3">
        <SectionIcon id={s.key} className={`h-5 w-5 shrink-0 ${enabled ? accent.text : 'text-slate-500'}`} />
        <span className="font-medium text-slate-100">{s.label}</span>
        {enabled ? (
          <>
            <span className="ml-auto text-lg font-semibold tabular-nums text-slate-300">{s.count}</span>
            <AccentArrow className="ml-1.5" />
          </>
        ) : (
          <span className="ml-auto text-sm text-slate-500">{sub}</span>
        )}
      </div>
      {enabled && preview.length > 0 && (
        <div className="mt-3 flex gap-2">
          {preview.map((refId) => (
            <div key={refId} className="w-1/4">
              <SectionCover sectionKey={s.key} refId={refId} />
            </div>
          ))}
        </div>
      )}
    </div>
  )

  return enabled ? (
    <Link to={sectionHref(s.key)} className="block">
      {inner}
    </Link>
  ) : (
    <div className="block cursor-default opacity-70" title="Not configured">
      {inner}
    </div>
  )
}
