// The rack and the word box (Build Spec v3.0, Sections 5 and 19): the Growing Rack (6 to 9
// tiles), Workshop stamps drawn on their tiles, Lantern Hints with the Lantern count beside the
// Hint button, the Rune in its own slot with the letter strip, and the Reserve Shelf directly
// above the rack (Section 10: no new screen region).
//
// Art (v3.0.2): the Gemini overlays are in. A stamped tile carries its stamp art as a corner
// badge (oak, granite, gilded); the Rune's slot shows the rune tile art; the Lantern icon is the
// Gemini lantern. All three are CSS backgrounds from src/assets/ui (styles.css).
//
// One input model on every platform: letters enter the word only through the rack. The word box
// is a display, never a text field, and nothing in the word area can take keyboard focus, so no
// tap here can summon a phone's software keyboard. On desktop the physical keyboard works
// through one document-level listener (src/ui/keyboard.ts) that calls the same store functions
// these buttons call.
//
// Tile identity: each tile is an object with its own id and used state. Selection belongs to the
// tile, never to the letter, so with two A tiles the one you tap is the one that greys.

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  LONG_PRESS_MS,
  SHELF_LOCKED_LINE,
  cancelSwap,
  chooseRuneLetter,
  clearWord,
  deleteLast,
  noLanternLine,
  pressHint,
  pressSwap,
  removeFromWord,
  rerollRack,
  shelfUnlocked,
  submitWord,
  swapStatus,
  tapRune,
  tapShelf,
  tapTile,
  useGame,
} from '../game/store';
import { RUNE_ID, STAMP_NAMES } from '../game/stamps';
import { realBuildings } from '../game/buildings';
import type { RackTile } from '../game/types';
import { RARE, REROLL_MAX, minWordLength } from '../game/words';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/** The Lantern icon (v3.0.2: the Gemini lantern, src/assets/ui/lantern.png). */
export function LanternIcon() {
  return <span className="lantern-icon" aria-hidden />;
}

const stampClass = (t: { stamp?: string }) => (t.stamp ? ` tile-stamp tile-stamp-${t.stamp}` : '');
const stampTitle = (t: RackTile) => (t.stamp ? ` ${STAMP_NAMES[t.stamp]} stamp.` : '');

/** Keeps a press from moving focus (so a tap never focuses anything, Section 5). */
const noFocus = (e: ReactMouseEvent) => e.preventDefault();

/** The on-screen delete key: a tap deletes the last letter; a 500 ms press clears the word. */
function DeleteKey({ disabled }: { disabled: boolean }) {
  const timer = useRef<number | null>(null);
  const longFired = useRef(false);
  const stop = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  const onDown = (e: ReactPointerEvent) => {
    if (disabled || e.button > 0) return;
    longFired.current = false;
    stop();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      longFired.current = true;
      clearWord();
    }, LONG_PRESS_MS);
  };
  const onUp = () => {
    if (timer.current === null) return; // already cleared by the long press, or never pressed
    stop();
    if (!longFired.current) deleteLast();
  };
  return (
    <button
      type="button"
      className="word-delete"
      tabIndex={-1}
      aria-label="Delete last letter (hold to clear the word)"
      title="Delete the last letter. Hold to clear the word."
      disabled={disabled}
      onMouseDown={noFocus}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e: ReactMouseEvent) => e.preventDefault()}
    >
      <svg viewBox="0 0 28 20" width="28" height="20" aria-hidden>
        <path d="M9 2h15a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H9L2 10z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M13 6.5l7 7M20 6.5l-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </button>
  );
}

/** (v3.0) Section 19: the Reserve Shelf, directly above the rack. Shown once a Scribe has stood. */
function Shelf() {
  const shelf = useGame((s) => s.shelf);
  const armed = useGame((s) => s.shelfArmed);
  const hasScribe = useGame((s) => realBuildings(s.buildings).some((b) => b.type === 'scribe'));
  useGame((s) => s.net);
  if (!hasScribe && !shelf) return null;
  const open = shelfUnlocked();
  return (
    <div className={`shelf${open ? '' : ' shelf-locked'}${armed ? ' shelf-armed' : ''}`} aria-label="Reserve Shelf">
      <span className="shelf-label">Shelf</span>
      <button
        type="button"
        className={`tile shelf-slot${shelf ? stampClass(shelf) : ' shelf-empty'}`}
        tabIndex={-1}
        onMouseDown={noFocus}
        onClick={tapShelf}
        title={open ? (shelf ? `Swap ${shelf.letter} back into your rack.` : 'Set one letter aside.') : SHELF_LOCKED_LINE}
      >
        {shelf?.letter ?? ''}
      </button>
      <span className="shelf-note">
        {!open ? SHELF_LOCKED_LINE : armed ? (shelf ? 'Tap a rack tile to swap with it, or the shelf again for the rightmost tile.' : 'Tap a rack tile to set it aside.') : shelf ? 'Tap the shelf to swap it back.' : 'Tap the shelf, then a tile, to set a letter aside.'}
      </span>
    </div>
  );
}

export function Rack() {
  const rack = useGame((s) => s.rack);
  const word = useGame((s) => s.word);
  const swap = useGame((s) => s.swap);
  const shake = useGame((s) => s.shake);
  const rerolls = useGame((s) => s.rerolls);
  const tier = useGame((s) => s.tier);
  const coins = useGame((s) => s.resources.coins);
  const lanterns = useGame((s) => s.lanterns);
  const hint = useGame((s) => s.hint);
  const rune = useGame((s) => s.rune);
  const submitLocked = useGame((s) => !s.locks.submit || !!s.pieceGhost?.anchor);
  const [shaking, setShaking] = useState<string | null>(null);
  const min = minWordLength(tier);

  // Visual only: the used tiles of a letter shake once when a key finds no unused tile.
  useEffect(() => {
    if (!shake) return;
    setShaking(shake.letter);
    const t = window.setTimeout(() => setShaking(null), 420);
    return () => window.clearTimeout(t);
  }, [shake]);

  const byId = new Map(rack.map((t) => [t.id, t]));
  const runeIn = word.includes(RUNE_ID);
  const placed = word
    .map((id) => (id === RUNE_ID ? { id: RUNE_ID, letter: rune.letter ?? '?', used: true, rune: true } : byId.get(id)))
    .filter((t): t is NonNullable<typeof t> => !!t);
  void coins; // re-render when Coins change, so the Swap price line stays right
  const sw = swapStatus();
  const hintTitle = !hint.freeUsed
    ? 'Free: names the length of the longest word.'
    : lanterns > 0
      ? 'Spend a Lantern to place the next letter of a guide word (up to 2 letters on this rack).'
      : noLanternLine();

  return (
    <div className={`rack panel${swap.active ? ' rack-swapping' : ''}`} aria-label="Word game" data-tour="rack">
      <Shelf />
      <div className="word-row">
        {/* The word box: a display only. Tapping it does nothing; tapping a placed letter takes it back. */}
        <div className="word-box" aria-label="Your word" aria-live="polite">
          {placed.length === 0 ? (
            <span className="word-placeholder">{swap.active ? 'Pick tiles to swap' : `Tap letters (${min}+)`}</span>
          ) : (
            placed.map((t) => (
              <span
                key={t.id}
                className={`word-letter${RARE.has(t.letter) ? ' tile-rare' : ''}${'rune' in t ? ' tile-rune' : stampClass(t as RackTile)}`}
                onClick={() => ('rune' in t ? removeFromWord(RUNE_ID) : tapTile(t.id))}
                title={'rune' in t ? 'Take the Rune back' : `Take ${t.letter} back`}
              >
                {t.letter}
              </span>
            ))
          )}
        </div>
        <DeleteKey disabled={placed.length === 0} />
      </div>
      {runeIn && (
        <div className="rune-strip" role="group" aria-label="Choose the Rune's letter">
          {LETTERS.map((L) => (
            <button key={L} type="button" tabIndex={-1} onMouseDown={noFocus} className={`rune-letter${rune.letter === L ? ' rune-letter-on' : ''}`} onClick={() => chooseRuneLetter(L)}>
              {L}
            </button>
          ))}
        </div>
      )}

      <div className="rack-tiles" role="group" aria-label="Your letters">
        {rack.map((t) => {
          const selected = swap.selected.includes(t.id);
          const cls = [
            'tile',
            t.used ? 'tile-used' : '',
            selected ? 'tile-selected' : '',
            RARE.has(t.letter) ? 'tile-rare' : '',
            shaking === t.letter && t.used ? 'tile-shake' : '',
          ]
            .filter(Boolean)
            .join(' ') + stampClass(t);
          return (
            <button
              type="button"
              key={t.id}
              data-tile-id={t.id}
              data-stamp={t.stamp ?? undefined}
              className={cls}
              tabIndex={-1}
              onMouseDown={noFocus}
              onClick={() => tapTile(t.id)}
              title={(swap.active ? (t.used ? 'In your word: take it back first' : selected ? 'Keep this tile' : 'Swap this tile') : t.used ? `Take ${t.letter} back` : RARE.has(t.letter) ? 'Rare letter: earns Magic' : `Add ${t.letter}`) + stampTitle(t)}
              aria-pressed={swap.active ? selected : t.used}
            >
              {t.letter}
            </button>
          );
        })}
        {rune.held && (
          <button
            type="button"
            className={`tile tile-rune rune-slot${runeIn ? ' tile-used' : ''}`}
            tabIndex={-1}
            onMouseDown={noFocus}
            onClick={tapRune}
            title={runeIn ? 'Take the Rune back' : 'The Rune: a wild letter you choose. Tap to add it to your word.'}
            aria-label="Rune tile"
          >
            {runeIn ? rune.letter ?? '?' : ''}
          </button>
        )}
      </div>

      <div className="rack-controls">
        <button type="button" className="pill pill-primary submit-button" tabIndex={-1} onMouseDown={noFocus} onClick={() => submitWord()} disabled={submitLocked} data-tour="submit">
          Submit
        </button>
        <button type="button" className="pill hint-button" tabIndex={-1} onMouseDown={noFocus} onClick={pressHint} title={hintTitle} data-tour="hint">
          Hint{' '}
          <span className="pill-count lantern-count" aria-label={`${lanterns} Lanterns`}>
            <LanternIcon />
            {lanterns}
          </span>
        </button>
        <button type="button" className={`pill swap-button${swap.active ? ' pill-selected' : ''}`} tabIndex={-1} onMouseDown={noFocus} onClick={pressSwap} disabled={sw.disabled}>
          {sw.label}
        </button>
        {swap.active ? (
          <button type="button" className="pill" tabIndex={-1} onMouseDown={noFocus} onClick={() => cancelSwap()}>
            Cancel
          </button>
        ) : (
          <button
            type="button"
            className="pill"
            tabIndex={-1}
            onMouseDown={noFocus}
            onClick={rerollRack}
            title="Replace every letter. You earn 1 reroll per 5 valid words, up to 3."
          >
            Reroll <span className="pill-count">{rerolls}/{REROLL_MAX}</span>
          </button>
        )}
      </div>
      {/* (v3.0.2) The free Hint's answer stays at the rack until the rack changes. */}
      {!swap.active && hint.longest !== null && (
        <p className="swap-note hint-longest" data-hint-longest={hint.longest}>
          Longest word: {hint.longest} letters
        </p>
      )}
      {!swap.active && hint.pending && <p className="swap-note hint-longest hint-pending">Hint is waiting for the word list to load.</p>}
      {sw.note && <p className="swap-note">{sw.note}</p>}
      {hint.freeUsed && lanterns === 0 && !swap.active && <p className="swap-note lantern-note">{noLanternLine()}</p>}
    </div>
  );
}
