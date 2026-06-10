import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { API_BASE } from '../lib/useApi.js'
import { Spinner } from './ui.jsx'
import { rewriteAssetSrc } from '../lib/readme.js'

// Renders a markdown doc fetched live from a backend endpoint that returns
// { available, markdown }. Shared by the README and Server Guide pages. GFM
// tables + raw HTML are rendered; image srcs are rewritten to the asset
// endpoint so README screenshots load. Styled by the theme-aware
// `.readme-content` stylesheet (see index.css).
const MD_COMPONENTS = {
  img: ({ src, alt, ...props }) => (
    <img src={rewriteAssetSrc(src)} alt={alt} loading="lazy" {...props} />
  ),
  a: (props) => <a target="_blank" rel="noreferrer" {...props} />,
}

export default function DocView({ endpoint, title, subtitle, unavailable }) {
  const [markdown, setMarkdown] = useState(null)
  const [available, setAvailable] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setMarkdown(null)
    setError(null)
    setAvailable(true)
    fetch(`${API_BASE}/${endpoint}`)
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
  }, [endpoint])

  return (
    <div className="max-w-3xl">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-xl font-semibold">{title}</h2>
        {subtitle && <span className="text-xs text-slate-500">{subtitle}</span>}
      </div>

      {error ? (
        <p className="text-sm text-rose-400">unavailable — {error}</p>
      ) : markdown == null ? (
        <Spinner label="loading…" />
      ) : !available ? (
        <p className="text-sm text-amber-400">{unavailable || 'Not found on the server.'}</p>
      ) : (
        <article className="readme-content">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
            components={MD_COMPONENTS}
          >
            {markdown}
          </ReactMarkdown>
        </article>
      )}
    </div>
  )
}
