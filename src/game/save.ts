// Save format (Build Spec v3.0, Section 11). Pure rules: no IndexedDB, no React, no Pixi.
//
// A save holds exactly the Section 11 fields: format version, map seed, every tile change
// from the generated base map, buildings (type and position), the five resource balances, rack
// letters, rerolls held, tier, lifetime totals, the last 10 submitted words, quest completion
// state, and camera position and zoom. Happiness and population are NOT saved: they are
// recalculated from the buildings on load (Section 8). Hint state, swap selections, road and
// bridge previews and the placement ghost are never saved.
//
// Version 2 (v2.0): tile changes gain cleared thicket and drained marsh, and roads can no longer
// stand on marsh. A version 1 save loads through MIGRATIONS[1].
//
// Version 3 (v3.0): the town center's position; road and bridge PIECES (with the banks) in place
// of single road and bridge tiles; dynamic terrain changes and flood gravel (Section 20); the three
// open Commission orders; stamps; Lanterns; the Rune; the Reserve Shelf; landmarks; the terrain
// counters; lifetime orders completed and stamped words. A version 2 save loads through
// MIGRATIONS[2] (Section 11): a town center is founded near the middle of the map, existing roads
// and buildings are grandfathered, the rack is resized from buildings ever built, the new systems
// start at their new-game defaults, and landmarks are granted retroactively.
//
// Loading never trusts a file blindly. parseSave() checks every field and rebuilds the map
// from the seed before anything is applied, so a damaged or hand-edited save fails with a
// plain message instead of loading silently into a broken map (Section 11).

import { BUILDINGS, placementProblem, population } from './buildings';
import { NAME } from './config';
import { landmarksEarnedBy, LANDMARK_ORDER } from './landmarks';
import { PIECE_LENGTHS, emptyBank, gridsFromPieces, pieceTiles, type Bank, type Dir, type Piece, type PieceKind } from './network';
import { allConditions, condKey, type Order, type OrderCond, type RewardRes } from './orders';
import { QUESTS } from './progress';
import { bridgeAllowedOn, bridgeAxisFor, roadAllowedOn } from './roads';
import { emptyCounters, type StampCounters } from './stamps';
import { generateTerrain } from './terrain';
import {
  MAP_H,
  MAP_W,
  RESOURCE_KEYS,
  STAMP_KINDS,
  Terrain,
  type Building,
  type BuildingType,
  type LandmarkId,
  type Lifetime,
  type Resources,
  type StampKind,
  type TerrainMap,
  type Tier,
} from './types';
import { LANTERN_MAX, LANTERN_START, RACK_MAX, rackSizeFor } from './words';

/**
 * Identifies a save file (so a random JSON file is refused with a clear message). The value
 * keeps the game's working name so every save made before the rename still loads.
 */
export const SAVE_FORMAT = 'wordcity-save';
/** Section 11: the save format version number. v3.0 raises it to 3. */
export const SAVE_VERSION = 3;

/** Camera saved as the world point at the centre of the view, so it fits any screen size. */
export interface SavedCamera {
  centreX: number;
  centreY: number;
  zoom: number;
}

export interface SavedPiece {
  kind: PieceKind;
  x: number;
  y: number;
  dir: Dir;
  len: number;
  /** A single tile carried over from a version 2 save (grandfathered; never bought as a piece). */
  legacy?: boolean;
  /** Legacy bridge tiles keep their deck direction: 1 = north-south, 2 = east-west. */
  axis?: 1 | 2;
}

export interface SaveData {
  format: typeof SAVE_FORMAT;
  version: 3;
  /** When the save was made (ISO 8601). Shown in the slot list only. */
  savedAt: string;
  /** Section 2: the seed regenerates the base map exactly. `value` double-checks it. */
  seed: { text: string; value: number };
  /** Section 11: every tile change from the generated base map. Tile indices are y * 54 + x. */
  tiles: {
    /** (v3.0) Section 20: tiles whose current terrain differs from the generated map, as [index, terrain]. */
    terrain: [number, number][];
    /** Forest tiles the player cleared (Section 4): now cleared forest. */
    cleared: number[];
    /** Thicket tiles the player cleared: now cleared thicket. */
    clearedThicket: number[];
    /** Marsh tiles the player drained: now meadow. */
    drained: number[];
    /** (v3.0) Section 20: flood gravel deposits. */
    gravel: number[];
    /** Long-word flower patches (Section 5), as [x, y]. Decoration only. */
    flowers: [number, number][];
  };
  /** (v3.0) Section 18: the town center's footprint top-left tile. */
  townCenter: { x: number; y: number };
  /** (v3.0) Section 4: placed road and bridge pieces, and the two banks. */
  pieces: SavedPiece[];
  banks: { road: Bank; bridge: Bank };
  /** Section 11: buildings with type and position (top-left footprint tile); landmarks name themselves. */
  buildings: { type: BuildingType; x: number; y: number; landmark?: LandmarkId }[];
  resources: Resources;
  /** Rack letters, left to right, and (v3.0) the stamp on each (null for none). */
  rack: string[];
  rackStamps: (StampKind | null)[];
  rerolls: number;
  tier: Tier;
  /** Lifetime totals: words submitted, Knowledge and every resource earned, and the Section 9 records. */
  lifetime: Lifetime;
  /** Section 5: the last 10 submitted valid words, oldest first. */
  recentWords: string[];
  /** Section 9: how many quests are complete (0 to 8). The next quest is the one after them. */
  questsCompleted: number;
  /** Section 5 dead rack rule: free redraws given so far (a statistic, kept for continuity). */
  freeRedraws: number;
  /** (v3.0) Section 5: Lanterns held and valid words toward the next. */
  lanterns: { held: number; progress: number };
  /** (v3.0) Section 19: stamp counters per kind and the kinds already announced. */
  stamps: { counters: StampCounters; seen: StampKind[] };
  /** (v3.0) Section 19: whether a Rune is held and the Wizard Tower's charge counter. */
  rune: { held: boolean; counter: number };
  /** (v3.0) Section 19: the Reserve Shelf's letter (and its stamp), if any. */
  shelf: { letter: string; stamp: StampKind | null } | null;
  /** (v3.0) Section 18: the three open orders and the free discard counter. */
  orders: { cond: OrderCond; reward: { res: RewardRes; amount: number }; postedAt: number }[];
  wordsSinceDiscard: number;
  /** (v3.0) Section 21: landmarks earned (placed ones are in the building list). */
  landmarks: LandmarkId[];
  /** (v3.0) Section 20: the dynamic terrain counters. */
  ticks: { sinceGrowth: number; sinceOverflow: number; growthTicks: number; overflowTicks: number };
  camera: SavedCamera;
}

/** The parts of the game a save describes (a subset of GameState). */
export interface SaveSource {
  terrain: TerrainMap;
  baseTiles: Uint8Array;
  /** 1 where the player cleared (forest, thicket) or drained (marsh) the tile. */
  cleared: Uint8Array;
  gravel: Uint8Array;
  pieces: Piece[];
  roadBank: Bank;
  bridgeBank: Bank;
  flowers: { x: number; y: number }[];
  buildings: Building[];
  resources: Resources;
  rack: { letter: string; stamp?: StampKind }[];
  rerolls: number;
  tier: Tier;
  lifetime: Lifetime;
  recentWords: string[];
  questIndex: number;
  freeRerolls: number;
  lanterns: number;
  lanternProgress: number;
  stampCounters: StampCounters;
  stampsSeen: StampKind[];
  rune: { held: boolean; letter: string | null };
  runeCounter: number;
  shelf: { letter: string; stamp?: StampKind } | null;
  orders: Order[];
  wordsSinceDiscard: number;
  landmarksEarned: LandmarkId[];
  ticks: { sinceGrowth: number; sinceOverflow: number; growthTicks: number; overflowTicks: number };
}

/** Builds a save from the current game. Art-showcase buildings are never saved. */
export function makeSave(s: SaveSource, camera: SavedCamera, now: Date = new Date()): SaveData {
  const cleared: number[] = [];
  const clearedThicket: number[] = [];
  const drained: number[] = [];
  const terrain: [number, number][] = [];
  const gravel: number[] = [];
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    const cur = s.terrain.tiles[i];
    if (cur !== s.baseTiles[i]) terrain.push([i, cur]);
    if (s.cleared[i] === 1) {
      if (cur === Terrain.Forest) cleared.push(i);
      else if (cur === Terrain.Thicket) clearedThicket.push(i);
      else if (cur === Terrain.Marsh) drained.push(i);
    }
    if (s.gravel[i] === 1) gravel.push(i);
  }
  const tc = s.buildings.find((b) => b.type === 'townCenter' && !b.preview);
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    savedAt: now.toISOString(),
    seed: { text: s.terrain.seedText, value: s.terrain.seed },
    tiles: { terrain, cleared, clearedThicket, drained, gravel, flowers: s.flowers.map((f) => [f.x, f.y]) },
    townCenter: tc ? { x: tc.x, y: tc.y } : { x: 0, y: 0 },
    pieces: s.pieces.map((p) => ({
      kind: p.kind,
      x: p.x,
      y: p.y,
      dir: p.dir,
      len: p.len,
      ...(p.legacy ? { legacy: true } : {}),
      ...(p.axis ? { axis: p.axis } : {}),
    })),
    banks: { road: { ...s.roadBank }, bridge: { ...s.bridgeBank } },
    buildings: s.buildings
      .filter((b) => !b.preview && b.type !== 'townCenter')
      .map((b) => (b.type === 'landmark' ? { type: b.type, x: b.x, y: b.y, landmark: b.landmark } : { type: b.type, x: b.x, y: b.y })),
    resources: { ...s.resources },
    rack: s.rack.map((t) => t.letter),
    rackStamps: s.rack.map((t) => t.stamp ?? null),
    rerolls: s.rerolls,
    tier: s.tier,
    lifetime: {
      submissions: s.lifetime.submissions,
      validWords: s.lifetime.validWords,
      longWords: s.lifetime.longWords,
      bridgesBuilt: s.lifetime.bridgesBuilt,
      everBuilt: { ...s.lifetime.everBuilt },
      earned: { ...s.lifetime.earned },
      ordersCompleted: s.lifetime.ordersCompleted,
      stampedWords: s.lifetime.stampedWords,
    },
    recentWords: [...s.recentWords],
    questsCompleted: s.questIndex,
    freeRedraws: s.freeRerolls,
    lanterns: { held: s.lanterns, progress: s.lanternProgress },
    stamps: { counters: { ...s.stampCounters }, seen: [...s.stampsSeen] },
    rune: { held: s.rune.held, counter: s.runeCounter },
    shelf: s.shelf ? { letter: s.shelf.letter, stamp: s.shelf.stamp ?? null } : null,
    orders: s.orders.map((o) => ({ cond: { ...o.cond }, reward: { ...o.reward }, postedAt: o.postedAt })),
    wordsSinceDiscard: s.wordsSinceDiscard,
    landmarks: [...s.landmarksEarned],
    ticks: { ...s.ticks },
    // Rounded so a save made, loaded and saved again is identical (no floating-point drift).
    camera: { centreX: round(camera.centreX, 2), centreY: round(camera.centreY, 2), zoom: round(camera.zoom, 4) },
  };
}

function round(v: number, places: number): number {
  const k = 10 ** places;
  return Math.round(v * k) / k;
}

/** What a loaded save turns into: everything a fresh GameState needs from it. */
export interface RestoredGame {
  terrain: TerrainMap;
  baseTiles: Uint8Array;
  cleared: Uint8Array;
  gravel: Uint8Array;
  pieces: Piece[];
  roadBank: Bank;
  bridgeBank: Bank;
  flowers: { x: number; y: number }[];
  buildings: Building[];
  nextBuildingId: number;
  resources: Resources;
  rack: { letter: string; stamp?: StampKind }[];
  rerolls: number;
  tier: Tier;
  lifetime: Lifetime;
  recentWords: string[];
  questIndex: number;
  freeRerolls: number;
  lanterns: number;
  lanternProgress: number;
  stampCounters: StampCounters;
  stampsSeen: StampKind[];
  rune: { held: boolean; letter: string | null };
  runeCounter: number;
  shelf: { letter: string; stamp?: StampKind } | null;
  orders: Order[];
  wordsSinceDiscard: number;
  landmarksEarned: LandmarkId[];
  ticks: { sinceGrowth: number; sinceOverflow: number; growthTicks: number; overflowTicks: number };
  camera: SavedCamera;
}

/** What a migration changed, for the Section 11 messages after the load. */
export interface MigrationNotes {
  /** v1 to v2: road tiles standing on marsh that became bridge tiles. */
  marshRoadsToBridges: number;
  /** v2 to v3: a town center was founded at migration. */
  foundedCenter: boolean;
  /** v2 to v3: landmarks granted retroactively, announced one line each on first entry. */
  landmarksGranted: LandmarkId[];
}

export type ParseResult = { ok: true; save: SaveData; notes: MigrationNotes } | { ok: false; reason: string };

/** One step that turns a save of version N into version N + 1. */
export type Migration = (old: Record<string, unknown>) => Record<string, unknown>;

/** Where migrations leave their notes for the messages (removed before the save is used). */
const NOTE_KEY = '__marshRoadsToBridges';
const NOTE_V3 = '__v3';

export function migrateV1toV2(old: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...old, version: 2 };
  const tiles = isObj(old.tiles) ? { ...(old.tiles as Record<string, unknown>) } : null;
  const seed = isObj(old.seed) ? (old.seed as Record<string, unknown>) : null;
  if (!tiles || !seed || typeof seed.text !== 'string') return out; // the version 2 check will say why
  tiles.clearedThicket = Array.isArray(tiles.clearedThicket) ? tiles.clearedThicket : [];
  tiles.drained = Array.isArray(tiles.drained) ? tiles.drained : [];
  const map = generateTerrain(seed.text);
  const roads = Array.isArray(tiles.roads) ? (tiles.roads as unknown[]) : [];
  const onMarsh = roads.filter((i): i is number => isInt(i, 0, TILE_COUNT - 1) && map.tiles[i] === Terrain.Marsh);
  if (onMarsh.length > 0) {
    const keep = roads.filter((i) => !(isInt(i, 0, TILE_COUNT - 1) && map.tiles[i] === Terrain.Marsh));
    const bridges = Array.isArray(tiles.bridges) ? [...(tiles.bridges as unknown[])] : [];
    // Deck direction is worked out against the whole network (roads and bridges as saved).
    const grid = new Uint8Array(TILE_COUNT);
    for (const i of roads) if (isInt(i, 0, TILE_COUNT - 1)) grid[i] = 1;
    for (const b of bridges) if (Array.isArray(b) && isInt(b[0], 0, TILE_COUNT - 1)) grid[b[0]] = 2;
    const cleared = new Uint8Array(TILE_COUNT);
    const ctx = { tiles: map.tiles, cleared, roads: grid, occupied: () => false };
    for (const i of onMarsh) bridges.push([i, bridgeAxisFor(ctx, i % MAP_W, Math.floor(i / MAP_W), null) as 1 | 2]);
    tiles.roads = keep;
    tiles.bridges = bridges;
  }
  out.tiles = tiles;
  out[NOTE_KEY] = onMarsh.length;
  return out;
}


/**
 * (v3.0) Section 18 founding search for a migrated town: the tile nearest the map centre (27, 27)
 * whose full 2 by 2 footprint is meadow or cleared land, unoccupied (no building, road or bridge)
 * and inside the map, widening ring by ring to the whole map.
 */
export function foundCenterOn(tiles: Uint8Array, changed: Uint8Array, blocked: Uint8Array): { x: number; y: number } | null {
  const open = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return false;
    const i = y * MAP_W + x;
    const t = tiles[i];
    const meadow = t === Terrain.Meadow || (changed[i] === 1 && (t === Terrain.Forest || t === Terrain.Thicket || t === Terrain.Marsh));
    return meadow && !blocked[i];
  };
  for (let r = 0; r < MAP_W; r++) {
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (let y = 27 - r; y <= 27 + r; y++)
      for (let x = 27 - r; x <= 27 + r; x++) {
        if (Math.max(Math.abs(x - 27), Math.abs(y - 27)) !== r) continue;
        if (!(open(x, y) && open(x + 1, y) && open(x, y + 1) && open(x + 1, y + 1))) continue;
        const d = Math.hypot(x - 27, y - 27);
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    if (best) return best;
  }
  return null;
}

/**
 * (v3.0) Section 11 migration from version 2 to version 3:
 *  - everything carries: map, tile changes, buildings, balances, quests, lifetime totals, camera;
 *  - a town center is founded on the nearest fitting tile to the map centre;
 *  - existing roads and bridges are grandfathered as single-tile legacy pieces (build reading: they
 *    were never bought as pieces, so removing one returns nothing to a bank); no building is
 *    removed for standing disconnected;
 *  - the rack is resized from buildings ever built; extra letters are removed from the right end;
 *  - the new systems start at their new-game defaults (3 Lanterns, no stamps, no Rune, an empty
 *    shelf, terrain counters at zero); the orders are generated on first entry;
 *  - landmarks the lifetime count already meets are granted (announced on first entry).
 */
export function migrateV2toV3(old: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...old, version: 3 };
  const tiles = isObj(old.tiles) ? (old.tiles as Record<string, unknown>) : null;
  const seed = isObj(old.seed) ? (old.seed as Record<string, unknown>) : null;
  if (!tiles || !seed || typeof seed.text !== 'string') return out; // the version 3 check will say why
  const map = generateTerrain(seed.text);
  const idx = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((i): i is number => isInt(i, 0, TILE_COUNT - 1)) : []);
  const changed = new Uint8Array(TILE_COUNT);
  for (const i of [...idx(tiles.cleared), ...idx(tiles.clearedThicket), ...idx(tiles.drained)]) changed[i] = 1;
  const pieces: SavedPiece[] = [];
  const blocked = new Uint8Array(TILE_COUNT);
  for (const i of idx(tiles.roads)) {
    pieces.push({ kind: 'road', x: i % MAP_W, y: Math.floor(i / MAP_W), dir: 0, len: 1, legacy: true });
    blocked[i] = 1;
  }
  if (Array.isArray(tiles.bridges)) {
    for (const b of tiles.bridges as unknown[]) {
      if (!Array.isArray(b) || !isInt(b[0], 0, TILE_COUNT - 1)) continue;
      const i = b[0] as number;
      pieces.push({ kind: 'bridge', x: i % MAP_W, y: Math.floor(i / MAP_W), dir: 0, len: 1, legacy: true, axis: b[1] === 2 ? 2 : 1 });
      blocked[i] = 1;
    }
  }
  const buildings = Array.isArray(old.buildings) ? (old.buildings as unknown[]) : [];
  for (const b of buildings) {
    if (!isObj(b) || typeof b.type !== 'string' || !(b.type in BUILDINGS)) continue;
    const d = BUILDINGS[b.type as BuildingType];
    if (!isInt(b.x, 0, MAP_W - 1) || !isInt(b.y, 0, MAP_H - 1)) continue;
    for (let y = b.y as number; y < (b.y as number) + d.h; y++)
      for (let x = b.x as number; x < (b.x as number) + d.w; x++) if (x < MAP_W && y < MAP_H) blocked[y * MAP_W + x] = 1;
  }
  if (Array.isArray(tiles.flowers)) {
    for (const f of tiles.flowers as unknown[]) if (Array.isArray(f) && isInt(f[0], 0, MAP_W - 1) && isInt(f[1], 0, MAP_H - 1)) blocked[(f[1] as number) * MAP_W + (f[0] as number)] = 1;
  }
  const centre = foundCenterOn(map.tiles, changed, blocked) ?? { x: -1, y: -1 };
  const lifetime = isObj(old.lifetime) ? (old.lifetime as Record<string, unknown>) : {};
  const everBuilt = (isObj(lifetime.everBuilt) ? lifetime.everBuilt : {}) as Partial<Record<BuildingType, number>>;
  const size = rackSizeFor(everBuilt);
  const rack = Array.isArray(old.rack) ? (old.rack as unknown[]).slice(0, size) : [];
  const landmarks = landmarksEarnedBy(everBuilt, false);
  out.tiles = { terrain: [], cleared: tiles.cleared, clearedThicket: tiles.clearedThicket, drained: tiles.drained, gravel: [], flowers: tiles.flowers };
  out.townCenter = centre;
  out.pieces = pieces;
  out.banks = { road: emptyBank(), bridge: emptyBank() };
  out.rack = rack;
  out.rackStamps = rack.map(() => null);
  out.lifetime = { ...lifetime, ordersCompleted: 0, stampedWords: 0 };
  out.lanterns = { held: LANTERN_START, progress: 0 };
  out.stamps = { counters: emptyCounters(), seen: [] };
  out.rune = { held: false, counter: 0 };
  out.shelf = null;
  out.orders = [];
  out.wordsSinceDiscard = 0;
  out.landmarks = landmarks;
  out.ticks = { sinceGrowth: 0, sinceOverflow: 0, growthTicks: 0, overflowTicks: 0 };
  out[NOTE_V3] = { foundedCenter: true, landmarksGranted: landmarks };
  return out;
}

/**
 * Section 11 migrations, keyed by the version they upgrade FROM. When the format changes, add
 * the step here and raise SAVE_VERSION: old saves then load through it instead of failing.
 */
export const MIGRATIONS: Record<number, Migration> = { 1: migrateV1toV2, 2: migrateV2toV3 };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Big enough for any real town; small enough to catch nonsense. */
const MAX_AMOUNT = 1_000_000_000;
const TILE_COUNT = MAP_W * MAP_H;
const BUILDING_TYPES = Object.keys(BUILDINGS) as BuildingType[];

class SaveError extends Error {}
const fail = (reason: string): never => {
  throw new SaveError(reason);
};

/** Reads a save from a JSON string (an imported file). */
export function parseSaveText(text: string, migrations: Record<number, Migration> = MIGRATIONS): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: `This file isn't a ${NAME} save: it could not be read as a save file.` };
  }
  return parseSave(raw, migrations);
}

/**
 * Checks a save from IndexedDB or a file, upgrading it through the migrations if it is
 * older. Returns the save, or a plain message saying exactly why it can't be loaded.
 */
export function parseSave(raw: unknown, migrations: Record<number, Migration> = MIGRATIONS): ParseResult {
  try {
    if (!isObj(raw) || raw.format !== SAVE_FORMAT) fail(`This file isn't a ${NAME} save.`);
    let data = raw as Record<string, unknown>;
    if (!isInt(data.version, 0, Number.MAX_SAFE_INTEGER)) fail('This save has no format version, so it cannot be loaded safely.');
    let version = data.version as number;
    if (version > SAVE_VERSION) {
      fail(`This save was made by a newer version of ${NAME} (save format ${version}; this game reads up to ${SAVE_VERSION}). Update the game, then try again.`);
    }
    while (version < SAVE_VERSION) {
      const step = migrations[version];
      if (!step) fail(`This save is from an older version of ${NAME} (save format ${version}) that this game can no longer load.`);
      // Version 2 checks run before the version 3 step, so a damaged version 2 save still fails
      // with its own plain sentence rather than a migration error.
      if (version === 2) checkV2(data);
      data = step(data);
      if (!isObj(data) || data.version !== version + 1) fail(`Upgrading this save from format ${version} did not work, so it was not loaded.`);
      version += 1;
    }
    const marshRoadsToBridges = typeof data[NOTE_KEY] === 'number' ? (data[NOTE_KEY] as number) : 0;
    const v3 = isObj(data[NOTE_V3]) ? (data[NOTE_V3] as { foundedCenter: boolean; landmarksGranted: LandmarkId[] }) : null;
    return {
      ok: true,
      save: checkV3(data),
      notes: { marshRoadsToBridges, foundedCenter: !!v3?.foundedCenter, landmarksGranted: v3?.landmarksGranted ?? [] },
    };
  } catch (err) {
    if (err instanceof SaveError) return { ok: false, reason: err.message };
    return { ok: false, reason: 'This save could not be read, so it was not loaded.' };
  }
}

function checkResources(v: unknown, what: string): Resources {
  if (!isObj(v)) fail(`This save is damaged: ${what} are missing.`);
  const r = v as Record<string, unknown>;
  const out = {} as Resources;
  for (const k of RESOURCE_KEYS) {
    if (!isInt(r[k], 0, MAX_AMOUNT)) fail(`This save is damaged: ${what} (${k}) is not a sensible number.`);
    out[k] = r[k] as number;
  }
  return out;
}

function checkIndexList(v: unknown, what: string): number[] {
  if (!Array.isArray(v)) fail(`This save is damaged: the ${what} list is missing.`);
  const seen = new Set<number>();
  for (const i of v as unknown[]) {
    if (!isInt(i, 0, TILE_COUNT - 1)) fail(`This save is damaged: a ${what} tile is off the map.`);
    if (seen.has(i as number)) fail(`This save is damaged: a ${what} tile is listed twice.`);
    seen.add(i as number);
  }
  return [...(v as number[])];
}

/** The seed, checked: the base map must regenerate exactly. */
function checkSeed(d: Record<string, unknown>): { text: string; value: number; terrain: TerrainMap } {
  const seed = d.seed;
  if (!isObj(seed) || typeof seed.text !== 'string' || seed.text.length === 0 || seed.text.length > 200 || !isInt(seed.value, 0, 0xffffffff)) {
    fail('This save is damaged: its map seed is missing.');
  }
  const seedObj = seed as { text: string; value: number };
  const terrain = generateTerrain(seedObj.text);
  if (terrain.seed !== seedObj.value || terrain.seedWasInvalid) fail('This save is damaged: its map seed does not rebuild the same map.');
  return { text: seedObj.text, value: seedObj.value, terrain };
}

/**
 * Version 2 checks, run on a version 2 save before it migrates (the v2.0 rules: roads and bridges
 * as tiles, an 8-letter rack). Throws with a plain sentence if anything would break the map.
 */
function checkV2(d: Record<string, unknown>): void {
  const { terrain } = checkSeed(d);
  const tilesAt = terrain.tiles;
  if (!isObj(d.tiles)) fail('This save is damaged: the map changes are missing.');
  const t = d.tiles as Record<string, unknown>;
  const cleared = checkIndexList(t.cleared, 'cleared forest');
  for (const i of cleared) if (tilesAt[i] !== Terrain.Forest) fail('This save is damaged: it clears forest where this map has none.');
  const clearedThicket = checkIndexList(t.clearedThicket, 'cleared thicket');
  for (const i of clearedThicket) if (tilesAt[i] !== Terrain.Thicket) fail('This save is damaged: it clears thicket where this map has none.');
  const drained = checkIndexList(t.drained, 'drained marsh');
  for (const i of drained) if (tilesAt[i] !== Terrain.Marsh) fail('This save is damaged: it drains marsh where this map has none.');
  const changed = new Uint8Array(TILE_COUNT);
  for (const i of [...cleared, ...clearedThicket, ...drained]) changed[i] = 1;
  const roads = checkIndexList(t.roads, 'road');
  for (const i of roads) {
    if (!roadAllowedOn(tilesAt[i], changed[i] === 1)) {
      const ter = tilesAt[i];
      fail(
        ter === Terrain.Marsh
          ? 'This save is damaged: it has a road on marsh, which needs a bridge.'
          : ter === Terrain.Water || ter === Terrain.Thicket
            ? 'This save is damaged: it has a road on water or thicket.'
            : 'This save is damaged: it has a road on uncleared forest.',
      );
    }
  }
  if (!Array.isArray(t.bridges)) fail('This save is damaged: the bridge list is missing.');
  const roadSet = new Set(roads);
  const bridgeSeen = new Set<number>();
  for (const b of t.bridges as unknown[]) {
    if (!Array.isArray(b) || b.length !== 2 || !isInt(b[0], 0, TILE_COUNT - 1) || (b[1] !== 1 && b[1] !== 2)) {
      fail('This save is damaged: a bridge entry is not readable.');
    }
    const [i] = b as [number, 1 | 2];
    if (!bridgeAllowedOn(tilesAt[i], changed[i] === 1)) fail('This save is damaged: it has a bridge on dry land.');
    if (roadSet.has(i) || bridgeSeen.has(i)) fail('This save is damaged: a bridge tile is listed twice.');
    bridgeSeen.add(i);
  }
  if (!Array.isArray(d.rack) || d.rack.length !== 8 || !(d.rack as unknown[]).every((c) => typeof c === 'string' && /^[A-Z]$/.test(c))) {
    fail('This save is damaged: the letter rack must hold 8 letters.');
  }
}

/** Every Section 11 field, checked against the map the seed makes. */
function checkV3(d: Record<string, unknown>): SaveData {
  const { text, value, terrain } = checkSeed(d);
  const base = terrain.tiles;

  // Tile changes: dynamic terrain first (it defines the current map the others are checked on).
  if (!isObj(d.tiles)) fail('This save is damaged: the map changes are missing.');
  const t = d.tiles as Record<string, unknown>;
  if (!Array.isArray(t.terrain)) fail('This save is damaged: the terrain change list is missing.');
  const current = base.slice();
  const terrainChanges: [number, number][] = [];
  const seenT = new Set<number>();
  for (const e of t.terrain as unknown[]) {
    if (!Array.isArray(e) || e.length !== 2 || !isInt(e[0], 0, TILE_COUNT - 1) || !isInt(e[1], 0, 5)) fail('This save is damaged: a terrain change is not readable.');
    const [i, to] = e as [number, number];
    if (seenT.has(i)) fail('This save is damaged: a terrain change is listed twice.');
    seenT.add(i);
    // Section 20 changes only make forest, thicket or marsh, and never touch hills or water.
    if (![Terrain.Forest, Terrain.Thicket, Terrain.Marsh].includes(to as 1) || base[i] === Terrain.Water || base[i] === Terrain.Hill || to === base[i]) {
      fail('This save is damaged: it changes the land in a way the game never does.');
    }
    current[i] = to;
    terrainChanges.push([i, to]);
  }
  const cleared = checkIndexList(t.cleared, 'cleared forest');
  for (const i of cleared) if (current[i] !== Terrain.Forest) fail('This save is damaged: it clears forest where this map has none.');
  const clearedThicket = checkIndexList(t.clearedThicket, 'cleared thicket');
  for (const i of clearedThicket) if (current[i] !== Terrain.Thicket) fail('This save is damaged: it clears thicket where this map has none.');
  const drained = checkIndexList(t.drained, 'drained marsh');
  for (const i of drained) if (current[i] !== Terrain.Marsh) fail('This save is damaged: it drains marsh where this map has none.');
  const changed = new Uint8Array(TILE_COUNT);
  for (const i of [...cleared, ...clearedThicket, ...drained]) changed[i] = 1;
  const gravel = checkIndexList(t.gravel, 'gravel');
  for (const i of gravel) if (current[i] !== Terrain.Meadow && !changed[i]) fail('This save is damaged: it has gravel off open land.');
  if (!Array.isArray(t.flowers)) fail('This save is damaged: the flower list is missing.');
  const flowers: [number, number][] = [];
  for (const f of t.flowers as unknown[]) {
    if (!Array.isArray(f) || f.length !== 2 || !isInt(f[0], 0, MAP_W - 1) || !isInt(f[1], 0, MAP_H - 1)) {
      fail('This save is damaged: a flower patch is off the map.');
    }
    const [fx, fy] = f as [number, number];
    flowers.push([fx, fy]);
  }

  // Pieces: every tile on the map, legal ground for its kind, and no two pieces overlapping.
  if (!Array.isArray(d.pieces)) fail('This save is damaged: the road piece list is missing.');
  const pieces: SavedPiece[] = [];
  const occupiedByPiece = new Uint8Array(TILE_COUNT);
  for (const raw of d.pieces as unknown[]) {
    const p = (isObj(raw) ? raw : {}) as Record<string, unknown>;
    if (!isObj(raw) || (p.kind !== 'road' && p.kind !== 'bridge') || !isInt(p.x, 0, MAP_W - 1) || !isInt(p.y, 0, MAP_H - 1) || !isInt(p.dir, 0, 3)) {
      fail('This save is damaged: a road piece is not readable.');
    }
    const legacy = p.legacy === true;
    const len = p.len as number;
    if (legacy ? len !== 1 : !(PIECE_LENGTHS as readonly number[]).includes(len)) fail('This save is damaged: a road piece has a length the game never sells.');
    const sp: SavedPiece = { kind: p.kind as PieceKind, x: p.x as number, y: p.y as number, dir: p.dir as Dir, len, ...(legacy ? { legacy: true } : {}) };
    if (p.axis === 1 || p.axis === 2) sp.axis = p.axis;
    for (const tt of pieceTiles(sp)) {
      if (tt.x < 0 || tt.y < 0 || tt.x >= MAP_W || tt.y >= MAP_H) fail('This save is damaged: a road piece runs off the map.');
      const i = tt.y * MAP_W + tt.x;
      if (occupiedByPiece[i]) fail('This save is damaged: two road pieces overlap.');
      occupiedByPiece[i] = 1;
      const ok = sp.kind === 'road' ? roadAllowedOn(current[i], changed[i] === 1) : bridgeAllowedOn(current[i], changed[i] === 1);
      if (!ok) fail(sp.kind === 'road' ? 'This save is damaged: it has a road on ground that cannot take one.' : 'This save is damaged: it has a bridge on dry land.');
      if (sp.kind === 'road' && gravel.includes(i)) fail('This save is damaged: it has a road on gravel.');
    }
    pieces.push(sp);
  }
  const roadGrid = gridsFromPieces(pieces.map((p, k) => ({ id: k + 1, ...p }))).roads;

  // Town center and buildings: rebuilt one by one on the restored map, so nothing overlaps, sits
  // on a road, water or thicket, or hangs off the map. (Road access is not re-checked: removing a
  // road after building is allowed, and v2 towns are grandfathered.)
  if (!isObj(d.townCenter) || !isInt(d.townCenter.x, 0, MAP_W - 2) || !isInt(d.townCenter.y, 0, MAP_H - 2)) fail('This save is damaged: the town center is missing.');
  const tcPos = d.townCenter as { x: number; y: number };
  const placed: Building[] = [];
  const ctx = () => ({ tiles: current, cleared: changed, roads: roadGrid, buildings: placed, mapW: MAP_W, mapH: MAP_H });
  const tcProblem = placementProblem(ctx(), 'townCenter', tcPos.x, tcPos.y);
  if (tcProblem) fail('This save is damaged: the town center is placed where it cannot stand.');
  placed.push({ id: 1, type: 'townCenter', x: tcPos.x, y: tcPos.y });
  if (!Array.isArray(d.buildings)) fail('This save is damaged: the building list is missing.');
  const buildings: SaveData['buildings'] = [];
  const landmarkSeen = new Set<string>();
  for (const rawB of d.buildings as unknown[]) {
    const b = (isObj(rawB) ? rawB : {}) as Record<string, unknown>;
    if (!isObj(rawB) || typeof b.type !== 'string' || !BUILDING_TYPES.includes(b.type as BuildingType) || b.type === 'townCenter' || !isInt(b.x, 0, MAP_W - 1) || !isInt(b.y, 0, MAP_H - 1)) {
      fail('This save is damaged: a building entry is not readable.');
    }
    const type = (b as { type: BuildingType }).type;
    const { x, y } = b as { x: number; y: number };
    let landmark: LandmarkId | undefined;
    if (type === 'landmark') {
      if (typeof b.landmark !== 'string' || !LANDMARK_ORDER.includes(b.landmark as LandmarkId) || landmarkSeen.has(b.landmark as string)) fail('This save is damaged: a landmark entry is not readable.');
      landmark = b.landmark as LandmarkId;
      landmarkSeen.add(landmark);
    }
    const problem = placementProblem(ctx(), type, x, y);
    if (problem === 'bounds' || problem === 'water' || problem === 'thicket' || problem === 'road' || problem === 'occupied' || problem === 'forest') {
      fail(`This save is damaged: a ${BUILDINGS[type].name} is placed where it can't stand.`);
    }
    placed.push({ id: placed.length + 1, type, x, y, ...(landmark ? { landmark } : {}) });
    buildings.push(landmark ? { type, x, y, landmark } : { type, x, y });
  }
  // Flower patches and gravel may not sit under a building or a road.
  const under = (x: number, y: number) => roadGrid[y * MAP_W + x] !== 0 || placed.some((b) => x >= b.x && y >= b.y && x < b.x + BUILDINGS[b.type].w && y < b.y + BUILDINGS[b.type].h);
  for (const [x, y] of flowers) if (under(x, y)) fail('This save is damaged: a flower patch is under a road or building.');
  for (const i of gravel) if (under(i % MAP_W, Math.floor(i / MAP_W))) fail('This save is damaged: gravel is under a road or building.');

  // Banks.
  const checkBank = (v: unknown): Bank => {
    if (!isObj(v)) fail('This save is damaged: a piece bank is missing.');
    const out = emptyBank();
    for (const len of PIECE_LENGTHS) {
      const n = (v as Record<string, unknown>)[String(len)];
      if (!isInt(n, 0, MAX_AMOUNT)) fail('This save is damaged: a piece bank count is not a sensible number.');
      out[len] = n as number;
    }
    return out;
  };
  if (!isObj(d.banks)) fail('This save is damaged: the piece banks are missing.');
  const banks = { road: checkBank((d.banks as Record<string, unknown>).road), bridge: checkBank((d.banks as Record<string, unknown>).bridge) };

  // Economy and word game.
  const resources = checkResources(d.resources, 'resources');
  if (!isObj(d.lifetime)) fail('This save is damaged: lifetime totals are missing.');
  const lt = d.lifetime as Record<string, unknown>;
  for (const k of ['submissions', 'validWords', 'longWords', 'bridgesBuilt', 'ordersCompleted', 'stampedWords'] as const) {
    if (!isInt(lt[k], 0, MAX_AMOUNT)) fail(`This save is damaged: lifetime ${k} is not a sensible number.`);
  }
  if ((lt.validWords as number) > (lt.submissions as number) || (lt.longWords as number) > (lt.validWords as number)) {
    fail("This save is damaged: its lifetime word counts don't add up.");
  }
  if (!isObj(lt.everBuilt)) fail('This save is damaged: the record of buildings built is missing.');
  const everBuilt: Lifetime['everBuilt'] = {};
  for (const [k, v] of Object.entries(lt.everBuilt as Record<string, unknown>)) {
    if (!BUILDING_TYPES.includes(k as BuildingType) || !isInt(v, 0, MAX_AMOUNT)) fail('This save is damaged: the record of buildings built is not readable.');
    everBuilt[k as BuildingType] = v as number;
  }
  const earned = checkResources(lt.earned, 'lifetime earnings');
  const size = rackSizeFor(everBuilt);
  if (!Array.isArray(d.rack) || d.rack.length < 1 || d.rack.length > Math.min(RACK_MAX, size) || !(d.rack as unknown[]).every((c) => typeof c === 'string' && /^[A-Z]$/.test(c))) {
    fail(`This save is damaged: the letter rack must hold 1 to ${size} letters.`);
  }
  const stampOk = (v: unknown) => v === null || STAMP_KINDS.includes(v as StampKind);
  if (!Array.isArray(d.rackStamps) || d.rackStamps.length !== (d.rack as unknown[]).length || !(d.rackStamps as unknown[]).every(stampOk)) {
    fail('This save is damaged: the rack stamps are not readable.');
  }
  const heldKinds = (d.rackStamps as (StampKind | null)[]).filter(Boolean);
  if (new Set(heldKinds).size !== heldKinds.length) fail('This save is damaged: it holds two stamps of one kind.');
  if (!isInt(d.rerolls, 0, 3)) fail('This save is damaged: rerolls held must be 0 to 3.');
  if (d.tier !== 1 && d.tier !== 2 && d.tier !== 3) fail('This save is damaged: the tier must be 1, 2 or 3.');
  if (!Array.isArray(d.recentWords) || d.recentWords.length > 10 || !(d.recentWords as unknown[]).every((w) => typeof w === 'string' && /^[A-Z]{1,10}$/.test(w))) {
    fail('This save is damaged: the recent word list is not readable.');
  }
  if (!isInt(d.questsCompleted, 0, QUESTS.length)) fail(`This save is damaged: quests completed must be 0 to ${QUESTS.length}.`);
  if (!isInt(d.freeRedraws, 0, MAX_AMOUNT)) fail('This save is damaged: the free redraw count is not a sensible number.');
  if (!isObj(d.lanterns) || !isInt(d.lanterns.held, 0, LANTERN_MAX) || !isInt(d.lanterns.progress, 0, 100)) fail('This save is damaged: the Lantern count is not readable.');
  const st = (isObj(d.stamps) ? d.stamps : {}) as Record<string, unknown>;
  if (!isObj(d.stamps) || !isObj(st.counters) || !Array.isArray(st.seen)) fail('This save is damaged: the stamp state is not readable.');
  const counters = emptyCounters();
  for (const k of STAMP_KINDS) {
    const v = (st.counters as Record<string, unknown>)[k];
    if (!isInt(v, 0, 3)) fail('This save is damaged: a stamp counter is not readable.');
    counters[k] = v as number;
  }
  const seen = (st.seen as unknown[]).filter((k): k is StampKind => STAMP_KINDS.includes(k as StampKind));
  if (!isObj(d.rune) || typeof d.rune.held !== 'boolean' || !isInt(d.rune.counter, 0, 100)) fail('This save is damaged: the Rune state is not readable.');
  let shelf: SaveData['shelf'] = null;
  if (d.shelf !== null) {
    if (!isObj(d.shelf) || typeof d.shelf.letter !== 'string' || !/^[A-Z]$/.test(d.shelf.letter) || !stampOk(d.shelf.stamp ?? null)) fail('This save is damaged: the shelf is not readable.');
    shelf = { letter: (d.shelf as { letter: string }).letter, stamp: ((d.shelf as { stamp?: StampKind | null }).stamp ?? null) as StampKind | null };
  }
  if (!Array.isArray(d.orders) || d.orders.length > 3) fail('This save is damaged: the Commission orders are not readable.');
  const condKeys = new Set(allConditions().map(condKey));
  const orders: SaveData['orders'] = [];
  for (const rawO of d.orders as unknown[]) {
    const o = (isObj(rawO) ? rawO : {}) as Record<string, unknown>;
    if (!isObj(rawO) || !isObj(o.cond) || !isObj(o.reward) || !isInt(o.postedAt, 0, MAX_AMOUNT)) fail('This save is damaged: a Commission order is not readable.');
    const cond = o.cond as OrderCond;
    const reward = o.reward as { res: RewardRes; amount: number };
    if (!condKeys.has(condKey(cond)) || !['coins', 'lumber', 'stone'].includes(reward.res) || !isInt(reward.amount, 1, 100)) fail('This save is damaged: a Commission order is not readable.');
    orders.push({ cond: { ...cond }, reward: { res: reward.res, amount: reward.amount }, postedAt: o.postedAt as number });
  }
  if (!isInt(d.wordsSinceDiscard, 0, 100)) fail('This save is damaged: the discard counter is not readable.');
  if (!Array.isArray(d.landmarks) || !(d.landmarks as unknown[]).every((l) => LANDMARK_ORDER.includes(l as LandmarkId))) fail('This save is damaged: the landmark list is not readable.');
  for (const l of landmarkSeen) if (!(d.landmarks as string[]).includes(l)) fail('This save is damaged: a placed landmark was never earned.');
  if (!isObj(d.ticks) || !['sinceGrowth', 'sinceOverflow', 'growthTicks', 'overflowTicks'].every((k) => isInt((d.ticks as Record<string, unknown>)[k], 0, MAX_AMOUNT))) {
    fail('This save is damaged: the terrain counters are not readable.');
  }
  const ticks = d.ticks as SaveData['ticks'];

  if (!isObj(d.camera) || !isFiniteNum(d.camera.centreX) || !isFiniteNum(d.camera.centreY) || !isFiniteNum(d.camera.zoom) || (d.camera.zoom as number) <= 0) {
    fail('This save is damaged: the camera position is not readable.');
  }
  const cam = d.camera as Record<string, number>;

  return {
    format: SAVE_FORMAT,
    version: 3,
    savedAt: typeof d.savedAt === 'string' ? d.savedAt : '',
    seed: { text, value },
    tiles: { terrain: terrainChanges, cleared, clearedThicket, drained, gravel, flowers },
    townCenter: { x: tcPos.x, y: tcPos.y },
    pieces,
    banks,
    buildings,
    resources,
    rack: [...(d.rack as string[])],
    rackStamps: [...(d.rackStamps as (StampKind | null)[])],
    rerolls: d.rerolls as number,
    tier: d.tier as Tier,
    lifetime: {
      submissions: lt.submissions as number,
      validWords: lt.validWords as number,
      longWords: lt.longWords as number,
      bridgesBuilt: lt.bridgesBuilt as number,
      everBuilt,
      earned,
      ordersCompleted: lt.ordersCompleted as number,
      stampedWords: lt.stampedWords as number,
    },
    recentWords: [...(d.recentWords as string[])],
    questsCompleted: d.questsCompleted as number,
    freeRedraws: d.freeRedraws as number,
    lanterns: { held: (d.lanterns as { held: number }).held, progress: (d.lanterns as { progress: number }).progress },
    stamps: { counters, seen },
    rune: { held: (d.rune as { held: boolean }).held, counter: (d.rune as { counter: number }).counter },
    shelf,
    orders,
    wordsSinceDiscard: d.wordsSinceDiscard as number,
    landmarks: LANDMARK_ORDER.filter((l) => (d.landmarks as string[]).includes(l)),
    ticks: { sinceGrowth: ticks.sinceGrowth, sinceOverflow: ticks.sinceOverflow, growthTicks: ticks.growthTicks, overflowTicks: ticks.overflowTicks },
    camera: { centreX: cam.centreX, centreY: cam.centreY, zoom: cam.zoom },
  };
}

/** Turns a checked save back into game state. Only call with a save from parseSave(). */
export function restoreGame(save: SaveData): RestoredGame {
  const generated = generateTerrain(save.seed.text);
  const tiles = generated.tiles.slice();
  for (const [i, to] of save.tiles.terrain) tiles[i] = to;
  const cleared = new Uint8Array(TILE_COUNT);
  for (const i of [...save.tiles.cleared, ...save.tiles.clearedThicket, ...save.tiles.drained]) cleared[i] = 1;
  const gravel = new Uint8Array(TILE_COUNT);
  for (const i of save.tiles.gravel) gravel[i] = 1;
  const buildings: Building[] = [{ id: 1, type: 'townCenter', x: save.townCenter.x, y: save.townCenter.y }];
  for (const b of save.buildings) buildings.push({ id: buildings.length + 1, type: b.type, x: b.x, y: b.y, ...(b.landmark ? { landmark: b.landmark } : {}) });
  return {
    terrain: { ...generated, tiles },
    baseTiles: generated.tiles,
    cleared,
    gravel,
    pieces: save.pieces.map((p, k) => ({ id: k + 1, ...p })),
    roadBank: { ...save.banks.road },
    bridgeBank: { ...save.banks.bridge },
    flowers: save.tiles.flowers.map(([x, y]) => ({ x, y })),
    buildings,
    nextBuildingId: buildings.length + 1,
    resources: { ...save.resources },
    rack: save.rack.map((letter, k) => (save.rackStamps[k] ? { letter, stamp: save.rackStamps[k]! } : { letter })),
    rerolls: save.rerolls,
    tier: save.tier,
    lifetime: { ...save.lifetime, everBuilt: { ...save.lifetime.everBuilt }, earned: { ...save.lifetime.earned } },
    recentWords: [...save.recentWords],
    questIndex: save.questsCompleted,
    freeRerolls: save.freeRedraws,
    lanterns: save.lanterns.held,
    lanternProgress: save.lanterns.progress,
    stampCounters: { ...save.stamps.counters },
    stampsSeen: [...save.stamps.seen],
    rune: { held: save.rune.held, letter: null },
    runeCounter: save.rune.counter,
    shelf: save.shelf ? (save.shelf.stamp ? { letter: save.shelf.letter, stamp: save.shelf.stamp } : { letter: save.shelf.letter }) : null,
    orders: save.orders.map((o, k) => ({ id: k + 1, cond: { ...o.cond }, reward: { ...o.reward }, postedAt: o.postedAt })),
    wordsSinceDiscard: save.wordsSinceDiscard,
    landmarksEarned: [...save.landmarks],
    ticks: { ...save.ticks },
    camera: { ...save.camera },
  };
}

/** A one-line description of a save for the slot list. Population is recalculated, never stored. */
export function describeSave(save: SaveData): { tier: Tier; population: number; words: number; buildings: number; savedAt: string } {
  const buildings = save.buildings.filter((b) => b.type !== 'landmark').map((b, k) => ({ id: k + 1, ...b }));
  return {
    tier: save.tier,
    population: population(buildings),
    words: save.lifetime.validWords,
    buildings: buildings.length,
    savedAt: save.savedAt,
  };
}
