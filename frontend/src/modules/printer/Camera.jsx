import { useState } from 'react'
import { API_BASE } from '../../lib/useApi.js'

// Live chamber camera. The backend serves an MJPEG (multipart/x-mixed-replace)
// stream that connects on demand, so a plain <img> renders it natively and the
// browser swaps frames in place — no per-frame refetch or cache-buster. We
// reconnect the <img> (by bumping its key) a few seconds after an error so it
// rides out brief drops, reconnects, or the printer waking from sleep.
export default function CameraView({ className = '' }) {
  const [streamKey, setStreamKey] = useState(0)
  const [status, setStatus] = useState('connecting') // connecting | live | offline

  const reconnect = () => {
    setStatus('offline')
    setTimeout(() => {
      setStatus('connecting')
      setStreamKey((k) => k + 1)
    }, 5000)
  }

  return (
    <div
      className={`relative aspect-video overflow-hidden rounded-xl border border-slate-800 bg-black ${className}`}
    >
      <img
        key={streamKey}
        src={`${API_BASE}/printer/camera/stream`}
        alt="Chamber camera"
        className="h-full w-full object-contain"
        onLoad={() => setStatus('live')}
        onError={reconnect}
      />
      {status !== 'live' && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500">
          {status === 'connecting' ? 'Connecting to camera…' : 'Camera offline'}
        </div>
      )}
    </div>
  )
}
