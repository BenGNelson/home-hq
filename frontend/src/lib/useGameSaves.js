import { useEffect, useRef } from 'react'
import { seedSave, captureSave, flushOutbox } from './gameSaves.js'

// Owns the battery save for as long as a game is on screen.
//
// It lives in the PARENT — that is the whole point. The player iframe cannot be
// trusted to save your game, because the moment you quit it is the thing being
// destroyed, and every write it starts dies with it. This survives, so it can read
// the save out of the engine and then write it down properly.
//
// Four moments matter:
//   · when the game starts   — seed it with whichever copy is newer (see gameSaves)
//   · every few seconds      — capture, if it changed
//   · when you leave         — capture, unconditionally, before the engine goes away
//   · when you come back online — push anything the outbox is still holding
export function useGameSaves(emuRef, gameId, running) {
  const stateRef = useRef({}) // { hash, uploadedAt } — carried between captures
  const seededRef = useRef(false)

  useEffect(() => {
    if (!running || !gameId) return
    const emu = emuRef.current
    if (!emu) return

    let alive = true

    // Seed once per game. Doing it twice would stomp progress made since.
    if (!seededRef.current) {
      seededRef.current = true
      seedSave(emu, gameId).catch(() => {})
    }

    const capture = async (force = false) => {
      const emuNow = emuRef.current
      if (!emuNow) return
      stateRef.current = await captureSave(emuNow, gameId, { ...stateRef.current, force })
    }

    const timer = setInterval(() => {
      if (alive) capture()
    }, 5000)

    // iOS can discard a backgrounded tab without further warning, so treat "hidden"
    // as "might never come back" and flush for real.
    const onHide = () => {
      if (document.visibilityState === 'hidden') capture(true)
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', () => capture(true))

    return () => {
      alive = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onHide)
      // THE IMPORTANT ONE. Quitting unmounts this and destroys the engine, so this is
      // the last chance anyone gets to read the save. It runs here, in the parent,
      // which is still very much alive — the old code ran it inside the iframe that
      // was already on its way out, and the write never landed.
      capture(true)
    }
  }, [running, gameId, emuRef])

  // Anything that never reached the server gets another go the moment we're back.
  useEffect(() => {
    const retry = () => flushOutbox().catch(() => {})
    retry() // and once now, in case we came back while nobody was looking
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [])
}
