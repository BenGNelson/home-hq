// The touch controls, as pure functions.
//
// The overlay does NOT use DOM hit-testing. It's a single surface that captures
// raw touch events, and everything below maps coordinates -> pressed buttons.
// That's the same approach Delta takes, and it buys three things that a grid of
// <button> elements cannot:
//
//   · correct multi-touch — hold Left, tap B, keep holding Left
//   · slide-through       — roll a thumb from B to A without lifting, and slide
//                           around the d-pad without ever leaving it
//   · hit areas bigger than the buttons you can see
//
// And because it's all coordinate arithmetic, it's testable without a browser.

// Letterbox a layout's virtual coordinate space into the real viewport, INSIDE
// the safe area. Layouts are authored once in their own space (see
// touchLayouts.js) and scaled to whatever screen they land on, so there are no
// per-device breakpoints to maintain.
//
// The safe area is an input, not an afterthought: in landscape the insets sit on
// the left and right (the notch) plus the bottom (the home indicator), and iOS
// swallows the first swipe near the bottom edge. Shrinking the space away from
// them means no button can land somewhere unreachable — by construction, rather
// than by eyeballing it on a phone.
export function fitTransform(space, viewport, safeArea = {}) {
  const top = safeArea.top || 0
  const right = safeArea.right || 0
  const bottom = safeArea.bottom || 0
  const left = safeArea.left || 0

  const w = Math.max(1, viewport.w - left - right)
  const h = Math.max(1, viewport.h - top - bottom)
  const scale = Math.min(w / space.w, h / space.h)

  return {
    scale,
    ox: left + (w - space.w * scale) / 2,
    oy: top + (h - space.h * scale) / 2,
  }
}

// Screen coordinates -> layout coordinates.
export function toVirtual(clientX, clientY, t) {
  return { x: (clientX - t.ox) / t.scale, y: (clientY - t.oy) / t.scale }
}

// The region a touch actually activates: the button you can see, grown by its
// extendedEdges. Thumbs undershoot, and a button that only works when you hit it
// dead-on feels broken — so the visual and the target are deliberately different
// sizes. (Delta calls this exact thing extendedEdges too.)
export function hitRect(item) {
  const f = item.frame
  const e = item.extendedEdges || {}
  return {
    x: f.x - (e.l || 0),
    y: f.y - (e.t || 0),
    w: f.w + (e.l || 0) + (e.r || 0),
    h: f.h + (e.t || 0) + (e.b || 0),
  }
}

const inRect = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h

export function hitTest(layout, x, y) {
  for (const item of layout.items) {
    if (item.frame && inRect(hitRect(item), x, y)) return item
  }
  return null
}

// Which directions a touch on the d-pad is pressing — one, or two for a diagonal.
//
// The d-pad is one item, not four buttons, and the corners deliberately produce
// BOTH directions. That's what makes a platformer playable: you can't jump
// diagonally if up-right is a gap between two buttons. The dead centre stops a
// thumb resting in the middle from firing anything.
export function dpadZones(item, x, y) {
  const f = item.frame
  const dz = item.deadzone ?? 0.18
  const lo = 0.5 - dz
  const hi = 0.5 + dz

  const px = (x - f.x) / f.w // 0..1 across the pad
  const py = (y - f.y) / f.h

  const dirs = []
  if (py < lo) dirs.push('up')
  if (py > hi) dirs.push('down')
  if (px < lo) dirs.push('left')
  if (px > hi) dirs.push('right')
  return dirs
}

// The core of the whole thing: every live touch -> the set of buttons held down.
//
// `prev.owners` maps a Touch.identifier to the item it grabbed. Ownership is
// STICKY for the life of that finger — except on items flagged `slide`, which
// re-hit-test as the finger moves. That single flag is what produces both the
// thumb-roll between face buttons and the continuous d-pad, and it's why a finger
// that starts on the menu button and drags off doesn't accidentally fire A.
//
// Pressed buttons are the UNION across every finger, and lifting one finger only
// clears what IT owned — which is multi-touch done correctly, by construction.
export function reduceTouches(prev, touches, layout, transform) {
  const owners = {}
  const pressed = new Set()
  const actions = new Set()

  for (const t of touches) {
    const { x, y } = toVirtual(t.clientX, t.clientY, transform)
    const prevId = prev?.owners?.[t.id]
    const owned = prevId != null ? layout.items.find((i) => i.id === prevId) : null

    let item
    if (!owned) {
      item = hitTest(layout, x, y)
    } else if (owned.slide) {
      // Slid onto another slide-able item? Take it. Otherwise stay put while the
      // finger is still anywhere in range, and release once it leaves.
      const under = hitTest(layout, x, y)
      if (under?.slide) item = under
      else if (inRect(hitRect(owned), x, y)) item = owned
      else item = null
    } else {
      item = owned // sticky: this finger keeps what it grabbed
    }

    if (!item) continue
    owners[t.id] = item.id

    if (item.type === 'dpad') {
      for (const dir of dpadZones(item, x, y)) pressed.add(item.inputs[dir])
    } else if (item.input != null) {
      pressed.add(item.input)
    } else if (item.action) {
      actions.add(item.action)
    }
  }

  return { owners, pressed, actions }
}

// What changed between two frames, as button-down / button-up events.
export function diffPressed(prev, next) {
  const events = []
  for (const index of next) if (!prev.has(index)) events.push({ index, down: true })
  for (const index of prev) if (!next.has(index)) events.push({ index, down: false })
  return events
}
