// The loading screen: the frog fills with water.
//
// It has a job. The moment you tap Play, the engine spends a second or two fetching
// and decompressing a core — and until now that second was a BLANK SCREEN, because
// the engine's own progress text renders hidden. A loading state that shows nothing
// is indistinguishable from a crash.
//
// So the frog *is* the progress bar: an empty vessel that fills bottom-to-top,
// waterline rippling, and gives a little hop when it's full. On-motif (Frog's whole
// language is water), and it does real work.
//
// --- why this is a STRING, and not a React component ---
//
// The start screen lives inside the player iframe. React is in the parent; the iframe
// has its own document that we can only reach through the DOM. So the art has to
// exist as markup that can be injected. The silhouette geometry is shared with the
// React frog (SILHOUETTE, below) so the two drawings can never drift apart — that
// sharing is the whole reason this file isn't just a copy-pasted SVG.

// The frog's silhouette. Three shapes: a body and two eye domes. Every drawing of the
// frog — the React character, the mark, this loader — is built on these numbers, and
// there is exactly one copy of them.
export const SILHOUETTE = {
  body: { cx: 50, cy: 62, rx: 37, ry: 30 },
  eyes: [
    { cx: 28, cy: 30, r: 16 },
    { cx: 72, cy: 30, r: 16 },
  ],
  pupils: [
    { cx: 28, cy: 29, r: 7 },
    { cx: 72, cy: 29, r: 7 },
  ],
}

const { body, eyes, pupils } = SILHOUETTE

// A waterline. Two full sine periods across 200 units, so the path can slide by 100
// (one period) forever and never show a seam — that's what makes the ripple look like
// water rather than a loop.
const WAVE =
  'M0 6 q 12.5 -6 25 0 t 25 0 t 25 0 t 25 0 t 25 0 t 25 0 t 25 0 t 25 0 V 120 H 0 Z'

// The markup. `rgb` is the machine's accent as "r,g,b" — the frog fills with the
// colour of the console you're about to play, which is the same trick the shelf uses.
export function frogLoaderSvg({ rgb, ground = '#05110D' }) {
  return `
<div class="hq-loader" role="progressbar" aria-label="Loading">
  <svg class="hq-loader-frog" viewBox="0 0 100 100" aria-hidden="true">
    <defs>
      <clipPath id="hq-frog-clip">
        <ellipse cx="${body.cx}" cy="${body.cy}" rx="${body.rx}" ry="${body.ry}"/>
        ${eyes.map((e) => `<circle cx="${e.cx}" cy="${e.cy}" r="${e.r}"/>`).join('')}
      </clipPath>
    </defs>

    <!-- The outline goes FIRST, under everything.
         Stroking a body and two eye domes separately leaves you looking at the seams
         where they cross — three shapes, not one frog. Drawn underneath and then
         covered by an opaque vessel, only the outer half of each stroke survives, so
         the silhouette reads as a single union with no lines running through it. -->
    <g fill="none" stroke="rgba(${rgb},0.6)" stroke-width="3">
      <ellipse cx="${body.cx}" cy="${body.cy}" rx="${body.rx}" ry="${body.ry}"/>
      ${eyes.map((e) => `<circle cx="${e.cx}" cy="${e.cy}" r="${e.r}"/>`).join('')}
    </g>

    <g clip-path="url(#hq-frog-clip)">
      <!-- the empty vessel: opaque, so it covers the outline's inner half -->
      <rect x="0" y="0" width="100" height="100" fill="${ground}"/>
      <rect x="0" y="0" width="100" height="100" fill="rgba(${rgb},0.14)"/>
      <!-- the water. The <g> is what rises; the wave slides inside it. -->
      <g class="hq-loader-water">
        <path class="hq-loader-wave" d="${WAVE}" fill="rgba(${rgb},0.92)"/>
      </g>
    </g>

    <!-- the eyes are knocked out, exactly as they are in the mark -->
    ${pupils.map((p) => `<circle cx="${p.cx}" cy="${p.cy}" r="${p.r}" fill="${ground}"/>`).join('')}
  </svg>
  <p class="hq-loader-text"></p>
</div>`
}

// The look. Injected into the player document alongside the start-screen styles.
export function frogLoaderCss({ rgb }) {
  return `
    .hq-loader {
      position: absolute; left: 50%; top: 50%;
      transform: translate(-50%, -50%);
      z-index: 3;
      display: flex; flex-direction: column; align-items: center; gap: 14px;
      animation: hq-rise 400ms cubic-bezier(.2,.8,.2,1) both;
    }
    .hq-loader-frog {
      width: 96px; height: 96px;
      filter: drop-shadow(0 0 26px rgba(${rgb},0.45));
      overflow: visible;
    }

    /* The rise. Driven from the parent by setting --fill (0 → 1); the transition is
       what makes progress glide instead of jumping between phases. */
    .hq-loader-water {
      --fill: 0;
      transform: translateY(calc((1 - var(--fill)) * 100px));
      transition: transform 500ms cubic-bezier(.3,.7,.4,1);
    }
    /* One period of the wave is 100 units, so sliding by exactly that loops seamlessly. */
    .hq-loader-wave { animation: hq-wave 2.4s linear infinite; }
    @keyframes hq-wave {
      from { transform: translateX(0); }
      to   { transform: translateX(-100px); }
    }

    .hq-loader-text {
      margin: 0; min-height: 1.2em;
      color: rgba(${rgb},0.95);
      font: 500 12px/1.2 system-ui, -apple-system, sans-serif;
      letter-spacing: 0.06em; text-transform: uppercase;
      text-shadow: 0 2px 12px rgba(0,0,0,0.6);
    }

    /* Full. The hop, one ring off the surface, and then it gets out of the way — the
       game is already running underneath, so this is a beat, not a curtain. */
    .hq-loader-done {
      animation: hq-loader-bow 620ms ease-in 260ms forwards;
    }
    .hq-loader-done .hq-loader-frog { animation: hq-loader-hop 420ms cubic-bezier(.34,1.4,.64,1); }
    .hq-loader-done .hq-loader-wave { animation: none; }
    @keyframes hq-loader-bow {
      to { opacity: 0; transform: translate(-50%, -50%) scale(1.08); }
    }
    .hq-loader-done::before {
      content: ''; position: absolute; top: 48px; left: 50%;
      width: 96px; height: 96px; margin-left: -48px;
      border-radius: 9999px; border: 2px solid rgba(${rgb},0.7);
      animation: hq-loader-ring 620ms ease-out forwards;
    }
    @keyframes hq-loader-hop {
      0%   { transform: translateY(0) scaleY(0.92) scaleX(1.08); }
      35%  { transform: translateY(-14px) scaleY(1.06) scaleX(0.95); }
      70%  { transform: translateY(0) scaleY(0.97) scaleX(1.03); }
      100% { transform: translateY(0) scale(1); }
    }
    @keyframes hq-loader-ring {
      from { transform: translate(-50%, -50%) scale(0.5); opacity: 0.8; }
      to   { transform: translate(-50%, -50%) scale(2.1); opacity: 0; }
    }

    @media (prefers-reduced-motion: reduce) {
      .hq-loader-wave,
      .hq-loader-done .hq-loader-frog,
      .hq-loader-done::before { animation: none; }
      .hq-loader-done { opacity: 0; }
      .hq-loader-water { transition: none; }
    }
  `
}

// How full the frog is.
//
// NOT a percentage read off the engine. Its progress text runs through several phases
// (download core, decompress core, download game…), each counting 0→100% of its own
// step — so piping that straight through would fill the frog, empty it, and fill it
// again. A progress bar that goes BACKWARDS is worse than one that doesn't know.
//
// Instead the fill only ever rises, easing toward a ceiling it never reaches on its
// own, and the game actually starting is what fills it the rest of the way. The frog
// is honest about the one thing it claims: something is happening, and it isn't stuck.
// The engine's phase text sits underneath saying what, which is where the real detail
// belongs.
const CEILING = 0.9

export function nextFill(fill, elapsedMs) {
  // Asymptotic: fast at first (you see it move immediately), slower as it climbs, so a
  // long load never looks frozen and a short one never looks like it skipped.
  const t = Math.max(0, elapsedMs) / 2600
  return Math.max(fill, CEILING * (1 - Math.exp(-t * 2.2)))
}

// The engine's own phase text, tidied. "Decompress Game Core 97%" is genuinely useful;
// the trailing percentage is not, when the frog is already showing you the shape of it.
export function phaseLabel(text) {
  if (!text) return ''
  return text.replace(/\s*\d+%\s*$/, '').trim()
}
