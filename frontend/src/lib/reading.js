// Pure helpers for the reading progress / Continue Reading shelf. The position
// itself lives server-side now (so it roams across devices); these just shape it
// for display. PDFs track page/total; ebooks track only a 0..1 fraction (no
// stable pages), so the helpers fall back to a plain percent for those.

// "42% · p. 34 of 80" for a PDF, "57%" for an ebook (fraction only), or "p. 34"
// when nothing but a page is known.
export function progressLabel(page, total, fraction) {
  if (total && total > 0) {
    const p = Number(page) || 1
    return `${Math.round((p / total) * 100)}% · p. ${p} of ${total}`
  }
  if (fraction != null) return `${Math.round(fraction * 100)}%`
  return `p. ${Number(page) || 1}`
}

// 0..1 fraction read, clamped — for a progress bar. Uses page/total when known,
// else the ebook fraction, else 0.
export function progressFraction(page, total, fraction) {
  if (total && total > 0) return clamp((Number(page) || 0) / total)
  if (fraction != null) return clamp(fraction)
  return 0
}

function clamp(n) {
  return Math.min(1, Math.max(0, n))
}
