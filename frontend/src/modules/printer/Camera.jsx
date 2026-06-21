import { useEffect, useRef, useState } from 'react'
import { API_BASE } from '../../lib/useApi.js'
import { prefersSnapshot } from '../../lib/camera.js'

const STREAM_URL = `${API_BASE}/printer/camera/stream`
const SNAPSHOT_URL = `${API_BASE}/printer/camera`
// If the MJPEG stream hasn't rendered a frame within this long on the *first*
// attempt, assume the browser can't play it and switch to snapshot polling
// (catches any WebKit the UA check missed). Snapshot mode re-fetches the latest
// frame on this cadence; a dropped live stream reconnects after this delay.
const STREAM_GRACE_MS = 6000
const SNAPSHOT_INTERVAL_MS = 1000
const STREAM_RECONNECT_MS = 5000

// Live chamber camera. By default we render the backend's MJPEG
// (multipart/x-mixed-replace) stream in a plain <img> — the browser swaps
// frames in place over one connection. WebKit (iOS, and Safari on macOS) can't
// do that, so those browsers (and any browser where the stream never loads)
// fall back to polling the single-frame snapshot endpoint. See lib/camera.js.
export default function CameraView({ className = '' }) {
  const [mode, setMode] = useState(() =>
    prefersSnapshot(typeof navigator === 'undefined' ? '' : navigator.userAgent)
      ? 'snapshot'
      : 'stream',
  )
  const [status, setStatus] = useState('connecting') // connecting | live | offline
  // Snapshot mode publishes each successfully-preloaded frame's URL here; the
  // visible <img> only ever points at a frame we've already loaded, so it never
  // flashes the broken-image glyph (e.g. during the camera's 503 warmup).
  const [frameSrc, setFrameSrc] = useState(null)
  const [streamKey, setStreamKey] = useState(0) // bump to reconnect the stream
  const everLive = useRef(false) // has the *stream* ever rendered a frame?
  const reconnectTimer = useRef(null)

  // Snapshot polling: preload the next frame off-screen and only swap the
  // visible src once it actually loads; keep the last good frame on a miss.
  useEffect(() => {
    if (mode !== 'snapshot') return
    let cancelled = false
    let timer
    let gotFrame = false
    let seq = 0
    const tick = () => {
      const url = `${SNAPSHOT_URL}?t=${seq++}`
      const probe = new Image()
      probe.onload = () => {
        if (cancelled) return
        gotFrame = true
        setFrameSrc(url)
        setStatus('live')
        timer = setTimeout(tick, SNAPSHOT_INTERVAL_MS)
      }
      probe.onerror = () => {
        if (cancelled) return
        // 503 while the camera wakes, or a dropped frame — keep the last good
        // frame up (if any) and retry; only show "connecting" if none yet.
        if (!gotFrame) setStatus('connecting')
        timer = setTimeout(tick, SNAPSHOT_INTERVAL_MS)
      }
      probe.src = url
    }
    tick()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [mode])

  // Stream mode: if no frame renders within the grace period on the *initial*
  // attempt, fall back to snapshot polling (covers a WebKit browser the UA
  // check missed). Only the first attempt (streamKey 0) — once the stream has
  // reconnected we've proven the browser can play MJPEG, so a slow-waking
  // printer must not get downgraded to 1fps polling.
  useEffect(() => {
    if (mode !== 'stream' || streamKey !== 0 || status === 'live') return
    const id = setTimeout(() => setMode('snapshot'), STREAM_GRACE_MS)
    return () => clearTimeout(id)
  }, [mode, status, streamKey])

  // Cancel any pending stream-reconnect timer on unmount.
  useEffect(() => () => clearTimeout(reconnectTimer.current), [])

  const onStreamLoad = () => {
    everLive.current = true
    setStatus('live')
  }
  const onStreamError = () => {
    if (!everLive.current) {
      // Never loaded → the browser likely can't play MJPEG; switch to polling
      // rather than reconnecting the same dead stream.
      setMode('snapshot')
      return
    }
    // A live stream dropped (printer sleeping / brief blip) — reconnect it
    // (the browser is proven MJPEG-capable, so keep using the smoother stream).
    setStatus('offline')
    reconnectTimer.current = setTimeout(() => {
      setStatus('connecting')
      setStreamKey((k) => k + 1)
    }, STREAM_RECONNECT_MS)
  }

  return (
    <div
      className={`relative aspect-video overflow-hidden rounded-xl border border-slate-800 bg-black ${className}`}
    >
      {mode === 'stream'
        ? (
          <img
            key={`stream-${streamKey}`}
            src={STREAM_URL}
            alt="Chamber camera"
            className="h-full w-full object-contain"
            onLoad={onStreamLoad}
            onError={onStreamError}
          />
        )
        : (
          frameSrc && (
            <img
              key="snapshot"
              src={frameSrc}
              alt="Chamber camera"
              className="h-full w-full object-contain"
            />
          )
        )}
      {status !== 'live' && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500">
          {status === 'connecting' ? 'Connecting to camera…' : 'Camera offline'}
        </div>
      )}
    </div>
  )
}
