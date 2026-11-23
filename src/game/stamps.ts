// (v3.0) Workshop stamps and the Rune tile (Build Spec v3.0, Section 19). Pure rules.

import type { BuildingType, StampKind } from './types';

/** Section 19: which producer stamps which kind. */
export const STAMP_SOURCE: Record<StampKind, BuildingType> = { oak: 'sawmill', granite: 'quarry', gilded: 'market' };
export const STAMP_NAMES: Record<StampKind, string> = { oak: 'Oak', granite: 'Granite', gilded: 'Gilded' };

/** Section 19: Oak pays 4 Lumber; Granite pays 4 Stone; Gilded doubles the word's Coins. */
export const STAMP_PAY = 4;

/**
 * Section 19 cadence: with one connected building of the type, a stamp every 3rd valid word;
 * with two or more, every 2nd. Null when none is connected (the counter does not run).
 */
export function stampCadence(connected: number): number | null {
  if (connected <= 0) return null;
  return connected >= 2 ? 2 : 3;
}

export type StampCounters = Record<StampKind, number>;
export const emptyCounters = (): StampCounters => ({ oak: 0, granite: 0, gilded: 0 });

/**
 * One valid word's step of the stamp counters (Section 19). `held` = kinds still on a rack tile
 * after this word's used tiles left. A kind whose counter reaches its cadence places a stamp and
 * resets; while one of its kind is held, the counter waits at the threshold and places on the
 * first word after the held one is spent or lost.
 */
export function stepStamps(
  counters: StampCounters,
  connected: Record<StampKind, number>,
  held: Set<StampKind>,
): { counters: StampCounters; place: StampKind[] } {
  const next = { ...counters };
  const place: StampKind[] = [];
  for (const kind of ['oak', 'granite', 'gilded'] as StampKind[]) {
    const every = stampCadence(connected[kind]);
    if (every === null) continue;
    next[kind] = Math.min(every, next[kind] + 1);
    if (next[kind] >= every && !held.has(kind)) {
      place.push(kind);
      next[kind] = 0;
    }
  }
  return { counters: next, place };
}

/** Section 19 (proposed wording): the first-time message for each kind. */
export const FIRST_STAMP_LINE: Record<StampKind, string> = {
  oak: 'Your Sawmill stamped an Oak tile. Play a word through it for bonus Lumber.',
  granite: 'Your Quarry stamped a Granite tile. Play a word through it for bonus Stone.',
  gilded: 'Your Market stamped a Gilded tile. Play a word through it for double Coins.',
};

/** Section 19: while a connected Wizard Tower stands and no Rune is held, every 10th valid word charges one. */
export const RUNE_EVERY = 10;
/** The Rune's place in the current word's id list (rack tile ids start at 1). */
export const RUNE_ID = 0;
