// Player preferences, persisted per-device.
//
// These used to be the engine's job — EmulatorJS writes volume, shaders and the
// fast-forward ratio to localStorage itself. But it writes the CONTROL MAP to
// the same per-game blob and reloads it on every boot, which would silently
// overwrite the Xbox preset we ship. So the engine's localStorage is switched
// off wholesale (EJS_disableLocalStorage) and we own these instead.
//
// Storage is injected so this is testable without a DOM.

export const SETTINGS_KEY = 'homehq.player'
const SWEEP_FLAG = 'homehq.player.ejsSwept'

export const DEFAULTS = {
  // 'auto' picks touch or pad by what's actually connected; the other two pin it.
  inputMode: 'auto',
  touchOpacity: 0.75,
  touchScale: 1,
  volume: 0.5,

  // How the controller maps onto the game — see lib/controlPresets.js.
  controlScheme: 'letters',
  // Per-button overrides, keyed BY CONTROLLER: `{ '<pad id>': { 8: 'BUTTON_2' } }`.
  // Keyed by pad rather than globally because a second controller is a different
  // shape, and remapping one must not silently rewire the other.
  controlBindings: {},
}

// This device's overrides for one specific controller.
export function bindingsFor(settings, padId) {
  return (padId && settings?.controlBindings?.[padId]) || {}
}

// Rebind one button on one controller, leaving every other controller alone.
export function withBinding(settings, padId, index, label) {
  if (!padId) return settings
  const forPad = { ...bindingsFor(settings, padId), [index]: label }
  return { ...settings, controlBindings: { ...settings.controlBindings, [padId]: forPad } }
}

// Back to the scheme's defaults for this controller.
export function clearBindings(settings, padId) {
  const next = { ...settings.controlBindings }
  delete next[padId]
  return { ...settings, controlBindings: next }
}

export function readSettings(storage) {
  if (!storage) return { ...DEFAULTS }
  try {
    const raw = storage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULTS }
    const saved = JSON.parse(raw)
    // Merge rather than replace, so a settings file written by an older build
    // (missing keys we've since added) still yields a complete object.
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function writeSettings(storage, patch) {
  const next = { ...readSettings(storage), ...patch }
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(next))
  } catch {
    // Private mode / quota. Losing a preference is not worth breaking the game.
  }
  return next
}

// One-shot cleanup of the engine's own per-game settings blobs (`ejs-<game>-…`).
// With EJS_disableLocalStorage on, the engine never reads or writes them again,
// so they're dead bytes — and they hold stale control maps from before we shipped
// the preset, which would be actively wrong if that flag ever came back off.
// Returns how many keys it removed.
export function migrateLegacyEjsKeys(storage) {
  if (!storage) return 0
  try {
    if (storage.getItem(SWEEP_FLAG)) return 0
    const doomed = []
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key && key.startsWith('ejs-')) doomed.push(key)
    }
    // Collect first, then delete: removing during the walk reindexes the store
    // and would skip every other key.
    doomed.forEach((key) => storage.removeItem(key))
    storage.setItem(SWEEP_FLAG, '1')
    return doomed.length
  } catch {
    return 0
  }
}
