import { useApi } from '../../../lib/useApi.js'
import { entityIcon, entityColor, entityLabel, entityValue, lowBattery } from '../../../lib/ha.js'
import { homeAssistantUrl } from '../../../lib/hostLocal.js'
import Widget from './Widget.jsx'

// A thin, read-only glance at a curated handful of Home Assistant entities, each
// row deep-linking into HA for detail/control. HQ is the infra cockpit; HA is
// the smart-home brain — this is NOT a second smart-home UI. Hides itself when
// HA isn't wired up (no collector / not configured), so the dashboard stays
// clean on setups without it.
export default function HomeWidget() {
  const { data, error, loading } = useApi('/ha', 30000)
  if (
    data &&
    data.available === false &&
    (data.reason === 'not_configured' || data.reason === 'no_data')
  ) {
    return null
  }

  const unavailable = data && data.available === false
  const entities = data?.entities ?? []

  return (
    <Widget title="Home" to="/catalog" loading={loading} error={error}>
      {data &&
        (unavailable ? (
          <p className="text-sm text-amber-400">Home Assistant unreachable</p>
        ) : entities.length === 0 ? (
          <p className="text-sm text-slate-400">No devices configured.</p>
        ) : (
          <>
            <ul className="space-y-2 text-sm">
              {entities.map((e) => (
                <Row key={e.entity_id} e={e} />
              ))}
            </ul>
            {data.stale && (
              <p className="mt-2 text-xs text-slate-600">values may be stale</p>
            )}
          </>
        ))}
    </Widget>
  )
}

function Row({ e }) {
  const href = homeAssistantUrl(`/history?entity_id=${encodeURIComponent(e.entity_id)}`)
  const low = lowBattery(e)
  const Icon = entityIcon(e)
  const color = entityColor(e)
  const body = (
    <div className="flex items-center justify-between gap-3">
      <span className="flex min-w-0 items-center gap-2">
        {Icon ? (
          <Icon className={`h-4 w-4 shrink-0 ${color}`} aria-hidden="true" />
        ) : (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-600" aria-hidden="true" />
        )}
        <span className="truncate text-slate-300">{entityLabel(e)}</span>
      </span>
      <span className={`shrink-0 tabular-nums ${low ? 'text-amber-400' : 'text-slate-400'}`}>
        {entityValue(e)}
      </span>
    </div>
  )
  return (
    <li>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="relative z-20 block rounded px-1 py-0.5 -mx-1 hover:bg-slate-800/60"
        >
          {body}
        </a>
      ) : (
        body
      )}
    </li>
  )
}
