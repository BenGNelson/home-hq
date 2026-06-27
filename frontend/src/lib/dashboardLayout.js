// Splits an ordered widget list into the two desktop columns, preserving the
// list's order within each column. The list order doubles as the single-column
// (phone) order, so the same array drives both layouts: on phone the widgets
// render top-to-bottom in array order; on desktop each column renders the array
// filtered to its `col` tag — which keeps each column's relative order matching
// the phone order. Because membership is fixed by the tag (not recomputed from
// heights), columns never reflow as widgets load.
//
// Anything not tagged 'right' falls into the left column, so a missing/typo'd
// tag degrades to a visible card rather than vanishing.
export function splitColumns(widgets) {
  const left = []
  const right = []
  for (const w of widgets) {
    ;(w.col === 'right' ? right : left).push(w)
  }
  return { left, right }
}
