// Terrain variant manifest and placement rules (Build Spec v1.5, Section 3, "Terrain variant
// organization"). Pure logic: no Pixi, no React, so it can be unit-tested.
//
// ADDING A VARIANT LATER: put the new Gemini JPG (e.g. terrain-water-2.jpg) through
// scripts/art/process_art.py, which writes its PNG and its size/anchor data into
// src/assets/terrain/, then add ONE line to VARIANTS below. Nothing else changes.
//
// The five rules:
//  1. Deterministic: a tile's variant comes only from the map seed and the tile's coordinates,
//     through a hash. Variants are never saved; a reload never reshuffles the ground.
//  2. Weighted: default weights 4, 2, 2, 1 for variants 1 to 4. Calm variants carry the map.
//     Meadow uses 8, 4, 4, 1 (Stu ruling, Nov 20, 2026) so the pale patch is about 6 percent.
//  3. Regional drift: a low-frequency noise value (one per roughly 6 x 6 tiles) raises or lowers
//     "drift" variants, so flower and tree density change gradually across the map.
//  4. Position rules override weights: some variants may only appear in certain places.
//  5. Mirroring: any variant may be flipped horizontally, decided by the same hash.

import { fbm } from '../game/terrain';
import { MAP_H, MAP_W, Terrain, type TerrainName } from '../game/types';

/**
 * Where a variant may appear (rule 4). A variant with a position tag appears ONLY where its
 * condition holds, and there its weight is multiplied by `boost`.
 */
export type PositionTag =
  | 'forestEdge' // forest clearing: only where forest borders another terrain
  | 'thicketSurrounded' // densest thicket: only where all 4 orthogonal neighbours are thicket
  | 'hillCentre' // rockiest hill: only where all 8 neighbours are hill (patch interior)
  | 'nextToWater' // wettest marsh: only next to water
  | 'awayFromWater' // driest marsh: only where no neighbour is water
  | 'riverPath' // flowing-ripple water: only on narrow river water
  | 'wideWater' // calmest water: only on wide or still water
  | 'waterEdge'; // water bank with reeds: only on water next to land (4 neighbours)

export interface VariantEntry {
  /** Matches the processed art (terrain.json "variants" key), e.g. "forest-2". */
  id: string;
  type: TerrainName;
  /** Rule 2: relative weight. */
  weight: number;
  /** Rule 3: +1 = more common where the regional value is high, -1 = where it is low. */
  drift?: 1 | -1;
  /** Rule 4: placement restriction, and the weight multiplier where it applies. */
  where?: PositionTag;
  boost?: number;
  /** Short note for people reading this file. */
  note: string;
}

// prettier-ignore
export const VARIANTS: VariantEntry[] = [
  // Meadow. Regional value = flower density. Weights 8, 4, 4, 1 (Section 3, Stu ruling).
  { id: 'meadow-1', type: 'meadow', weight: 8, drift: -1, note: 'calm grass, a few flowers' },
  { id: 'meadow-2', type: 'meadow', weight: 4, drift: 1, note: 'flower-rich (accent)' },
  { id: 'meadow-3', type: 'meadow', weight: 4, drift: -1, note: 'plainest grass' },
  { id: 'meadow-4', type: 'meadow', weight: 1, drift: 1, note: 'pale patch with pink flowers (accent)' },
  // Forest. Regional value = tree density.
  { id: 'forest-1', type: 'forest', weight: 4, drift: 1, note: 'dense stand' },
  { id: 'forest-2', type: 'forest', weight: 2, where: 'forestEdge', boost: 2, note: 'clearing: four trees' },
  { id: 'forest-3', type: 'forest', weight: 2, drift: 1, note: 'dense mixed stand' },
  { id: 'forest-4', type: 'forest', weight: 1, drift: -1, note: 'open, saplings and bushes' },
  // Hill.
  { id: 'hill-1', type: 'hill', weight: 4, note: 'ochre mound with rocks' },
  { id: 'hill-2', type: 'hill', weight: 2, note: 'small mound' },
  { id: 'hill-3', type: 'hill', weight: 2, note: 'two mounds' },
  { id: 'hill-4', type: 'hill', weight: 1, where: 'hillCentre', boost: 3, note: 'rockiest crag' },
  // Marsh.
  { id: 'marsh-1', type: 'marsh', weight: 4, note: 'reeds and pools' },
  { id: 'marsh-2', type: 'marsh', weight: 2, where: 'nextToWater', note: 'wettest: one big pool' },
  { id: 'marsh-3', type: 'marsh', weight: 2, where: 'awayFromWater', note: 'driest: grass and reeds' },
  { id: 'marsh-4', type: 'marsh', weight: 1, note: 'pools with lily pads' },
  // Thicket.
  { id: 'thicket-1', type: 'thicket', weight: 4, note: 'brambles' },
  { id: 'thicket-2', type: 'thicket', weight: 2, note: 'brambles with bare branches' },
  { id: 'thicket-3', type: 'thicket', weight: 2, note: 'brambles with berries' },
  { id: 'thicket-4', type: 'thicket', weight: 1, where: 'thicketSurrounded', boost: 3, note: 'densest' },
  // Water: the four Gemini variants (v2.0: water-2 to water-4 delivered Nov 20, 2026).
  { id: 'water-1', type: 'water', weight: 4, note: 'river water' },
  { id: 'water-2', type: 'water', weight: 2, where: 'riverPath', boost: 2, note: 'flowing ripples: on the river path' },
  { id: 'water-3', type: 'water', weight: 1, where: 'waterEdge', note: 'bank with reeds: water beside land' },
  { id: 'water-4', type: 'water', weight: 2, where: 'wideWater', boost: 2, note: 'calm glassy: wide or still water' },
];

const TYPE_CODE: Record<TerrainName, number> = {
  meadow: Terrain.Meadow,
  forest: Terrain.Forest,
  hill: Terrain.Hill,
  marsh: Terrain.Marsh,
  thicket: Terrain.Thicket,
  water: Terrain.Water,
};

/** Variants per terrain code, in manifest order. */
export const VARIANTS_BY_CODE: VariantEntry[][] = (() => {
  const out: VariantEntry[][] = [[], [], [], [], [], []];
  for (const v of VARIANTS) out[TYPE_CODE[v.type]].push(v);
  return out;
})();

/** Rule 1: stable integer hash of (seed, x, y, salt) to [0, 1). */
export function tileHash(seed: number, x: number, y: number, salt: number): number {
  let h = Math.imul(x + 1, 0x27d4eb2d) ^ Math.imul(y + 1, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Rule 3: the slow regional value in [0, 1], about one value per 6 x 6 tiles. */
export function regionalValue(seed: number, x: number, y: number): number {
  const v = fbm(x / 6, y / 6, (seed % 100000) + 4242, 2);
  return Math.min(1, Math.max(0, (v - 0.3) / 0.4));
}

/** Rule 4 conditions. `tiles` is the effective terrain (cleared forest counts as meadow). */
export function positionHolds(tag: PositionTag, tiles: Uint8Array, x: number, y: number): boolean {
  const at = (xx: number, yy: number) => (xx < 0 || yy < 0 || xx >= MAP_W || yy >= MAP_H ? -1 : tiles[yy * MAP_W + xx]);
  const self = at(x, y);
  const n8 = [at(x - 1, y - 1), at(x, y - 1), at(x + 1, y - 1), at(x - 1, y), at(x + 1, y), at(x - 1, y + 1), at(x, y + 1), at(x + 1, y + 1)];
  const n4 = [at(x, y - 1), at(x + 1, y), at(x, y + 1), at(x - 1, y)];
  switch (tag) {
    case 'forestEdge':
      return self === Terrain.Forest && n4.some((t) => t !== -1 && t !== Terrain.Forest);
    case 'thicketSurrounded':
      // Section 3 (Stu ruling, Nov 20, 2026): all 4 orthogonal neighbours, not all 8.
      return self === Terrain.Thicket && n4.every((t) => t === Terrain.Thicket);
    case 'hillCentre':
      return self === Terrain.Hill && n8.every((t) => t === Terrain.Hill);
    case 'nextToWater':
      return n8.some((t) => t === Terrain.Water);
    case 'awayFromWater':
      return !n8.some((t) => t === Terrain.Water);
    case 'riverPath':
      return self === Terrain.Water && n8.filter((t) => t === Terrain.Water).length <= 5;
    case 'wideWater':
      return self === Terrain.Water && n8.every((t) => t === Terrain.Water);
    case 'waterEdge':
      return self === Terrain.Water && n4.some((t) => t !== -1 && t !== Terrain.Water);
  }
}

export interface VariantPick {
  entry: VariantEntry;
  flip: boolean;
}

/** Picks the variant for one tile (rules 1 to 5). */
export function pickVariant(seed: number, tiles: Uint8Array, x: number, y: number): VariantPick {
  const code = tiles[y * MAP_W + x];
  const options = VARIANTS_BY_CODE[code];
  const region = regionalValue(seed, x, y);
  let total = 0;
  const weights = options.map((v) => {
    let w = v.weight;
    if (v.where) w = positionHolds(v.where, tiles, x, y) ? w * (v.boost ?? 1) : 0;
    if (v.drift === 1) w *= 0.25 + 1.5 * region;
    if (v.drift === -1) w *= 1.75 - 1.5 * region;
    total += w;
    return w;
  });
  let r = tileHash(seed, x, y, 1) * total;
  let chosen = options[0];
  for (let i = 0; i < options.length; i++) {
    if (weights[i] <= 0) continue;
    chosen = options[i];
    r -= weights[i];
    if (r < 0) break;
  }
  return { entry: chosen, flip: tileHash(seed, x, y, 2) < 0.5 };
}

/** The whole map's picks, recomputed at every bake (never stored). */
export function planVariants(seed: number, tiles: Uint8Array): VariantPick[] {
  const out: VariantPick[] = new Array(MAP_W * MAP_H);
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) out[y * MAP_W + x] = pickVariant(seed, tiles, x, y);
  return out;
}

/**
 * Effective terrain for rendering and rules (Section 4, v2.0): a cleared forest, cleared thicket
 * or drained marsh tile behaves as meadow.
 */
export function effectiveTiles(tiles: Uint8Array, cleared: Uint8Array): Uint8Array {
  const out = tiles.slice();
  for (let i = 0; i < out.length; i++) {
    if (cleared[i] && (out[i] === Terrain.Forest || out[i] === Terrain.Thicket || out[i] === Terrain.Marsh)) out[i] = Terrain.Meadow;
  }
  return out;
}

// ---------- Section 13 (v2.0): terrain polish art slots ----------
//
// The polish pass needs a small Gemini art commission that is not ready yet: a mountain peak
// for large hill clusters, larger tree and canopy art, and soft marsh and water edge pieces.
// Each piece has its slot here already. DROPPING ONE IN LATER: put the Gemini JPG through
// scripts/art/process_art.py as polish-<name>.jpg; it writes the PNG named in `file` below into
// src/assets/terrain/, and the game uses it on the next build. No code changes. Until a piece
// exists, the bake uses the fallback named in `fallback` (existing approved art, scaled).

export type PolishUse = 'hillPeak' | 'forestCanopy' | 'treeLarge' | 'marshEdge' | 'waterEdge';

export interface PolishArt {
  id: string;
  use: PolishUse;
  /** The processed file name the bake looks for. */
  file: string;
  /** Where the art sits on its tile (fractions of the image), and its size in tile widths. */
  anchorX: number;
  anchorY: number;
  tiles: number;
  /** Existing art used until this piece arrives (a variant id), or null for none. */
  fallback: string | null;
  note: string;
}

// prettier-ignore
export const POLISH_ART: PolishArt[] = [
  { id: 'hill-peak', use: 'hillPeak', file: 'props-hill-peak.png', anchorX: 0.5, anchorY: 0.82, tiles: 2.6, fallback: 'hill-4', note: 'mountain peak for hill patches of 4+ tiles' },
  { id: 'forest-canopy-1', use: 'forestCanopy', file: 'props-forest-canopy-1.png', anchorX: 0.5, anchorY: 0.8, tiles: 1.9, fallback: 'forest-1', note: 'continuous canopy for big forest interiors' },
  { id: 'forest-canopy-2', use: 'forestCanopy', file: 'props-forest-canopy-2.png', anchorX: 0.5, anchorY: 0.8, tiles: 1.9, fallback: 'forest-3', note: 'second canopy piece' },
  { id: 'tree-large-1', use: 'treeLarge', file: 'props-tree-large-1.png', anchorX: 0.5, anchorY: 0.9, tiles: 1.2, fallback: null, note: 'larger single tree for forest edges' },
  { id: 'edge-marsh-1', use: 'marshEdge', file: 'splat-edge-marsh-1.png', anchorX: 0.5, anchorY: 0.5, tiles: 1.6, fallback: null, note: 'soft marsh-to-meadow transition' },
  { id: 'edge-water-1', use: 'waterEdge', file: 'splat-edge-water-1.png', anchorX: 0.5, anchorY: 0.5, tiles: 1.6, fallback: null, note: 'soft water bank transition' },
];
