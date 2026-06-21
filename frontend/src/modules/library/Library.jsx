import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useApi, API_BASE } from '../../lib/useApi.js'
import { useOnline } from '../../lib/online.jsx'
import { allEntries } from '../../lib/offlineStore.js'
import { libraryHeadline, resumeHref, readerHref } from '../../lib/library.js'
import { progressLabel, progressFraction } from '../../lib/reading.js'
import { formatAgo, formatSize } from '../../lib/format.js'
import GameCover from './GameCover.jsx'
import BookCover from './BookCover.jsx'
import ComicCover from './ComicCover.jsx'
import AudiobookCover from './AudiobookCover.jsx'

// The Library hub: your owned content (games + magazines/papers now, more
// later), played/read in-app. Mobile-first — big tap-target section cards that
// drill into a section's browse page. A "Jump back in" shelf at the top resumes
// in-progress content across types: documents (to the page) and games (into the
// last save state), so you skip the drill-down.
export default function Library() {
  const { data, error, loading } = useApi('/library', 30000)
  const { online } = useOnline()

  return (
    <div className="space-y-4">

      {loading && !data && <p className="text-sm text-slate-500">loading…</p>}
      {/* Offline, the failure is expected and explained by the global banner —
          only surface a raw error when we're actually online. */}
      {error && online && <p className="text-sm text-rose-400">unavailable — {error}</p>}

      <JumpBackIn />
      <Downloaded />

      {data && (
        <>
          <p className="text-sm text-slate-400">{libraryHeadline(data)}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.sections.map((s) => (
              <SectionCard key={s.key} s={s} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// Unified resume shelf: in-progress documents (resume to page) + recently-played
// games (resume the newest save state), newest first. Tap to jump straight in;
// ✕ removes from the shelf (clears the bookmark / last-played marker — never the
// save files). Hidden when empty.
function JumpBackIn() {
  const navigate = useNavigate()
  const { data } = useApi('/library/continue', 30000)
  const [removed, setRemoved] = useState(() => new Set())

  const key = (it) => `${it.kind}:${it.id}`
  const items = (data?.items ?? []).filter((it) => !removed.has(key(it)))
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

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium uppercase tracking-wide text-slate-500">Jump back in</h3>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {items.map((it) => (
          <ContinueCard
            key={key(it)}
            entry={it}
            onResume={() => navigate(resumeHref(it))}
            onRemove={() => remove(it)}
          />
        ))}
      </div>
    </section>
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

  if (!entries || entries.length === 0) return null
  const items = [...entries].sort((a, b) => (b.date || 0) - (a.date || 0))

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium uppercase tracking-wide text-slate-500">Downloaded</h3>
        <Link to="/library/downloads" className="text-xs text-slate-400 active:text-slate-200">
          Manage ›
        </Link>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {items.map((e) => (
          <Link
            key={e.key}
            to={readerHref(e.section, { id: e.id, reader: e.reader })}
            className="block w-28 shrink-0 active:opacity-80"
          >
            <div className="flex aspect-[3/4] items-center justify-center rounded-lg bg-slate-800 p-2 text-center">
              <span className="line-clamp-5 text-xs font-medium text-slate-300">{e.name}</span>
            </div>
            <span className="mt-1 block truncate text-xs text-slate-200">{e.name}</span>
            <span className="block truncate text-[11px] text-slate-500">
              {formatSize(e.bytes)} · offline
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}

function ContinueCard({ entry, onResume, onRemove }) {
  const isPlay = entry.kind === 'play'
  const isListen = entry.kind === 'listen'
  // Books + comics have cover art (extracted from the file); show it like game
  // box art. Papers (PDFs) and audiobooks have no cover source (v1), so they
  // keep a title / icon tile.
  const isBook = !isPlay && entry.section === 'books'
  const isComic = !isPlay && entry.section === 'comics'
  const sub = isPlay
    ? `saved ${formatAgo(entry.updated_ms / 1000)}`
    : isListen
      ? `${formatAgo(entry.updated_ms / 1000)}`
      : progressLabel(entry.page, entry.total, entry.fraction)

  return (
    <div className="relative w-28 shrink-0">
      <button onClick={onResume} className="block w-full text-left active:opacity-80">
        {isPlay ? (
          <GameCover game={entry} />
        ) : isBook ? (
          <BookCover book={entry} className="w-full rounded-lg" />
        ) : isComic ? (
          <ComicCover comic={entry} className="w-full rounded-lg" />
        ) : isListen ? (
          <AudiobookCover path={entry.id} alt={entry.name} className="w-full rounded-lg" />
        ) : (
          <div className="flex aspect-[3/4] items-center justify-center rounded-lg bg-slate-800 p-2 text-center">
            <span className="line-clamp-5 text-xs font-medium text-slate-300">{entry.name}</span>
          </div>
        )}
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
      <button
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        aria-label="Remove from Jump back in"
        className="absolute right-1 top-1 flex h-9 w-9 items-center justify-center rounded-full bg-black/70 text-base leading-none text-slate-100 shadow active:bg-black/90"
      >
        ✕
      </button>
    </div>
  )
}

function SectionCard({ s }) {
  const enabled = s.configured && s.count > 0
  const sub = !s.configured
    ? 'not set up yet'
    : s.count === 0
      ? 'empty'
      : `${s.count} item${s.count === 1 ? '' : 's'}`

  const inner = (
    <div
      className={`flex items-center gap-4 rounded-2xl border p-5 transition-colors ${
        enabled
          ? 'border-slate-700 bg-slate-900/60 active:bg-slate-800'
          : 'border-slate-800 bg-slate-900/30'
      }`}
    >
      <span className="text-3xl">{s.icon}</span>
      <div className="min-w-0">
        <div className="font-medium text-slate-100">{s.label}</div>
        <div className="text-sm text-slate-400">{sub}</div>
      </div>
    </div>
  )

  return enabled ? (
    <Link to={`/library/${s.key}`} className="block">
      {inner}
    </Link>
  ) : (
    <div className="block cursor-default opacity-70" title="Not configured">
      {inner}
    </div>
  )
}
