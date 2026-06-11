import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useApi } from '../lib/useApi.js'
import { groupModules, FOOTER_GROUP } from '../lib/nav.js'
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

// One sidebar link. `muted` dims it a shade — used for the Docs section so the
// reference docs read as secondary to the functional modules above them.
function NavItem({ to, icon, label, muted }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
          isActive
            ? 'bg-slate-800 text-white'
            : muted
              ? 'text-slate-500 hover:bg-slate-800/50 hover:text-slate-300'
              : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
        }`
      }
    >
      <span className="text-base leading-none">{icon}</span>
      <span>{label}</span>
    </NavLink>
  )
}

// A labeled nav section: a small uppercase header over its module links.
function NavSection({ group, items, muted }) {
  return (
    <div>
      <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {group}
      </p>
      <div className="space-y-1">
        {items.map((m) => (
          <NavItem key={m.id} to={m.path} icon={m.icon} label={m.label} muted={muted} />
        ))}
      </div>
    </div>
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

  // Group the flat registry into labeled sections. The Docs group renders apart
  // at the bottom (reference material, not functional modules); everything else
  // is a top-of-sidebar nav section.
  const sections = groupModules(modules)
  const navSections = sections.filter((s) => s.group !== FOOTER_GROUP)
  const footer = sections.find((s) => s.group === FOOTER_GROUP)

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* Backdrop — only on mobile while the drawer is open. */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-56 shrink-0 transform flex-col border-r border-slate-800 bg-slate-900 p-4 transition-transform md:static md:translate-x-0 md:bg-slate-900/50 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="mb-6 px-2">
          <h1 className="text-lg font-semibold tracking-tight">Home HQ</h1>
          <div className="mt-1">
            <StatusDot />
          </div>
        </div>
        <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          {navSections.map((s) => (
            <NavSection key={s.group} group={s.group} items={s.items} />
          ))}
        </nav>

        {/* Footer: the Docs group, set apart from the module nav and pinned to
            the bottom. Reference material — Under the Hood explains the
            software, the Server Guide documents the host, the README documents
            the project. */}
        {footer && (
          <div className="mt-auto border-t border-slate-800 pt-3">
            <NavSection group={footer.group} items={footer.items} muted />
          </div>
        )}
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
