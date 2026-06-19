import { useEffect, useRef, useState } from 'react'
import { fileUrl, formatTime } from '../../lib/library.js'
import { API_BASE } from '../../lib/useApi.js'

// Plays an audiobook = a folder of ordered chapter files. Streams each chapter
// from the range-capable /library/file via a plain <audio> element (so it keeps
// playing when the screen locks), auto-advances chapters, and resumes its saved
// chapter+position server-side (so it roams + joins the Jump-back-in shelf).
// The Media Session API wires up the iOS lock-screen / Control-Center transport.
export default function AudiobookPlayer({ bookPath, bookName, chapters }) {
  const audioRef = useRef(null)
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [ready, setReady] = useState(false) // saved position loaded → safe to set src
  const seekTo = useRef(0) // seconds to apply on the next loadedmetadata
  const playNext = useRef(false) // play once the next chapter is loaded
  const lastSave = useRef(0)
  const stateRef = useRef({ chapterId: null, time: 0 }) // latest, for unmount save

  const current = chapters[idx]
  stateRef.current = { chapterId: current?.id, time }

  // Load saved position once, then allow the audio src to mount on the right chapter.
  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/library/listen-progress?book=${encodeURIComponent(bookPath)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((saved) => {
        if (cancelled) return
        if (saved && saved.chapter_id) {
          const i = chapters.findIndex((c) => c.id === saved.chapter_id)
          if (i >= 0) {
            setIdx(i)
            seekTo.current = saved.position_s || 0
          }
        }
        setReady(true)
      })
      .catch(() => setReady(true))
    return () => {
      cancelled = true
    }
  }, [bookPath]) // chapters are stable for a given book

  const putProgress = (chapterId, position) =>
    fetch(`${API_BASE}/library/listen-progress`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ book_id: bookPath, chapter_id: chapterId, position_s: position }),
    }).catch(() => {})

  const save = (force = false) => {
    const a = audioRef.current
    if (!a || !current) return
    const now = Date.now()
    if (!force && now - lastSave.current < 10000) return // throttle the timeupdate firehose
    lastSave.current = now
    putProgress(current.id, a.currentTime || 0)
  }

  // Save the final position on unmount (reads the latest via a ref to dodge stale closures).
  useEffect(
    () => () => {
      const a = audioRef.current
      if (a && stateRef.current.chapterId) putProgress(stateRef.current.chapterId, a.currentTime || 0)
    },
    []
  )

  const goChapter = (next, autoplay) => {
    if (next < 0 || next >= chapters.length) return
    save(true)
    seekTo.current = 0
    playNext.current = autoplay
    setIdx(next)
  }
  const skip = (delta) => {
    const a = audioRef.current
    if (a) a.currentTime = Math.max(0, Math.min((a.currentTime || 0) + delta, a.duration || 0))
  }
  const togglePlay = () => {
    const a = audioRef.current
    if (!a) return
    a.paused ? a.play().catch(() => {}) : a.pause()
  }

  // Media Session: lock-screen metadata + transport controls.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    try {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: current?.name || bookName,
        artist: bookName,
        album: 'Audiobook',
      })
      const h = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession)
      h('play', () => audioRef.current?.play())
      h('pause', () => audioRef.current?.pause())
      h('previoustrack', () => goChapter(idx - 1, true))
      h('nexttrack', () => goChapter(idx + 1, true))
      h('seekbackward', () => skip(-15))
      h('seekforward', () => skip(15))
    } catch {
      /* older browsers — ignore */
    }
  }, [idx, current, bookName])

  const onLoadedMetadata = () => {
    const a = audioRef.current
    if (!a) return
    setDuration(a.duration || 0)
    if (seekTo.current > 0) {
      a.currentTime = Math.min(seekTo.current, a.duration || seekTo.current)
      seekTo.current = 0
    }
    if (playNext.current) {
      a.play().catch(() => {})
      playNext.current = false
    }
  }
  const onEnded = () => {
    if (idx < chapters.length - 1) goChapter(idx + 1, true)
    else save(true)
  }

  return (
    <div className="space-y-4">
      <audio
        ref={audioRef}
        src={ready && current ? fileUrl('audiobooks', current.id) : undefined}
        preload="metadata"
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={() => {
          setTime(audioRef.current?.currentTime || 0)
          save()
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false)
          save(true)
        }}
        onEnded={onEnded}
      />

      {/* Now playing + transport */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="truncate text-sm text-slate-400">{bookName}</div>
        <div className="mt-0.5 truncate font-medium text-slate-100">
          {current?.name || '—'}
          <span className="ml-2 text-xs text-slate-500">
            ch {idx + 1} / {chapters.length}
          </span>
        </div>

        <input
          type="range"
          min="0"
          max={duration || 0}
          step="1"
          value={Math.min(time, duration || 0)}
          onChange={(e) => {
            const a = audioRef.current
            if (a) {
              a.currentTime = Number(e.target.value)
              setTime(a.currentTime)
            }
          }}
          className="mt-3 w-full accent-emerald-500"
        />
        <div className="flex justify-between text-xs tabular-nums text-slate-500">
          <span>{formatTime(time)}</span>
          <span>{formatTime(duration)}</span>
        </div>

        <div className="mt-3 flex items-center justify-center gap-4">
          <button
            onClick={() => goChapter(idx - 1, playing)}
            disabled={idx <= 0}
            className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-100 active:bg-slate-700 disabled:opacity-40"
            aria-label="Previous chapter"
          >
            ⏮
          </button>
          <button
            onClick={() => skip(-15)}
            className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-100 active:bg-slate-700"
            aria-label="Back 15 seconds"
          >
            ⏪15
          </button>
          <button
            onClick={togglePlay}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-2xl text-white active:bg-emerald-500"
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? '⏸' : '▶'}
          </button>
          <button
            onClick={() => skip(30)}
            className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-100 active:bg-slate-700"
            aria-label="Forward 30 seconds"
          >
            30⏩
          </button>
          <button
            onClick={() => goChapter(idx + 1, playing)}
            disabled={idx >= chapters.length - 1}
            className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-100 active:bg-slate-700 disabled:opacity-40"
            aria-label="Next chapter"
          >
            ⏭
          </button>
        </div>
      </div>

      {/* Chapter list */}
      {chapters.length > 1 && (
        <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
          {chapters.map((c, i) => (
            <li key={c.id}>
              <button
                onClick={() => goChapter(i, true)}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left active:bg-slate-800 ${
                  i === idx ? 'text-emerald-400' : 'text-slate-200'
                }`}
              >
                <span className="w-6 shrink-0 text-xs tabular-nums text-slate-500">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                {i === idx && <span className="shrink-0 text-xs">{playing ? '▶' : '⏸'}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
