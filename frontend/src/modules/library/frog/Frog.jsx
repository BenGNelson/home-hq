import { FROG, systemStyle } from './theme.js'

// The frog.
//
// Silhouette first: two eye domes over a rounded body. Three shapes. If a mascot
// needs its face to be legible before you can identify it, it fails as a favicon —
// so the shape has to survive being shrunk to 16px and flattened to one colour,
// which is what <FrogMark> is.
//
// It never speaks. It expresses itself through STATE: it breathes while it waits,
// closes its eyes when nothing's happening, and wears the colours of whichever
// machine you're looking at. That restraint is what separates a mascot from a Clippy.

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
    >
      <ellipse cx="50" cy="62" rx="37" ry="30" fill="currentColor" />
      <circle cx="28" cy="30" r="16" fill="currentColor" />
      <circle cx="72" cy="30" r="16" fill="currentColor" />
      {/* The eyes are holes, not marks — so the silhouette still reads when the whole
          thing is knocked out of a solid block. */}
      <circle cx="28" cy="29" r="7" fill={FROG.ground} />
      <circle cx="72" cy="29" r="7" fill={FROG.ground} />
    </svg>
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

// The full character: the boot, the shelf, the empty states.
//
// `system` dresses it in that console's colours. `asleep` shuts its eyes — used when
// the app has been sitting idle, which is the closest thing Frog has to a personality.
export default function Frog({ size = 96, system, asleep = false, className = '', style }) {
  const s = systemStyle(system)
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
    >
      <defs>
        {/* A single light source, from above — the same one every console below uses,
            which is what makes them look like one set rather than six drawings. */}
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={s.skin} />
          <stop offset="1" stopColor={s.shade} />
        </linearGradient>
      </defs>

      <g className="frog-breathe">
        {/* The feet. Three shapes' worth of work and they're what turn a green blob
            into a frog SITTING — the posture is most of the character. */}
        {[22, 78].map((x, i) => (
          <g key={x} fill={s.shade}>
            <ellipse cx={x} cy="88" rx="12" ry="6.5" />
            {[-6, 0, 6].map((d) => (
              <circle key={d} cx={x + (i === 0 ? d - 2 : d + 2)} cy="91" r="2.6" />
            ))}
          </g>
        ))}

        <ellipse cx="50" cy="62" rx="37" ry="30" fill={`url(#${id})`} />
        <ellipse cx="50" cy="76" rx="22" ry="13" fill={s.belly} opacity="0.45" />

        <circle cx="28" cy="30" r="16" fill={s.skin} />
        <circle cx="72" cy="30" r="16" fill={s.skin} />

        {asleep ? (
          // Two closed lids. It's the whole "asleep" state — nothing else changes.
          <>
            <path d="M20 31 Q28 37 36 31" stroke="#0A1F19" strokeWidth="2.4" fill="none" strokeLinecap="round" />
            <path d="M64 31 Q72 37 80 31" stroke="#0A1F19" strokeWidth="2.4" fill="none" strokeLinecap="round" />
          </>
        ) : (
          <>
            <circle cx="28" cy="29" r="10.5" fill="#F4FBF8" />
            <circle cx="72" cy="29" r="10.5" fill="#F4FBF8" />
            <circle cx="29" cy="30" r="5.4" fill="#0A1F19" />
            <circle cx="71" cy="30" r="5.4" fill="#0A1F19" />
            <circle cx="31" cy="27.6" r="1.9" fill="#fff" />
            <circle cx="73" cy="27.6" r="1.9" fill="#fff" />
            {/* Lids sit at scaleY(0) and snap shut on the blink keyframe. */}
            <ellipse className="frog-lid" cx="28" cy="29" rx="11" ry="11" fill={s.skin} />
            <ellipse className="frog-lid frog-lid-b" cx="72" cy="29" rx="11" ry="11" fill={s.skin} />
          </>
        )}

        {/* The mouth rides ABOVE the belly. When they overlapped, the pale belly read
            as a chin and the whole face slid downward. */}
        <path
          d="M32 55 Q50 67 68 55"
          stroke="#0A1F19"
          strokeWidth="2.6"
          fill="none"
          strokeLinecap="round"
          opacity="0.75"
        />
        <circle cx="43" cy="46" r="1.7" fill="#0A1F19" opacity="0.5" />
        <circle cx="57" cy="46" r="1.7" fill="#0A1F19" opacity="0.5" />
      </g>
    </svg>
  )
}
