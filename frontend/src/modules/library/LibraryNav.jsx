import { NavLink } from 'react-router-dom'
import { useApi } from '../../lib/useApi.js'
import { libraryNavSections, sectionHref } from '../../lib/library.js'
import { SkeletonLine } from '../../components/ui.jsx'

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
  const { data, loading } = useApi('/library', 30000)
  const sections = libraryNavSections(data)
  // First cold load: hold the pill row's shape (so the page below doesn't jump
  // when the real pills resolve). Pill heights match the real `px-3 py-1 text-sm`.
  if (loading && !data) {
    return (
      <nav className="flex flex-wrap gap-2" aria-hidden="true">
        {['w-10', 'w-16', 'w-16', 'w-20', 'w-24', 'w-20'].map((w, i) => (
          <SkeletonLine key={i} className={`h-7 rounded-full ${w}`} />
        ))}
      </nav>
    )
  }
  if (sections.length === 0) return null
  return (
    <nav className="flex flex-wrap gap-2">
      <Pill to="/library" end>
        All
      </Pill>
      {sections.map((s) => (
        <Pill key={s.key} to={sectionHref(s.key)}>
          <span className="mr-1" aria-hidden>
            {s.icon}
          </span>
          {s.label}
        </Pill>
      ))}
    </nav>
  )
}
