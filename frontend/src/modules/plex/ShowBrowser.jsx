import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { API_BASE } from '../../lib/useApi.js'
import MediaTable from '../../components/MediaTable.jsx'
import MediaDetail from '../../components/MediaDetail.jsx'
import LibraryNav from '../../components/LibraryNav.jsx'
import BackToLibrary from '../../components/BackToLibrary.jsx'
import {
  formatBytes,
  formatDate,
  formatDuration,
  formatResolution,
} from '../../lib/format.js'

// Episode columns. "Episode" sorts chronologically via a season*N+episode key
// and renders as "S2 · E5".
const EPISODE_COLUMNS = [
  {
    key: 'episode',
    label: 'Episode',
    get: (i) => (i.season ?? 0) * 10000 + (i.episode_num ?? 0),
    cell: (i) => `S${i.season ?? '?'} · E${i.episode_num ?? '?'}`,
    cls: 'whitespace-nowrap text-slate-400',
  },
  { key: 'title', label: 'Title', get: (i) => i.title, cell: (i) => i.title, cls: '' },
  { key: 'duration', label: 'Length', get: (i) => i.duration_ms, cell: (i) => formatDuration(i.duration_ms), cls: 'text-right tabular-nums hidden sm:table-cell' },
  { key: 'resolution', label: 'Quality', get: (i) => i.res_height, cell: (i) => formatResolution(i.resolution), cls: 'text-right' },
  { key: null, label: 'Codec', get: (i) => i.codec, cell: (i) => i.codec ?? '—', cls: 'text-right uppercase hidden md:table-cell' },
  { key: 'size', label: 'Size', get: (i) => i.file_size, cell: (i) => formatBytes(i.file_size), cls: 'text-right tabular-nums' },
  { key: 'added', label: 'Added', get: (i) => i.added_at, cell: (i) => formatDate(i.added_at), cls: 'text-right tabular-nums hidden lg:table-cell' },
]

export default function ShowBrowser() {
  const { key } = useParams()
  const [data, setData] = useState({ show: null, episodes: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`${API_BASE}/plex/show/${key}/episodes`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((j) => {
        if (!cancelled) {
          setData(j)
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
      <LibraryNav activeKey={data.library_key} />
      <BackToLibrary libraryKey={data.library_key} />

      <MediaDetail ratingKey={key} fallbackTitle={data.show} />

      <MediaTable
        columns={EPISODE_COLUMNS}
        items={data.episodes}
        loading={loading}
        error={error}
        defaultSort={{ key: 'episode', order: 'asc' }}
        emptyMessage="No episodes cached for this show — hit Refresh on the Plex page."
        searchPlaceholder="Search episodes…"
      />
    </div>
  )
}
