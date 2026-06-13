import { useApi } from '../../lib/useApi.js'
import { gridColsClass } from '../../lib/cameras.js'
import CameraTile from './CameraTile.jsx'

// Camera wall: a live grid of the Home Assistant cameras the backend bridges.
// HA owns the cameras; this is a read-only view — each tile relays HA's MJPEG
// through our backend (so the browser never holds the HA token). Streams only
// run while the page is open, so cameras sleep when nobody's watching.
export default function Cameras() {
  const { data, error, loading } = useApi('/ha/cameras', 60000)
  const cameras = data?.cameras ?? []

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Cameras</h2>

      {loading && !data && <p className="text-sm text-slate-500">loading…</p>}
      {error && <p className="text-sm text-rose-400">unavailable — {error}</p>}

      {data && !data.available && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <p className="text-amber-400">Cameras unavailable.</p>
          <p className="mt-2 text-sm text-slate-400">
            {data.reason === 'not_configured' ? (
              <>
                Set <code className="rounded bg-slate-800 px-1">HA_URL</code> and{' '}
                <code className="rounded bg-slate-800 px-1">HA_TOKEN</code> in{' '}
                <code className="rounded bg-slate-800 px-1">.env</code> to bridge Home Assistant cameras.
              </>
            ) : (
              'Home Assistant is not reachable from the backend.'
            )}
          </p>
        </div>
      )}

      {data && data.available && cameras.length === 0 && (
        <p className="text-sm text-slate-400">No cameras found in Home Assistant.</p>
      )}

      {cameras.length > 0 && (
        <div className={`grid gap-4 ${gridColsClass(cameras.length)}`}>
          {cameras.map((c) => (
            <CameraTile key={c.entity_id} camera={c} />
          ))}
        </div>
      )}
    </div>
  )
}
