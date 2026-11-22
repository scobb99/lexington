// Roads and bridges (Build Spec v2.0, Section 4). Pure rules, no rendering.

import { MAP_H, MAP_W, Terrain } from './types';

export const ROAD_COST = { coins: 1 }; // Section 4: 1 Coin per tile
export const BRIDGE_COST = { coins: 3, lumber: 2 }; // Section 4: 3 Coins and 2 Lumber per tile

/** Values in the store's `roads` array. */
export const LINK_NONE = 0;
export const LINK_ROAD = 1;
export const LINK_BRIDGE = 2;

/** Values in the store's `bridgeAxis` array: which way the deck runs (Section 4). */
export const AXIS_NS = 1; // along the grid's north-south axis
export const AXIS_EW = 2; // along the grid's east-west axis

/**
 * Section 4 (v2.0): roads go on meadow, cleared forest, cleared thicket, drained marsh, and
 * hill. Never on forest, thicket, marsh, or water. `changed` = the player cleared or drained it.
 */
export function roadAllowedOn(terrain: number, changed: boolean): boolean {
  if (terrain === Terrain.Meadow || terrain === Terrain.Hill) return true;
  if (terrain === Terrain.Forest || terrain === Terrain.Thicket || terrain === Terrain.Marsh) return changed;
  return false;
}

/**
 * Section 4 (v2.0, Stu ruling Nov 22, 2026): bridges cross water and marsh. A drained marsh
 * tile is meadow, so it takes a road, not a bridge.
 */
export function bridgeAllowedOn(terrain: number, changed: boolean): boolean {
  return terrain === Terrain.Water || (terrain === Terrain.Marsh && !changed);
}

// Section 4: 4-bit neighbour mask. North = 1, East = 2, South = 4, West = 8.
// Grid north is y - 1, east is x + 1, south is y + 1, west is x - 1.
export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;

const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

/**
 * Mask for tile (x, y). `isLink(x, y)` should be true for road and bridge tiles, so roads
 * join onto bridges at the bridge's land ends. Off-map neighbours never link.
 */
export function neighbourMask(x: number, y: number, isLink: (x: number, y: number) => boolean): number {
  const ok = (nx: number, ny: number) => inMap(nx, ny) && isLink(nx, ny);
  return (ok(x, y - 1) ? N : 0) | (ok(x + 1, y) ? E : 0) | (ok(x, y + 1) ? S : 0) | (ok(x - 1, y) ? W : 0);
}

export type RoadShape = 'isolated' | 'end' | 'straight' | 'corner' | 'tee' | 'cross';

/** Names the 16 variants in the six families listed in Section 4. */
export function maskShape(mask: number): RoadShape {
  const bits = (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1);
  if (bits === 0) return 'isolated';
  if (bits === 1) return 'end';
  if (bits === 3) return 'tee';
  if (bits === 4) return 'cross';
  return mask === (N | S) || mask === (E | W) ? 'straight' : 'corner';
}

// ---------- placement checks ----------

export interface MapContext {
  tiles: Uint8Array;
  /** 1 where the player cleared (forest, thicket) or drained (marsh) the tile. */
  cleared: Uint8Array;
  roads: Uint8Array;
  /** True when a building's footprint covers the tile. */
  occupied: (x: number, y: number) => boolean;
}

/**
 * Why a road or bridge tile cannot go here. 'exists' = already a road or bridge (a path may run
 * over it for free). The others are the Section 4 (v2.0) preview reasons.
 */
export type TileProblem = 'bounds' | 'exists' | 'occupied' | 'water' | 'marsh' | 'thicket' | 'forest' | 'notBridgeable';

/** Section 4: why a road cannot go on this tile, or null if it can. */
export function roadProblem(ctx: MapContext, x: number, y: number): TileProblem | null {
  if (!inMap(x, y)) return 'bounds';
  const i = y * MAP_W + x;
  if (ctx.roads[i] !== LINK_NONE) return 'exists';
  if (ctx.occupied(x, y)) return 'occupied';
  const t = ctx.tiles[i];
  const changed = ctx.cleared[i] === 1;
  if (roadAllowedOn(t, changed)) return null;
  if (t === Terrain.Water) return 'water';
  if (t === Terrain.Marsh) return 'marsh';
  if (t === Terrain.Thicket) return 'thicket';
  return 'forest';
}

/** Section 4: why a bridge cannot go on this tile, or null if it can. */
export function bridgeProblem(ctx: MapContext, x: number, y: number): TileProblem | null {
  if (!inMap(x, y)) return 'bounds';
  const i = y * MAP_W + x;
  if (ctx.roads[i] !== LINK_NONE) return 'exists';
  if (ctx.occupied(x, y)) return 'occupied';
  return bridgeAllowedOn(ctx.tiles[i], ctx.cleared[i] === 1) ? null : 'notBridgeable';
}

/**
 * Section 4: "Deck orientation follows the crossing direction at placement."
 * A bridge dragged across the river runs in the drag direction. A single bridge tile follows
 * an existing road or bridge beside it, and otherwise crosses the water or marsh the short way.
 */
export function bridgeAxisFor(ctx: MapContext, x: number, y: number, dragAxis: number | null): number {
  if (dragAxis === AXIS_NS || dragAxis === AXIS_EW) return dragAxis;
  const link = (xx: number, yy: number) => inMap(xx, yy) && ctx.roads[yy * MAP_W + xx] !== LINK_NONE;
  const ns = link(x, y - 1) || link(x, y + 1);
  const ew = link(x - 1, y) || link(x + 1, y);
  if (ns && !ew) return AXIS_NS;
  if (ew && !ns) return AXIS_EW;
  const wet = (xx: number, yy: number) => {
    const i = yy * MAP_W + xx;
    return bridgeAllowedOn(ctx.tiles[i], ctx.cleared[i] === 1);
  };
  const run = (dx: number, dy: number) => {
    let n = 1;
    for (const s of [1, -1]) {
      let xx = x + dx * s;
      let yy = y + dy * s;
      while (inMap(xx, yy) && wet(xx, yy)) {
        n++;
        xx += dx * s;
        yy += dy * s;
      }
    }
    return n;
  };
  return run(0, 1) <= run(1, 0) ? AXIS_NS : AXIS_EW;
}

/**
 * A 4-connected line of tiles from a to b (inclusive), so a road dragged quickly is never
 * missing a tile and never joins diagonally.
 */
export function connectTiles(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number }[] {
  const out = [{ x: a.x, y: a.y }];
  let { x, y } = a;
  while (x !== b.x || y !== b.y) {
    const dx = b.x - x;
    const dy = b.y - y;
    if (Math.abs(dx) >= Math.abs(dy)) x += Math.sign(dx);
    else y += Math.sign(dy);
    out.push({ x, y });
  }
  return out;
}

/** The main axis of a dragged path: AXIS_NS, AXIS_EW, or null for a single tile. */
export function pathAxis(path: { x: number; y: number }[]): number | null {
  if (path.length < 2) return null;
  const a = path[0];
  const b = path[path.length - 1];
  return Math.abs(b.y - a.y) > Math.abs(b.x - a.x) ? AXIS_NS : AXIS_EW;
}

// ---------- Section 4 (v2.0): the preview path ----------

export interface Pt {
  x: number;
  y: number;
}

/**
 * Section 4 preview drag rules, as a pure step: the drag reached `tile`. Returns the new path.
 *  - A tile next to the path's end (4-neighbour) joins the path, with no duplicates.
 *  - Dragging back over the tile before the end removes the end.
 *  - A jump of more than one tile adds nothing until the pointer reaches a tile next to the end.
 *  - Off-map tiles never join.
 * Tiles that cannot take a road or bridge DO join the preview sequence (so they render red and
 * the cost bar names them, Section 4), but they are never charged or built: Confirm stays
 * disabled while any is in the path.
 */
export function extendPath(path: Pt[], tile: Pt): Pt[] {
  if (!inMap(tile.x, tile.y)) return path;
  if (path.length === 0) return [tile];
  const end = path[path.length - 1];
  if (end.x === tile.x && end.y === tile.y) return path;
  const prev = path[path.length - 2];
  if (prev && prev.x === tile.x && prev.y === tile.y) return path.slice(0, -1);
  const adjacent = Math.abs(end.x - tile.x) + Math.abs(end.y - tile.y) === 1;
  if (!adjacent) return path;
  if (path.some((p) => p.x === tile.x && p.y === tile.y)) return path; // no duplicates
  return [...path, tile];
}
