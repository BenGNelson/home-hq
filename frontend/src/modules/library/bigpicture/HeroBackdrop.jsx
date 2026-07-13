import { coverUrl } from '../../../lib/library.js'

// The focused game's box art, blown up and blurred into a full-bleed backdrop.
//
// The single highest-value trick a console dashboard has: the whole screen takes
// on the colour of whatever you're looking at. Cheap on the web — it's the same
// cover image the tile already loaded, so it costs nothing extra — and it makes a
// grid of small images feel like a place rather than a list.
//
// Both layers stay mounted and cross-fade, so moving along a rail doesn't flash
// black between games.
export default function HeroBackdrop({ game }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden bg-slate-950">
      {game && (
        <img
          key={game.id}
          src={coverUrl(game.id)}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full scale-110 animate-[fadeIn_600ms_ease-out] object-cover opacity-40 blur-2xl"
          onError={(e) => {
            e.currentTarget.style.visibility = 'hidden'
          }}
        />
      )}
      {/* Darken toward the bottom, where the rails sit, so the art never fights
          the tiles for attention. */}
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/80 to-slate-950/40" />
      <style>{`@keyframes fadeIn { from { opacity: 0 } to { opacity: 0.4 } }`}</style>
    </div>
  )
}
