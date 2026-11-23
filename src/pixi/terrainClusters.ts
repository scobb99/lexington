// Cluster-aware terrain (Build Spec v2.0, Section 13, terrain polish; Stu's cluster cohesion
// idea of Nov 20, 2026). Pure logic: no Pixi, so it can be unit-tested.
//
// Contiguous patches of the same terrain read as one feature, not separate tiles. For every
// tile this works out which patch it belongs to, how big that patch is, and how deep inside the
// patch the tile sits (1 = on the patch edge). The bake uses it so that:
//  - prop scale and density grow with patch size;
//  - patch interiors get the deep treatment (a continuous canopy for big forests);
//  - a large hill patch (4 or more tiles) gets a mountain peak stamped at its centre.

import { MAP_H, MAP_W, Terrain } from '../game/types';

export interface Clusters {
  /** Patch id per tile (row-major); every tile belongs to exactly one patch. */
  patch: Int32Array;
  /** Tiles in each patch, by patch id. */
  size: number[];
  /** Terrain code of each patch. */
  type: number[];
  /** Steps (4-neighbour) to the nearest tile outside the patch: 1 on the edge, 2 one in, ... */
  depth: Uint8Array;
  /** The patch's centre tile: the deepest tile, ties broken by nearness to the centroid. */
  centre: { x: number; y: number }[];
}

/** Section 13: a hill patch of roughly 4 or more tiles gets the mountain peak treatment. */
export const PEAK_MIN_TILES = 4;
/** A forest patch this big reads as one canopy inside its edge. */
export const CANOPY_MIN_TILES = 6;

export function findClusters(tiles: Uint8Array): Clusters {
  const n = MAP_W * MAP_H;
  const patch = new Int32Array(n).fill(-1);
  const size: number[] = [];
  const type: number[] = [];
  const members: number[][] = [];
  for (let i = 0; i < n; i++) {
    if (patch[i] !== -1) continue;
    const id = size.length;
    const t = tiles[i];
    const list: number[] = [i];
    patch[i] = id;
    for (let q = 0; q < list.length; q++) {
      const j = list[q];
      const x = j % MAP_W;
      const y = (j / MAP_W) | 0;
      const next = [x > 0 ? j - 1 : -1, x < MAP_W - 1 ? j + 1 : -1, y > 0 ? j - MAP_W : -1, y < MAP_H - 1 ? j + MAP_W : -1];
      for (const k of next) {
        if (k < 0 || patch[k] !== -1 || tiles[k] !== t) continue;
        patch[k] = id;
        list.push(k);
      }
    }
    size.push(list.length);
    type.push(t);
    members.push(list);
  }

  // Depth: multi-source BFS from every tile that touches another patch (or the map edge).
  const depth = new Uint8Array(n);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = i % MAP_W;
    const y = (i / MAP_W) | 0;
    const edge =
      x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1 ||
      patch[i - 1] !== patch[i] || patch[i + 1] !== patch[i] || patch[i - MAP_W] !== patch[i] || patch[i + MAP_W] !== patch[i];
    if (edge) {
      depth[i] = 1;
      queue.push(i);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const j = queue[q];
    const x = j % MAP_W;
    const y = (j / MAP_W) | 0;
    for (const k of [x > 0 ? j - 1 : -1, x < MAP_W - 1 ? j + 1 : -1, y > 0 ? j - MAP_W : -1, y < MAP_H - 1 ? j + MAP_W : -1]) {
      if (k < 0 || depth[k] !== 0 || patch[k] !== patch[j]) continue;
      depth[k] = Math.min(255, depth[j] + 1);
      queue.push(k);
    }
  }

  const centre = members.map((list) => {
    let sx = 0;
    let sy = 0;
    for (const j of list) {
      sx += j % MAP_W;
      sy += (j / MAP_W) | 0;
    }
    const cx = sx / list.length;
    const cy = sy / list.length;
    let best = list[0];
    for (const j of list) {
      const d = depth[j] - depth[best];
      const dist = (j % MAP_W - cx) ** 2 + (((j / MAP_W) | 0) - cy) ** 2;
      const bestDist = (best % MAP_W - cx) ** 2 + (((best / MAP_W) | 0) - cy) ** 2;
      if (d > 0 || (d === 0 && dist < bestDist)) best = j;
    }
    return { x: best % MAP_W, y: (best / MAP_W) | 0 };
  });

  return { patch, size, type, depth, centre };
}

/**
 * Section 13: prop scale grows with patch size, so a big forest or hill reads at the same scale
 * as the buildings. 1.0 for a lone tile, rising to about 1.45 for a patch of 16 tiles or more;
 * interior tiles get a little more.
 */
export function propScale(patchSize: number, depth: number): number {
  const grow = Math.min(1, (patchSize - 1) / 15);
  return 1 + 0.35 * grow + (depth >= 2 ? 0.1 : 0);
}

/** Hill patches that get a mountain peak, as their centre tiles. */
export function peakTiles(c: Clusters): { x: number; y: number; size: number }[] {
  const out: { x: number; y: number; size: number }[] = [];
  for (let id = 0; id < c.size.length; id++) {
    if (c.type[id] === Terrain.Hill && c.size[id] >= PEAK_MIN_TILES) out.push({ ...c.centre[id], size: c.size[id] });
  }
  return out;
}

/** Main peak width in tiles for a patch: 2.6 at 4 tiles, growing to 4.6 for big patches. */
export function peakWidth(size: number): number {
  return Math.min(4.6, Math.max(2.6, 1.9 + Math.sqrt(size) * 0.36));
}

/** Patches this big are too large for one peak to read as one feature. */
export const RANGE_MIN_TILES = 40;
/** Extra peaks in a big patch stand at least this far (tiles) from every other peak. */
export const RANGE_SPACING = 7;

export interface PeakSite {
  x: number;
  y: number;
  size: number;
  /** Width of the peak's base in tiles. */
  tiles: number;
  main: boolean;
}

/**
 * The peak art's outline, for keeping it on its own hill. `aspect` is the art's height over its
 * base width (from terrain.json "polish"), `anchorY` the base point as a fraction of the height.
 */
export interface PeakShape {
  aspect: number;
  anchorY: number;
}
/** Measured from the approved Gemini terrain-peak.jpg (768 x 577, base point at 63 percent). */
export const PEAK_SHAPE: PeakShape = { aspect: 577 / 768, anchorY: 0.632 };
/** (v3.0) Peaks keep at least this many tiles from the map edge where the patch allows. */
export const PEAK_EDGE_MARGIN = 2;
/** Narrowest peak for a patch that has room for one, in tiles. */
export const PEAK_MIN_WIDTH = 2.6;
/** Small or thin patches may go down to this so the peak stays on its own hill. */
export const PEAK_SMALL_WIDTH = 2.0;

/**
 * How many tiles outside the hill patch the peak art would cover behind or beside its base, for
 * a peak of `tiles` width standing on (px, py). Those tiles can hold roads and buildings, and
 * anything built there draws over the baked peak (a building behind a mountain would sit on its
 * slope), so a peak is placed where this is 0 whenever the patch allows it. The outline is
 * treated as a triangle from the base corners to the summit; a tile counts when its diamond
 * reaches into it (a tile the base corners only graze does not). Tiles in `keepClear` (the
 * tutorial's marked plots) count even inside the patch.
 */
export function peakOverhang(c: Clusters, id: number, px: number, py: number, tiles: number, shape: PeakShape = PEAK_SHAPE, keepClear?: ReadonlySet<number>): number {
  // Summit height and base half-width in screen pixels; a tile counts when its diamond (32 x 20
  // around its centre) reaches into the outline, so the base is trimmed and the summit raised.
  const half = 32 * tiles * 0.8 + 12;
  const up = 64 * tiles * shape.aspect * shape.anchorY + 26;
  const r = Math.ceil(tiles * 1.6) + 2;
  let bad = 0;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const x = px + dx;
      const y = py + dy;
      if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
      const sx = (dx - dy) * 32;
      const sy = (dx + dy) * 20;
      if (sy > 0 || sy < -up) continue;
      if (Math.abs(sx) > half * (1 + sy / up)) continue;
      if (c.patch[y * MAP_W + x] !== id || keepClear?.has(y * MAP_W + x)) bad++;
    }
  return bad;
}

/**
 * Section 13: every hill patch of 4 or more tiles gets a mountain peak at its centre. Two build
 * interpretations (both flagged in the build report):
 *  - the peak stands on the centre tile when its art fits inside the patch there; otherwise on
 *    the nearest patch tile where it fits, narrowing toward 2.6 tiles (2.0 for a small or thin
 *    patch) if it must. It only moves off the centre so the art does not cover open ground
 *    behind it (where a road or building would draw over the mountain). A patch too small or
 *    thin to hold it anywhere keeps the tile with the least overhang.
 *  - a patch of 40 or more tiles also gets smaller peaks on its deep interior (depth 3 or more,
 *    at least 7 tiles from every other peak, about one per 45 tiles, at most 4 extra), each
 *    only where it fits, so a very large hill region reads as a range rather than one small
 *    peak lost in a field of mounds.
 */
export function peakSites(c: Clusters, shape: PeakShape = PEAK_SHAPE, keepClear?: ReadonlySet<number>): PeakSite[] {
  const out: PeakSite[] = [];
  for (let id = 0; id < c.size.length; id++) {
    if (c.type[id] !== Terrain.Hill || c.size[id] < PEAK_MIN_TILES) continue;
    const size = c.size[id];
    const centre = c.centre[id];
    const tilesOf: { x: number; y: number; d: number }[] = [];
    for (let i = 0; i < c.patch.length; i++) if (c.patch[i] === id) tilesOf.push({ x: i % MAP_W, y: (i / MAP_W) | 0, d: c.depth[i] });
    const near = (p: { x: number; y: number }) => Math.hypot(p.x - centre.x, p.y - centre.y);
    tilesOf.sort((a, b) => near(a) - near(b) || b.d - a.d || a.y - b.y || a.x - b.x);

    let main: PeakSite | null = null;
    const widest = peakWidth(size);
    const widths: number[] = [];
    for (let w = widest; w > PEAK_MIN_WIDTH; w -= 0.3) widths.push(w);
    widths.push(PEAK_MIN_WIDTH, 2.3, PEAK_SMALL_WIDTH);
    for (const w of widths) {
      if (main) break;
      // (v3.0, Stu's art note in the LOCKED amendment) Peaks stay a tile or two in from the map
      // edge where the patch allows: a fitting tile at least 2 tiles from every edge comes first.
      const inner = (p: { x: number; y: number }) => Math.min(p.x, p.y, MAP_W - 1 - p.x, MAP_H - 1 - p.y) >= PEAK_EDGE_MARGIN;
      const fits = (p: { x: number; y: number }) => peakOverhang(c, id, p.x, p.y, w, shape, keepClear) === 0;
      const fit = tilesOf.find((p) => inner(p) && fits(p)) ?? tilesOf.find(fits);
      if (fit) main = { x: fit.x, y: fit.y, size, tiles: w, main: true };
    }
    if (!main) {
      let best = tilesOf[0];
      let least = Infinity;
      for (const p of tilesOf) {
        const o = peakOverhang(c, id, p.x, p.y, PEAK_SMALL_WIDTH, shape, keepClear);
        if (o < least) {
          least = o;
          best = p;
        }
      }
      main = { x: best.x, y: best.y, size, tiles: PEAK_SMALL_WIDTH, main: true };
    }
    out.push(main);
    if (size < RANGE_MIN_TILES) continue;
    const extra = Math.min(4, Math.floor(size / 45));
    const mine: { x: number; y: number }[] = [main];
    const cands = tilesOf.filter((p) => p.d >= 3).sort((a, b) => b.d - a.d || a.y - b.y || a.x - b.x);
    for (const p of cands) {
      if (mine.length > extra) break;
      if (mine.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < RANGE_SPACING)) continue;
      const w = [Math.min(3.4, 2.2 + p.d * 0.2), 2.4].find((t) => peakOverhang(c, id, p.x, p.y, t, shape, keepClear) === 0);
      if (w === undefined) continue;
      mine.push(p);
      out.push({ x: p.x, y: p.y, size, tiles: w, main: false });
    }
  }
  return out;
}
