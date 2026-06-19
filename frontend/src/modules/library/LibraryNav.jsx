import { NavLink } from 'react-router-dom'
import { useApi } from '../../lib/useApi.js'
import { libraryNavSections } from '../../lib/library.js'

// A horizontal section switcher for the Library area, so you can hop between
// Games / Books / Comics / Audiobooks / Papers (and back to the hub) without
// returning to the hub each time. Data-driven from /api/library, so it only
// offers sections that are configured and non-empty; hidden when none are.
function Pill({ to, end, children }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `rounded-full px-3 py-1 text-sm transition ${
          isActive
            ? 'bg-slate-700 text-white'
            : 'bg-slate-800/60 text-slate-300 hover:bg-slate-800 hover:text-slate-100'
        }`
      }
    >
      {children}
    </NavLink>
  )
}

export default function LibraryNav() {
  const { data } = useApi('/library', 30000)
  const sections = libraryNavSections(data)
  if (sections.length === 0) return null
  return (
    <nav className="flex flex-wrap gap-2">
      <Pill to="/library" end>
        All
      </Pill>
      {sections.map((s) => (
        <Pill key={s.key} to={`/library/${s.key}`}>
          <span className="mr-1" aria-hidden>
            {s.icon}
          </span>
          {s.label}
        </Pill>
      ))}
    </nav>
  )
}
