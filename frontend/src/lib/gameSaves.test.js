import { describe, it, expect, vi } from 'vitest'
import {
  hashSave,
  pickNewest,
  readOutbox,
  addToOutbox,
  removeFromOutbox,
  readLocal,
  writeLocal,
  readServer,
  uploadSram,
  flushOutbox,
  readFromEngine,
  seedSave,
  captureSave,
  sramKey,
} from './gameSaves.js'

const GID = 'NintendoGameBoy/Pokemon Red.gb'

function fakeStorage(initial = {}) {
  const m = new Map(Object.entries(initial))
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, v),
    removeItem: (k) => m.delete(k),
  }
}

// Cache Storage, including the response headers we hang the timestamp off.
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

const bytes = (fill, len = 256) => new Uint8Array(len).fill(fill)

// An engine whose battery save we can poke at.
function fakeEmu(save = bytes(1)) {
  const files = { '/save.sav': save }
  return {
    files,
    gameManager: {
      getSaveFile: () => files['/save.sav'],
      getSaveFilePath: () => '/save.sav',
      loadSaveFiles: vi.fn(),
      FS: { writeFile: (p, b) => (files[p] = b) },
    },
  }
}

describe('hashSave', () => {
  it('notices a change ANYWHERE in the save', () => {
    // The bug this replaces: the old check sampled every 64th byte — 1.6% of a 32KB
    // save. Flip a byte it didn't happen to look at and it reported "unchanged", and
    // the save was silently dropped. Every offset must count.
    const base = new Uint8Array(32 * 1024)
    const h = hashSave(base)

    for (const offset of [0, 1, 7, 63, 64, 65, 1000, 32 * 1024 - 1]) {
      const changed = new Uint8Array(base)
      changed[offset] = 0xff
      expect(hashSave(changed), `a change at byte ${offset} went unnoticed`).not.toBe(h)
    }
  })

  it('is stable for an unchanged save, so we do not upload for nothing', () => {
    expect(hashSave(bytes(3))).toBe(hashSave(bytes(3)))
  })

  it('separates saves of different lengths', () => {
    expect(hashSave(bytes(0, 100))).not.toBe(hashSave(bytes(0, 200)))
  })

  it('has nothing to say about an empty save', () => {
    expect(hashSave(new Uint8Array())).toBeNull()
    expect(hashSave(null)).toBeNull()
  })
})

describe('pickNewest', () => {
  it('takes the SERVER copy when it is newer', () => {
    // The two-device bug. Seeding preferred the local cache unconditionally, so
    // playing on the iPad and then picking up the phone loaded the phone's older
    // save — and then overwrote the server with it, destroying the evidence.
    const local = { bytes: bytes(1), savedAt: 1000 }
    const remote = { bytes: bytes(2), savedAt: 2000 }
    expect(pickNewest(local, remote)).toBe('remote')
  })

  it('keeps the local copy when it is newer', () => {
    expect(pickNewest({ bytes: bytes(1), savedAt: 2000 }, { bytes: bytes(2), savedAt: 1000 })).toBe('local')
  })

  it('prefers local on an exact tie — it is the one already in the machine', () => {
    expect(pickNewest({ bytes: bytes(1), savedAt: 5 }, { bytes: bytes(2), savedAt: 5 })).toBe('local')
  })

  it('uses whichever one exists', () => {
    expect(pickNewest(null, { bytes: bytes(2), savedAt: 1 })).toBe('remote')
    expect(pickNewest({ bytes: bytes(1), savedAt: 1 }, null)).toBe('local')
    expect(pickNewest(null, null)).toBeNull()
  })

  it('ignores an empty save on either side', () => {
    expect(pickNewest({ bytes: new Uint8Array(), savedAt: 9 }, { bytes: bytes(2), savedAt: 1 })).toBe('remote')
  })
})

describe('the outbox', () => {
  it('remembers a game whose save never reached the server', () => {
    const s = fakeStorage()
    addToOutbox(s, GID)
    expect(readOutbox(s)).toEqual([GID])
  })

  it('does not queue the same game twice', () => {
    const s = fakeStorage()
    addToOutbox(s, GID)
    addToOutbox(s, GID)
    expect(readOutbox(s)).toEqual([GID])
  })

  it('forgets it once it lands', () => {
    const s = fakeStorage()
    addToOutbox(s, GID)
    removeFromOutbox(s, GID)
    expect(readOutbox(s)).toEqual([])
  })

  it('survives corrupt storage rather than throwing', () => {
    expect(readOutbox(fakeStorage({ 'homehq.games.sramOutbox': 'not json' }))).toEqual([])
    expect(readOutbox(null)).toEqual([])
  })
})

describe('local storage of a save', () => {
  it('round-trips the bytes AND when they were written', async () => {
    const d = { caches: fakeCaches(), storage: fakeStorage() }
    await writeLocal(GID, bytes(7), 1234, d)
    const got = await readLocal(GID, d)
    expect(got.bytes[0]).toBe(7)
    expect(got.savedAt).toBe(1234) // without this, newest-wins has nothing to compare
    expect(d.caches.store.has(sramKey(GID))).toBe(true)
  })

  it('returns null when this device has never saved the game', async () => {
    expect(await readLocal(GID, { caches: fakeCaches() })).toBeNull()
  })
})

describe('readServer', () => {
  it('reads the bytes and the timestamp the backend stamps on them', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => bytes(4).buffer,
      headers: { get: (h) => (h === 'x-saved-at' ? '9999' : null) },
    }))
    const got = await readServer(GID, { fetch })
    expect(got.savedAt).toBe(9999)
  })

  it('treats a 404 as "no save yet", not an error', async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 404 }))
    expect(await readServer(GID, { fetch })).toBeNull()
  })

  it('treats being offline as "cannot say", so the local copy stands', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('offline')
    })
    expect(await readServer(GID, { fetch })).toBeNull()
  })
})

describe('uploadSram', () => {
  it('clears the outbox on success', async () => {
    const storage = fakeStorage()
    addToOutbox(storage, GID)
    const fetch = vi.fn(async () => ({ ok: true }))
    expect(await uploadSram(GID, bytes(1), { fetch, storage })).toBe(true)
    expect(readOutbox(storage)).toEqual([])
  })

  it('queues the game when the upload fails, instead of forgetting it', async () => {
    // The gap that let an offline save never reach the server, the backup, or the
    // other device. The readers have had an outbox for ages; games never did.
    const storage = fakeStorage()
    const fetch = vi.fn(async () => {
      throw new Error('offline')
    })
    expect(await uploadSram(GID, bytes(1), { fetch, storage })).toBe(false)
    expect(readOutbox(storage)).toEqual([GID])
  })
})

describe('flushOutbox', () => {
  it('re-sends what was queued, from the copy already on disk', async () => {
    const storage = fakeStorage()
    const caches = fakeCaches()
    await writeLocal(GID, bytes(5), 111, { caches })
    addToOutbox(storage, GID)

    const fetch = vi.fn(async () => ({ ok: true }))
    expect(await flushOutbox({ fetch, storage, caches })).toBe(1)
    expect(readOutbox(storage)).toEqual([]) // it landed
  })

  it('drops a queued game that has no local save left to send', async () => {
    const storage = fakeStorage()
    addToOutbox(storage, GID)
    const fetch = vi.fn()
    expect(await flushOutbox({ fetch, storage, caches: fakeCaches() })).toBe(0)
    expect(readOutbox(storage)).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps it queued if the retry fails too', async () => {
    const storage = fakeStorage()
    const caches = fakeCaches()
    await writeLocal(GID, bytes(5), 111, { caches })
    addToOutbox(storage, GID)
    const fetch = vi.fn(async () => {
      throw new Error('still offline')
    })
    await flushOutbox({ fetch, storage, caches })
    expect(readOutbox(storage)).toEqual([GID])
  })
})

describe('seedSave', () => {
  const d = (server) => ({
    caches: fakeCaches(),
    storage: fakeStorage(),
    fetch: server
      ? vi.fn(async () => ({
          ok: true,
          arrayBuffer: async () => server.bytes.buffer,
          headers: { get: () => String(server.savedAt) },
        }))
      : vi.fn(async () => ({ ok: false, status: 404 })),
  })

  it('loads the SERVER save when it is newer than this device’s', async () => {
    const deps = d({ bytes: bytes(9), savedAt: 5000 })
    await writeLocal(GID, bytes(1), 1000, deps) // this device's stale copy
    const emu = fakeEmu()

    const r = await seedSave(emu, GID, deps)

    expect(r.from).toBe('remote')
    expect(emu.files['/save.sav'][0]).toBe(9) // the newer save went into the game
  })

  it('adopts that newer save locally, so the device stops believing its own stale one', async () => {
    const deps = d({ bytes: bytes(9), savedAt: 5000 })
    await writeLocal(GID, bytes(1), 1000, deps)
    await seedSave(fakeEmu(), GID, deps)

    const local = await readLocal(GID, deps)
    expect(local.bytes[0]).toBe(9)
    expect(local.savedAt).toBe(5000)
  })

  it('keeps the local save when it is the newer one', async () => {
    const deps = d({ bytes: bytes(9), savedAt: 1000 })
    await writeLocal(GID, bytes(1), 5000, deps)
    const emu = fakeEmu()

    const r = await seedSave(emu, GID, deps)

    expect(r.from).toBe('local')
    expect(emu.files['/save.sav'][0]).toBe(1)
  })

  it('works offline, from the local copy alone', async () => {
    const deps = { caches: fakeCaches(), storage: fakeStorage(), fetch: async () => { throw new Error('offline') } }
    await writeLocal(GID, bytes(3), 1000, deps)
    const emu = fakeEmu()

    expect((await seedSave(emu, GID, deps)).from).toBe('local')
    expect(emu.files['/save.sav'][0]).toBe(3)
  })

  it('does nothing at all for a game that has never been saved', async () => {
    const deps = d(null)
    const emu = fakeEmu()
    expect((await seedSave(emu, GID, deps)).seeded).toBe(false)
  })
})

describe('captureSave', () => {
  const deps = (now = 1000) => ({
    caches: fakeCaches(),
    storage: fakeStorage(),
    fetch: vi.fn(async () => ({ ok: true })),
    now: () => now,
  })

  it('writes the save locally AND pushes it up', async () => {
    const d = deps()
    const s = await captureSave(fakeEmu(bytes(4)), GID, {}, d)
    expect((await readLocal(GID, d)).bytes[0]).toBe(4)
    expect(d.fetch).toHaveBeenCalled()
    expect(s.hash).toBeTruthy()
  })

  it('does nothing when the save has not changed', async () => {
    const d = deps()
    const emu = fakeEmu(bytes(4))
    const first = await captureSave(emu, GID, {}, d)
    d.fetch.mockClear()

    await captureSave(emu, GID, first, d)
    expect(d.fetch).not.toHaveBeenCalled()
  })

  it('throttles the upload but NEVER the local write', async () => {
    // The network doesn't need to hear about every frame of a battle — but the copy
    // that survives a crash does.
    const d = deps(1000)
    const emu = fakeEmu(bytes(4))
    const s1 = await captureSave(emu, GID, {}, d)
    d.fetch.mockClear()

    emu.files['/save.sav'] = bytes(5) // the game saved again, moments later
    const s2 = await captureSave(emu, GID, s1, d)

    expect(d.fetch).not.toHaveBeenCalled() // throttled
    expect((await readLocal(GID, d)).bytes[0]).toBe(5) // but written down
    expect(readOutbox(d.storage)).toEqual([GID]) // and remembered for later
    expect(s2.hash).not.toBe(s1.hash)
  })

  it('IGNORES the throttle on the way out — this is the one that was losing saves', async () => {
    // Quitting used to lose the save entirely: the flush was asynchronous and the
    // iframe was destroyed before it landed. Now the parent does it, and `force`
    // means "the game is about to disappear, send it now".
    const d = deps(1000)
    const emu = fakeEmu(bytes(4))
    const s1 = await captureSave(emu, GID, {}, d)
    d.fetch.mockClear()

    emu.files['/save.sav'] = bytes(6)
    await captureSave(emu, GID, { ...s1, force: true }, d)

    expect(d.fetch).toHaveBeenCalled()
    expect((await readLocal(GID, d)).bytes[0]).toBe(6)
  })

  it('keeps the local save even when the upload fails', async () => {
    const d = deps()
    d.fetch = vi.fn(async () => {
      throw new Error('offline')
    })
    await captureSave(fakeEmu(bytes(8)), GID, {}, d)

    expect((await readLocal(GID, d)).bytes[0]).toBe(8) // safe on this device
    expect(readOutbox(d.storage)).toEqual([GID]) // and queued for the server
  })

  it('does nothing when the engine has no save to give', async () => {
    const d = deps()
    const s = await captureSave(fakeEmu(new Uint8Array()), GID, {}, d)
    expect(d.fetch).not.toHaveBeenCalled()
    expect(s).toEqual({})
  })
})

describe('readFromEngine', () => {
  it('flushes the core’s RAM before reading — otherwise the last save is still in memory', () => {
    const emu = fakeEmu(bytes(2))
    const spy = vi.spyOn(emu.gameManager, 'getSaveFile')
    readFromEngine(emu)
    expect(spy).toHaveBeenCalledWith(true)
  })

  it('does not throw when the engine is already gone', () => {
    expect(readFromEngine(null)).toBeNull()
    expect(readFromEngine({})).toBeNull()
  })
})
