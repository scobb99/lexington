// The word game rules: rack, validation, and rewards.
// Pure functions only (no React, no Pixi, no store) so they can be unit-tested and
// reused by the Magic economy simulation (Build Spec v1.1, Section 6 playtest risk).

import { emptyResources, type Resources, type Tier } from './types';

// ---------- Section 5: rack ----------

export const RACK_SIZE = 8; // Section 5: 8 letters
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

export function drawRack(rng: Rng = Math.random): string[] {
  return Array.from({ length: RACK_SIZE }, () => drawLetter(rng));
}

/** Keeps the letters that were not used and refills the rack back to 8. */
export function refillRack(remaining: string[], rng: Rng = Math.random): string[] {
  const out = remaining.slice(0, RACK_SIZE);
  while (out.length < RACK_SIZE) out.push(drawLetter(rng));
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

/** Section 6 reward formulas, before the happiness multiplier. */
export function baseReward(word: string): Resources {
  const L = word.length;
  let V = 0;
  let R = 0;
  for (const ch of word) {
    if (VOWELS.has(ch)) V++;
    if (RARE.has(ch)) R++;
  }
  return {
    coins: Math.max(2, Math.floor(L / 2)), // Section 6: max(2, floor(L / 2))
    lumber: Math.max(1, Math.floor((L - V) / 3)), // Section 6: floor((L - V) / 3), minimum 1
    stone: Math.floor((L - V) / 4), // Section 6: floor((L - V) / 4)
    knowledge: Math.ceil(V / 2), // Section 6: ceil(V / 2)
    magic: R, // Section 6: R
  };
}

/** Section 8: happiness only changes this multiplier. */
export function happinessMultiplier(happiness: number): number {
  if (happiness >= 80) return 1.2;
  if (happiness >= 60) return 1.1;
  if (happiness >= 40) return 1.0;
  if (happiness >= 20) return 0.9;
  return 0.8;
}

export interface RewardContext {
  happiness: number;
  /** Section 5: word resubmitted within the last 10 submissions earns half. */
  isRepeat: boolean;
  /** Section 6: a standing Wizard Tower doubles Magic earned from rare letters. */
  wizardTowerStanding: boolean;
}

export interface WordReward {
  total: Resources;
  longWordBonus: boolean;
  halved: boolean;
  multiplier: number;
}

/**
 * Applies the Section 5 and 6 rules in this order (the spec does not fix the order of the
 * repeat rule and the floor, so this order is a build interpretation):
 *  1. base formulas; Wizard Tower doubles the rare-letter Magic;
 *  2. happiness multiplier, then round each value down (Section 6);
 *  3. long word bonus: +1 Magic for 7+ letters (Section 5), added after the multiplier;
 *  4. repeat rule: halve everything, rounded down (Section 5);
 *  5. floor of 1 Coin and 1 Lumber on every valid word (Section 6).
 */
export function computeWordReward(word: string, ctx: RewardContext): WordReward {
  const base = baseReward(word);
  if (ctx.wizardTowerStanding) base.magic *= 2;
  const multiplier = happinessMultiplier(ctx.happiness);
  const total = emptyResources();
  for (const k of Object.keys(base) as (keyof Resources)[]) {
    total[k] = Math.floor(base[k] * multiplier + 1e-9);
  }
  const longWordBonus = word.length >= LONG_WORD;
  if (longWordBonus) total.magic += 1;
  if (ctx.isRepeat) {
    for (const k of Object.keys(total) as (keyof Resources)[]) total[k] = Math.floor(total[k] / 2);
  }
  total.coins = Math.max(1, total.coins);
  total.lumber = Math.max(1, total.lumber);
  return { total, longWordBonus, halved: ctx.isRepeat, multiplier };
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
    current = drawRack(rng);
    freeRedraws++;
  }
  return { rack: current, freeRedraws };
}
