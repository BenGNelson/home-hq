import { useApi } from '../../../lib/useApi.js'
import { WidgetSkeleton, StatusDot } from '../../../components/ui.jsx'
import { formatUptime } from '../../../lib/format.js'
import { containerUrl } from '../../../lib/hostLocal.js'
import Widget from './Widget.jsx'

export default function ContainersWidget() {
  const { data, error, loading } = useApi('/containers', 10000)
  const unavailable = data && data.available === false
  const list = data?.containers ?? []
  const running = list.filter((c) => c.status === 'running').length
  const title = data && !unavailable ? `Containers · ${running}/${list.length}` : 'Containers'

  return (
    <Widget title={title} loading={loading} error={error} skeleton={<WidgetSkeleton rows={6} />}>
      {data &&
        (unavailable ? (
          <p className="text-sm text-amber-400">Docker unavailable</p>
        ) : (
          <ul className="divide-y divide-slate-800 text-sm">
            {list.map((c) => {
              const link = containerUrl(c.name)
              return (
                <li key={c.name} className="flex items-center justify-between py-1.5">
                  <span className="flex items-center gap-2 truncate">
                    <StatusDot ok={c.status === 'running'} />
                    {link ? (
                      <a
                        href={link}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate text-emerald-400 hover:underline"
                      >
                        {c.name} ↗
                      </a>
                    ) : (
                      <span className="truncate text-slate-200">{c.name}</span>
                    )}
                  </span>
                  <span className="ml-2 shrink-0 text-xs text-slate-400">
                    {c.status === 'running' ? formatUptime(c.uptime_seconds) : c.status}
                  </span>
                </li>
              )
            })}
          </ul>
        ))}
    </Widget>
  )
}
