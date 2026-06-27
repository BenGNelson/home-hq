import { useApi } from '../../../lib/useApi.js'
import { formatMinutes } from '../../../lib/format.js'
import { printerUnavailableMessage } from '../../../lib/printer.js'
import { WidgetSkeleton } from '../../../components/ui.jsx'
import Widget from './Widget.jsx'
import StateBadge from '../../printer/StateBadge.jsx'
import { FilamentList } from '../../printer/Filament.jsx'

// Compact printer summary for the dashboard. Hides itself entirely when no
// printer is configured, so the dashboard stays clean on setups without one.
export default function PrinterWidget() {
  const { data, error, loading } = useApi('/printer', 5000)
  if (data && data.available === false && data.reason === 'not_configured') return null

  const unavailable = data && data.available === false
  const p = data?.printer
  const printing = p?.state === 'RUNNING'

  return (
    <Widget
      title={data?.name ?? 'Printer'}
      to="/printer"
      loading={loading}
      error={error}
      skeleton={<WidgetSkeleton rows={3} />}
    >
      {data &&
        (unavailable ? (
          <p className="text-sm text-amber-400">{printerUnavailableMessage(data.reason)}</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <StateBadge printer={p} />
              {printing && p.remaining_min != null && (
                <span className="text-xs text-slate-400">{formatMinutes(p.remaining_min)} left</span>
              )}
            </div>

            {printing && (
              <div>
                <div className="mb-1 flex justify-between text-xs text-slate-400">
                  <span className="truncate">{p.file ?? '—'}</span>
                  <span className="ml-2 shrink-0">{p.progress ?? 0}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${p.progress ?? 0}%` }}
                  />
                </div>
              </div>
            )}

            <div className="flex gap-4 text-xs text-slate-400">
              <span>Nozzle {fmtTemp(p.nozzle?.current)}</span>
              <span>Bed {fmtTemp(p.bed?.current)}</span>
              {p.chamber != null && <span>Chamber {fmtTemp(p.chamber)}</span>}
            </div>

            <FilamentList ams={p.ams} />
          </div>
        ))}
    </Widget>
  )
}

function fmtTemp(t) {
  return t == null ? '—' : `${Math.round(t)}°`
}
