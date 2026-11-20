// The 8-letter rack and word input (Build Spec v1.1, Section 5).
// The typed word lives in this component's own React state. Tiles can be tapped to type
// (and tapped again to take a letter back), so a word can be made by touch alone. Typing never touches the store
// and never passes anything to MapView (Section 10).

import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { rerollRack, submitWord, useGame } from '../game/store';
import { RACK_SIZE, RARE, REROLL_MAX, minWordLength, normalizeWord } from '../game/words';

/** For each rack slot, whether the typed word is using it (left to right, duplicates counted). */
function usedSlots(word: string, rack: string[]): boolean[] {
  const used = rack.map(() => false);
  for (const ch of word) {
    const i = rack.findIndex((c, j) => c === ch && !used[j]);
    if (i >= 0) used[i] = true;
  }
  return used;
}

export function Rack() {
  const rack = useGame((s) => s.rack);
  const rerolls = useGame((s) => s.rerolls);
  const tier = useGame((s) => s.tier);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const used = useMemo(() => usedSlots(text, rack), [text, rack]);
  const min = minWordLength(tier);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const result = submitWord(text);
    if (result.ok) setText('');
    inputRef.current?.focus();
  };

  /** Tapping a tile adds its letter; tapping a tile already in the word takes that letter back. */
  const tapTile = (letter: string, slot: number) => {
    if (used[slot]) {
      const at = text.lastIndexOf(letter);
      if (at >= 0) setText(text.slice(0, at) + text.slice(at + 1));
      return;
    }
    if (text.length >= RACK_SIZE) return;
    setText((t) => t + letter);
  };

  return (
    <form className="rack panel" onSubmit={onSubmit} aria-label="Word game">
      <div className="rack-tiles" role="group" aria-label="Your letters">
        {rack.map((letter, i) => (
          <button
            type="button"
            key={i}
            className={`tile${used[i] ? ' tile-used' : ''}${RARE.has(letter) ? ' tile-rare' : ''}`}
            onClick={() => tapTile(letter, i)}
            title={used[i] ? `Take ${letter} back` : RARE.has(letter) ? 'Rare letter: earns Magic' : `Add ${letter}`}
            aria-pressed={used[i]}
          >
            {letter}
          </button>
        ))}
      </div>
      <div className="rack-controls">
        <input
          ref={inputRef}
          className="word-input"
          value={text}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setText(normalizeWord(e.target.value).slice(0, RACK_SIZE))}
          placeholder={`Word (${min}+ letters)`}
          aria-label="Your word"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={RACK_SIZE}
        />
        <button type="submit" className="pill pill-primary">
          Submit
        </button>
        <button type="button" className="pill clear-button" onClick={() => setText('')} disabled={!text}>
          Clear
        </button>
        <button
          type="button"
          className="pill"
          onClick={() => {
            rerollRack();
            setText('');
          }}
          title="Replace all 8 letters. You earn 1 reroll per 5 valid words, up to 3."
        >
          Reroll <span className="pill-count">{rerolls}/{REROLL_MAX}</span>
        </button>
      </div>
    </form>
  );
}
