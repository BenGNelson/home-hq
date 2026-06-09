import { useApi } from '../../../lib/useApi.js'
import { formatAgo, formatBytes } from '../../../lib/format.js'
import Widget from './Widget.jsx'

// Health badge per drive: green OK, amber when there are warnings (e.g.
// reallocated sectors) even if SMART still says "passed", red on FAILED,
// grey when SMART couldn't be read (e.g. a USB bridge).
function badge(d) {
  if (!d.supported) return { label: 'n/a', cls: 'text-slate-500' }
  if (d.passed === false) return { label: 'FAILED', cls: 'text-rose-400' }
  if (d.warnings.length) return { label: 'warn', cls: 'text-amber-400' }
  return { label: 'OK', cls: 'text-emerald-400' }
}

export default function DrivesWidget() {
  const { data, error, loading } = useApi('/smart', 60000)
  const drives = data?.available ? data.drives : []

  return (
    <Widget title="Drives" loading={loading} error={error}>
      {data && !data.available && (
        <p className="text-sm text-slate-500">
          No SMART data yet — the host collector hasn’t run.
        </p>
      )}

      {drives.length > 0 && (
        <div className="space-y-2 text-sm">
          {drives.map((d) => {
            const b = badge(d)
            return (
              <div
                key={d.name}
                className="border-b border-slate-800 pb-2 last:border-0 last:pb-0"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-200">
                    {d.name}
                    {d.model && (
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        {d.model}
                      </span>
                    )}
                  </span>
                  <span className={b.cls} title={d.message || ''}>
                    <span className="mr-1">●</span>
                    {b.label}
                  </span>
                </div>
                {d.supported && (
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
                    {d.capacity_bytes != null && <span>{formatBytes(d.capacity_bytes)}</span>}
                    {d.temperature_c != null && <span>{d.temperature_c}°C</span>}
                    {d.power_on_hours != null && (
                      <span>{d.power_on_hours.toLocaleString()} h</span>
                    )}
                    {d.wear_percent != null && <span>{d.wear_percent}% used</span>}
                  </div>
                )}
                {d.warnings.length > 0 && (
                  <p className="mt-0.5 text-xs text-amber-400/90">
                    {d.warnings.join(' · ')}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {data?.available && data.generated_at && (
        <p className="mt-2 text-xs text-slate-600">as of {formatAgo(data.generated_at)}</p>
      )}
    </Widget>
  )
}
