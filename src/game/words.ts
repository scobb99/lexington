// The word game rules: rack, validation, rewards, and the Lantern guide word (Build Spec v3.0,
// Sections 5 and 6). Pure functions only (no React, no Pixi, no store) so they can be
// unit-tested and reused by the economy simulation.

import { type BuildingType, type Resources, type Tier } from './types';

// ---------- Section 5: rack ----------

/** (v3.0) Section 5, the Growing Rack: a new town's rack holds 6 tiles. */
export const RACK_START = 6;
/** The largest rack (the Town Hall's 9). */
export const RACK_MAX = 9;
/** v2.0's fixed rack (kept for the v2 save check and the tutorial's v2 data). */
export const RACK_SIZE = 8;
export const REROLL_EVERY = 5; // Section 5: 1 reroll per 5 valid words
export const REROLL_MAX = 3; // Section 5: hold up to 3
export const REPEAT_WINDOW = 10; // Section 5: last 10 submissions
export const LONG_WORD = 7; // Section 5: 7 letters or more

/**
 * Section 5: weighted bag favouring E, T, A, O, I, N, S, H, R; J, Q, X, Z rare.
 * Draws are with replacement (an endless bag), so the odds never change mid-game.
 * Total weight is 120. The exact weights are a build choice inside the spec's rule.
 */
export const LETTER_WEIGHTS: Record<string, number> = {
  E: 12, T: 9, A: 9, O: 8, I: 8, N: 7, S: 7, H: 6, R: 7,
  D: 4, L: 4, U: 4, C: 3, M: 3, G: 3,
  W: 2, F: 2, Y: 2, P: 2, B: 2, V: 2, K: 2,
  J: 1, Q: 1, X: 1, Z: 1,
};

const BAG: string[] = Object.entries(LETTER_WEIGHTS).flatMap(([l, w]) => Array(w).fill(l));

export type Rng = () => number;

export function drawLetter(rng: Rng = Math.random): string {
  return BAG[Math.floor(rng() * BAG.length) % BAG.length];
}

export function drawRack(rng: Rng = Math.random, size: number = RACK_START): string[] {
  return Array.from({ length: size }, () => drawLetter(rng));
}

/**
 * (v3.0) Section 5: rack size from buildings ever built (the Section 9 reading, so removing a
 * Cottage never shrinks it): 6; 7 at the 2nd Cottage; 8 at the 4th; 9 at the Town Hall.
 */
export function rackSizeFor(everBuilt: Partial<Record<BuildingType, number>>): number {
  if ((everBuilt.townHall ?? 0) >= 1) return 9;
  const c = everBuilt.cottage ?? 0;
  if (c >= 4) return 8;
  if (c >= 2) return 7;
  return RACK_START;
}

/** Keeps the letters that were not used and refills the rack back to its size. */
export function refillRack(remaining: string[], rng: Rng = Math.random, size: number = RACK_START): string[] {
  const out = remaining.slice(0, size);
  while (out.length < size) out.push(drawLetter(rng));
  return out;
}

// ---------- Section 5: validation ----------

/** Fork A (Stu, Nov 20, 2026): 3 letters at Tier 1, 4 letters at Tier 2 and Tier 3. */
export function minWordLength(tier: Tier): number {
  return tier === 1 ? 3 : 4;
}

/** Upper-cases and strips anything that is not A to Z. */
export function normalizeWord(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, '');
}

export type LetterCheck =
  | { ok: true; remaining: string[] }
  | { ok: false; letter: string; need: number; have: number };

/** Section 5 step 2: letter availability, counting duplicates. */
export function checkLetters(word: string, rack: string[]): LetterCheck {
  const pool = rack.slice();
  const need: Record<string, number> = {};
  for (const ch of word) need[ch] = (need[ch] ?? 0) + 1;
  for (const ch of word) {
    const at = pool.indexOf(ch);
    if (at === -1) {
      const have = rack.filter((c) => c === ch).length;
      return { ok: false, letter: ch, need: need[ch], have };
    }
    pool.splice(at, 1);
  }
  return { ok: true, remaining: pool };
}

export type ValidationResult =
  | { ok: true; word: string; remaining: string[] }
  | { ok: false; reason: 'empty' }
  | { ok: false; reason: 'short'; min: number }
  | { ok: false; reason: 'letters'; letter: string; need: number; have: number }
  | { ok: false; reason: 'dictionary'; word: string }
  | { ok: false; reason: 'loading'; word: string };

/**
 * Section 5 validation order: minimum length, letter availability, dictionary membership.
 * `inDictionary` returns true, false, or null (null = the main list is still loading and
 * the word is not in the fallback set either).
 */
export function validateWord(
  raw: string,
  rack: string[],
  tier: Tier,
  inDictionary: (word: string) => boolean | null,
): ValidationResult {
  const word = normalizeWord(raw);
  if (word.length === 0) return { ok: false, reason: 'empty' };
  const min = minWordLength(tier);
  if (word.length < min) return { ok: false, reason: 'short', min };
  const letters = checkLetters(word, rack);
  if (!letters.ok) return { ok: false, reason: 'letters', ...withoutOk(letters) };
  const known = inDictionary(word);
  if (known === null) return { ok: false, reason: 'loading', word };
  if (!known) return { ok: false, reason: 'dictionary', word };
  return { ok: true, word, remaining: letters.remaining };
}

function withoutOk(c: { letter: string; need: number; have: number }) {
  return { letter: c.letter, need: c.need, have: c.have };
}

// ---------- Section 6: rewards ----------

export const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']); // Section 6: V counts A, E, I, O, U
export const RARE = new Set(['J', 'Q', 'X', 'Z', 'K', 'V']); // Section 6: R counts J, Q, X, Z, K, V

/**
 * (v3.0) Section 6 reward formulas. Material separation: words pay Coins, Knowledge and Magic
 * only; Lumber and Stone are 0. `effLength` is the High Street effective length (Section 19), used
 * only for the length term; vowels and rare letters are counted on the real word.
 */
export function baseReward(word: string, effLength: number = word.length): Resources {
  let V = 0;
  let R = 0;
  for (const ch of word) {
    if (VOWELS.has(ch)) V++;
    if (RARE.has(ch)) R++;
  }
  return {
    coins: Math.max(2, Math.floor(effLength / 2)), // Section 6: max(2, floor(L / 2))
    lumber: 0, // Section 6 (v3.0): words never pay Lumber
    stone: 0, // Section 6 (v3.0): words never pay Stone
    knowledge: Math.ceil(V / 2), // Section 6: ceil(V / 2)
    magic: R, // Section 6: R
  };
}

export interface RewardContext {
  /** Section 5: word resubmitted within the last 10 submissions earns half. */
  isRepeat: boolean;
  /** Section 6: a standing Wizard Tower doubles Magic earned from rare letters. */
  wizardTowerStanding: boolean;
  /** (v3.0) Section 19: High Street effective length (the real length when there is no bonus). */
  effLength?: number;
  /** (v3.0) Section 19: a Gilded stamp in the word doubles its Coins (before the repeat halving). */
  gilded?: boolean;
}

export interface WordReward {
  total: Resources;
  longWordBonus: boolean;
  halved: boolean;
}

/**
 * Section 5 and 6 (v3.0) word reward, in this order. The happiness multiplier is CUT (LOCKED
 * amendment ruling 5): rewards pay flat.
 *  1. base formulas at the effective length; Wizard Tower doubles the rare-letter Magic;
 *  2. Gilded doubles the Coins (Section 19: before any repeat halving);
 *  3. long word bonus: +1 Magic for 7+ REAL letters (Section 5; never the effective length);
 *  4. repeat rule: halve the word reward, rounded down (Section 5; production is never halved);
 *  5. floor of 1 Coin per valid word (carried).
 */
export function computeWordReward(word: string, ctx: RewardContext): WordReward {
  const total = baseReward(word, ctx.effLength ?? word.length);
  if (ctx.wizardTowerStanding) total.magic *= 2;
  if (ctx.gilded) total.coins *= 2;
  const longWordBonus = word.length >= LONG_WORD;
  if (longWordBonus) total.magic += 1;
  if (ctx.isRepeat) {
    for (const k of Object.keys(total) as (keyof Resources)[]) total[k] = Math.floor(total[k] / 2);
  }
  total.coins = Math.max(1, total.coins);
  return { total, longWordBonus, halved: ctx.isRepeat };
}

export function isRepeatWord(word: string, recentWords: string[]): boolean {
  return recentWords.slice(-REPEAT_WINDOW).includes(word);
}

/** Section 5: one reroll earned per 5 valid words, held up to 3. */
export function rerollsAfterValidWord(validWordsSoFar: number, held: number): number {
  return validWordsSoFar > 0 && validWordsSoFar % REROLL_EVERY === 0
    ? Math.min(REROLL_MAX, held + 1)
    : held;
}

/** "+3 Coins, +1 Lumber, +2 Knowledge" — only non-zero amounts. */
export function formatResources(r: Resources, sign = '+'): string {
  const parts: string[] = [];
  const names: [keyof Resources, string][] = [
    ['coins', 'Coin'],
    ['lumber', 'Lumber'],
    ['stone', 'Stone'],
    ['knowledge', 'Knowledge'],
    ['magic', 'Magic'],
  ];
  for (const [k, label] of names) {
    const v = r[k];
    if (v > 0) parts.push(`${sign}${v} ${label === 'Coin' && v !== 1 ? 'Coins' : label}`);
  }
  return parts.join(', ');
}

// ---------- Section 5: dead rack rule ----------

/**
 * True if at least one dictionary word of at least `minLen` letters can be made from the rack.
 * `words` are lower-case. Stops at the first word found, so a normal rack answers at once.
 */
export function rackHasWord(rack: string[], minLen: number, words: Iterable<string>): boolean {
  const have = new Array(26).fill(0);
  for (const ch of rack) have[ch.charCodeAt(0) - 65]++;
  const need = new Array(26);
  outer: for (const w of words) {
    if (w.length < minLen || w.length > rack.length) continue;
    need.fill(0);
    for (let i = 0; i < w.length; i++) {
      const k = w.charCodeAt(i) - 97;
      if (++need[k] > have[k]) continue outer;
    }
    return true;
  }
  return false;
}

/** Safety cap on free redraws in a row (with the full list, a dead rack is about 1 in 60). */
export const DEAD_RACK_MAX_REDRAWS = 40;

/**
 * Section 5 dead rack rule (Stu decision, Nov 20, 2026): if the rack has no valid word at the
 * current minimum length, draw a fresh rack for free (stored rerolls are not used). Repeats
 * until a playable rack appears. Returns the playable rack and how many free redraws it took.
 */
export function ensurePlayable(
  rack: string[],
  minLen: number,
  words: Iterable<string>,
  rng: Rng = Math.random,
): { rack: string[]; freeRedraws: number } {
  let current = rack;
  let freeRedraws = 0;
  while (!rackHasWord(current, minLen, words) && freeRedraws < DEAD_RACK_MAX_REDRAWS) {
    current = drawRack(rng, rack.length);
    freeRedraws++;
  }
  return { rack: current, freeRedraws };
}

// ---------- Section 5: the longest word, and (v3.0) the Lantern guide word ----------

/**
 * The longest word that can be made from the rack, ties broken alphabetically so the answer is
 * stable (Section 5 Hint). `words` are lower-case. Returns the word in capitals, or null.
 */
export function longestWord(rack: string[], minLen: number, words: Iterable<string>): string | null {
  const have = new Array(26).fill(0);
  for (const ch of rack) have[ch.charCodeAt(0) - 65]++;
  const need = new Array(26);
  let best: string | null = null;
  outer: for (const w of words) {
    if (w.length < minLen || w.length > rack.length) continue;
    if (best && (w.length < best.length || (w.length === best.length && w >= best))) continue;
    need.fill(0);
    for (let i = 0; i < w.length; i++) {
      const k = w.charCodeAt(i) - 97;
      if (k < 0 || k > 25 || ++need[k] > have[k]) continue outer;
    }
    best = w;
  }
  return best ? best.toUpperCase() : null;
}

/** Section 5 (v2.0): Swap costs 2 Coins per tile. */
export const SWAP_COST_PER_TILE = 2;

/** Every word of exactly `len` letters the rack can make, sorted alphabetically (capitals). */
export function wordsOfLength(rack: string[], len: number, words: Iterable<string>): string[] {
  const have = new Array(26).fill(0);
  for (const ch of rack) have[ch.charCodeAt(0) - 65]++;
  const need = new Array(26);
  const out: string[] = [];
  outer: for (const w of words) {
    if (w.length !== len) continue;
    need.fill(0);
    for (let i = 0; i < w.length; i++) {
      const k = w.charCodeAt(i) - 97;
      if (k < 0 || k > 25 || ++need[k] > have[k]) continue outer;
    }
    out.push(w.toUpperCase());
  }
  return out.sort();
}

/**
 * (v3.0) Section 5, Lantern Hints: the guide word is never the longest word on the rack. It is
 * the longest word one letter shorter than the longest (ties alphabetical), never shorter than
 * the tier minimum; if no word exists at that length, the longest word itself (proposed edge rule).
 */
export function guideWord(rack: string[], minLen: number, words: string[]): string | null {
  const longest = longestWord(rack, minLen, words);
  if (!longest) return null;
  const shorter = longest.length - 1;
  if (shorter >= minLen) {
    const list = wordsOfLength(rack, shorter, words);
    if (list.length) return list[0];
  }
  return longest;
}

/** (v3.0) Section 5: Lanterns. Start 3, hold 3, +1 per 10 valid words (per 5 with a connected Library). */
export const LANTERN_START = 3;
export const LANTERN_MAX = 3;
export const LANTERN_EVERY = 10;
export const LANTERN_EVERY_LIBRARY = 5;
/** (v3.0) Section 5: at most 2 letters placed by Lanterns on one rack. */
export const LANTERN_LETTERS_PER_RACK = 2;
