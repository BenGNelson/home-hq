import Frog from './Frog.jsx'
import { FROG } from './theme.js'
import './frog.css'

// The screen between tapping Play and the game appearing.
//
// It lives in the PARENT, over the iframe — and that is the whole point.
//
// The first two versions of this lived inside the player document, and both of them
// jumped. Not because the frog moved, but because the ground did: when the game
// starts, the iframe itself is resized (on a phone it drops to 46% of the screen so
// the touch controls can have the rest). Anything centred inside a box that changes
// size moves when it changes size, and no amount of position: fixed inside that box
// can save you. Out here the overlay is pinned to the whole player, which never
// resizes, so the frog physically cannot go anywhere.
//
// There's no progress bar. There was one — the frog filled with water — and it was
// lovely and it was pointless: a cached core loads in ~300ms, so nobody ever saw it
// fill. What you want in that second is to know the thing is alive and that it's
// yours. A breathing frog says both, and it can't be wrong about a percentage.
// The boot frog is deliberately NOT dressed in the console's colours (no `system`
// prop passed through to <Frog>). Everywhere else the frog wears the machine you're
// looking at; here it's the LOGO — the one canonical jade frog — because this is the
// app announcing itself, not a shelf tile. Tinting it to the console read as "a blue
// frog" and broke the brand recognition. Jade, always.
export default function FrogBoot({ done }) {
  return (
    <div
      data-testid="frog-boot-screen"
      data-phase={done ? 'done' : 'loading'}
      className="frog-boot absolute inset-0 z-40 flex items-center justify-center"
      style={{
        background: `radial-gradient(60% 45% at 50% 50%, rgba(${FROG.jade}, 0.18), transparent 70%), ${FROG.ground}`,
      }}
      aria-label="Loading"
      role="status"
    >
      {/* One ring, breathing out from under it — the pond, not a spinner. */}
      <span
        aria-hidden="true"
        className="frog-boot-ring absolute rounded-full"
        style={{ borderColor: `rgba(${FROG.jade}, 0.45)`, width: 'min(52vmin, 280px)', aspectRatio: 1 }}
      />

      <Frog
        size={220}
        className="frog-boot-frog relative"
        style={{ filter: `drop-shadow(0 14px 44px rgba(${FROG.jade}, 0.45))`, maxWidth: '44vmin', height: 'auto' }}
      />
    </div>
  )
}
