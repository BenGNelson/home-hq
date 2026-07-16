import { FROG, systemStyle } from './theme.js'
import { frogCharacterMarkup, frogMarkMarkup } from './art.js'
import Console from './Console.jsx'

// The frog.
//
// Silhouette first: two eye domes over a rounded body. Three shapes. If a mascot needs
// its face to be legible before you can identify it, it fails as a favicon — so the
// shape has to survive being shrunk to 16px and flattened to one colour, which is what
// <FrogMark> is.
//
// It never speaks. It expresses itself through STATE: it breathes while it waits,
// closes its eyes when nothing's happening, and wears the colours of whichever machine
// you're looking at. That restraint is what separates a mascot from a Clippy.
//
// The drawing itself lives in art.js as markup, not JSX, because the SAME frog has to
// render inside the player iframe (as the loading screen) where React can't reach.
// One animal, two documents, no chance of drift.

// The two-tone mark: favicons, app icons, the header badge. One path's worth of idea.
export function FrogMark({ size = 24, className = '', style }) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: frogMarkMarkup({ ground: FROG.ground }) }}
    />
  )
}

// Water, in one component: a thing floating on it throws a copy of itself downward.
// Not a shadow — a reflection. It's the cheapest thing in the whole app and it does
// more for the motif than anything else here, so everything that floats gets one.
//
// `transformOrigin: top` is load-bearing: with the default (center) the flipped copy
// lifts away from the thing casting it and reads as a second, detached object.
export function Reflected({ children, scale = 0.5, className = '' }) {
  return (
    <div className={`relative ${className}`}>
      {children}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-full opacity-[0.18]"
        style={{
          transform: `scaleY(-${scale})`,
          transformOrigin: 'top',
          filter: 'blur(2px)',
          maskImage: 'linear-gradient(to bottom, black, transparent 70%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black, transparent 70%)',
        }}
      >
        {children}
      </div>
    </div>
  )
}

// The frog wearing a console's colours AND holding its machine as a badge.
//
// The colour alone doesn't say which system — two of the six are greenish Game Boys —
// so a small `Console` icon is pinned to the frog's lower corner (Ben's pick). Used
// wherever the big frog stands in for the focused system: the shelf, the game list,
// the game screen. Without a `system` it's just the plain frog (boot, search), so this
// is a safe drop-in for `<Frog system>`. The badge rides inside `<Reflected>` with the
// frog, so it reflects on the water like everything else.
export function SystemFrog({ size = 96, system, asleep = false, className = '', style }) {
  const badge = Math.round(size * 0.4)
  return (
    <div className={`relative inline-block ${className}`} style={{ width: size, height: size, ...style }}>
      <Frog size={size} system={system} asleep={asleep} />
      {system && (
        <div
          className="absolute flex items-center justify-center rounded-full"
          style={{
            right: -size * 0.02,
            bottom: size * 0.04,
            padding: Math.max(2, Math.round(size * 0.035)),
            background: FROG.ground,
            border: '1px solid rgba(160, 255, 214, 0.22)',
            boxShadow: '0 4px 14px rgba(0,0,0,0.55)',
          }}
        >
          <Console system={system} size={badge} />
        </div>
      )}
    </div>
  )
}

// The full character: the boot, the shelf, the empty states.
//
// `system` dresses it in that console's colours. `asleep` shuts its eyes — used when
// the app has been sitting idle.
export default function Frog({ size = 96, system, asleep = false, className = '', style }) {
  const s = systemStyle(system)
  // The gradient needs an id, and two frogs on one page must not share one.
  const id = `frog-${size}-${system || 'default'}`.replace(/\W/g, '')

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={`frog-body ${className}`}
      style={style}
      role="img"
      aria-label="Frog"
      dangerouslySetInnerHTML={{
        __html: frogCharacterMarkup({ skin: s.skin, shade: s.shade, belly: s.belly, id, asleep }),
      }}
    />
  )
}
