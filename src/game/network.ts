// (v3.0) The road network: road and bridge pieces, the banks, connectivity rooted at the town
// center, bridge landings, the removal cascade, and High Street corridors (Build Spec v3.0,
// Sections 4, 18 and 19). Pure rules: no React, no Pixi, no store.

import { BUILDINGS, buildingAt, effectiveAt } from './buildings';
import { AXIS_BOTH, AXIS_EW, AXIS_NS, LINK_BRIDGE, LINK_NONE, LINK_ROAD, bridgeAllowedOn, roadAllowedOn, type Pt } from './roads';
import { MAP_H, MAP_W, Terrain, type Building, type BuildingType, type Resources } from './types';

export type PieceKind = 'road' | 'bridge';
/** Section 4: pieces come in fixed straight lengths of 3, 4 or 5 tiles. */
export const PIECE_LENGTHS = [3, 4, 5] as const;
export type PieceLen = (typeof PIECE_LENGTHS)[number];
/** The four grid directions, in the order the rotate button cycles them: east, south, west, north. */
export type Dir = 0 | 1 | 2 | 3;
export const DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
export const DIR_NAMES = ['east', 'south', 'west', 'north'];

/**
 * A placed piece. Its tiles run from (x, y) `len` tiles in direction `dir`. The map remembers
 * piece boundaries (Section 4), so removal always takes a whole piece.
 * `legacy` marks a single road or bridge tile carried over from a version 2 save (Section 11
 * grandfathering): it was never bought as a piece, so removing it returns nothing to a bank.
 */
export interface Piece {
  id: number;
  kind: PieceKind;
  x: number;
  y: number;
  dir: Dir;
  len: number;
  legacy?: boolean;
  /** Legacy bridge tiles keep their saved deck direction. */
  axis?: 1 | 2;
}

export type Bank = Record<PieceLen, number>;
export const emptyBank = (): Bank => ({ 3: 0, 4: 0, 5: 0 });

const res = (coins: number, lumber = 0): Resources => ({ coins, lumber, stone: 0, knowledge: 0, magic: 0 });

/**
 * Section 4 piece prices (proposed: the v2.0 per-tile rates summed). Road: 3, 4, 5 Coins.
 * Bridge: 9 Coins and 6 Lumber, 12 and 8, 15 and 10. Charged once, at the purchase.
 */
export const PIECE_PRICE: Record<PieceKind, Record<PieceLen, Resources>> = {
  road: { 3: res(3), 4: res(4), 5: res(5) },
  bridge: { 3: res(9, 6), 4: res(12, 8), 5: res(15, 10) },
};

const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
const N4: readonly (readonly [number, number])[] = DIRS;

/** The tiles of a piece, first tile first. */
export function pieceTiles(p: { x: number; y: number; dir: Dir; len: number }): Pt[] {
  const [dx, dy] = DIRS[p.dir];
  return Array.from({ length: p.len }, (_, k) => ({ x: p.x + dx * k, y: p.y + dy * k }));
}

/** The link grids the renderer and the placement rules read, rebuilt from the pieces. */
export function gridsFromPieces(pieces: Piece[]): { roads: Uint8Array; bridgeAxis: Uint8Array; pieceAt: Int32Array } {
  const roads = new Uint8Array(MAP_W * MAP_H);
  const bridgeAxis = new Uint8Array(MAP_W * MAP_H);
  const pieceAt = new Int32Array(MAP_W * MAP_H);
  // (v3.0.2) Pieces may share tiles (crossings; see sharedTiles). A tile stays on the map while
  // any piece covers it; pieceAt names the most recently laid piece on it (the one a tap removes).
  // A bridge tile crossed by bridges along both axes draws both decks (AXIS_BOTH).
  for (const p of pieces) {
    const axis = p.axis ?? (p.dir === 0 || p.dir === 2 ? AXIS_EW : AXIS_NS);
    for (const t of pieceTiles(p)) {
      if (!inMap(t.x, t.y)) continue;
      const i = t.y * MAP_W + t.x;
      roads[i] = p.kind === 'road' ? LINK_ROAD : LINK_BRIDGE;
      if (p.kind === 'bridge') bridgeAxis[i] = bridgeAxis[i] && bridgeAxis[i] !== axis ? AXIS_BOTH : axis;
      pieceAt[i] = p.id;
    }
  }
  return { roads, bridgeAxis, pieceAt };
}

// ---------- connectivity (Section 4; Section 10: a store computation, never per frame) ----------

/** The town center's footprint tiles, as tile indices. */
export function centerTiles(buildings: Building[]): number[] {
  const tc = buildings.find((b) => b.type === 'townCenter' && !b.preview);
  if (!tc) return [];
  const d = BUILDINGS.townCenter;
  const out: number[] = [];
  for (let y = tc.y; y < tc.y + d.h; y++) for (let x = tc.x; x < tc.x + d.w; x++) if (inMap(x, y)) out.push(y * MAP_W + x);
  return out;
}

/**
 * Section 4: the network. 1 for every town center tile and every road or bridge tile joined
 * orthogonally to the town center through other road and bridge tiles. A flood fill.
 */
export function computeNetwork(roads: Uint8Array, buildings: Building[]): Uint8Array {
  const net = new Uint8Array(MAP_W * MAP_H);
  const queue: number[] = [];
  for (const i of centerTiles(buildings)) {
    net[i] = 1;
    queue.push(i);
  }
  while (queue.length) {
    const i = queue.pop()!;
    const x = i % MAP_W;
    const y = (i / MAP_W) | 0;
    for (const [dx, dy] of N4) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inMap(nx, ny)) continue;
      const j = ny * MAP_W + nx;
      if (net[j] || roads[j] === LINK_NONE) continue;
      net[j] = 1;
      queue.push(j);
    }
  }
  return net;
}

/** The tiles around a footprint (its four sides), in the map or not. */
export function footprintRing(b: { x: number; y: number }, w: number, h: number): Pt[] {
  const ring: Pt[] = [];
  for (let x = b.x; x < b.x + w; x++) ring.push({ x, y: b.y - 1 }, { x, y: b.y + h });
  for (let y = b.y; y < b.y + h; y++) ring.push({ x: b.x - 1, y }, { x: b.x + w, y });
  return ring;
}

/** Section 4: a building is connected when a side of its footprint touches the network. */
export function buildingConnected(b: Building, net: Uint8Array): boolean {
  if (b.type === 'townCenter') return true;
  const d = BUILDINGS[b.type];
  return footprintRing(b, d.w, d.h).some((t) => inMap(t.x, t.y) && net[t.y * MAP_W + t.x] === 1);
}

// ---------- placing a piece (Section 4: pick, rotate, ghost, confirm) ----------

export interface PieceContext {
  tiles: Uint8Array;
  cleared: Uint8Array;
  roads: Uint8Array;
  gravel: Uint8Array;
  buildings: Building[];
  /** The current network (computeNetwork). */
  net: Uint8Array;
}

export interface PieceCheck {
  ok: boolean;
  /** The first matching reason, Section 4 order (terrain reasons first, then connectivity). */
  reason: string | null;
  /** Tiles that are themselves illegal (drawn red); empty when only connectivity fails. */
  badTiles: Pt[];
}

/**
 * (v3.0.2) The overlap rule, settled with Boone (Nov 23, 2026): a piece may cross or run over
 * tiles already laid by pieces of its own kind (road over road, bridge over bridge). A shared tile
 * is one network tile (a junction where the pieces cross); the piece still costs what it cost to
 * buy, and its shared tiles are simply already there. A piece must lay at least one new tile.
 * A road can never share a tile with a bridge, so every tile always suits every piece on it.
 */
export const REASON_ROAD_ON_BRIDGE = 'That tile is a bridge. A road piece can cross roads, not bridges.';
export const REASON_BRIDGE_ON_ROAD = 'That tile is a road. A bridge piece can cross bridges, not roads.';
export const REASON_NOTHING_NEW = { road: 'That road is already there.', bridge: 'That bridge is already there.' } as const;

/** (v3.0.2) True when this tile already holds a laid tile of the same kind (a crossing tile). */
function sharesTile(ctx: PieceContext, kind: PieceKind, i: number): boolean {
  return ctx.roads[i] === (kind === 'road' ? LINK_ROAD : LINK_BRIDGE);
}

/** Section 4: why one tile cannot take this kind of piece, or null. */
function tileReason(ctx: PieceContext, kind: PieceKind, x: number, y: number): string | null {
  if (!inMap(x, y)) return 'Part of the piece is off the map.';
  const i = y * MAP_W + x;
  if (buildingAt(ctx.buildings, x, y)) return 'That tile is already built on.';
  if (sharesTile(ctx, kind, i)) return null; // (v3.0.2) a crossing: the tile is already there
  if (ctx.roads[i] !== LINK_NONE) return kind === 'road' ? REASON_ROAD_ON_BRIDGE : REASON_BRIDGE_ON_ROAD;
  const t = ctx.tiles[i];
  const changed = ctx.cleared[i] === 1;
  if (kind === 'bridge') return bridgeAllowedOn(t, changed) ? null : 'Bridges need water or marsh.';
  if (ctx.gravel[i] === 1) return 'That tile is gravel. Clear it first.';
  if (roadAllowedOn(t, changed)) return null;
  if (t === Terrain.Water) return 'That tile is water. Water needs a bridge.';
  if (t === Terrain.Marsh) return 'That tile is marsh. Marsh needs a bridge, or drain it from Tier 2.';
  if (t === Terrain.Thicket) return 'That tile is thicket. Clear it first.';
  return 'That tile is forest. Clear it first.';
}

/** Section 4: the road connectivity reason. */
export const REASON_ROAD_CONNECT = 'Roads must connect to your network.';
/** Section 4 (proposed wording): the bridge landing reason. */
export const REASON_BRIDGE_LAND = 'A bridge must land on a road or on land at one end.';

/** True for plain land: not water, and not undrained marsh (Section 4 bridge landings). */
function isLand(ctx: PieceContext, i: number): boolean {
  const t = effectiveAt(ctx.tiles, ctx.cleared, i);
  return t !== Terrain.Water && t !== Terrain.Marsh;
}

/**
 * Section 4: green or red for a piece of `len` tiles from `anchor` in direction `dir`. Terrain
 * and occupancy reasons come first (the first tile that fails), then connectivity:
 *  - a road piece needs at least one tile orthogonally beside the network (a connected road or
 *    bridge tile, or the town center's footprint);
 *  - a bridge piece must land: one of its two end tiles beside a connected road, the town center,
 *    any road or bridge tile on the map, or plain land.
 */
export function checkPiece(ctx: PieceContext, kind: PieceKind, anchor: Pt, dir: Dir, len: number): PieceCheck {
  const tiles = pieceTiles({ x: anchor.x, y: anchor.y, dir, len });
  const bad: Pt[] = [];
  let reason: string | null = null;
  for (const t of tiles) {
    const r = tileReason(ctx, kind, t.x, t.y);
    if (r) {
      bad.push(t);
      reason ??= r;
    }
  }
  if (reason) return { ok: false, reason, badTiles: bad };
  // (v3.0.2) A piece that lies wholly on tiles already laid adds nothing.
  if (tiles.every((t) => sharesTile(ctx, kind, t.y * MAP_W + t.x))) return { ok: false, reason: REASON_NOTHING_NEW[kind], badTiles: tiles };
  const own = new Set(tiles.map((t) => t.y * MAP_W + t.x));
  // A shared tile that is already on the network joins the piece to it directly.
  const sharesNet = tiles.some((t) => ctx.net[t.y * MAP_W + t.x] === 1);
  const around = (t: Pt, test: (j: number) => boolean) =>
    N4.some(([dx, dy]) => {
      const nx = t.x + dx;
      const ny = t.y + dy;
      if (!inMap(nx, ny)) return false;
      const j = ny * MAP_W + nx;
      return !own.has(j) && test(j);
    });
  if (kind === 'road') {
    const joins = sharesNet || tiles.some((t) => around(t, (j) => ctx.net[j] === 1));
    return joins ? { ok: true, reason: null, badTiles: [] } : { ok: false, reason: REASON_ROAD_CONNECT, badTiles: [] };
  }
  const ends = [tiles[0], tiles[tiles.length - 1]];
  const centre = new Set(centerTiles(ctx.buildings));
  const lands =
    sharesNet || ends.some((t) => ctx.roads[t.y * MAP_W + t.x] !== LINK_NONE) || ends.some((t) => around(t, (j) => ctx.net[j] === 1 || centre.has(j) || ctx.roads[j] !== LINK_NONE || isLand(ctx, j)));
  return lands ? { ok: true, reason: null, badTiles: [] } : { ok: false, reason: REASON_BRIDGE_LAND, badTiles: [] };
}

// ---------- removal and the cascade (Section 4; LOCKED rulings 2 and 9) ----------

/**
 * (v3.0.2) The tiles of a piece that another laid piece also covers. They stay on the map when
 * this piece is removed (a tile belongs to the network, not to one piece).
 */
export function sharedTiles(pieces: Piece[], piece: Piece): Pt[] {
  const others = gridsFromPieces(pieces.filter((p) => p.id !== piece.id)).roads;
  return pieceTiles(piece).filter((t) => inMap(t.x, t.y) && others[t.y * MAP_W + t.x] !== LINK_NONE);
}

/**
 * The buildings that lose their connection when this piece leaves the map: connected before and
 * not after. Landmarks are exempt (Section 21), the town center never cascades, and a building
 * that was already disconnected (grandfathered, Section 11) is not touched.
 */
export function cascadeFor(pieces: Piece[], removeId: number, buildings: Building[]): Building[] {
  const before = computeNetwork(gridsFromPieces(pieces).roads, buildings);
  const after = computeNetwork(gridsFromPieces(pieces.filter((p) => p.id !== removeId)).roads, buildings);
  return buildings.filter(
    (b) => !b.preview && b.type !== 'townCenter' && b.type !== 'landmark' && buildingConnected(b, before) && !buildingConnected(b, after),
  );
}

// ---------- the High Street (Section 19) ----------

/** Section 19: a corridor is at least 6 tiles (proposed: longer runs count once). */
export const CORRIDOR_MIN = 6;
/** Section 19: the bonus caps at plus 3 (proposed). */
export const HIGH_STREET_CAP = 3;

export interface Corridor {
  tiles: Pt[];
  /** Distinct building types standing beside it (landmarks are not counted). */
  types: BuildingType[];
}

/**
 * Section 19: straight, unbroken runs of road or bridge tiles in one row or column, 6 or more
 * long, containing no junction tile (3 or more road or bridge neighbours) and no gap. Build
 * reading: only network tiles count (a stranded piece connects nothing, Section 4).
 */
export function findCorridors(roads: Uint8Array, net: Uint8Array, buildings: Building[]): Corridor[] {
  const link = (x: number, y: number) => inMap(x, y) && roads[y * MAP_W + x] !== LINK_NONE;
  const degree = (x: number, y: number) => N4.filter(([dx, dy]) => link(x + dx, y + dy)).length;
  const good = (x: number, y: number) => link(x, y) && net[y * MAP_W + x] === 1 && degree(x, y) <= 2;
  const runs: Pt[][] = [];
  const scan = (outer: number, inner: number, at: (o: number, k: number) => Pt) => {
    for (let o = 0; o < outer; o++) {
      let run: Pt[] = [];
      for (let k = 0; k <= inner; k++) {
        const p = k < inner ? at(o, k) : null;
        if (p && good(p.x, p.y)) run.push(p);
        else {
          if (run.length >= CORRIDOR_MIN) runs.push(run);
          run = [];
        }
      }
    }
  };
  scan(MAP_H, MAP_W, (y, x) => ({ x, y }));
  scan(MAP_W, MAP_H, (x, y) => ({ x, y }));
  const real = buildings.filter((b) => !b.preview && b.type !== 'landmark');
  return runs.map((tiles) => {
    const set = new Set(tiles.map((t) => t.y * MAP_W + t.x));
    const types = new Set<BuildingType>();
    for (const b of real) {
      const d = BUILDINGS[b.type];
      if (footprintRing(b, d.w, d.h).some((t) => inMap(t.x, t.y) && set.has(t.y * MAP_W + t.x))) types.add(b.type);
    }
    return { tiles, types: [...types] };
  });
}

/** Section 19: the effective-length bonus now (the best corridor, capped at plus 3). */
export function highStreetBonus(corridors: Corridor[]): number {
  return corridors.reduce((m, c) => Math.max(m, Math.min(HIGH_STREET_CAP, c.types.length)), 0);
}

/** Section 21 River Bell: the longest straight run of bridge tiles through this tile, along `dir`. */
export function bridgeRunThrough(roads: Uint8Array, x: number, y: number, dir: Dir): number {
  const [dx, dy] = DIRS[dir];
  let n = 1;
  for (const s of [1, -1]) {
    let xx = x + dx * s;
    let yy = y + dy * s;
    while (inMap(xx, yy) && roads[yy * MAP_W + xx] === LINK_BRIDGE) {
      n++;
      xx += dx * s;
      yy += dy * s;
    }
  }
  return n;
}
