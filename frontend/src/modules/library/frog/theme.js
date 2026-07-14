// Frog's own look.
//
// Home HQ's visual motif is LIGHT — the back-lit radiance you see on the Solar page
// and the dashboard cards. Frog borrows the house's bones (a near-black ground, one
// accent, constant-palette RGB that survives a theme swap) but not its signature, or
// it would just be a skin.
//
// FROG'S MOTIF IS WATER. Things float, reflect, and ripple. Cards hover over a dark
// pond with a soft reflection under them; selecting one sends out a ripple. Same
// house, different room — you should look at it and think "different app", not
// "different page".
//
// (When Frog is eventually lifted into its own repo, this file is the whole theme.
//  Everything visual reads from here.)

// The ground is a GREEN-black, where Home HQ's is a blue-black. Same darkness, and
// the difference is almost subliminal until you put them side by side — which is
// exactly the amount of different we want.
export const FROG = {
  ground: '#05110D',
  panel: '#0A1C16',
  line: 'rgba(160, 255, 214, 0.10)',

  ink: '#E6F5EE',
  soft: '#93B5A8',
  faint: '#5B7A6E',

  // The frog's own green. Constant RGB (not a Tailwind token) so it survives a
  // Home HQ theme swap, same rule the section accents follow.
  jade: '52, 211, 153',
  // A cartridge label. Stops the whole thing being one note of green.
  amber: '242, 180, 65',
  // Home HQ's violet appears exactly once in Frog: the way back home.
  home: '139, 92, 246',
}

// One frog, six costumes. This is the part no scraper can hand anyone else — every
// other front-end pulls the same console logos from the same database, which is why
// they all look alike.
//
// `skin`/`shade`/`belly` dress the frog; `accent` tints the whole screen when that
// console is selected. The values are drawn from the real hardware: the DMG's
// pea-soup LCD, the Color's berry plastic, the SNES's lavender buttons, the Genesis's
// red badge.
export const SYSTEMS = {
  'Game Boy': {
    accent: '155, 188, 75', // that LCD green
    skin: '#B8D96B',
    shade: '#7E9F3C',
    belly: '#DCEFA8',
    device: 'dmg',
  },
  'Game Boy Color': {
    accent: '167, 92, 168', // berry
    skin: '#C48ACB',
    shade: '#8F4E97',
    belly: '#E8CCEC',
    device: 'gbc',
  },
  'Game Boy Advance': {
    accent: '92, 107, 192', // indigo shell
    skin: '#93A0DC',
    shade: '#4C5AA8',
    belly: '#C6CDEE',
    device: 'gba',
  },
  'Super Nintendo': {
    accent: '155, 132, 199', // the lavender buttons
    skin: '#CBBCE8',
    shade: '#8A72BA',
    belly: '#E9E2F6',
    device: 'snes',
  },
  'Sega Genesis': {
    accent: '77, 171, 245',
    skin: '#8FCBF9',
    shade: '#3F8FD0',
    belly: '#C9E6FD',
    device: 'genesis',
  },
  'Sega Master System': {
    accent: '239, 83, 80',
    skin: '#F49795',
    shade: '#C94340',
    belly: '#FAD1D0',
    device: 'sms',
  },
}

const DEFAULT_SYSTEM = {
  accent: FROG.jade,
  skin: '#5FE3AB',
  shade: '#2A9D74',
  belly: '#B6F5DC',
  device: 'dmg',
}

export function systemStyle(label) {
  return SYSTEMS[label] || DEFAULT_SYSTEM
}

// The water. A thing that floats casts a soft reflection under itself.
export function reflection(rgb, alpha = 0.22) {
  return `0 26px 40px -22px rgba(${rgb}, ${alpha}), 0 2px 0 rgba(255,255,255,0.04) inset`
}
