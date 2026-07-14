// Directional focus movement for the controller-driven surfaces (the pause menu,
// which is a grid; and Big Picture, which is rails of box art).
//
// Pure on purpose — no DOM, no refs, no measuring. A geometric focus engine that
// measures elements would need jsdom to test, and this app has none, which would
// leave the most navigation-critical code as the only untested code. Our layouts
// aren't arbitrary geometry: they're a grid and a set of rails, both of which are
// just index arithmetic.

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))

// Row-major grid walk, no wrapping (a D-pad that wraps feels broken — you press
// right at the edge and the cursor teleports across the screen).
//
// The last row is usually short. Pressing down from the row above into that gap
// lands on the last item rather than refusing to move, which is what every
// console UI does.
// `centerLastRow`: when the last row holds a single orphan item, it's drawn in the
// MIDDLE column rather than dumped on the left (7 tiles read as 3-3-1 centred, not
// 3-3 and a stray). The walk has to know that, or the cursor and your eye disagree:
// press Up from the centred tile and you'd jump to the left-hand column, which is
// not the tile sitting above it.
export function moveInGrid({ count, cols, index }, dir, { centerLastRow = false } = {}) {
  if (!count || !cols) return 0
  const i = clamp(index, 0, count - 1)
  const col = i % cols
  const row = Math.floor(i / cols)
  const lastRow = Math.floor((count - 1) / cols)

  const orphan = centerLastRow && count % cols === 1 && count > cols
  const middle = Math.floor((cols - 1) / 2)

  // The orphan is alone on its row: left/right/down have nowhere to go, and up
  // lands on whatever is actually drawn above it — the middle of the row before.
  if (orphan && i === count - 1) {
    return dir === 'up' ? (lastRow - 1) * cols + middle : i
  }

  switch (dir) {
    case 'left':
      return col > 0 ? i - 1 : i
    case 'right':
      return col < cols - 1 && i + 1 < count ? i + 1 : i
    case 'up':
      return row > 0 ? i - cols : i
    case 'down': {
      const below = i + cols
      if (below < count) return below
      return row < lastRow ? count - 1 : i
    }
    default:
      return i
  }
}

// Rails: `rails` = [{ id, items }], `focus` = { rail, index }.
//
// Left/right moves within a rail; up/down (and railPrev/railNext — the shoulder
// buttons) moves between rails. Returns the new focus AND the updated column
// memory, which is the thing that makes rails feel right: leave a rail at item
// 12, go down, come back — you're on item 12 again, not back at the start.
// Netflix, the Switch home screen and Steam Big Picture all do this.
export function moveInRails(rails, focus, dir, memory = {}) {
  if (!rails || !rails.length) return { focus: { rail: 0, index: 0 }, memory }

  const rail = clamp(focus?.rail ?? 0, 0, rails.length - 1)
  const items = rails[rail]?.items ?? []
  const index = clamp(focus?.index ?? 0, 0, Math.max(0, items.length - 1))

  if (dir === 'left' || dir === 'right') {
    const next = clamp(index + (dir === 'right' ? 1 : -1), 0, Math.max(0, items.length - 1))
    return { focus: { rail, index: next }, memory: { ...memory, [rails[rail].id]: next } }
  }

  const step = dir === 'up' || dir === 'railPrev' ? -1 : dir === 'down' || dir === 'railNext' ? 1 : 0
  if (!step) return { focus: { rail, index }, memory }

  // Skip rails with nothing in them, so focus is never stranded on a heading
  // with no tiles under it (an empty "Continue playing" rail is common).
  let next = rail + step
  while (next >= 0 && next < rails.length && !rails[next].items?.length) next += step
  if (next < 0 || next >= rails.length) return { focus: { rail, index }, memory } // no wrap at the ends

  const remembered = { ...memory, [rails[rail].id]: index }
  const target = rails[next]
  // Clamp against the target rail's length: remembering column 12 and moving to
  // a rail with 3 items must land on the last item, not off the end.
  const restored = clamp(remembered[target.id] ?? 0, 0, target.items.length - 1)
  return { focus: { rail: next, index: restored }, memory: remembered }
}
