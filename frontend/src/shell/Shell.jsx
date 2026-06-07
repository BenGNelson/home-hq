import { NavLink } from 'react-router-dom'

// The shell: a persistent sidebar (nav) + a content area where the active
// module renders. This frame stays constant as modules come and go.
export default function Shell({ modules, children }) {
  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <aside className="w-56 shrink-0 border-r border-slate-800 bg-slate-900/50 p-4">
        <div className="mb-6 px-2">
          <h1 className="text-lg font-semibold tracking-tight">Home HQ</h1>
          <p className="text-xs text-slate-400">personal platform</p>
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
