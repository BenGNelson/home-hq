import { systemStyle } from './theme.js'

// The six machines, drawn rather than scraped.
//
// Every other front-end pulls the same console logos from the same database, which
// is precisely why they all look the same. These are ours: one flat style, one light
// source from above, the same rounded language as the frog.
//
// NO OFFICIAL LOGOS OR WORDMARKS. The hardware is drawn; the systems are named in
// plain text elsewhere. That distinction is what keeps this publishable — stylized
// illustrations of hardware are well-trodden ground in open-source front-ends;
// shipping someone's trademark is what gets a repo a letter.
//
// For a HANDHELD the device is the icon — you picture a Game Boy. For a HOME CONSOLE
// the box is a boring slab and it's the CONTROLLER you picture, so that's what's
// drawn. "The thing you hold" is the rule, and it's why the set feels coherent.

function Dpad({ x, y, s = 1, fill = '#2B3038' }) {
  const w = 7 * s
  const l = 20 * s
  return (
    <g transform={`translate(${x} ${y})`} fill={fill}>
      <rect x={-w / 2} y={-l / 2} width={w} height={l} rx={1.5 * s} />
      <rect x={-l / 2} y={-w / 2} width={l} height={w} rx={1.5 * s} />
    </g>
  )
}

// --- handhelds: the device IS the icon --------------------------------------

function Handheld({ body, screenTint, buttons, sheen, screenY = 16, screenH = 30 }) {
  return (
    <>
      <rect x="18" y="6" width="64" height="88" rx="9" fill={body.shell} />
      <rect x="18" y="6" width="64" height="88" rx="9" fill={`url(#${sheen})`} opacity="0.55" />
      {/* screen bezel + the LCD's own colour — a Game Boy screen is never black */}
      <rect x="26" y={screenY} width="48" height={screenH} rx="3" fill="#3A3F45" />
      <rect x="30" y={screenY + 3} width="40" height={screenH - 6} rx="1.5" fill={screenTint} />
      <Dpad x={35} y={screenY + screenH + 20} s={1} />
      {buttons}
      {/* start / select */}
      <rect x="40" y="86" width="9" height="3" rx="1.5" fill="#2B3038" transform="rotate(-20 44 87)" />
      <rect x="52" y="86" width="9" height="3" rx="1.5" fill="#2B3038" transform="rotate(-20 56 87)" />
    </>
  )
}

const DEVICES = {
  // The DMG brick. Grey shell, pea-soup screen, two round buttons on the diagonal.
  dmg: (s, sheen) => (
    <Handheld
      sheen={sheen}
      body={{ shell: '#C9C7BC' }}
      screenTint="#8FA24B"
      buttons={
        <>
          <circle cx="62" cy="66" r="5.5" fill="#8E3A5A" />
          <circle cx="74" cy="60" r="5.5" fill="#8E3A5A" />
        </>
      }
    />
  ),

  // Same brick, berry-translucent plastic, a colour screen.
  gbc: (s, sheen) => (
    <Handheld
      sheen={sheen}
      body={{ shell: s.shade }}
      screenTint="#5C7BC4"
      screenY={18}
      screenH={30}
      buttons={
        <>
          <circle cx="62" cy="68" r="5.5" fill="#2B3038" />
          <circle cx="74" cy="62" r="5.5" fill="#2B3038" />
        </>
      }
    />
  ),

  // Turned on its side: the screen goes to the middle, the buttons to the edges,
  // and it grows shoulders.
  gba: (s, sheen) => (
    <>
      <rect x="6" y="26" width="88" height="48" rx="16" fill={s.shade} />
      <rect x="6" y="26" width="88" height="48" rx="16" fill={`url(#${sheen})`} opacity="0.5" />
      <rect x="10" y="24" width="16" height="7" rx="3.5" fill={s.shade} />
      <rect x="74" y="24" width="16" height="7" rx="3.5" fill={s.shade} />
      <rect x="32" y="36" width="36" height="28" rx="2.5" fill="#3A3F45" />
      <rect x="35" y="39" width="30" height="22" rx="1.5" fill="#5C7BC4" />
      <Dpad x="19" y="50" s="0.82" />
      <circle cx="80" cy="54" r="5" fill="#8E3A5A" />
      <circle cx="89" cy="46" r="5" fill="#8E3A5A" />
    </>
  ),

  // A home console: you don't picture the box, you picture the pad. Two rounded
  // grips, the four lavender buttons, the two shoulders.
  snes: (s, sheen) => (
    <>
      <rect x="4" y="34" width="92" height="34" rx="17" fill="#D8D6D0" />
      <rect x="4" y="34" width="92" height="34" rx="17" fill={`url(#${sheen})`} opacity="0.5" />
      <rect x="14" y="28" width="20" height="8" rx="4" fill="#B9B7B1" />
      <rect x="66" y="28" width="20" height="8" rx="4" fill="#B9B7B1" />
      <Dpad x="24" y="51" s="0.85" />
      <circle cx="70" cy="58" r="5" fill={s.shade} />
      <circle cx="82" cy="51" r="5" fill={s.skin} />
      <circle cx="70" cy="44" r="5" fill={s.shade} />
      <circle cx="58" cy="51" r="5" fill={s.skin} />
      <rect x="42" y="48" width="9" height="3.5" rx="1.75" fill="#8E8C87" />
      <rect x="42" y="55" width="9" height="3.5" rx="1.75" fill="#8E8C87" />
    </>
  ),

  // The three-button Mega Drive pad: a wide black wedge, three buttons in a row.
  genesis: (s, sheen) => (
    <>
      <path d="M8 44 Q8 32 22 32 H78 Q92 32 92 44 Q92 70 74 70 H26 Q8 70 8 44 Z" fill="#3B4149" />
      <path d="M8 44 Q8 32 22 32 H78 Q92 32 92 44 Q92 70 74 70 H26 Q8 70 8 44 Z" fill={`url(#${sheen})`} opacity="0.35" />
      <Dpad x="28" y="50" s="0.9" fill="#101216" />
      <circle cx="58" cy="55" r="5.5" fill="#B23A3A" />
      <circle cx="71" cy="52" r="5.5" fill="#B23A3A" />
      <circle cx="84" cy="49" r="5.5" fill="#B23A3A" />
      <rect x="44" y="36" width="12" height="4" rx="2" fill="#3D424A" />
    </>
  ),

  // The Master System pad: a plain black rectangle and two buttons. It is what it is.
  sms: (s, sheen) => (
    <>
      <rect x="12" y="34" width="76" height="34" rx="5" fill="#3B4149" />
      <rect x="12" y="34" width="76" height="34" rx="5" fill={`url(#${sheen})`} opacity="0.35" />
      <Dpad x="34" y="51" s="0.9" fill="#101216" />
      <circle cx="64" cy="51" r="6" fill="#C0392B" />
      <circle cx="78" cy="51" r="6" fill="#C0392B" />
    </>
  ),
}

// One machine, drawn in its own colours.
export default function Console({ system, size = 96, className = '', style }) {
  const s = systemStyle(system)
  const draw = DEVICES[s.device] || DEVICES.dmg
  const sheen = `frog-sheen-${s.device}`

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      style={style}
      role="img"
      aria-label={system}
    >
      <defs>
        {/* The single light source the whole set shares. */}
        <linearGradient id={sheen} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.04" />
          <stop offset="1" stopColor="#000" stopOpacity="0.22" />
        </linearGradient>
      </defs>
      {draw(s, sheen)}
    </svg>
  )
}
