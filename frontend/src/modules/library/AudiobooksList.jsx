import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useApi } from '../../lib/useApi.js'
import { useOnline } from '../../lib/online.jsx'
import { useDownloadedEntries } from '../../lib/useDownloaded.js'
import { downloadKey } from '../../lib/offlineStore.js'
import { browseFolder, folderCrumbs, naturalCompare, fileUrl } from '../../lib/library.js'
import AudiobookPlayer from './AudiobookPlayer.jsx'
import AudiobookCover from './AudiobookCover.jsx'
import OfflineSection from './OfflineSection.jsx'
import SavedBadge from './SavedBadge.jsx'
import DownloadButton from './DownloadButton.jsx'

// The Audiobooks section. A book is a FOLDER of ordered chapter files, nested
// under author/collection folders — so this is a folder browser (mirrors disk at
// any depth, like Comics): a folder with no audio files is a collection (show its
// subfolders); a folder that directly contains audio files IS a book (show the
// player + its chapters). The current folder lives in ?path= so back walks up.
export default function AudiobooksList() {
  const { data, error, loading } = useApi('/library/audiobooks', 30000)
  const { online } = useOnline()
  const entries = useDownloadedEntries()
  // Downloaded keys for the badges, derived from the entries we already load
  // (avoids a second IndexedDB read of the same manifest).
  const downloaded = new Set((entries ?? []).map((e) => e.key))
  const [params] = useSearchParams()
  const path = params.get('path') || ''
  const navigate = useNavigate()

  // OFFLINE: the live folder browse can't load, so drive from the on-device
  // manifest. A downloaded book carries its chapter list, so the player runs
  // entirely from cache; otherwise show the downloaded-audiobooks subset.
  if (!online) {
    if (entries == null) return <p className="text-sm text-slate-500">loading…</p>
    const book = entries.find((e) => e.section === 'audiobooks' && e.id === path)
    if (book) {
      const name = path.split('/').pop()
      return (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">{name}</h2>
          <AudiobookPlayer bookPath={path} bookName={name} chapters={book.chapters || []} />
        </div>
      )
    }
    return <OfflineSection section="audiobooks" label="Audiobooks" icon="🎧" />
  }

  const items = data?.items ?? []
  const { folders, issues } = browseFolder(items, path)
  // A folder's direct audio files = the book's chapters, in natural order.
  const chapters = [...issues]
    .sort((a, b) => naturalCompare(a.name, b.name))
    .map((it) => ({ id: it.id, name: it.name }))
  const isBook = chapters.length > 0
  const crumbs = folderCrumbs(path)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{isBook ? path.split('/').pop() : 'Audiobooks'}</h2>
        {/* A book download = every chapter file (the chapter list is stored in the
            manifest so the player can run offline). Audiobooks are big — this can
            be hundreds of MB. */}
        {isBook && (
          <DownloadButton
            item={{
              section: 'audiobooks',
              id: path,
              name: path.split('/').pop(),
              reader: 'listen',
              chapters,
              urls: chapters.map((c) => fileUrl('audiobooks', c.id)),
            }}
          />
        )}
      </div>

      {loading && !data && <p className="text-sm text-slate-500">loading…</p>}
      {error && <p className="text-sm text-rose-400">unavailable — {error}</p>}
      {data && data.configured === false && <NotConfigured />}

      {data && data.configured && data.count > 0 && (
        <>
          {crumbs.length > 0 && (
            <nav className="flex flex-wrap items-center gap-1 text-sm text-slate-400">
              <Link to="/library/audiobooks" className="hover:text-slate-200">
                Audiobooks
              </Link>
              {crumbs.map((c) => (
                <span key={c.path}>
                  <span className="px-1 text-slate-600">/</span>
                  <Link
                    to={`/library/audiobooks?path=${encodeURIComponent(c.path)}`}
                    className="hover:text-slate-200"
                  >
                    {c.name}
                  </Link>
                </span>
              ))}
            </nav>
          )}

          {/* Subfolders (collections / books) */}
          {folders.length > 0 && (
            <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
              {folders.map((f) => (
                <li key={f.path}>
                  <button
                    onClick={() => navigate(`/library/audiobooks?path=${encodeURIComponent(f.path)}`)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-slate-800"
                  >
                    <AudiobookCover path={f.path} alt={f.name} className="w-12 rounded" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-slate-100">{f.name}</span>
                      <span className="block text-xs text-slate-500">
                        {f.count} file{f.count === 1 ? '' : 's'}
                      </span>
                    </span>
                    <SavedBadge saved={downloaded?.has(downloadKey('audiobooks', f.path))} />
                    <span className="shrink-0 text-slate-600">›</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* This folder is a book → the player. */}
          {isBook && <AudiobookPlayer bookPath={path} bookName={path.split('/').pop()} chapters={chapters} />}
        </>
      )}
    </div>
  )
}

function NotConfigured() {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
      <p className="text-amber-400">No Audiobooks folder configured.</p>
      <p className="mt-2 text-sm text-slate-400">
        Set <code className="rounded bg-slate-800 px-1">AUDIOBOOKS_DIR</code> (a folder of
        audiobook folders, each holding ordered audio files) in{' '}
        <code className="rounded bg-slate-800 px-1">.env</code>. See the Server Guide.
      </p>
    </div>
  )
}
