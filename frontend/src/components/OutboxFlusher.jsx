import { useEffect, useRef } from 'react'
import { useOnline } from '../lib/online.jsx'
import { flushOutbox } from '../lib/progressOutbox.js'

// Flushes the reading/listening position outbox whenever the app (re)gains the
// server: once on mount if we're online (catches a backlog from a previous
// offline session), and on every offline→online transition. Renders nothing.
export default function OutboxFlusher() {
  const { online } = useOnline()
  const wasOnline = useRef(false)
  useEffect(() => {
    if (online && !wasOnline.current) flushOutbox().catch(() => {})
    wasOnline.current = online
  }, [online])
  return null
}
