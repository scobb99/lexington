// (v3.0) Commission orders at the town center (Build Spec v3.0, Section 18). Pure rules.

import solvability from '../data/orderSolvability.json';
import { BUILDINGS, TIER_ORDER, realBuildings } from './buildings';
import { RARE } from './words';
import type { Building, Resources, Tier } from './types';

/** Section 18: the board holds exactly 3 open orders. */
export const OPEN_ORDERS = 3;
/** Section 18: one free discard per 5 valid words. */
export const DISCARD_EVERY = 5;
/** Section 18: the lump is 5 to 12 of one resource, drawn evenly. */
export const REWARD_MIN = 5;
export const REWARD_MAX = 12;

/** Section 18 condition types 3 and 4: the letters they draw from. */
export const TWICE_LETTERS = ['E', 'S', 'T', 'R', 'L', 'O', 'A', 'N'];
export const START_LETTERS = ['S', 'C', 'P', 'T', 'M', 'B', 'R', 'L', 'D', 'G'];

export type OrderCond =
  | { type: 'len'; min: 6 | 7 }
  | { type: 'twice'; letter: string }
  | { type: 'start'; letter: string }
  | { type: 'rare' }
  | { type: 'stamp' };

export type RewardRes = 'coins' | 'lumber' | 'stone';

export interface Order {
  id: number;
  cond: OrderCond;
  reward: { res: RewardRes; amount: number };
  /** Lifetime valid words when the order was posted (the panel shows how long it has been open). */
  postedAt: number;
}

/** A short key per condition, as the solvability table stores them ("len6", "twice:E", ...). */
export function condKey(c: OrderCond): string {
  switch (c.type) {
    case 'len':
      return `len${c.min}`;
    case 'twice':
      return `twice:${c.letter}`;
    case 'start':
      return `start:${c.letter}`;
    default:
      return c.type;
  }
}

/** Every condition the generator can post (Section 18's full list). */
export function allConditions(): OrderCond[] {
  return [
    { type: 'len', min: 6 },
    { type: 'len', min: 7 },
    ...TWICE_LETTERS.map((letter) => ({ type: 'twice' as const, letter })),
    ...START_LETTERS.map((letter) => ({ type: 'start' as const, letter })),
    { type: 'rare' },
    { type: 'stamp' },
  ];
}

/** Section 18: the condition in words, as the orders panel and messages show it. */
export function condText(c: OrderCond): string {
  switch (c.type) {
    case 'len':
      return `Play a word of ${c.min} or more letters.`;
    case 'twice':
      return `Play a word with two ${c.letter}'s.`;
    case 'start':
      return `Play a word of 5 or more letters starting with ${c.letter}.`;
    case 'rare':
      return 'Play a word using J, Q, X, Z, K, or V.';
    case 'stamp':
      return 'Play a word through a stamped tile.';
  }
}

/** Section 18: does this submitted valid word meet the condition? Reads the real word. */
export function meets(c: OrderCond, word: string, usedStamp: boolean): boolean {
  switch (c.type) {
    case 'len':
      return word.length >= c.min;
    case 'twice':
      return [...word].filter((ch) => ch === c.letter).length >= 2;
    case 'start':
      return word.length >= 5 && word[0] === c.letter;
    case 'rare':
      return [...word].some((ch) => RARE.has(ch));
    case 'stamp':
      return usedStamp;
  }
}

/**
 * Section 18 solvability: a condition is posted only if it passed the offline dictionary check at
 * the current rack size (satisfiable from at least 25 percent of 1,000 random racks). The table
 * is src/data/orderSolvability.json, made by scripts/orders/solvability.mjs from the shipped list.
 */
export function solvable(c: OrderCond, rackSize: number): boolean {
  return shareOf(c, rackSize) >= SOLVABLE_BAR;
}

/** Section 18: the bar, 25 percent of random racks. */
export const SOLVABLE_BAR = (solvability as { bar: number }).bar;

/** The measured share of racks (0 to 1) that can meet this condition at this rack size. */
export function shareOf(c: OrderCond, rackSize: number): number {
  const table = (solvability as { results: Record<string, Record<string, number>> }).results;
  const row = table[String(Math.max(6, Math.min(9, rackSize)))];
  const share = row?.[condKey(c)];
  return typeof share === 'number' ? share : 0;
}

export interface OrderTownState {
  rackSize: number;
  tier: Tier;
  buildings: Building[];
  resources: Resources;
  /** Section 18 type 6: posted only when at least one producer (Sawmill, Quarry, Market) stands. */
  producerStands: boolean;
}

/** Conditions allowed by Section 18's own gates (condition 2's rack size, condition 6's producer). */
export function gatedConditions(t: OrderTownState): OrderCond[] {
  return allConditions().filter((c) => {
    if (c.type === 'len' && c.min === 7 && t.rackSize < 7) return false; // part of the rule (Section 18)
    if (c.type === 'stamp' && !t.producerStands) return false;
    return true;
  });
}

/** The conditions that pass the solvability bar at this rack size. */
export function postableConditions(t: OrderTownState): OrderCond[] {
  return gatedConditions(t).filter((c) => solvable(c, t.rackSize));
}

/**
 * DISPUTED VALUE (flagged in the build note): Section 18 asks for exactly 3 open orders at all
 * times AND only conditions that pass the 25 percent bar. Measured against the shipped list, a
 * 6-tile rack passes no condition except "through a stamped tile" (which needs a producer), so the
 * two rules cannot both hold in a new town. The build keeps the board full: it posts from the
 * passing conditions first, and when fewer than needed are free, from the remaining gated
 * conditions with the highest measured share (the top 4, so the board still varies).
 */
export function fallbackConditions(t: OrderTownState, taken: Set<string>): OrderCond[] {
  return gatedConditions(t)
    .filter((c) => !taken.has(condKey(c)) && !solvable(c, t.rackSize))
    .sort((a, b) => shareOf(b, t.rackSize) - shareOf(a, t.rackSize))
    .slice(0, 4);
}

/**
 * Section 18 targeting: the cheapest building the player's tier has unlocked and that is not
 * currently standing (proposed reading); the reward is the resource with the largest shortfall
 * (cost minus balance, floored at 0) across its Coin, Lumber and Stone costs; ties and no
 * shortfall go to that building's largest cost resource. Every unlocked building standing: Coins.
 */
export function rewardResource(t: OrderTownState): RewardRes {
  const standing = new Set(realBuildings(t.buildings).map((b) => b.type));
  const keys: RewardRes[] = ['coins', 'lumber', 'stone'];
  const total = (c: Resources) => c.coins + c.lumber + c.stone;
  const candidates = TIER_ORDER.filter((type) => BUILDINGS[type].tier <= t.tier && !standing.has(type));
  if (!candidates.length) return 'coins';
  const target = candidates.reduce((a, b) => (total(BUILDINGS[b].cost) < total(BUILDINGS[a].cost) ? b : a));
  const cost = BUILDINGS[target].cost;
  const short = (k: RewardRes) => Math.max(0, cost[k] - t.resources[k]);
  const largestCost = (among: RewardRes[]) => among.reduce((a, b) => (cost[b] > cost[a] ? b : a));
  const most = Math.max(...keys.map(short));
  if (most === 0) return largestCost(keys);
  const tied = keys.filter((k) => short(k) === most);
  return tied.length === 1 ? tied[0] : largestCost(tied);
}

/** Section 18: a new order, avoiding conditions already open. `rng` returns 0 to 1. */
export function makeOrder(id: number, t: OrderTownState, open: Order[], postedAt: number, rng: () => number = Math.random): Order {
  const taken = new Set(open.map((o) => condKey(o.cond)));
  let pool = postableConditions(t).filter((c) => !taken.has(condKey(c)));
  if (!pool.length) pool = fallbackConditions(t, taken);
  if (!pool.length) pool = [{ type: 'rare' }];
  // Pick a condition type first, then its letter, so the many letter variants don't crowd out
  // the single-condition types.
  const types = [...new Set(pool.map((c) => c.type))];
  const type = types[Math.floor(rng() * types.length) % types.length];
  const ofType = pool.filter((c) => c.type === type);
  const cond = ofType[Math.floor(rng() * ofType.length) % ofType.length];
  const amount = REWARD_MIN + (Math.floor(rng() * (REWARD_MAX - REWARD_MIN + 1)) % (REWARD_MAX - REWARD_MIN + 1));
  return { id, cond, reward: { res: rewardResource(t), amount }, postedAt };
}

/** Section 18: the panel's discard line. */
export function discardLine(wordsSinceDiscard: number): string {
  const left = DISCARD_EVERY - wordsSinceDiscard;
  return left <= 0 ? 'Free discard ready.' : `Free discard in ${left} word${left === 1 ? '' : 's'}.`;
}

/** Section 18 (proposed wording): the town center's one-line summary of the loop. */
export const LOOP_SUMMARY =
  'Words earn Coins, Knowledge, and Magic. Your buildings make Lumber and Stone. Commissions pay for finishing the words your town asks for.';
