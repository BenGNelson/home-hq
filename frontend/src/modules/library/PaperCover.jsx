import { useState } from 'react'
import { Newspaper } from 'lucide-react'
import { paperCoverUrl } from '../../lib/library.js'

// A magazine/paper's cover = its rendered first page (a magazine's first page is
// its cover), extracted + cached server-side. Graceful fallback to an icon tile
// if the PDF can't be read. Pass className to size.
export default function PaperCover({ paper, className = '' }) {
  const [failed, setFailed] = useState(false)
  return (
    <div
      className={`relative aspect-[3/4] shrink-0 overflow-hidden rounded bg-slate-800 ${className}`}
    >
      {failed ? (
        <div className="flex h-full w-full items-center justify-center text-slate-500">
          <Newspaper className="h-8 w-8" aria-hidden="true" />
        </div>
      ) : (
        <img
          src={paperCoverUrl(paper.id)}
          alt={paper.name || paper.id}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      )}
    </div>
  )
}
