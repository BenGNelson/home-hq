import { Link } from 'react-router-dom'
import { Waypoints, TriangleAlert } from 'lucide-react'
import { useApi } from '../../../lib/useApi.js'
import { tailscaleVerdict, osIcon } from '../../../lib/tailscale.js'
import Widget from './Widget.jsx'

// Compact tailnet summary for the dashboard: the mesh verdict plus the online
// devices at a glance. Hides itself entirely when the host check hasn't run, so
// the dashboard stays clean on setups without Tailscale.
export default function TailscaleWidget() {
  const { data, error, loading } = useApi('/tailscale', 15000)
  if (data && data.available === false) return null

  const verdict = data ? tailscaleVerdict(data) : null
  const devices = data?.available ? [data.self, ...(data.peers || [])].filter(Boolean) : []

  // Back-light by the tailnet verdict (a status hue, like System): emerald when
  // the mesh is up, rose when it's disconnected, flat while indeterminate.
  const accent =
    verdict?.tone === 'good' ? '52,211,153' : verdict?.tone === 'bad' ? '248,113,113' : null

  return (
    <Widget title="Tailscale" loading={loading} error={error} accent={accent}>
      {data && (
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              {verdict.tone === 'good' ? (
                <Waypoints className="h-4 w-4 text-slate-200" aria-hidden="true" />
              ) : verdict.tone === 'bad' ? (
                <TriangleAlert className="h-4 w-4 text-slate-200" aria-hidden="true" />
              ) : (
                <span className="text-base leading-none text-slate-200">○</span>
              )}
              <span className="text-slate-200">{verdict.label}</span>
            </span>
            {data.available && data.status !== 'unavailable' && (
              <span className="text-xs text-slate-400">
                {data.online_total ?? data.online_count}/{data.peer_count + (data.self ? 1 : 0)} online
              </span>
            )}
          </div>

          {devices.length > 0 && (
            <ul className="space-y-1">
              {devices.slice(0, 5).map((d) => {
                const OsIcon = osIcon(d.os)
                return (
                <li key={d.dns_name || d.hostname} className="flex items-center gap-2 text-xs">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      d.online ? 'bg-emerald-400' : 'bg-slate-600'
                    }`}
                  />
                  <OsIcon className="h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden="true" />
                  <span className="truncate text-slate-300">{d.hostname}</span>
                  {d.self && <span className="text-[10px] uppercase text-slate-500">you</span>}
                </li>
                )
              })}
            </ul>
          )}

          <Link to="/tailscale" className="block text-xs text-sky-400 hover:underline">
            View tailnet →
          </Link>
        </div>
      )}
    </Widget>
  )
}
