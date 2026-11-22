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
