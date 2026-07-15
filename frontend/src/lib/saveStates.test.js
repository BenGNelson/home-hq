import { describe, it, expect, vi } from 'vitest'
import { saveState, loadState, listStates, deleteState, captureShot, localStateKey } from './saveStates.js'

// A running engine, reduced to the two things save states touch.
function fakeEmu({ state = new Uint8Array([1, 2, 3]), shot = new Blob(['png']) } = {}) {
  return {
    gameManager: {
      getState: () => state,
      loadState: vi.fn(),
    },
    capture: { photo: {} },
    // NOTE the shape: takeScreenshot resolves { blob }, not { screenshot }.
    takeScreenshot: vi.fn(async () => (shot ? { blob: shot } : null)),
  }
}

function fakeCaches() {
  const store = new Map()
  return {
    store,
    open: async () => ({
      put: async (k, res) => store.set(k, res),
      match: async (k) => store.get(k),
    }),
  }
}

const ok = (body) => ({ ok: true, status: 200, json: async () => body, arrayBuffer: async () => body })

describe('captureShot', () => {
  it('reads the blob the engine actually returns', () => {
    // EmulatorJS 4.2.3 destructures { screenshot } from takeScreenshot(), which
    // resolves { blob } — so the saveState event's e.screenshot is always
    // undefined. We must take the frame ourselves.
    return expect(captureShot(fakeEmu())).resolves.toBeInstanceOf(Blob)
  })

  it('returns null instead of throwing when the engine cannot screenshot', async () => {
    await expect(captureShot({})).resolves.toBeNull()
    await expect(captureShot({ takeScreenshot: async () => { throw new Error('no gl') } })).resolves.toBeNull()
  })
})

describe('saveState', () => {
  it('writes the local copy and uploads', async () => {
    const caches = fakeCaches()
    const fetch = vi.fn(async () => ok({}))
    const res = await saveState(fakeEmu(), 'gb/zelda.gb', { fetch, caches })

    expect(res.offline).toBe(false)
    expect(caches.store.has(localStateKey('gb/zelda.gb'))).toBe(true)

    const [url, init] = fetch.mock.calls[0]
    expect(url).toContain('/api/library/games/save-states')
    expect(init.method).toBe('POST')
    // The backend assigns the slot (a timestamp). The client never picks one —
    // that's what keeps a hostile id out of the save path on disk.
    expect(init.body.get('slot')).toBeNull()
    expect(init.body.get('id')).toBe('gb/zelda.gb')
    expect(init.body.get('screenshot')).toBeTruthy()
  })

  it('still keeps the local copy when the upload fails', async () => {
    // This is the copy that makes offline play resume. Losing it because the
    // network blipped would be the worst bug in the feature.
    const caches = fakeCaches()
    const fetch = vi.fn(async () => {
      throw new Error('offline')
    })
    const res = await saveState(fakeEmu(), 'gb/zelda.gb', { fetch, caches })

    expect(res.offline).toBe(true)
    expect(caches.store.has(localStateKey('gb/zelda.gb'))).toBe(true)
  })

  it('reports offline on a non-OK response too', async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 500 }))
    const res = await saveState(fakeEmu(), 'g', { fetch, caches: fakeCaches() })
    expect(res.offline).toBe(true)
  })

  it('still uploads when the cache write fails', async () => {
    const fetch = vi.fn(async () => ok({}))
    const hostileCaches = { open: async () => { throw new Error('quota') } }
    const res = await saveState(fakeEmu(), 'g', { fetch, caches: hostileCaches })
    expect(res.offline).toBe(false)
    expect(fetch).toHaveBeenCalled()
  })

  it('refuses to save an empty state rather than writing a corrupt one', async () => {
    const emu = fakeEmu({ state: new Uint8Array() })
    await expect(saveState(emu, 'g', { fetch: vi.fn(), caches: fakeCaches() })).rejects.toThrow(/empty/)
  })

  it('saves without a screenshot when the frame grab fails', async () => {
    const fetch = vi.fn(async () => ok({}))
    const emu = fakeEmu({ shot: null })
    const res = await saveState(emu, 'g', { fetch, caches: fakeCaches() })
    expect(res.hasShot).toBe(false)
    expect(fetch.mock.calls[0][1].body.get('screenshot')).toBeNull()
  })

  it('uploads a PRE-CAPTURED live frame and never touches the (occluded) canvas', async () => {
    // The fix for black thumbnails: the frame is grabbed while the game is still on
    // screen and handed in here. Capturing at save time reads the paused, covered
    // canvas — black on iOS. So a supplied shot must be used, and takeScreenshot must
    // NOT be called (that's the black one).
    const fetch = vi.fn(async () => ok({}))
    const emu = fakeEmu()
    const live = new Blob(['live-frame'])
    const res = await saveState(emu, 'g', { shot: live, fetch, caches: fakeCaches() })
    expect(res.hasShot).toBe(true)
    expect(emu.takeScreenshot).not.toHaveBeenCalled()
    // FormData wraps the blob in a File, so it's attached (truthy) but not identity-equal.
    expect(fetch.mock.calls[0][1].body.get('screenshot')).toBeTruthy()
  })

  it('falls back to a save-time capture when no live frame was handed in', async () => {
    const fetch = vi.fn(async () => ok({}))
    const emu = fakeEmu()
    await saveState(emu, 'g', { fetch, caches: fakeCaches() })
    expect(emu.takeScreenshot).toHaveBeenCalled()
  })
})

describe('loadState', () => {
  it('restores into the running engine — no reboot', async () => {
    const emu = fakeEmu()
    const bytes = new Uint8Array([9, 9]).buffer
    const fetch = vi.fn(async () => ok(bytes))

    await loadState(emu, 'gb/zelda.gb', '1720000000000', { fetch })

    expect(emu.gameManager.loadState).toHaveBeenCalledOnce()
    expect(emu.gameManager.loadState.mock.calls[0][0]).toBeInstanceOf(Uint8Array)
    expect(fetch.mock.calls[0][0]).toContain('slot=1720000000000')
  })

  it('throws (so the UI can say so) when the state is gone', async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 404 }))
    await expect(loadState(fakeEmu(), 'g', '1', { fetch })).rejects.toThrow(/404/)
  })
})

describe('listStates / deleteState', () => {
  it('lists the states the backend holds', async () => {
    const fetch = vi.fn(async () => ok({ states: [{ slot: '2' }, { slot: '1' }] }))
    await expect(listStates('g', { fetch })).resolves.toHaveLength(2)
  })

  it('returns an empty list rather than throwing when offline', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('offline')
    })
    await expect(listStates('g', { fetch })).resolves.toEqual([])
  })

  it('deletes by slot', async () => {
    const fetch = vi.fn(async () => ({ ok: true }))
    await expect(deleteState('g', '7', { fetch })).resolves.toBe(true)
    expect(fetch.mock.calls[0][0]).toContain('slot=7')
    expect(fetch.mock.calls[0][1].method).toBe('DELETE')
  })
})
