import { useNavigate, useSearchParams } from 'react-router-dom'
import { saveStateUrl } from '../../lib/library.js'
import PlayerShell from './player/PlayerShell.jsx'

// The /library/play route. A real route (not a modal) so the phone's back
// gesture exits the game, and so unmounting tears the engine down completely.
// Everything else lives in PlayerShell.
export default function Player() {
  const [params] = useSearchParams()
  const navigate = useNavigate()

  const id = params.get('id')
  const core = params.get('core')
  const name = params.get('name') || 'Game'
  // The system ("Game Boy Color"). Optional — a core can't be trusted to imply it
  // (GBC games run on the gba core), and an offline download entry never stored one.
  const label = params.get('label') || ''
  // Present when launching straight into a save state from the game's detail
  // page. In-game, loading a state no longer reboots the player — but this entry
  // point still does, because there's no running engine yet to load into.
  const slot = params.get('slot')

  if (!id || !core) {
    return (
      <div className="p-6 text-rose-400">
        Missing game.{' '}
        <button onClick={() => navigate('/library/games')} className="underline">
          Back to Games
        </button>
      </div>
    )
  }

  return (
    <PlayerShell
      id={id}
      core={core}
      name={name}
      label={label}
      loadStateUrl={slot ? saveStateUrl(id, slot) : undefined}
    />
  )
}
