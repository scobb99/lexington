// (v3.0) Dynamic terrain: forest and thicket spread, river overflow, and flood gravel
// (Build Spec v3.0, Section 20; LOCKED amendment rulings 4 and 6; Stu's clarifications of
// Nov 22, 2026). Pure rules: the store applies the result and the map repaints those tiles.
//
// The clock is valid word submissions only: nothing here runs on a timer, a page load, or while
// the game is closed. Growth every 20 valid words, overflow every 50; when both fall on the same
// word, growth runs first.
//
// Stu's clarifications (Nov 22, 2026), which refine the draft's deterministic pick:
//  - eligibility is exactly as specified (below);
//  - selection is a weighted random draw from a seeded RNG, weighted by same-type neighbour count,
//    so enclosed tiles are more likely but never guaranteed;
//  - the number of tiles per step varies from 0 up to the step maximum, so some ticks change nothing;
//  - an overflow leaves at most one gravel tile, about one overflow in three, by the same kind of
//    seeded draw; clearing gravel is free and gives 3 Stone.
// The RNG is seeded from the map seed, the step kind and the tick number (both saved), so a
// reload or a second device reading the same save reproduces the same history.

import { BUILDINGS, effectiveAt } from './buildings';
import { mulberry32 } from './terrain';
import { MAP_H, MAP_W, Terrain, type Building } from './types';

/** Section 20 (decided, LOCKED ruling 6): growth every 20 valid words, overflow every 50. */
export const GROWTH_EVERY = 20;
export const OVERFLOW_EVERY = 50;
/** Section 20: up to 2 forest tiles per growth step; thicket up to 1 on every second growth tick. */
export const FOREST_MAX = 2;
export const THICKET_MAX = 1;
/** Section 20: up to 2 tiles per overflow step. */
export const OVERFLOW_MAX = 2;
/** Stu's clarification: about one overflow in three leaves one gravel tile. */
export const GRAVEL_CHANCE = 1 / 3;
/** LOCKED ruling 4: clearing gravel gives 3 Stone (free, per Stu's clarification). */
export const GRAVEL_STONE = 3;

const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

export interface LandState {
  /** Current terrain per tile (Section 2: the generated map is only the starting state). */
  tiles: Uint8Array;
  /** 1 where the player cleared or drained the tile. */
  cleared: Uint8Array;
  roads: Uint8Array;
  gravel: Uint8Array;
  buildings: Building[];
}

export interface LandChange {
  i: number;
  to: number;
}

/**
 * Tiles nothing grows or floods onto (Section 20): roads, bridges, buildings, landmarks, the town
 * center, the ring of tiles around the town center's footprint (proposed: so the founding clearing
 * cannot close in), and gravel (build reading: a deposit waits for the player's Clear).
 */
export function protectedTiles(s: LandState): Uint8Array {
  const out = new Uint8Array(MAP_W * MAP_H);
  for (let i = 0; i < out.length; i++) if (s.roads[i] || s.gravel[i]) out[i] = 1;
  for (const b of s.buildings) {
    if (b.preview) continue;
    const d = BUILDINGS[b.type];
    const pad = b.type === 'townCenter' ? 1 : 0;
    for (let y = b.y - pad; y < b.y + d.h + pad; y++) for (let x = b.x - pad; x < b.x + d.w + pad; x++) if (inMap(x, y)) out[y * MAP_W + x] = 1;
  }
  return out;
}

/** A tile is open low land: meadow, or cleared or drained land (all count as meadow, Section 4). */
function isOpenLand(s: LandState, i: number): boolean {
  return effectiveAt(s.tiles, s.cleared, i) === Terrain.Meadow;
}

/** Same-type neighbours of tile i (uncleared tiles of `type`). */
function neighboursOf(s: LandState, i: number, type: number): number {
  const x = i % MAP_W;
  const y = (i / MAP_W) | 0;
  let n = 0;
  for (const [dx, dy] of N4) {
    const nx = x + dx;
    const ny = y + dy;
    if (inMap(nx, ny) && effectiveAt(s.tiles, s.cleared, ny * MAP_W + nx) === type) n++;
  }
  return n;
}

/** Stable 32-bit seed for one step of one tick (map seed, step salt, tick number). */
export function tickSeed(mapSeed: number, salt: number, tick: number): number {
  let h = (mapSeed ^ Math.imul(salt + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (tick + 0x632be5ab), 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * The weighted draw: picks up to `max` tiles (the count itself drawn evenly from 0 to max),
 * without replacement, each pick weighted by its weight.
 */
function weightedPicks(cands: { i: number; w: number }[], max: number, rng: () => number): number[] {
  const count = Math.floor(rng() * (max + 1)) % (max + 1);
  const pool = cands.slice();
  const out: number[] = [];
  for (let k = 0; k < count && pool.length; k++) {
    const total = pool.reduce((n, c) => n + c.w, 0);
    let r = rng() * total;
    let at = 0;
    while (at < pool.length - 1 && r >= pool[at].w) {
      r -= pool[at].w;
      at++;
    }
    out.push(pool[at].i);
    pool.splice(at, 1);
  }
  return out;
}

/** Eligible tiles for `type` to spread into: open land beside it, not protected. */
export function spreadCandidates(s: LandState, type: number): { i: number; w: number }[] {
  const prot = protectedTiles(s);
  const out: { i: number; w: number }[] = [];
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    if (prot[i] || !isOpenLand(s, i)) continue;
    const w = neighboursOf(s, i, type);
    if (w > 0) out.push({ i, w });
  }
  return out;
}

/** Salts for the seeded steps. */
const SALT_FOREST = 101;
const SALT_THICKET = 202;
const SALT_OVERFLOW = 303;

/**
 * Section 20 growth step number `tick` (1, 2, 3, ...): up to 2 forest tiles, and on every second
 * growth tick up to 1 thicket tile. Forest picks are made first; thicket picks skip them.
 */
export function growthStep(s: LandState, mapSeed: number, tick: number): { forest: number[]; thicket: number[] } {
  const forest = weightedPicks(spreadCandidates(s, Terrain.Forest), FOREST_MAX, mulberry32(tickSeed(mapSeed, SALT_FOREST, tick)));
  let thicket: number[] = [];
  if (tick % 2 === 0) {
    const taken = new Set(forest);
    const cands = spreadCandidates(s, Terrain.Thicket).filter((c) => !taken.has(c.i));
    thicket = weightedPicks(cands, THICKET_MAX, mulberry32(tickSeed(mapSeed, SALT_THICKET, tick)));
  }
  return { forest, thicket };
}

/**
 * Section 20 overflow step number `tick`: up to 2 open meadow tiles touching water become marsh
 * (weighted by water neighbours), empty land only. Then, about one overflow in three, one gravel
 * tile on an empty meadow tile beside the flooded tiles (LOCKED ruling 4 with Stu's clarification).
 */
export function overflowStep(s: LandState, mapSeed: number, tick: number): { marsh: number[]; gravel: number | null } {
  const rng = mulberry32(tickSeed(mapSeed, SALT_OVERFLOW, tick));
  const marsh = weightedPicks(spreadCandidates(s, Terrain.Water), OVERFLOW_MAX, rng);
  if (marsh.length === 0) return { marsh, gravel: null };
  if (rng() >= GRAVEL_CHANCE) return { marsh, gravel: null };
  const prot = protectedTiles(s);
  const flooded = new Set(marsh);
  const spots = new Set<number>();
  for (const i of marsh) {
    const x = i % MAP_W;
    const y = (i / MAP_W) | 0;
    for (const [dx, dy] of N4) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inMap(nx, ny)) continue;
      const j = ny * MAP_W + nx;
      if (!flooded.has(j) && !prot[j] && isOpenLand(s, j)) spots.add(j);
    }
  }
  const list = [...spots].sort((a, b) => a - b);
  if (!list.length) return { marsh, gravel: null };
  return { marsh, gravel: list[Math.floor(rng() * list.length) % list.length] };
}

/** Applies spread or flooding to copies of the arrays; returns the new arrays. */
export function applyLand(s: LandState, changes: LandChange[], gravelAt: number | null): { tiles: Uint8Array; cleared: Uint8Array; gravel: Uint8Array } {
  const tiles = s.tiles.slice();
  const cleared = s.cleared.slice();
  const gravel = s.gravel.slice();
  for (const c of changes) {
    tiles[c.i] = c.to;
    cleared[c.i] = 0; // grown or flooded land is the real thing again (Section 20)
  }
  if (gravelAt !== null) gravel[gravelAt] = 1;
  return { tiles, cleared, gravel };
}
