import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { API_BASE } from '../../lib/useApi.js'
import { Spinner } from '../../components/ui.jsx'
import { rewriteAssetSrc } from '../../lib/readme.js'

// Renders the project's real README (fetched live from /api/readme, so it never
// drifts from the file). GFM tables + raw HTML are rendered; screenshot <img>
// srcs are rewritten to the backend asset endpoint so they actually load.
export default function Readme() {
  const [markdown, setMarkdown] = useState(null)
  const [available, setAvailable] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/readme`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((j) => {
        if (cancelled) return
        setAvailable(j.available)
        setMarkdown(j.markdown || '')
      })
      .catch((e) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="max-w-3xl">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-xl font-semibold">README</h2>
        <span className="text-xs text-slate-500">the project’s public documentation</span>
      </div>

      {error ? (
        <p className="text-sm text-rose-400">README unavailable — {error}</p>
      ) : markdown == null ? (
        <Spinner label="loading README…" />
      ) : !available ? (
        <p className="text-sm text-amber-400">README not found on the server.</p>
      ) : (
        <article className="readme-content">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
            components={{
              img: ({ src, alt, ...props }) => (
                <img src={rewriteAssetSrc(src)} alt={alt} loading="lazy" {...props} />
              ),
              a: (props) => <a target="_blank" rel="noreferrer" {...props} />,
            }}
          >
            {markdown}
          </ReactMarkdown>
        </article>
      )}
    </div>
  )
}
