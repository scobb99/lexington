// The 8-letter rack and the word box (Build Spec v2.0, Section 5).
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
  cancelSwap,
  clearWord,
  deleteLast,
  pressHint,
  pressSwap,
  rerollRack,
  submitWord,
  swapStatus,
  tapTile,
  useGame,
} from '../game/store';
import { RARE, REROLL_MAX, minWordLength } from '../game/words';

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

export function Rack() {
  const rack = useGame((s) => s.rack);
  const word = useGame((s) => s.word);
  const swap = useGame((s) => s.swap);
  const shake = useGame((s) => s.shake);
  const rerolls = useGame((s) => s.rerolls);
  const tier = useGame((s) => s.tier);
  const coins = useGame((s) => s.resources.coins);
  const submitLocked = useGame((s) => !s.locks.submit || !!s.preview);
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
  const placed = word.map((id) => byId.get(id)).filter((t): t is NonNullable<typeof t> => !!t);
  void coins; // re-render when Coins change, so the Swap price line stays right
  const sw = swapStatus();

  return (
    <div className={`rack panel${swap.active ? ' rack-swapping' : ''}`} aria-label="Word game" data-tour="rack">
      <div className="word-row">
        {/* The word box: a display only. Tapping it does nothing; tapping a placed letter takes it back. */}
        <div className="word-box" aria-label="Your word" aria-live="polite">
          {placed.length === 0 ? (
            <span className="word-placeholder">{swap.active ? 'Pick tiles to swap' : `Tap letters (${min}+)`}</span>
          ) : (
            placed.map((t) => (
              <span
                key={t.id}
                className={`word-letter${RARE.has(t.letter) ? ' tile-rare' : ''}`}
                onClick={() => tapTile(t.id)}
                title={`Take ${t.letter} back`}
              >
                {t.letter}
              </span>
            ))
          )}
        </div>
        <DeleteKey disabled={placed.length === 0} />
      </div>

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
            .join(' ');
          return (
            <button
              type="button"
              key={t.id}
              data-tile-id={t.id}
              className={cls}
              tabIndex={-1}
              onMouseDown={noFocus}
              onClick={() => tapTile(t.id)}
              title={swap.active ? (t.used ? 'In your word: take it back first' : selected ? 'Keep this tile' : 'Swap this tile') : t.used ? `Take ${t.letter} back` : RARE.has(t.letter) ? 'Rare letter: earns Magic' : `Add ${t.letter}`}
              aria-pressed={swap.active ? selected : t.used}
            >
              {t.letter}
            </button>
          );
        })}
      </div>

      <div className="rack-controls">
        <button type="button" className="pill pill-primary submit-button" tabIndex={-1} onMouseDown={noFocus} onClick={() => submitWord()} disabled={submitLocked} data-tour="submit">
          Submit
        </button>
        <button type="button" className="pill hint-button" tabIndex={-1} onMouseDown={noFocus} onClick={pressHint} title="Free: names the length, then the first letter, then the word">
          Hint
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
            title="Replace all 8 letters. You earn 1 reroll per 5 valid words, up to 3."
          >
            Reroll <span className="pill-count">{rerolls}/{REROLL_MAX}</span>
          </button>
        )}
      </div>
      {sw.note && <p className="swap-note">{sw.note}</p>}
    </div>
  );
}
