import { useApi } from '../../../lib/useApi.js'
import { WidgetSkeleton } from '../../../components/ui.jsx'
import { formatAgo, formatBytes } from '../../../lib/format.js'
import { watchdogBadge } from '../../../lib/watchdog.js'
import { smartBadge, roleTag } from '../../../lib/storage.js'
import Widget from './Widget.jsx'

export default function DrivesWidget() {
  const { data, error, loading } = useApi('/smart', 60000)
  // The watchdog covers the gap SMART leaves: a USB-bridged external drive whose
  // enclosure blocks SMART passthrough. So we hide SMART's unreadable 'other'
  // disks here and show that drive's health from the watchdog instead, below.
  const { data: wd } = useApi('/drive-watchdog', 60000)
  const drives = (data?.available ? data.drives : []).filter((d) => d.role !== 'other')
  const watched = wd?.available ? wd : null
  const empty = drives.length === 0 && !watched

  return (
    <Widget title="Drives" to="/storage" loading={loading} error={error} skeleton={<WidgetSkeleton rows={4} />}>
      {data && empty && (
        <p className="text-sm text-slate-400">
          No SMART data yet — the host collector hasn’t run.
        </p>
      )}

      {(drives.length > 0 || watched) && (
        <div className="space-y-2 text-sm">
          {drives.map((d) => {
            const b = smartBadge(d)
            const tag = roleTag(d.role)
            return (
              <div
                key={d.name}
                className="border-b border-slate-800 pb-2 last:border-0 last:pb-0"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-200">
                    {d.name}
                    {tag && (
                      <span
                        className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold ${tag.cls}`}
                      >
                        {tag.label}
                      </span>
                    )}
                    {d.model && (
                      <span className="ml-2 text-xs font-normal text-slate-400">
                        {d.model}
                      </span>
                    )}
                  </span>
                  {/* z-20 so the native SMART-diagnostic tooltip stays reachable
                      above the card's stretched-link overlay. */}
                  <span className={`relative z-20 ${b.cls}`} title={d.message || ''}>
                    <span className="mr-1">●</span>
                    {b.label}
                  </span>
                </div>
                {d.supported && (
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-400">
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

          {watched && <WatchedDrive d={watched} />}
        </div>
      )}

      {data?.available && data.generated_at && (
        <p className="mt-2 text-xs text-slate-600">as of {formatAgo(data.generated_at)}</p>
      )}
    </Widget>
  )
}

// The externally-watched USB drive: health comes from the watchdog (SMART can't
// read it through the bridge), with its self-recovery history shown inline.
function WatchedDrive({ d }) {
  const b = watchdogBadge(d)
  return (
    <div className="border-b border-slate-800 pb-2 last:border-0 last:pb-0">
      <div className="flex items-center justify-between">
        <span className="font-medium text-slate-200">
          {d.label || 'External drive'}
          <span className="ml-2 rounded bg-teal-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-teal-300">
            EXT
          </span>
          {d.mount && (
            <span className="ml-2 text-xs font-normal text-slate-400">{d.mount}</span>
          )}
        </span>
        {/* z-20 so the watchdog recovery-note tooltip stays reachable above the
            card's stretched-link overlay. */}
        <span className={`relative z-20 ${b.cls}`} title={d.note || ''}>
          <span className="mr-1">●</span>
          {b.label}
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-400">
        {d.fstype && <span>{d.fstype}</span>}
        {d.recovery_count > 0 && (
          <span>
            {d.recovery_count} auto-recover{d.recovery_count === 1 ? 'y' : 'ies'}
          </span>
        )}
        {d.last_recovery && <span>last {formatAgo(d.last_recovery)}</span>}
      </div>
    </div>
  )
}
