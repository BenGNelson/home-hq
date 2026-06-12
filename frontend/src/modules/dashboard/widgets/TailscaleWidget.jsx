import { Link } from 'react-router-dom'
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

  return (
    <Widget title="Tailscale" loading={loading} error={error}>
      {data && (
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span className="text-base leading-none">
                {verdict.tone === 'good' ? '🔗' : verdict.tone === 'bad' ? '⚠️' : '○'}
              </span>
              <span className="text-slate-200">{verdict.label}</span>
            </span>
            {data.available && data.status !== 'unavailable' && (
              <span className="text-xs text-slate-400">
                {data.online_count}/{data.peer_count + (data.self ? 1 : 0)} online
              </span>
            )}
          </div>

          {devices.length > 0 && (
            <ul className="space-y-1">
              {devices.slice(0, 5).map((d) => (
                <li key={d.dns_name || d.hostname} className="flex items-center gap-2 text-xs">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      d.online ? 'bg-emerald-400' : 'bg-slate-600'
                    }`}
                  />
                  <span className="leading-none">{osIcon(d.os)}</span>
                  <span className="truncate text-slate-300">{d.hostname}</span>
                  {d.self && <span className="text-[10px] uppercase text-slate-500">you</span>}
                </li>
              ))}
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
