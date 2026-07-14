// Reading a physical controller. All pure — the rAF loop that actually polls the
// browser lives in useGamepad.js, and hands these functions its snapshots.
//
// This drives MENUS, not the game. In-game the engine reads the pad itself (it
// has its own polling loop and the preset we ship it), and the two must never
// bind the same button — see the Menu-button note below.

// The browser's "standard" mapping, which an Xbox Series X pad reports over
// Bluetooth on iOS, iPadOS and desktop.
export const XBOX = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  VIEW: 8,
  MENU: 9,
  LS: 10,
  RS: 11,
  DU: 12,
  DD: 13,
  DL: 14,
  DR: 15,
  GUIDE: 16,
}

// Flatten a live Gamepad into something we can diff and compare. The browser
// hands back a snapshot object whose contents change under you, so copying is
// not optional.
export function snapshotPad(pad) {
  if (!pad) return null
  return {
    id: `${pad.id}:${pad.index}`,
    buttons: Array.from(pad.buttons || [], (b) => !!(b && (typeof b === 'object' ? b.pressed : b))),
    axes: Array.from(pad.axes || []),
  }
}

// Edge-triggered button changes. A menu must move ONE item per press, not fly to
// the end of the list because the poll ran 60 times while your thumb was down.
export function padDiff(prev, next) {
  if (!next) return []
  const events = []
  const before = prev?.buttons || []
  for (let i = 0; i < next.buttons.length; i++) {
    const was = !!before[i]
    const is = next.buttons[i]
    if (is && !was) events.push({ button: i, type: 'down' })
    else if (!is && was) events.push({ button: i, type: 'up' })
  }
  return events
}

// Treat the analog stick as a D-pad. Deadzone is generous (0.5) because we want a
// deliberate push, not a drift; the dominant axis wins so a diagonal shove picks
// one direction instead of chattering between two.
export function axisDirection(x, y, deadzone = 0.5) {
  const ax = Math.abs(x)
  const ay = Math.abs(y)
  if (ax < deadzone && ay < deadzone) return null
  if (ax >= ay) return x > 0 ? 'right' : 'left'
  return y > 0 ? 'down' : 'up'
}

// Hold a direction and the cursor should keep moving — but only after a beat, and
// then at a steady clip. Without the initial delay a single press double-fires;
// without the repeat, scrolling a 300-game rail is agony.
//
// `now` is passed in rather than read from the clock, so this is testable.
export function repeatTick(state, now, { delay = 400, rate = 110 } = {}) {
  if (!state || state.since == null) return { state, fire: false }
  const held = now - state.since
  const waited = state.repeated ? state.last + rate : state.since + delay
  if (held >= 0 && now >= waited) {
    return { state: { ...state, repeated: true, last: now }, fire: true }
  }
  return { state, fire: false }
}

// EmulatorJS's name for a raw button index, so a press can become a binding.
// Indices come from the browser's "standard" mapping, which every modern pad
// reports — so this works for a controller we've never seen.
const BUTTON_NAMES = {
  0: 'BUTTON_1',
  1: 'BUTTON_2',
  2: 'BUTTON_3',
  3: 'BUTTON_4',
  4: 'LEFT_TOP_SHOULDER',
  5: 'RIGHT_TOP_SHOULDER',
  6: 'LEFT_BOTTOM_SHOULDER',
  7: 'RIGHT_BOTTOM_SHOULDER',
  8: 'SELECT',
  10: 'LEFT_STICK',
  11: 'RIGHT_STICK',
  12: 'DPAD_UP',
  13: 'DPAD_DOWN',
  14: 'DPAD_LEFT',
  15: 'DPAD_RIGHT',
}

// Index 9 (Menu/Start) is deliberately absent: the app owns it (short press = the
// game's START, long press = the pause menu), so it can't be handed to the game as
// well. Index 16 (Guide) is swallowed by the OS on most platforms.
export function bindingForButton(index) {
  return BUTTON_NAMES[index] || null
}

// What a button MEANS to a menu. The game never sees these — it gets the preset.
export function padAction(button) {
  switch (button) {
    case XBOX.A:
      return 'confirm'
    case XBOX.B:
      return 'back'
    case XBOX.X:
      return 'search'
    case XBOX.Y:
      return 'alt' // "show me the save states for this game"
    case XBOX.LB:
      return 'railPrev'
    case XBOX.RB:
      return 'railNext'
    // The triggers are the fast lane: a long list moves a letter at a time, not a
    // row at a time. Analog on an Xbox pad, so they read as pressed past a threshold
    // — which snapshotPad already reduces to a boolean.
    case XBOX.LT:
      return 'jumpPrev'
    case XBOX.RT:
      return 'jumpNext'
    case XBOX.DU:
      return 'up'
    case XBOX.DD:
      return 'down'
    case XBOX.DL:
      return 'left'
    case XBOX.DR:
      return 'right'
    case XBOX.MENU:
      return 'menu'
    default:
      return null
  }
}

// The Menu button is the one button the app takes for itself, and it has to do
// two jobs: games need a START button, and the player needs a way in to the pause
// menu. So:
//
//   short press  -> a synthetic START, sent to the game
//   long press   -> the HQ pause menu, and NO start
//
// It fires the menu on the way DOWN (as soon as the hold is long enough), not on
// release, so it feels immediate rather than laggy. START only fires on release,
// because that's the only moment we know the press was short.
export const MENU_GESTURE_IDLE = { downAt: null, fired: false }

export function menuGesture(state, event, now, { longMs = 450 } = {}) {
  switch (event) {
    case 'down':
      return { state: { downAt: now, fired: false }, action: null }

    case 'tick':
      if (state.downAt != null && !state.fired && now - state.downAt >= longMs) {
        return { state: { ...state, fired: true }, action: 'pauseMenu' }
      }
      return { state, action: null }

    case 'up': {
      const wasShortPress = state.downAt != null && !state.fired
      return { state: MENU_GESTURE_IDLE, action: wasShortPress ? 'start' : null }
    }

    default:
      return { state, action: null }
  }
}
