import { Sun } from 'lucide-react'
import { useApi } from '../../../lib/useApi.js'
import {
  formatWatts,
  formatKwh,
  netLabel,
  solarUnavailableMessage,
  glowIntensity,
  sunGlowFilter,
} from '../../../lib/solar.js'
import { SkeletonLine } from '../../../components/ui.jsx'
import Widget from './Widget.jsx'

// Matches the real body's height (a ~40px sun+watts hero row over a caption
// line) so the card holds its size from the first frame — a generic row-only
// skeleton under-reserves the text-2xl hero and lets the card grow on load.
const solarSkeleton = (
  <div className="space-y-3 text-sm" aria-hidden="true">
    <div className="flex items-center gap-3">
      <SkeletonLine className="h-10 w-10 rounded-full" />
      <SkeletonLine className="h-7 w-24" />
    </div>
    <SkeletonLine className="h-4 w-32" />
  </div>
)

// Compact solar summary for the dashboard. Hides itself entirely when no Envoy
// is configured, so the dashboard stays clean on setups without solar. A glance,
// not the full page: a glowing sun whose halo grows with output, the current
// production, a colored export/import chip, and today's energy.
export default function SolarWidget() {
  const { data, error, loading } = useApi('/solar', 10000)
  if (data && data.available === false && data.reason === 'not_configured') return null

  const unavailable = data && data.available === false
  const p = data?.production
  const net = netLabel(data?.net_watts)
  const glow = glowIntensity(p?.watts_now)

  return (
    <Widget title="Solar" to="/solar" loading={loading} error={error} skeleton={solarSkeleton}>
      {data &&
        (unavailable ? (
          <p className="text-sm text-amber-400">{solarUnavailableMessage(data.reason)}</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-yellow-500/15">
                <Sun
                  className="h-5 w-5 text-yellow-300"
                  aria-hidden="true"
                  style={{ filter: sunGlowFilter(glow, { baseBlur: 4, blurGain: 10, baseAlpha: 0.3 }) }}
                />
              </span>
              <span className="text-2xl font-semibold tabular-nums text-slate-100">
                {formatWatts(p?.watts_now)}
              </span>
              {net && (
                <span className={`ml-auto rounded-full bg-slate-800/60 px-2 py-0.5 text-xs font-medium ${net.tone}`}>
                  {net.text}
                </span>
              )}
            </div>
            <div className="text-xs text-slate-400">
              {formatKwh(p?.watt_hours_today)} produced today
            </div>
          </div>
        ))}
    </Widget>
  )
}
