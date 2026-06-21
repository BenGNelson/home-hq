import { useEffect, useRef, useState } from 'react'
import { fileUrl, formatTime, audiobookCoverUrl } from '../../lib/library.js'
import { API_BASE } from '../../lib/useApi.js'
import { saveProgress, resolveResume, listenKey } from '../../lib/progressOutbox.js'
import { useOnline } from '../../lib/online.jsx'
import AudiobookCover from './AudiobookCover.jsx'

// --- transport icons (crisp SVGs that inherit currentColor) ----------------
const Svg = ({ children, className = 'h-6 w-6' }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    {children}
  </svg>
)
const PlayIcon = (p) => (
  <Svg {...p}>
    <path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.78-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14z" />
  </Svg>
)
const PauseIcon = (p) => (
  <Svg {...p}>
    <path d="M7 4.5h3.5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1zm6.5 0H17a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-3.5a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1z" />
  </Svg>
)
const PrevIcon = (p) => (
  <Svg {...p}>
    <path d="M7 6a1 1 0 0 1 2 0v4.7l8.5-5.36A1 1 0 0 1 19 6.2v11.6a1 1 0 0 1-1.5.86L9 13.3V18a1 1 0 0 1-2 0V6z" />
  </Svg>
)
const NextIcon = (p) => (
  <Svg {...p}>
    <path d="M17 6a1 1 0 0 0-2 0v4.7L6.5 5.34A1 1 0 0 0 5 6.2v11.6a1 1 0 0 0 1.5.86L15 13.3V18a1 1 0 0 0 2 0V6z" />
  </Svg>
)
// A circular "replay" arrow (thin stroked ring, so the center stays clear for
// the seconds label). `mirror` flips it for the forward direction.
const SkipCircle = ({ seconds, mirror }) => (
  <span className="relative inline-flex h-9 w-9 items-center justify-center">
    <svg
      viewBox="0 0 24 24"
      className="h-9 w-9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={mirror ? { transform: 'scaleX(-1)' } : undefined}
      aria-hidden="true"
    >
      <path d="M12 4.5a7.5 7.5 0 1 1-7.1 5.2" />
      <path d="M12 1.6 8.7 4.5 12 7.4" />
    </svg>
    <span className="absolute text-[10px] font-bold leading-none">{seconds}</span>
  </span>
)

// Plays an audiobook = a folder of ordered chapter files. Streams each chapter
// from the range-capable /library/file via a plain <audio> element (so it keeps
// playing when the screen locks), auto-advances chapters, and resumes its saved
// chapter+position server-side (so it roams + joins the Jump-back-in shelf).
// The Media Session API wires up the iOS lock-screen / Control-Center transport.
export default function AudiobookPlayer({ bookPath, bookName, chapters }) {
  const { online } = useOnline()
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

  // Load saved position once, then allow the audio src to mount on the right
  // chapter. A queued offline write (if any) is the freshest position — prefer
  // it; otherwise ask the server (roams across devices).
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      // Offline progress wins, else the server when online (roams across
      // devices), else the local copy when offline. Both the local body and the
      // server response carry chapter_id + position_s.
      const saved = await resolveResume({
        key: listenKey(bookPath),
        online,
        serverFetch: async () => {
          const r = await fetch(`${API_BASE}/library/listen-progress?book=${encodeURIComponent(bookPath)}`)
          return r.ok ? await r.json() : null
        },
      })
      if (cancelled) return
      if (saved && saved.chapter_id) {
        const i = chapters.findIndex((c) => c.id === saved.chapter_id)
        if (i >= 0) {
          setIdx(i)
          seekTo.current = saved.position_s || 0
        }
      }
      setReady(true)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [bookPath]) // chapters are stable for a given book

  const putProgress = (chapterId, position) =>
    saveProgress({
      key: listenKey(bookPath),
      path: '/library/listen-progress',
      body: { book_id: bookPath, chapter_id: chapterId, position_s: position },
    })

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
        artwork: [{ src: audiobookCoverUrl(bookPath), sizes: '400x400', type: 'image/webp' }],
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
        <AudiobookCover path={bookPath} alt={bookName} className="mx-auto mb-3 w-40 rounded-lg" />
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

        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            onClick={() => goChapter(idx - 1, playing)}
            disabled={idx <= 0}
            className="flex h-12 w-12 items-center justify-center rounded-full text-slate-300 active:bg-slate-800 disabled:opacity-30"
            aria-label="Previous chapter"
          >
            <PrevIcon className="h-7 w-7" />
          </button>
          <button
            onClick={() => skip(-15)}
            className="flex h-12 w-12 items-center justify-center rounded-full text-slate-300 active:bg-slate-800"
            aria-label="Back 15 seconds"
          >
            <SkipCircle seconds={15} />
          </button>
          <button
            onClick={togglePlay}
            className="mx-1 flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-900/40 active:bg-emerald-500"
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <PauseIcon className="h-9 w-9" /> : <PlayIcon className="ml-0.5 h-9 w-9" />}
          </button>
          <button
            onClick={() => skip(30)}
            className="flex h-12 w-12 items-center justify-center rounded-full text-slate-300 active:bg-slate-800"
            aria-label="Forward 30 seconds"
          >
            <SkipCircle seconds={30} mirror />
          </button>
          <button
            onClick={() => goChapter(idx + 1, playing)}
            disabled={idx >= chapters.length - 1}
            className="flex h-12 w-12 items-center justify-center rounded-full text-slate-300 active:bg-slate-800 disabled:opacity-30"
            aria-label="Next chapter"
          >
            <NextIcon className="h-7 w-7" />
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
                {i === idx &&
                  (playing ? (
                    <PauseIcon className="h-4 w-4 shrink-0 text-emerald-400" />
                  ) : (
                    <PlayIcon className="h-4 w-4 shrink-0 text-emerald-400" />
                  ))}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
