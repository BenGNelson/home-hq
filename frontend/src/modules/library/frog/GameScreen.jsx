import { useState } from 'react'
import { Play, Star, Download, Check, Trash2, TriangleAlert, Loader } from 'lucide-react'
import { coverUrl, saveStateShotUrl } from '../../../lib/library.js'
import { FROG, systemStyle, reflection } from './theme.js'
import { SystemFrog, Reflected } from './Frog.jsx'
import { agoLabel } from './shelf.js'

// FROG — a game's page.
//
// The one screen between picking a game and playing it: what it is, a big Play (the
// battery save), and its save states to jump into instead. It's the in-Frog home for
// everything the old HQ game-detail page did — play, favourite, download-for-offline,
// snapshots — so you never leave Frog's world to manage a game.
//
// Presentational, like the shelf/list/search: FrogBrowser owns the focus, the save
// list, the favourite and download state, and every action; this draws what it's told
// and reports hovers back. Two focus zones — the actions row and the save list —
// exactly the shape the search screen uses, so a D-pad crosses between them the same
// way. The hero band up top is deliberately empty: it's the seat reserved for IGDB
// artwork/summary later, and until then the cover + frog carry the screen.
export default function GameScreen({
  game,
  favorited,
  saves,
  loadingSaves,
  download,
  focus,
  confirm,
  onFocus,
  onPlay,
  onPlaySlot,
  onToggleFavorite,
  onDownload,
  onRequestDeleteSave,
  onConfirmYes,
  onConfirmNo,
}) {
  const s = systemStyle(game.label)
  const on = (zone, index) => focus.zone === zone && focus.index === index

  return (
    <div data-testid="frog-detail" className="relative flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-4">
      {/* Header: the cover, the frog wearing this machine, the title. The empty band
          to the right of the title is the reserved hero (IGDB art/video later). */}
      <div className="flex shrink-0 gap-5 pt-1">
        <div
          className="relative w-32 shrink-0 overflow-hidden rounded-2xl sm:w-40"
          style={{ border: `1px solid rgba(${s.accent}, 0.4)`, boxShadow: reflection(s.accent, 0.5), background: '#000' }}
        >
          <img src={coverUrl(game.id)} alt="" className="aspect-[3/4] w-full object-cover" />
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3"
            style={{ background: `linear-gradient(to top, rgba(${s.accent}, 0.4), transparent)` }}
          />
        </div>

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

          {/* Actions: Play / Favourite / Download. Zone 'actions', indices 0/1/2. */}
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
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
        </div>
      </div>

      {/* The save shelf. */}
      <div className="min-h-0 flex-1">
        <h2 className="mb-2 text-[11px] font-semibold tracking-[0.2em]" style={{ color: FROG.faint }}>
          SAVE STATES
        </h2>

        {loadingSaves ? (
          <p className="py-6 text-sm" style={{ color: FROG.faint }}>
            loading…
          </p>
        ) : saves.length === 0 ? (
          <p className="py-4 text-sm leading-relaxed" style={{ color: FROG.faint }}>
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
                    background: on('saves', i) ? `rgba(${s.accent}, 0.16)` : FROG.panel,
                    boxShadow: on('saves', i) ? `inset 0 0 0 1px rgba(${s.accent}, 0.5)` : `inset 0 0 0 1px ${FROG.line}`,
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
                    style={{ color: on('saves', i) ? `rgb(${s.accent})` : FROG.faint }}
                  >
                    <Trash2 className="h-[18px] w-[18px]" aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

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

// A snapshot's thumbnail. The backend flags saves with no `.png` sibling as
// `has_shot:false`; those (and any that 404 anyway) show a "no preview" tile instead
// of a broken-image icon — the guard the retired SaveStateCard had.
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
// tappable. Guards a delete/remove behind one deliberate step, as Ben asked.
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
