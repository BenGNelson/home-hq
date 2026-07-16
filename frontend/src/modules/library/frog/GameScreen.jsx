import { useState } from 'react'
import {
  Play, Star, Download, Check, Trash2, TriangleAlert, Loader, X, ChevronLeft, ChevronRight, Maximize2,
} from 'lucide-react'
import { coverUrl, saveStateShotUrl, igdbShotUrl } from '../../../lib/library.js'
import { FROG, systemStyle, reflection } from './theme.js'
import { SystemFrog, Reflected } from './Frog.jsx'
import { agoLabel } from './shelf.js'

// FROG — a game's page.
//
// The one screen between picking a game and playing it: what it is, a big Play (the
// battery save), and its save states to jump into instead. When IGDB has matched the
// ROM (`meta.matched`) the reserved hero band fills with the real game — a screenshot
// backdrop behind the title, its summary/genres/rating, and a screenshot strip you
// can open fullscreen. When it hasn't (a ROM hack, no key, still looking up), the
// page falls back to exactly the basic cover + name layout — same graceful-degrade
// the rest of the Library uses, so nothing ever looks broken.
//
// Presentational, like the shelf/list/search: FrogBrowser owns the focus, the save
// list, the favourite/download state, the open lightbox, and every action; this draws
// what it's told and reports hovers back. Focus zones stack vertically — the hero, the
// actions row, then the save list — and a D-pad crosses them the same way the search
// screen crosses grid⇄results. The screenshots aren't a separate strip: they're the
// hero's slowly-crossfading background, and clicking it (or A) opens them fullscreen.
export default function GameScreen({
  game,
  meta,
  favorited,
  saves,
  loadingSaves,
  download,
  focus,
  confirm,
  lightbox,
  slide,
  onFocus,
  onPlay,
  onPlaySlot,
  onToggleFavorite,
  onDownload,
  onRequestDeleteSave,
  onOpenShot,
  onCloseLightbox,
  onLightboxNav,
  onConfirmYes,
  onConfirmNo,
}) {
  const s = systemStyle(game.label)
  const on = (zone, index) => focus.zone === zone && focus.index === index
  const rich = !!meta?.matched
  const shots = rich ? meta.screenshot_ids ?? [] : []

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        data-testid="frog-detail-play"
        data-focused={on('actions', 0) || undefined}
        onMouseMove={() => onFocus('actions', 0)}
        onClick={onPlay}
        className="flex items-center gap-2 rounded-xl px-6 py-3 text-base font-semibold transition-transform"
        style={{
          background: `rgb(${FROG.jade})`,
          color: FROG.ground,
          transform: on('actions', 0) ? 'scale(1.04)' : 'scale(1)',
          boxShadow: on('actions', 0) ? `0 0 26px rgba(${FROG.jade}, 0.55)` : 'none',
        }}
      >
        <Play className="h-5 w-5" fill="currentColor" aria-hidden="true" /> Play
      </button>

      <ActionButton
        focused={on('actions', 1)}
        onFocus={() => onFocus('actions', 1)}
        onClick={onToggleFavorite}
        accent={FROG.amber}
        active={favorited}
        label={favorited ? 'Favorited' : 'Favorite'}
        testid="frog-detail-fav"
      >
        <Star className="h-5 w-5" fill={favorited ? 'currentColor' : 'none'} aria-hidden="true" />
      </ActionButton>

      <ActionButton
        focused={on('actions', 2)}
        onFocus={() => onFocus('actions', 2)}
        onClick={onDownload}
        accent={FROG.jade}
        active={download.state === 'done'}
        busy={download.state === 'downloading'}
        label={<DownloadLabel download={download} />}
        testid="frog-detail-dl"
      >
        <DownloadIcon state={download.state} />
      </ActionButton>
    </div>
  )

  return (
    // Outer layer is positioned but does NOT scroll, so the lightbox / confirm
    // overlays (absolute inset-0) always cover the visible page — not the middle of
    // the full, now-taller scroll height. The inner layer is the scroll region.
    <div data-testid="frog-detail" className="relative flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rich ? (
          <RichHero
            game={game}
            meta={meta}
            shots={shots}
            s={s}
            slide={slide}
            focused={on('hero', 0)}
            onOpen={onOpenShot}
            onHover={() => onFocus('hero', 0)}
          />
        ) : (
          <BasicHeader game={game} s={s} actions={actions} />
        )}

        <div className="flex flex-col gap-6 px-6 pb-4 pt-5">
          {/* When rich, the hero holds the title only, so the actions live here under
              it. When basic, the header already carried them beside the cover. */}
          {rich && actions}

          {rich && <About meta={meta} />}

          <SaveShelf
            game={game}
            saves={saves}
            loadingSaves={loadingSaves}
            on={on}
            accent={s.accent}
            onFocus={onFocus}
            onPlaySlot={onPlaySlot}
            onRequestDeleteSave={onRequestDeleteSave}
          />
        </div>
      </div>

      {lightbox !== null && shots[lightbox] && (
        <Lightbox
          gameId={game.id}
          shots={shots}
          index={lightbox}
          onClose={onCloseLightbox}
          onNav={onLightboxNav}
        />
      )}

      {confirm && (
        <ConfirmDialog
          message={confirm.kind === 'download' ? 'Remove this offline download?' : 'Delete this save state?'}
          onYes={onConfirmYes}
          onNo={onConfirmNo}
        />
      )}
    </div>
  )
}

// The basic (unmatched / dormant / still-loading) header — a ROM hack looks exactly
// like it did before IGDB existed: the cover, the frog wearing this machine, the
// title, and the actions beside them.
function BasicHeader({ game, s, actions }) {
  return (
    <div className="flex shrink-0 gap-5 px-6 pt-6">
      <Cover game={game} accent={s.accent} className="w-32 sm:w-40" />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold leading-tight" style={{ color: FROG.ink }}>
              {game.name}
            </h1>
            <p className="mt-1 text-sm font-medium" style={{ color: `rgb(${s.accent})` }}>
              {game.label}
            </p>
          </div>
          <div className="hidden shrink-0 sm:block">
            <Reflected scale={0.4}>
              <SystemFrog size={56} system={game.label} />
            </Reflected>
          </div>
        </div>
        <div className="mt-auto pt-4">{actions}</div>
      </div>
    </div>
  )
}

// The rich hero — a big banner whose background IS the screenshots, slowly
// crossfading (Ben's steer: no separate strip; the banner is the gallery). The cover
// floats over it, the facts read year · rating · genres at a glance, and clicking the
// banner (or A when it's focused) opens the shots fullscreen. `slide` is the active
// screenshot index (FrogBrowser owns it so the auto-advance can pause for the lightbox
// and the D-pad can peek); dots show where you are.
function RichHero({ game, meta, shots, s, slide, focused, onOpen, onHover }) {
  const n = shots.length
  const idx = n ? ((slide % n) + n) % n : 0
  return (
    <div
      data-testid="frog-detail-hero"
      data-focused={focused || undefined}
      role={n ? 'button' : undefined}
      aria-label={n ? 'View screenshots' : undefined}
      onClick={n ? () => onOpen(idx) : undefined}
      onMouseMove={onHover}
      className="relative w-full overflow-hidden"
      style={{ cursor: n ? 'pointer' : 'default' }}
    >
      <div className="relative h-[44vh] min-h-[260px] max-h-[460px] w-full" style={{ background: FROG.panel }}>
        {/* The crossfading screenshots. Every shot is layered; only the active one is
            opaque, and the 1.2s opacity transition is the whole (non-distracting)
            animation — no zoom. Reduced-motion just leaves the auto-advance off (the
            index simply never changes), so this stays a still image. */}
        {shots.map((sid, i) => (
          <img
            key={sid}
            src={igdbShotUrl(game.id, sid)}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover transition-opacity ease-in-out"
            style={{ opacity: i === idx ? 1 : 0, transitionDuration: '1200ms' }}
          />
        ))}

        {/* Legibility scrim + the machine's accent glow rising from the corner. */}
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(to top, ${FROG.ground} 4%, rgba(5,17,13,0.88) 32%, rgba(5,17,13,0.32) 66%, rgba(5,17,13,0.5))`,
          }}
        />
        <div
          className="absolute inset-0"
          style={{ background: `radial-gradient(92% 82% at 16% 100%, rgba(${s.accent}, 0.30), transparent 64%)` }}
        />
        {/* Focus ring when the hero is the controller's focus. */}
        {focused && (
          <div
            className="pointer-events-none absolute inset-0"
            style={{ boxShadow: `inset 0 0 0 2px rgb(${s.accent}), inset 0 0 44px rgba(${s.accent}, 0.45)` }}
          />
        )}

        {/* "N shots" cue (top-right) — signals the banner is a gallery you can open. */}
        {n > 0 && (
          <span
            className="absolute right-4 top-4 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
            style={{ background: 'rgba(5,17,13,0.55)', color: FROG.ink, backdropFilter: 'blur(4px)' }}
          >
            <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" /> {n}
          </span>
        )}

        {/* Slide dots (top-right, under the cue). */}
        {n > 1 && (
          <div className="absolute right-4 top-11 flex gap-1.5">
            {shots.map((sid, i) => (
              <span
                key={sid}
                className="h-1.5 rounded-full transition-all"
                style={{ width: i === idx ? 16 : 6, background: i === idx ? `rgb(${s.accent})` : 'rgba(230,245,238,0.4)' }}
              />
            ))}
          </div>
        )}

        {/* Overlaid: the cover + title + facts, sitting on the scrim. */}
        <div className="absolute inset-x-0 bottom-0 flex items-end gap-4 p-5 sm:gap-5 sm:p-6">
          <Cover game={game} accent={s.accent} className="w-24 sm:w-28" />
          <div className="min-w-0 flex-1 pb-1">
            <h1
              className="text-2xl font-semibold leading-tight sm:text-3xl"
              style={{ color: FROG.ink, textShadow: '0 2px 14px rgba(0,0,0,0.6)' }}
            >
              {game.name}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-medium" style={{ color: `rgb(${s.accent})` }}>
                {game.label}
              </span>
              {meta.release_year && (
                <span className="tabular-nums" style={{ color: FROG.soft }}>
                  {meta.release_year}
                </span>
              )}
              {meta.rating != null && <RatingPill rating={meta.rating} />}
            </div>
            {meta.genres?.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {meta.genres.slice(0, 4).map((g) => (
                  <span
                    key={g}
                    className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                    style={{ background: 'rgba(5,17,13,0.5)', color: FROG.soft, border: `1px solid ${FROG.line}` }}
                  >
                    {g}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// The box-art cover, with the machine's accent edge + reflection glow. Shared by both
// headers so a matched and unmatched game frame their cover identically.
function Cover({ game, accent, className = '' }) {
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-2xl ${className}`}
      style={{ border: `1px solid rgba(${accent}, 0.4)`, boxShadow: reflection(accent, 0.5), background: '#000' }}
    >
      <img src={coverUrl(game.id)} alt="" className="aspect-[3/4] w-full object-cover" />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3"
        style={{ background: `linear-gradient(to top, rgba(${accent}, 0.4), transparent)` }}
      />
    </div>
  )
}

function RatingPill({ rating }) {
  return (
    <span
      className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums"
      style={{ background: `rgba(${FROG.amber}, 0.14)`, color: `rgb(${FROG.amber})` }}
    >
      <Star className="h-3 w-3" fill="currentColor" aria-hidden="true" />
      {Math.round(rating)}
    </span>
  )
}

// The summary + a compact facts grid.
function About({ meta }) {
  const [expanded, setExpanded] = useState(false)
  const facts = [
    meta.developer && ['Developer', meta.developer],
    meta.publisher && meta.publisher !== meta.developer && ['Publisher', meta.publisher],
    meta.release_year && ['Released', String(meta.release_year)],
    meta.genres?.length && ['Genres', meta.genres.join(', ')],
  ].filter(Boolean)
  const long = (meta.summary || '').length > 260
  return (
    <div className="space-y-5">
      {meta.summary && (
        <div>
          <Heading>ABOUT</Heading>
          <p
            className={`text-sm leading-relaxed ${expanded ? '' : 'line-clamp-4'}`}
            style={{ color: FROG.soft }}
          >
            {meta.summary}
          </p>
          {long && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 text-xs font-medium"
              style={{ color: `rgb(${FROG.jade})` }}
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      )}
      {facts.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          {facts.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[11px] font-semibold tracking-[0.15em]" style={{ color: FROG.faint }}>
                {k.toUpperCase()}
              </dt>
              <dd className="mt-0.5 truncate text-sm" style={{ color: FROG.ink }} title={v}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

// The save-state shelf (zone 'saves') — unchanged behaviour: launch a slot, or delete
// one behind the confirm.
function SaveShelf({ game, saves, loadingSaves, on, accent, onFocus, onPlaySlot, onRequestDeleteSave }) {
  return (
    <div>
      <Heading>SAVE STATES</Heading>
      {loadingSaves ? (
        <p className="py-4 text-sm" style={{ color: FROG.faint }}>
          loading…
        </p>
      ) : saves.length === 0 ? (
        <p className="py-3 text-sm leading-relaxed" style={{ color: FROG.faint }}>
          No snapshots yet. Save one from the in-game pause menu and it’ll appear here — and on
          your other devices — to jump straight back into.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {saves.map((snap, i) => (
            <li key={snap.slot}>
              <div
                data-testid="frog-save-row"
                data-focused={on('saves', i) || undefined}
                onMouseMove={() => onFocus('saves', i)}
                className="flex items-center gap-3 rounded-xl px-2 py-2"
                style={{
                  background: on('saves', i) ? `rgba(${accent}, 0.16)` : FROG.panel,
                  boxShadow: on('saves', i) ? `inset 0 0 0 1px rgba(${accent}, 0.5)` : `inset 0 0 0 1px ${FROG.line}`,
                }}
              >
                <button
                  type="button"
                  onClick={() => onPlaySlot(snap.slot)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <SaveThumb gameId={game.id} snap={snap} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium" style={{ color: FROG.ink }}>
                      Resume
                    </span>
                    <span className="block text-xs" style={{ color: FROG.soft }}>
                      saved {agoLabel(snap.slot)}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onRequestDeleteSave(snap.slot)}
                  aria-label="Delete this save state"
                  className="shrink-0 rounded-lg p-2"
                  style={{ color: on('saves', i) ? `rgb(${accent})` : FROG.faint }}
                >
                  <Trash2 className="h-[18px] w-[18px]" aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// A fullscreen screenshot — controller-drivable (◀ ▶ page, B/A closes) and tappable
// (tap the backdrop or ✕ to close, the arrows to page). Traps input in FrogBrowser
// while open, like the confirm dialog.
function Lightbox({ gameId, shots, index, onClose, onNav }) {
  const stop = (e) => e.stopPropagation()
  return (
    <div
      data-testid="frog-lightbox"
      className="absolute inset-0 z-30 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(2px)' }}
      onClick={onClose}
    >
      <img
        src={igdbShotUrl(gameId, shots[index])}
        alt=""
        onClick={stop}
        className="max-h-full max-w-full rounded-lg object-contain"
        style={{ boxShadow: '0 20px 80px rgba(0,0,0,0.7)' }}
      />
      {index > 0 && (
        <LightboxArrow side="left" onClick={(e) => (stop(e), onNav(-1))} />
      )}
      {index < shots.length - 1 && (
        <LightboxArrow side="right" onClick={(e) => (stop(e), onNav(1))} />
      )}
      <button
        type="button"
        aria-label="Close"
        onClick={(e) => (stop(e), onClose())}
        className="absolute right-3 top-3 rounded-full p-2"
        style={{ background: FROG.panel, color: FROG.soft }}
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>
      <span
        className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full px-2.5 py-1 text-xs tabular-nums"
        style={{ background: FROG.panel, color: FROG.soft }}
      >
        {index + 1} / {shots.length}
      </span>
    </div>
  )
}

function LightboxArrow({ side, onClick }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight
  return (
    <button
      type="button"
      aria-label={side === 'left' ? 'Previous screenshot' : 'Next screenshot'}
      onClick={onClick}
      className={`absolute top-1/2 -translate-y-1/2 rounded-full p-2 ${side === 'left' ? 'left-3' : 'right-3'}`}
      style={{ background: FROG.panel, color: FROG.ink }}
    >
      <Icon className="h-6 w-6" aria-hidden="true" />
    </button>
  )
}

// A section heading — small, wide-tracked, quiet.
function Heading({ children }) {
  return (
    <h2 className="mb-2 text-[11px] font-semibold tracking-[0.2em]" style={{ color: FROG.faint }}>
      {children}
    </h2>
  )
}

// A snapshot's thumbnail. The backend flags saves with no `.png` sibling as
// `has_shot:false`; those (and any that 404 anyway) show a "no preview" tile instead
// of a broken-image icon.
function SaveThumb({ gameId, snap }) {
  const [failed, setFailed] = useState(false)
  const box = 'h-12 w-16 shrink-0 rounded-md'
  const frame = { background: '#000', border: `1px solid ${FROG.line}` }
  if (!snap.has_shot || failed) {
    return (
      <span className={`${box} flex items-center justify-center text-center text-[9px] leading-none`} style={{ ...frame, color: FROG.faint }}>
        no preview
      </span>
    )
  }
  return (
    <img
      src={saveStateShotUrl(gameId, snap.slot)}
      alt=""
      onError={() => setFailed(true)}
      className={`${box} object-cover`}
      style={frame}
    />
  )
}

function ActionButton({ focused, onFocus, onClick, accent, active, busy, label, testid, children }) {
  return (
    <button
      type="button"
      data-testid={testid}
      data-focused={focused || undefined}
      onMouseMove={onFocus}
      onClick={onClick}
      disabled={busy}
      className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition-transform"
      style={{
        background: active ? `rgba(${accent}, 0.14)` : FROG.panel,
        color: active ? `rgb(${accent})` : FROG.soft,
        border: `1px solid ${focused ? `rgba(${accent}, 0.6)` : active ? `rgba(${accent}, 0.35)` : FROG.line}`,
        transform: focused ? 'scale(1.04)' : 'scale(1)',
        boxShadow: focused ? `0 0 20px rgba(${accent}, 0.4)` : 'none',
      }}
    >
      {children}
      <span>{label}</span>
    </button>
  )
}

function DownloadIcon({ state }) {
  if (state === 'downloading') return <Loader className="h-5 w-5 animate-spin" aria-hidden="true" />
  if (state === 'done') return <Check className="h-5 w-5" aria-hidden="true" />
  if (state === 'error') return <TriangleAlert className="h-5 w-5" aria-hidden="true" />
  return <Download className="h-5 w-5" aria-hidden="true" />
}

function DownloadLabel({ download }) {
  if (download.state === 'downloading') return `${download.pct || 0}%`
  if (download.state === 'done') return 'Offline'
  if (download.state === 'error') return 'Retry'
  return 'Download'
}

// The confirm — controller-drivable (Yes is focus, A confirms, B cancels) and
// tappable. Guards a delete/remove behind one deliberate step.
function ConfirmDialog({ message, onYes, onNo }) {
  return (
    <div
      data-testid="frog-confirm"
      className="absolute inset-0 z-20 flex items-center justify-center p-6"
      style={{ background: 'rgba(5, 17, 13, 0.72)', backdropFilter: 'blur(3px)' }}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-5 text-center"
        style={{ background: FROG.panel, border: `1px solid ${FROG.line}`, boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}
      >
        <p className="text-base font-medium" style={{ color: FROG.ink }}>
          {message}
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <button
            type="button"
            data-testid="frog-confirm-yes"
            onClick={onYes}
            className="rounded-xl px-5 py-2.5 text-sm font-semibold"
            style={{ background: 'rgb(239, 90, 90)', color: '#fff' }}
          >
            Delete
          </button>
          <button
            type="button"
            onClick={onNo}
            className="rounded-xl px-5 py-2.5 text-sm font-medium"
            style={{ background: 'transparent', color: FROG.soft, border: `1px solid ${FROG.line}` }}
          >
            Keep
          </button>
        </div>
      </div>
    </div>
  )
}
