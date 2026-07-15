// Save states: capture a snapshot from the running engine, list them, load one
// back in place, delete one.
//
// Two destinations, always both:
//   · the local cache — so reopening the game resumes it even offline
//   · the backend     — so the state roams to your other devices
// The network half is best-effort: a failed upload must never lose the local
// copy, which is the one that makes offline play work.
//
// fetch/caches are injected so every path here is testable without a browser.

import { GAME_SAVES_CACHE } from './offlineConfig.js'
import { saveStatesUrl, saveStateUrl } from './library.js'

export const localStateKey = (gameId) => `/__game-save/${encodeURIComponent(gameId)}`

function deps(d = {}) {
  return {
    fetch: d.fetch || globalThis.fetch?.bind(globalThis),
    caches: 'caches' in d ? d.caches : globalThis.caches,
  }
}

// The engine's saveState event hands us `e.screenshot` — but it is ALWAYS undefined:
// EmulatorJS destructures `{ screenshot }` out of takeScreenshot(), which actually
// resolves `{ blob }` (upstream bug, still present in 4.2.3). So we grab the frame
// ourselves.
//
// It reads the frame back off the canvas, which only works because the player
// document's WebGL context is forced to keep its drawing buffer — see
// emuBridge.preserveCanvas(). Without that this returns a flawless black rectangle,
// which is exactly what every save state used to show.
//
// (The engine's other source, "retroarch", asks the core for the frame instead. It
// is not usable: on these cores it aborts the Emscripten module and takes the whole
// player iframe down with it.)
export async function captureShot(emu) {
  try {
    if (typeof emu?.takeScreenshot !== 'function') return null
    const shot = await emu.takeScreenshot('canvas', 'png', 1)
    const blob = shot?.blob
    if (!blob) return null
    // Never store a black rectangle. If the canvas came back empty — the drawing
    // buffer wasn't preserved, the core hadn't drawn a frame yet — say so by having
    // no screenshot at all. A card that admits "no preview" is honest; a black
    // rectangle looks like a working feature that shows you nothing.
    return (await isBlank(blob)) ? null : blob
  } catch {
    return null
  }
}

// Is this image effectively empty? Samples rather than reading every pixel — a
// screenshot is only ever a few hundred KB, but this runs while you're waiting.
async function isBlank(blob) {
  try {
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return false
    const bmp = await createImageBitmap(blob)
    const c = new OffscreenCanvas(bmp.width, bmp.height)
    const ctx = c.getContext('2d')
    ctx.drawImage(bmp, 0, 0)
    const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height)
    for (let i = 0; i < data.length; i += 4 * 64) {
      if (data[i] > 8 || data[i + 1] > 8 || data[i + 2] > 8) return false
    }
    return true
  } catch {
    return false // can't tell — keep the shot rather than throw one away
  }
}

// Snapshot the running game. Returns { slot } on a successful upload, or
// { slot: null, offline: true } when only the local copy landed.
export async function saveState(emu, gameId, d) {
  const { fetch: f, caches: c } = deps(d)
  const state = emu?.gameManager?.getState?.()
  if (!state || !state.length) throw new Error('the emulator returned an empty save state')

  const blob = new Blob([state])

  // Local first, and unconditionally: this is the copy that survives a dead
  // network, and it's what emulator.html reads to resume the game on next boot.
  try {
    const cache = await c.open(GAME_SAVES_CACHE)
    await cache.put(localStateKey(gameId), new Response(blob))
  } catch {
    // A full/blocked cache shouldn't stop the upload below.
  }

  // Prefer a frame captured while the game was actually PRESENTING (see PlayerShell's
  // live-shot timer). Capturing here instead — at save time — reads the canvas AFTER
  // the core has paused and the save overlay has covered it, which on iOS WebKit comes
  // back solid black no matter what preserveDrawingBuffer says. That timing, not the
  // flag, is why every early thumbnail was black. Fall back to a live capture only when
  // no pre-captured frame was handed in.
  const shot = d?.shot ?? (await captureShot(emu))
  try {
    const body = new FormData()
    body.append('id', gameId)
    body.append('state', blob)
    if (shot) body.append('screenshot', shot, 'shot.png')
    // The backend assigns the slot itself (a timestamp) — the client never picks
    // one, which is also what keeps a hostile id out of the save path.
    const res = await f(saveStatesUrl(gameId), { method: 'POST', body })
    if (!res.ok) throw new Error(String(res.status))
    return { offline: false, bytes: state.length, hasShot: !!shot }
  } catch {
    return { offline: true, bytes: state.length, hasShot: !!shot }
  }
}

export async function listStates(gameId, d) {
  const { fetch: f } = deps(d)
  try {
    const res = await f(saveStatesUrl(gameId))
    if (!res.ok) return []
    const body = await res.json()
    return body?.states ?? []
  } catch {
    return []
  }
}

// Restore a snapshot into the RUNNING engine — no page reload, no engine reboot.
// (The old ?slot= launch path rebooted the whole player to do this.)
export async function loadState(emu, gameId, slot, d) {
  const { fetch: f } = deps(d)
  const res = await f(saveStateUrl(gameId, slot))
  if (!res.ok) throw new Error(`save state unavailable (${res.status})`)
  const buf = await res.arrayBuffer()
  emu.gameManager.loadState(new Uint8Array(buf))
  return true
}

export async function deleteState(gameId, slot, d) {
  const { fetch: f } = deps(d)
  const res = await f(`${saveStatesUrl(gameId)}&slot=${encodeURIComponent(slot)}`, { method: 'DELETE' })
  return res.ok
}
