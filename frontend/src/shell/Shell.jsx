import { NavLink } from 'react-router-dom'
import { useApi } from '../lib/useApi.js'

// A live health indicator: green when the API answers, red when it doesn't.
function StatusDot() {
  const { data, error } = useApi('/health', 10000)
  const ok = !error && data?.status === 'ok'
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-400">
      <span
        className={`inline-block h-2 w-2 rounded-full ${
          ok ? 'bg-emerald-500' : 'bg-rose-500'
        }`}
      />
      {ok ? 'online' : 'offline'}
    </span>
  )
}

// The shell: a persistent sidebar (nav) + a content area where the active
// module renders. This frame stays constant as modules come and go.
export default function Shell({ modules, children }) {
  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <aside className="w-56 shrink-0 border-r border-slate-800 bg-slate-900/50 p-4">
        <div className="mb-6 px-2">
          <h1 className="text-lg font-semibold tracking-tight">Home HQ</h1>
          <div className="mt-1">
            <StatusDot />
          </div>
        </div>
        <nav className="space-y-1">
          {modules.map((m) => (
            <NavLink
              key={m.id}
              to={m.path}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                  isActive
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                }`
              }
            >
              <span className="text-base leading-none">{m.icon}</span>
              <span>{m.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  )
}
