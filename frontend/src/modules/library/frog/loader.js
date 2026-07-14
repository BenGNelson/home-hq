// The loading screen: the frog fills with water, then comes to life.
//
// It has a job. The moment you tap Play, the engine spends a beat fetching and
// decompressing a core — and that beat used to be a BLANK SCREEN, because the
// engine's own progress text renders hidden. A loading state that shows nothing is
// indistinguishable from a crash.
//
// Three rules it has to obey, all of them learned the hard way:
//
//   1. IT CANNOT MOVE. It's pinned to the iframe's viewport (position: fixed), not
//      laid out inside the engine's DOM. The first version centred itself in a flex
//      column and then jumped 14px when the progress text was removed — the column
//      got shorter, and a centred thing moves when it changes size. Nothing about
//      this element's position now depends on its contents.
//   2. IT ALWAYS FINISHES. A cached core loads in ~300ms, faster than any fill worth
//      watching, so the game starting doesn't dismiss the frog — it just tells it to
//      hurry up. The fill completes, the frog hops, and THEN it leaves. The game is
//      already running underneath the whole time; the veil is what makes the seam
//      invisible.
//   3. THE PAYOFF IS THE FROG. The vessel fills with water and, when it's full,
//      becomes the actual frog — in colour, with eyes and a belly and feet — and
//      hops. That's what the filling was FOR.
import { frogVesselMarkup, frogCharacterMarkup } from './art.js'

export { FROG_ART } from './art.js'

// A waterline. Enough sine periods to cross the frog twice over, so the path can slide
// by exactly one period forever and never show a seam — that's what makes the ripple
// look like water rather than a loop.
const WAVE = 'M0 6 q 12.5 -6 25 0 t 25 0 t 25 0 t 25 0 t 25 0 t 25 0 t 25 0 t 25 0 V 120 H 0 Z'

// The beats. The frog is on screen for about two seconds whether the core took that
// long or not — which is a deliberate choice, not a slip: it's a console boot, and a
// splash that flickers past is worse than no splash. Nothing here waits on the game;
// the game is already running behind the veil.
export const TIMING = {
  minFill: 900, // never celebrate before the fill has been worth watching
  fill: 420, // the last of the water rushing in
  hop: 620, // full-colour frog + hop + ring
  fade: 320, // the veil lifting off the running game
}

export function frogLoaderSvg({ rgb, ground = '#05110D', skin, shade, belly }) {
  return `
<div class="hq-loader" aria-hidden="true">
  <div class="hq-loader-pond"></div>
  <div class="hq-loader-stack">
    <svg class="hq-loader-frog" viewBox="0 0 100 100" role="progressbar" aria-label="Loading">
      <g class="hq-loader-vessel">${frogVesselMarkup({ rgb, ground, clipId: 'hq-frog-clip', wave: WAVE })}</g>
      <g class="hq-loader-char">${frogCharacterMarkup({ skin, shade, belly, id: 'hq-frog-skin' })}</g>
    </svg>
    <p class="hq-loader-text"></p>
  </div>
</div>`
}

export function frogLoaderCss({ rgb, ground = '#05110D' }) {
  return `
    /* Fixed to the iframe's viewport. NOT laid out in the engine's DOM, so nothing the
       engine does — building a canvas, resizing, rotating — can shift it. */
    .hq-loader {
      position: fixed; inset: 0; z-index: 5;
      display: flex; align-items: center; justify-content: center;
      pointer-events: none;
    }
    /* The veil: the game boots behind this. It's why there's no flash of a half-drawn
       frame, and why the frog can take its time. */
    .hq-loader-pond {
      position: absolute; inset: 0;
      background:
        radial-gradient(60% 45% at 50% 50%, rgba(${rgb},0.16), transparent 70%),
        ${ground};
    }
    /* The stack is CENTRED AS A WHOLE and the text is absolutely positioned under the
       frog — so the text appearing, changing or emptying can never move the frog. */
    .hq-loader-stack {
      position: relative;
      display: flex; align-items: center; justify-content: center;
      animation: hq-loader-in 420ms cubic-bezier(.2,.8,.2,1) both;
    }
    /* Its OWN entrance. Reusing the start card's hq-rise put a translate(-50%,-50%) on
       a flex-CENTRED element — which is exactly how you centre something absolutely
       positioned, and exactly how you shove a centred thing half its own width off to
       the left. It did both, and the frog sat in the wrong place all the way through. */
    @keyframes hq-loader-in {
      from { opacity: 0; transform: translateY(10px) scale(0.96); }
      to   { opacity: 1; transform: none; }
    }

    /* The frog's own life, restated here because this document is the player IFRAME —
       it never loads frog.css, and without these the lids render at full size and sit
       there like two closed eyes on a frog that is supposed to be waking up. */
    @keyframes hq-loader-breathe {
      0%, 100% { transform: scale(1, 1) translateY(0); }
      50%      { transform: scale(1.02, 0.985) translateY(1.2%); }
    }
    .hq-loader .frog-breathe {
      animation: hq-loader-breathe 3.6s ease-in-out infinite;
      transform-origin: 50% 92%;
    }
    @keyframes hq-loader-blink {
      0%, 95%, 100% { transform: scaleY(0); }
      97%           { transform: scaleY(1); }
    }
    .hq-loader .frog-lid {
      transform: scaleY(0);
      transform-origin: center;
      transform-box: fill-box;
      animation: hq-loader-blink 5.2s ease-in-out infinite;
    }
    .hq-loader .frog-lid-b { animation-delay: 0.08s; }
    .hq-loader-frog {
      width: min(44vmin, 240px); height: min(44vmin, 240px);
      overflow: visible;
      filter: drop-shadow(0 12px 40px rgba(${rgb},0.4));
    }
    .hq-loader-text {
      position: absolute; top: 100%; left: 50%;
      transform: translateX(-50%);
      margin: 18px 0 0; white-space: nowrap;
      color: rgba(${rgb},0.9);
      font: 500 12px/1.2 system-ui, -apple-system, sans-serif;
      letter-spacing: 0.14em; text-transform: uppercase;
    }

    /* The water. Driven from the parent by setting --fill (0 → 1). */
    .hq-loader-water {
      --fill: 0;
      transform: translateY(calc((1 - var(--fill)) * 100px));
      transition: transform ${TIMING.fill}ms cubic-bezier(.3,.7,.4,1);
    }
    /* One period of the wave is 100 units, so sliding by exactly that loops seamlessly. */
    .hq-loader-wave { animation: hq-wave 2.4s linear infinite; }
    @keyframes hq-wave {
      from { transform: translateX(0); }
      to   { transform: translateX(-100px); }
    }

    /* The real frog is stacked exactly on top of the vessel and cross-fades in. Same
       viewBox, same silhouette, same numbers — so it doesn't move a pixel as it turns
       from an outline full of water into an animal. */
    .hq-loader-char {
      opacity: 0;
      transition: opacity 260ms ease-out;
    }
    .hq-loader-vessel { transition: opacity 260ms ease-out; }

    /* Full. The frog arrives, hops, and throws one ring off the surface. */
    .hq-loader-done .hq-loader-char { opacity: 1; }
    .hq-loader-done .hq-loader-vessel { opacity: 0; }
    .hq-loader-done .hq-loader-frog { animation: hq-loader-hop ${TIMING.hop}ms cubic-bezier(.34,1.35,.64,1); }
    .hq-loader-done .hq-loader-stack::after {
      content: ''; position: absolute; left: 50%; top: 50%;
      width: min(44vmin, 240px); aspect-ratio: 1;
      border-radius: 9999px; border: 2px solid rgba(${rgb},0.55);
      animation: hq-loader-ring ${TIMING.hop}ms ease-out forwards;
    }
    @keyframes hq-loader-hop {
      0%   { transform: translateY(0) scaleY(0.9) scaleX(1.1); }
      30%  { transform: translateY(-11%) scaleY(1.06) scaleX(0.95); }
      62%  { transform: translateY(0) scaleY(0.97) scaleX(1.03); }
      100% { transform: translateY(0) scale(1); }
    }
    @keyframes hq-loader-ring {
      from { transform: translate(-50%, -50%) scale(0.55); opacity: 0.7; }
      to   { transform: translate(-50%, -50%) scale(1.9); opacity: 0; }
    }

    /* The veil lifts and the game is there. */
    .hq-loader-out { animation: hq-loader-out ${TIMING.fade}ms ease-in forwards; }
    @keyframes hq-loader-out {
      to { opacity: 0; }
    }

    @media (prefers-reduced-motion: reduce) {
      .hq-loader-wave,
      .hq-loader-done .hq-loader-frog,
      .hq-loader-done .hq-loader-stack::after,
      .hq-loader-stack { animation: none; }
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
// own; the game starting is what fills it the rest of the way. The frog is honest
// about the one thing it claims: something is happening, and it isn't stuck. The
// engine's phase text sits underneath saying what, which is where the real detail
// belongs.
const CEILING = 0.88

export function nextFill(fill, elapsedMs) {
  // Asymptotic: fast at first (you see it move immediately), slower as it climbs, so a
  // long load never looks frozen and a short one never looks like it skipped.
  const t = Math.max(0, elapsedMs) / 1400
  return Math.max(fill, CEILING * (1 - Math.exp(-t * 2.2)))
}

// The engine's own phase text, tidied. "Decompress Game Core 97%" is genuinely useful;
// the trailing percentage is not, when the frog is already showing you the shape of it.
export function phaseLabel(text) {
  if (!text) return ''
  return text.replace(/\s*\d+%\s*$/, '').trim()
}

// When the game is ready, how long until the frog is done making its point.
// Exported so the teardown and the animation can't disagree about the schedule.
export function finishPlan(elapsedMs) {
  const fillAt = Math.max(0, TIMING.minFill - elapsedMs)
  return {
    fillAt, // top the water up (immediately, if it's already had its moment)
    hopAt: fillAt + TIMING.fill, // the frog arrives and hops
    outAt: fillAt + TIMING.fill + TIMING.hop, // the veil lifts
    goneAt: fillAt + TIMING.fill + TIMING.hop + TIMING.fade,
  }
}
