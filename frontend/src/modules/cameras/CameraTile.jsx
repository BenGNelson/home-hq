import { useState } from 'react'
import { cameraStreamUrl } from '../../lib/cameras.js'

// One live camera tile. The backend relays an MJPEG (multipart/x-mixed-replace)
// stream that connects on demand, so a plain <img> renders it natively and the
// browser swaps frames in place. On error we wait a few seconds and reconnect
// (bumping the <img> key) so it rides out brief drops or a battery cam waking.
export default function CameraTile({ camera }) {
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
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50">
      <div className="relative aspect-video bg-black">
        <img
          key={streamKey}
          src={cameraStreamUrl(camera.entity_id)}
          alt={camera.name}
          className="h-full w-full object-contain"
          onLoad={() => setStatus('live')}
          onError={reconnect}
        />
        {status !== 'live' && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500">
            {status === 'connecting' ? 'Connecting…' : 'Camera offline'}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-sm font-medium text-slate-200">{camera.name}</span>
        <span
          className={`h-2 w-2 rounded-full ${status === 'live' ? 'bg-emerald-400' : 'bg-slate-600'}`}
          title={status}
        />
      </div>
    </div>
  )
}
