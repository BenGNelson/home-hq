import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useApi, API_BASE } from '../../lib/useApi.js'
import MediaTable from '../../components/MediaTable.jsx'
import SyncControl from '../../components/SyncControl.jsx'
import LibraryNav from '../../components/LibraryNav.jsx'
import {
  formatBytes,
  formatDate,
  formatDuration,
  formatResolution,
} from '../../lib/format.js'

const MOVIE_COLUMNS = [
  {
    key: 'title',
    label: 'Title',
    get: (i) => i.title,
    cell: (i) => (
      <Link to={`/plex/movie/${i.rating_key}`} className="text-emerald-400 hover:underline">
        {i.title}
      </Link>
    ),
    cls: '',
  },
  { key: 'year', label: 'Year', get: (i) => i.year, cell: (i) => i.year ?? '—', cls: 'text-right tabular-nums' },
  { key: 'duration', label: 'Length', get: (i) => i.duration_ms, cell: (i) => formatDuration(i.duration_ms), cls: 'text-right tabular-nums hidden sm:table-cell' },
  { key: 'resolution', label: 'Quality', get: (i) => i.res_height, cell: (i) => formatResolution(i.resolution), cls: 'text-right' },
  { key: null, label: 'Codec', get: (i) => i.codec, cell: (i) => i.codec ?? '—', cls: 'text-right uppercase hidden md:table-cell' },
  { key: 'size', label: 'Size', get: (i) => i.file_size, cell: (i) => formatBytes(i.file_size), cls: 'text-right tabular-nums' },
  { key: 'added', label: 'Added', get: (i) => i.added_at, cell: (i) => formatDate(i.added_at), cls: 'text-right tabular-nums hidden lg:table-cell' },
]

// Shows link into the episode drill-down (cell renders a Link).
const SHOW_COLUMNS = [
  {
    key: 'title',
    label: 'Title',
    get: (i) => i.title,
    cell: (i) => (
      <Link to={`/plex/show/${i.rating_key}`} className="text-emerald-400 hover:underline">
        {i.title} →
      </Link>
    ),
    cls: '',
  },
  { key: 'year', label: 'Year', get: (i) => i.year, cell: (i) => i.year ?? '—', cls: 'text-right tabular-nums' },
  { key: 'episodes', label: 'Episodes', get: (i) => i.episodes, cell: (i) => i.episodes ?? '—', cls: 'text-right tabular-nums' },
  { key: 'added', label: 'Added', get: (i) => i.added_at, cell: (i) => formatDate(i.added_at), cls: 'text-right tabular-nums hidden sm:table-cell' },
]

export default function LibraryBrowser() {
  const { key } = useParams()
  const libs = useApi('/plex/libraries', 60000)
  const lib = (libs.data?.libraries ?? []).find((l) => l.key === key)
  const isShow = lib?.type === 'show'

  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Load the whole library once (small enough); MediaTable filters/sorts it.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`${API_BASE}/plex/library/${key}/items?limit=10000`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((j) => {
        if (!cancelled) {
          setItems(j.items)
          setError(null)
          setLoading(false)
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message)
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [key])

  return (
    <div className="flex h-full flex-col">
      <LibraryNav activeKey={key} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{lib?.title ?? 'Library'}</h2>
        <SyncControl />
      </div>

      <MediaTable
        columns={isShow ? SHOW_COLUMNS : MOVIE_COLUMNS}
        items={items}
        loading={loading}
        error={error}
        defaultSort={{ key: 'title', order: 'asc' }}
        emptyMessage="No items cached yet — hit Refresh to sync from Plex."
      />
    </div>
  )
}
