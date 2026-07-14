import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { layoutFor } from '../../../lib/touchLayouts.js'
import { fitTransform, reduceTouches, diffPressed } from '../../../lib/touchInput.js'
import { sectionAccent } from '../../../lib/library.js'
import { glowFilter } from '../../../lib/glow.js'

const GAMES = sectionAccent('games')

// The on-screen controls.
//
// ONE surface captures every touch; the buttons you can see are `pointer-events:
// none` and never receive an event at all. All the logic is coordinate maths in
// lib/touchInput.js — which is what gives us real multi-touch, a d-pad you can
// slide a thumb around, thumb-rolls between face buttons, and hit areas larger
// than the visible button.
//
// PERFORMANCE RULE: press states are applied by toggling classes on refs, NEVER
// with setState. A React re-render on every touchmove would make the controls feel
// like mud, and touchmove fires at screen rate under a moving thumb.
export default function TouchOverlay({ core, orientation, onInput, onAction, opacity = 0.75, fastForward = false }) {
  // Swaps the whole layout when the phone is turned. `layout` is the dep for both
  // effects below, so rotating rebuilds the touch pipeline and re-letterboxes.
  const layout = layoutFor(core, orientation)
  const surfaceRef = useRef(null)
  const itemRefs = useRef({})

  // The handlers live in a ref so the touch pipeline below is installed ONCE.
  //
  // Depending on them directly is a trap: `onAction` changes identity whenever
  // fast-forward toggles, which would tear the listeners down and rebuild them —
  // resetting `owners`/`pressed` — WHILE a finger is still on the screen. The
  // button under that finger then looks new again and re-fires, so fast-forward
  // chatters on and off; worse, the teardown releases whatever the other thumb was
  // holding, so the character stops walking the instant you tap ».
  const handlers = useRef({ onInput, onAction })
  handlers.current = { onInput, onAction }

  const [transform, setTransform] = useState(() => ({ scale: 1, ox: 0, oy: 0 }))
  const transformRef = useRef(transform)
  transformRef.current = transform

  // Where the surface sits on the page. Touch events arrive in PAGE coordinates,
  // but the layout transform is relative to the surface's own box (that's what the
  // absolutely-positioned button visuals are placed against). The player has a top
  // bar above it, so the two differ by ~48px — and without this correction every
  // touch lands lower than the finger actually is: press the middle of the d-pad
  // and you get Down instead of nothing, press Left and you get Down+Left.
  const originRef = useRef({ x: 0, y: 0 })

  // Re-letterboxing on resize is what makes rotation work. Safe-area insets are
  // read from the live computed style rather than hardcoded, so the controls stay
  // clear of the notch and the home indicator on every device.
  useLayoutEffect(() => {
    const measure = () => {
      const el = surfaceRef.current
      if (!el) return
      const cs = getComputedStyle(el)
      const px = (v) => parseFloat(v) || 0
      const rect = el.getBoundingClientRect()
      originRef.current = { x: rect.left, y: rect.top }
      setTransform(
        fitTransform(
          layout.space,
          { w: el.clientWidth, h: el.clientHeight },
          {
            top: px(cs.paddingTop),
            right: px(cs.paddingRight),
            bottom: px(cs.paddingBottom),
            left: px(cs.paddingLeft),
          }
        )
      )
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    // Watch the surface itself, not just the window: hiding the top bar (the CSS
    // immersive toggle) and entering fullscreen both change its height WITHOUT a
    // window resize, and a stale letterbox silently shifts every button.
    const ro = new ResizeObserver(measure)
    ro.observe(surfaceRef.current)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('orientationchange', measure)
    }
  }, [layout])

  // The touch pipeline. Registered natively (not via React's synthetic events) so
  // we can be non-passive and preventDefault — otherwise iOS scrolls the page out
  // from under the controls.
  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return

    let owners = {}
    let pressed = new Set()
    let uiHeld = new Set() // action items (menu, fast-forward) currently under a finger

    const dpadItem = layout.items.find((i) => i.type === 'dpad')

    const paint = (ownedIds, pressed) => {
      // Only the buttons whose state actually changed get touched.
      for (const [id, node] of Object.entries(itemRefs.current)) {
        if (!node) continue
        const on = ownedIds.has(id)
        if (node.dataset.on !== (on ? '1' : '0')) {
          node.dataset.on = on ? '1' : '0'
          node.classList.toggle('hq-pressed', on)
        }
      }

      // The d-pad is one element but four directions: light the arrow you're
      // actually holding, rather than the whole cross. Pressing Right should look
      // like pressing Right.
      const node = dpadItem && itemRefs.current[dpadItem.id]
      if (!node) return
      for (const [dir, index] of Object.entries(dpadItem.inputs)) {
        node.classList.toggle(`hq-dir-${dir}`, pressed.has(index))
      }
    }

    const handle = (e) => {
      e.preventDefault()

      // Re-read the origin as each finger goes down. It moves when the top bar is
      // hidden, when fullscreen is entered, and on rotation — and a stale origin
      // silently shifts every button. Once per touchstart is cheap; doing it on
      // every touchmove would not be.
      if (e.type === 'touchstart') {
        const rect = el.getBoundingClientRect()
        originRef.current = { x: rect.left, y: rect.top }
      }

      // Page coordinates -> surface coordinates. See originRef above: skip this
      // and every touch lands offset by the height of the top bar.
      const origin = originRef.current
      const touches = Array.from(e.touches, (t) => ({
        id: t.identifier,
        clientX: t.clientX - origin.x,
        clientY: t.clientY - origin.y,
      }))

      const next = reduceTouches({ owners }, touches, layout, transformRef.current)

      for (const { index, down } of diffPressed(pressed, next.pressed)) handlers.current.onInput(index, down)

      // A UI button (menu, fast-forward) fires ONCE, on the way down — not every
      // frame a finger rests on it, and not on release, which would feel laggy.
      const held = new Set(
        Object.values(next.owners).filter((id) => layout.items.find((i) => i.id === id)?.action)
      )
      for (const id of held) {
        if (!uiHeld.has(id)) handlers.current.onAction(layout.items.find((i) => i.id === id).action)
      }
      uiHeld = held

      owners = next.owners
      pressed = next.pressed
      paint(new Set(Object.values(next.owners)), next.pressed)
    }

    const end = (e) => {
      e.preventDefault()
      handle(e)
    }

    el.addEventListener('touchstart', handle, { passive: false })
    el.addEventListener('touchmove', handle, { passive: false })
    el.addEventListener('touchend', end, { passive: false })
    el.addEventListener('touchcancel', end, { passive: false })

    return () => {
      el.removeEventListener('touchstart', handle)
      el.removeEventListener('touchmove', handle)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
      // Unmounting with a finger down would leave that button latched in the core.
      for (const index of pressed) handlers.current.onInput(index, false)
    }
  }, [layout])

  const place = (frame) => ({
    position: 'absolute',
    left: transform.ox + frame.x * transform.scale,
    top: transform.oy + frame.y * transform.scale,
    width: frame.w * transform.scale,
    height: frame.h * transform.scale,
  })

  return (
    <div
      ref={surfaceRef}
      data-testid="touch-overlay"
      // No safe-area padding here: the player wrapper already insets the whole
      // player, so this box is safe by the time we get it. Padding again would
      // inset twice and shrink every control.
      className="absolute inset-0 z-10 touch-none select-none"
      style={{ opacity }}
    >
      {layout.items.map((item) => {
        const on = item.id === 'ff' && fastForward
        return (
          <div
            key={item.id}
            ref={(n) => (itemRefs.current[item.id] = n)}
            data-id={item.id}
            data-type={item.type}
            data-on="0"
            // The visuals never receive a touch — the surface above owns all of
            // them. This is what makes multi-touch and slide-through possible.
            className={`pointer-events-none flex items-center justify-center font-semibold text-slate-100 transition-[filter,background-color] duration-75 ${SHAPE[item.type] || ''} ${
              on ? 'hq-pressed' : ''
            }`}
            style={place(item.frame)}
          >
            {item.type === 'dpad' ? <DpadArt /> : <span className={LABEL[item.type] || 'text-base'}>{item.label}</span>}
          </div>
        )
      })}

      {/* No haptics on iOS — WebKit has no vibration API at all — so the press state
          has to carry the whole feel on its own. But it should read as a button
          lighting up, not as a highlighter being dragged across the screen.

          The d-pad is the case that has to be handled separately. It's a CROSS drawn
          inside a SQUARE box, so tinting the element's background lights up the whole
          invisible square around it — a purple block, which is what Ben was seeing.
          Its box stays transparent and only the drawn cross glows, via the filter
          (which follows the shape, not the box). */}
      <style>{`
        .hq-pressed {
          filter: ${glowFilter(GAMES.rgb, 0.45, { baseBlur: 2, blurGain: 6, baseAlpha: 0.14, alphaGain: 0.3 })};
          background-color: rgba(${GAMES.rgb}, 0.3) !important;
        }
        .hq-pressed[data-type="dpad"] { background-color: transparent !important; }
        /* Only the arrow you're holding lights up — pressing Right should look like
           pressing Right, not like the whole pad catching fire. */
        .hq-dir-up .d-up, .hq-dir-down .d-down,
        .hq-dir-left .d-left, .hq-dir-right .d-right {
          fill: rgba(${GAMES.rgb}, 0.95);
        }
      `}</style>
    </div>
  )
}

const SHAPE = {
  button: 'rounded-full border-2 border-white/30 bg-black/40 backdrop-blur-[2px]',
  pill: 'rounded-full border border-white/25 bg-black/40 text-[11px] tracking-wide backdrop-blur-[2px]',
  shoulder: 'rounded-xl border border-white/25 bg-black/40 backdrop-blur-[2px]',
  ui: 'rounded-lg border border-white/20 bg-black/50 text-sm backdrop-blur-[2px]',
  dpad: '',
}

const LABEL = {
  pill: 'text-[11px]',
  shoulder: 'text-sm',
  ui: 'text-sm',
}

// The d-pad is drawn as a cross, but it's ONE hit region split into nine zones —
// the corners deliberately fire two directions at once, because you can't jump
// diagonally if up-right is a gap between two buttons.
function DpadArt() {
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden="true">
      <path
        d="M37 4 h26 v33 h33 v26 h-33 v33 h-26 v-33 h-33 v-26 h33 z"
        fill="rgba(0,0,0,0.45)"
        stroke="rgba(255,255,255,0.3)"
        strokeWidth="2.5"
      />
      <g fill="rgba(255,255,255,0.55)">
        <path className="d-up" d="M50 14 l7 10 h-14 z" />
        <path className="d-down" d="M50 86 l-7 -10 h14 z" />
        <path className="d-left" d="M14 50 l10 -7 v14 z" />
        <path className="d-right" d="M86 50 l-10 7 v-14 z" />
      </g>
    </svg>
  )
}
