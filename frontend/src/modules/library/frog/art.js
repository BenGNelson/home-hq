// The frog, as numbers and as markup — one drawing, two consumers.
//
// The React frog (Frog.jsx) and the loading frog live in different documents: the
// loader is injected into the player IFRAME, where React cannot reach. Rather than
// keep two copies of the same animal and watch them drift, both render from the
// markup built here. React just wraps it in an <svg>.
//
// So: change the frog once, and it changes everywhere — the shelf, the boot, the
// loading screen, the favicon.

export const FROG_ART = {
  // The silhouette: a body and two eye domes. Three shapes, and the whole reason the
  // frog survives being shrunk to 16px.
  body: { cx: 50, cy: 62, rx: 37, ry: 30 },
  eyes: [
    { cx: 28, cy: 30, r: 16 },
    { cx: 72, cy: 30, r: 16 },
  ],

  // The flat mark knocks its eyes clean out of the silhouette, so the shape still
  // reads when the whole thing is one colour.
  markPupil: 7,

  belly: { cx: 50, cy: 76, rx: 22, ry: 13 },

  // The feet. Three shapes' worth of work, and they're what turn a green blob into a
  // frog SITTING — the posture is most of the character.
  feet: { xs: [22, 78], cy: 88, rx: 12, ry: 6.5, toeY: 91, toeR: 2.6, toes: [-6, 0, 6] },

  face: { white: 10.5, pupil: 5.4, glint: 1.9 },
  // The mouth rides ABOVE the belly. When they overlapped, the pale belly read as a
  // chin and the whole face slid downward.
  mouth: 'M32 55 Q50 67 68 55',
  nostrils: [
    { cx: 43, cy: 46 },
    { cx: 57, cy: 46 },
  ],
  ink: '#0A1F19',
}

const A = FROG_ART

const circles = (list, r, fill) =>
  list.map((c) => `<circle cx="${c.cx}" cy="${c.cy}" r="${c.r ?? r}" fill="${fill}"/>`).join('')

// The eye domes, in whatever colour the costume calls for.
const domes = (fill) => circles(A.eyes, null, fill)

// The full character. `skin`/`shade`/`belly` are the console's costume; `asleep` shuts
// its eyes, which is the closest thing Frog has to a personality.
export function frogCharacterMarkup({ skin, shade, belly, id, asleep = false }) {
  const eyes = asleep
    ? A.eyes
        .map(
          (e) =>
            `<path d="M${e.cx - 8} ${e.cy + 1} Q${e.cx} ${e.cy + 7} ${e.cx + 8} ${e.cy + 1}" stroke="${A.ink}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`
        )
        .join('')
    : A.eyes
        .map(
          (e, i) => `
      <circle cx="${e.cx}" cy="${e.cy - 1}" r="${A.face.white}" fill="#F4FBF8"/>
      <circle cx="${e.cx + (i === 0 ? 1 : -1)}" cy="${e.cy}" r="${A.face.pupil}" fill="${A.ink}"/>
      <circle cx="${e.cx + 3}" cy="${e.cy - 2.4}" r="${A.face.glint}" fill="#fff"/>
      <ellipse class="frog-lid${i ? ' frog-lid-b' : ''}" cx="${e.cx}" cy="${e.cy - 1}" rx="11" ry="11" fill="${skin}"/>`
        )
        .join('')

  return `
  <defs>
    <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${skin}"/>
      <stop offset="1" stop-color="${shade}"/>
    </linearGradient>
  </defs>
  <g class="frog-breathe">
    ${A.feet.xs
      .map(
        (x, i) => `<g fill="${shade}">
      <ellipse cx="${x}" cy="${A.feet.cy}" rx="${A.feet.rx}" ry="${A.feet.ry}"/>
      ${A.feet.toes
        .map(
          (d) =>
            `<circle cx="${x + (i === 0 ? d - 2 : d + 2)}" cy="${A.feet.toeY}" r="${A.feet.toeR}"/>`
        )
        .join('')}
    </g>`
      )
      .join('')}

    <ellipse cx="${A.body.cx}" cy="${A.body.cy}" rx="${A.body.rx}" ry="${A.body.ry}" fill="url(#${id})"/>
    <ellipse cx="${A.belly.cx}" cy="${A.belly.cy}" rx="${A.belly.rx}" ry="${A.belly.ry}" fill="${belly}" opacity="0.45"/>

    ${domes(skin)}
    ${eyes}

    <path d="${A.mouth}" stroke="${A.ink}" stroke-width="2.6" fill="none" stroke-linecap="round" opacity="0.75"/>
    ${A.nostrils.map((n) => `<circle cx="${n.cx}" cy="${n.cy}" r="1.7" fill="${A.ink}" opacity="0.5"/>`).join('')}
  </g>`
}

// The flat two-tone mark: favicons, app icons, the header badge.
export function frogMarkMarkup({ ground }) {
  return `
  <ellipse cx="${A.body.cx}" cy="${A.body.cy}" rx="${A.body.rx}" ry="${A.body.ry}" fill="currentColor"/>
  ${domes('currentColor')}
  ${circles(A.eyes.map((e) => ({ cx: e.cx, cy: e.cy - 1 })), A.markPupil, ground)}`
}

// The frog as an EMPTY VESSEL, for the loading screen: an outline that fills with
// water from the bottom up.
//
// The outline is drawn FIRST, under everything. Stroking a body and two eye domes
// separately leaves you looking at the seams where they cross — three shapes, not one
// frog. Drawn underneath and then covered by an opaque body, only the outer half of
// each stroke survives, so the silhouette reads as a single union with no lines
// running through it.
export function frogVesselMarkup({ rgb, ground, clipId, wave }) {
  return `
  <defs>
    <clipPath id="${clipId}">
      <ellipse cx="${A.body.cx}" cy="${A.body.cy}" rx="${A.body.rx}" ry="${A.body.ry}"/>
      ${A.eyes.map((e) => `<circle cx="${e.cx}" cy="${e.cy}" r="${e.r}"/>`).join('')}
    </clipPath>
  </defs>

  <g fill="none" stroke="rgba(${rgb},0.6)" stroke-width="3">
    <ellipse cx="${A.body.cx}" cy="${A.body.cy}" rx="${A.body.rx}" ry="${A.body.ry}"/>
    ${A.eyes.map((e) => `<circle cx="${e.cx}" cy="${e.cy}" r="${e.r}"/>`).join('')}
  </g>

  <g clip-path="url(#${clipId})">
    <rect x="0" y="0" width="100" height="100" fill="${ground}"/>
    <rect x="0" y="0" width="100" height="100" fill="rgba(${rgb},0.14)"/>
    <g class="hq-loader-water">
      <path class="hq-loader-wave" d="${wave}" fill="rgba(${rgb},0.92)"/>
    </g>
  </g>

  ${circles(A.eyes.map((e) => ({ cx: e.cx, cy: e.cy - 1 })), A.markPupil, ground)}`
}
