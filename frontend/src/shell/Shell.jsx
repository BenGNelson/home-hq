import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useApi } from '../lib/useApi.js'
import ThemePicker from './ThemePicker.jsx'

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
// module renders. On phones the sidebar collapses into a slide-in drawer
// behind a top bar; on md+ screens it's always visible.
export default function Shell({ modules, children }) {
  const [open, setOpen] = useState(false)
  const location = useLocation()

  // Close the mobile drawer whenever the route changes (after a tap).
  useEffect(() => setOpen(false), [location.pathname])

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      {/* Backdrop — only on mobile while the drawer is open. */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-56 shrink-0 transform border-r border-slate-800 bg-slate-900 p-4 transition-transform md:static md:translate-x-0 md:bg-slate-900/50 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
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

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar — persistent so the theme picker sits top-right on every
            screen. The hamburger + title only appear on mobile (where the
            sidebar is a drawer); on md+ only the theme control shows. */}
        <header className="flex items-center gap-3 border-b border-slate-800 bg-slate-900/50 px-4 pb-3 [padding-top:calc(env(safe-area-inset-top)+0.75rem)]">
          <div className="flex items-center gap-3 md:hidden">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-label="Toggle navigation"
              className="rounded-lg p-1 text-slate-300 hover:bg-slate-800"
            >
              {/* Hamburger */}
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <span className="text-base font-semibold tracking-tight">Home HQ</span>
          </div>
          <div className="ml-auto">
            <ThemePicker />
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}
