import { useEffect, useRef } from 'react'
import { snapshotPad, padDiff, axisDirection, repeatTick, padAction, menuGesture, MENU_GESTURE_IDLE } from './gamepad.js'

// Polls the physical controller and turns it into semantic actions.
//
// A poll loop, not events: the Gamepad API has no button events at all — you read
// the current state and diff it yourself. rAF rather than setInterval, so it stops
// while the tab is hidden (which is exactly what we want) and it never runs faster
// than the screen.
//
// The handlers are held in a ref so the loop is installed ONCE. Re-installing it
// on every render would drop button presses in the gap.
export function useGamepad(handlers, enabled = true) {
  const ref = useRef(handlers)
  ref.current = handlers

  useEffect(() => {
    if (!enabled) return

    let raf = 0
    let prev = null
    let menu = MENU_GESTURE_IDLE
    let held = null // { action, since, last, repeated } — the direction being held
    let stick = null // the analog stick's current direction, as a d-pad

    const readPads = () => {
      // A test seam: e2e drives a fake pad through this, because Chrome DevTools
      // Protocol has no gamepad domain and a real controller can't be synthesized.
      // Inert in production — nothing else ever sets it.
      const pads = window.__hqPads ? window.__hqPads() : navigator.getGamepads?.() || []
      for (const p of pads) if (p) return p
      return null
    }

    const loop = () => {
      raf = requestAnimationFrame(loop)
      const now = performance.now()
      const h = ref.current

      const next = snapshotPad(readPads())
      if (!next) {
        // The pad went away — battery died, went to sleep, wandered out of range.
        if (prev) {
          // RELEASE the stick first. Clearing our own record isn't enough: the
          // direction is held down in the CORE, and nothing else will ever let it
          // go. The character just walks into the wall forever, and the touch
          // d-pad can't undo it (pressing Down only adds Down).
          if (stick) h.onStick?.(stick, false)
          prev = null
          held = null
          stick = null
          menu = MENU_GESTURE_IDLE
          h.onDisconnect?.()
        }
        return
      }

      for (const { button, type } of padDiff(prev, next)) {
        // ANY button press is what tells us a controller is live. We can't wait for
        // `gamepadconnected` — on iOS Safari it doesn't fire until a button is
        // pressed anyway, so the touch controls would sit there over a working pad.
        // The pad's id rides along so a remap can be saved against THIS controller.
        if (type === 'down') h.onPadButton?.(next.id)

        // The raw index, for the Controls screen's "press a button to bind it".
        // Handled before everything else and short-circuits: while we're listening
        // for a binding, a press must NOT also navigate the menu it's sitting in.
        if (type === 'down' && h.onRawButton?.(button, next.id)) continue

        if (button === 9) {
          // The Menu button belongs to the app, never to the game (see gamepad.js).
          const r = menuGesture(menu, type === 'down' ? 'down' : 'up', now)
          menu = r.state
          if (r.action) h.onMenuAction?.(r.action)
          continue
        }

        const action = padAction(button)
        if (!action) continue

        if (type === 'down') {
          h.onAction?.(action)
          if (isDirection(action)) held = { action, since: now, last: now, repeated: false }
        } else if (held?.action === action) {
          held = null
        }
      }

      // A long press has to fire while the button is still down, so poll it.
      const m = menuGesture(menu, 'tick', now)
      menu = m.state
      if (m.action) h.onMenuAction?.(m.action)

      // Hold a direction -> keep moving, after a beat.
      if (held) {
        const r = repeatTick(held, now)
        held = r.state
        if (r.fire) h.onAction?.(held.action)
      }

      // The analog stick doubles as a d-pad. The preset binds the real d-pad to
      // the game, but none of these systems has an analog input — so without this
      // the stick would just be dead, and on an Xbox pad it's the first thing a
      // thumb reaches for. Edge-triggered, so it acts exactly like a d-pad:
      // onStick drives the game, onAction drives a menu, and the caller wires up
      // whichever one applies right now.
      const dir = axisDirection(next.axes[0] ?? 0, next.axes[1] ?? 0)
      if (dir !== stick) {
        if (stick) {
          h.onStick?.(stick, false)
          if (held?.action === stick) held = null
        }
        if (dir) {
          h.onStick?.(dir, true)
          h.onAction?.(dir)
          held = { action: dir, since: now, last: now, repeated: false }
        }
        stick = dir
      }

      prev = next
    }

    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [enabled])
}

const isDirection = (a) => a === 'up' || a === 'down' || a === 'left' || a === 'right'
