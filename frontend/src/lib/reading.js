// Pure helpers for the reading progress / Continue Reading shelf. The position
// itself lives server-side now (so it roams across devices); these just shape it
// for display.

// "42% · p. 34 of 80", or "p. 34" when the total is unknown.
export function progressLabel(page, total) {
  const p = Number(page) || 1
  if (!total || total <= 0) return `p. ${p}`
  return `${Math.round((p / total) * 100)}% · p. ${p} of ${total}`
}

// 0..1 fraction read, clamped — for a progress bar. 0 when the total is unknown.
export function progressFraction(page, total) {
  if (!total || total <= 0) return 0
  return Math.min(1, Math.max(0, (Number(page) || 0) / total))
}
