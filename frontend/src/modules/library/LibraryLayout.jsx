import { Outlet } from 'react-router-dom'
import LibraryNav from './LibraryNav.jsx'

// Persistent layout for the Library section pages (Games / Books / Comics /
// Audiobooks / Papers). The section switcher (LibraryNav) renders once here and
// stays mounted as you hop between sections via the nested <Outlet/> — only the
// content below swaps. Previously each list page rendered its own LibraryNav, so
// switching sections unmounted/remounted the pill bar (disappear → reappear, and
// a refetch of /api/library every time). Hoisting it here keeps the bar steady.
export default function LibraryLayout() {
  return (
    <div className="space-y-4">
      <LibraryNav />
      <Outlet />
    </div>
  )
}
