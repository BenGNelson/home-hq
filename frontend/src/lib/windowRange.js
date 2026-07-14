// Which slice of a long rail actually needs to exist in the DOM.
//
// Big Picture mounts every game at once — 1,196 tiles, 496 of them in the Game Boy
// Color rail alone. Each is an <img>. The browser will happily build that, and then
// spend the rest of the session paying for it: every scroll decodes more covers, and
// the layout is enormous. That's the stutter.
//
// So a rail renders only what's on screen (plus a buffer either side), with a spacer
// standing in for the rest so the scrollbar and the scroll position stay honest.
//
// Pure, because the arithmetic is the part that can be wrong.

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))

// `step` is one tile plus its gap. `focusIndex` is always included even if it's
// nowhere near the viewport — the controller can jump focus somewhere off-screen, and
// the tile has to EXIST before anything can scroll it into view.
export function windowRange({ count, scrollLeft = 0, viewportWidth = 0, step, buffer = 4, focusIndex = null }) {
  if (!count || !step) return { start: 0, end: -1 }

  let start = Math.floor(scrollLeft / step) - buffer
  let end = Math.ceil((scrollLeft + viewportWidth) / step) + buffer

  if (focusIndex != null && focusIndex >= 0 && focusIndex < count) {
    // Give the focused tile a little company, so moving one step doesn't immediately
    // land on an empty edge.
    start = Math.min(start, focusIndex - 2)
    end = Math.max(end, focusIndex + 2)
  }

  return {
    start: clamp(start, 0, count - 1),
    end: clamp(end, 0, count - 1),
  }
}

// The blank space standing in for the tiles that aren't rendered, so the rail is as
// long as it should be and scrolling doesn't jump.
export function spacers({ count, start, end, step }) {
  if (!count || !step || end < start) return { before: 0, after: 0 }
  return {
    before: start * step,
    after: Math.max(0, (count - 1 - end) * step),
  }
}
