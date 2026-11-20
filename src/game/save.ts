// Save format (Build Spec v1.8, Section 11). Pure rules: no IndexedDB, no React, no Pixi.
//
// A save holds exactly the Section 11 fields: format version, map seed, every tile change
// from the generated base map, buildings (type and position), the five resource balances, rack
// letters, rerolls held, tier, lifetime totals, the last 10 submitted words, quest completion
// state, and camera position and zoom. Happiness and population are NOT saved: they are
// recalculated from the buildings on load (Section 8).
//
// Loading never trusts a file blindly. parseSave() checks every field and rebuilds the map
// from the seed before anything is applied, so a damaged or hand-edited save fails with a
// plain message instead of loading silently into a broken map (Section 11).

import { BUILDINGS, placementProblem, population } from './buildings';
import { QUESTS } from './progress';
import { generateTerrain } from './terrain';
import {
  MAP_H,
  MAP_W,
  RESOURCE_KEYS,
  Terrain,
  type Building,
  type BuildingType,
  type Lifetime,
  type Resources,
  type TerrainMap,
  type Tier,
} from './types';

/** Identifies a WordCity save file (so a random JSON file is refused with a clear message). */
export const SAVE_FORMAT = 'wordcity-save';
/** Section 11: the save format version number. Raise it whenever the format changes. */
export const SAVE_VERSION = 1;

/** Camera saved as the world point at the centre of the view, so it fits any screen size. */
export interface SavedCamera {
  centreX: number;
  centreY: number;
  zoom: number;
}

export interface SaveV1 {
  format: typeof SAVE_FORMAT;
  version: 1;
  /** When the save was made (ISO 8601). Shown in the slot list only. */
  savedAt: string;
  /** Section 2: the seed regenerates the base map exactly. `value` double-checks it. */
  seed: { text: string; value: number };
  /** Section 11: every tile change from the generated base map, as tile indices (y * 54 + x). */
  tiles: {
    /** Forest tiles the player cleared (Section 4). */
    cleared: number[];
    /** Road tiles. */
    roads: number[];
    /** Bridge tiles with their deck direction: 1 = north-south, 2 = east-west. */
    bridges: [number, 1 | 2][];
    /** Long-word flower patches (Section 5), as [x, y]. Decoration only. */
    flowers: [number, number][];
  };
  /** Section 11: buildings with type and position (top-left footprint tile). */
  buildings: { type: BuildingType; x: number; y: number }[];
  resources: Resources;
  rack: string[];
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
  camera: SavedCamera;
}

export type SaveData = SaveV1;

/** The parts of the game a save describes (a subset of GameState). */
export interface SaveSource {
  terrain: TerrainMap;
  forestCleared: Uint8Array;
  roads: Uint8Array;
  bridgeAxis: Uint8Array;
  flowers: { x: number; y: number }[];
  buildings: Building[];
  resources: Resources;
  rack: string[];
  rerolls: number;
  tier: Tier;
  lifetime: Lifetime;
  recentWords: string[];
  questIndex: number;
  freeRerolls: number;
}

/** Builds a save from the current game. Art-showcase buildings are never saved. */
export function makeSave(s: SaveSource, camera: SavedCamera, now: Date = new Date()): SaveV1 {
  const cleared: number[] = [];
  const roads: number[] = [];
  const bridges: [number, 1 | 2][] = [];
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    if (s.forestCleared[i] === 1) cleared.push(i);
    if (s.roads[i] === 1) roads.push(i);
    else if (s.roads[i] === 2) bridges.push([i, s.bridgeAxis[i] === 2 ? 2 : 1]);
  }
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    savedAt: now.toISOString(),
    seed: { text: s.terrain.seedText, value: s.terrain.seed },
    tiles: { cleared, roads, bridges, flowers: s.flowers.map((f) => [f.x, f.y]) },
    buildings: s.buildings.filter((b) => !b.preview).map((b) => ({ type: b.type, x: b.x, y: b.y })),
    resources: { ...s.resources },
    rack: [...s.rack],
    rerolls: s.rerolls,
    tier: s.tier,
    lifetime: {
      submissions: s.lifetime.submissions,
      validWords: s.lifetime.validWords,
      longWords: s.lifetime.longWords,
      bridgesBuilt: s.lifetime.bridgesBuilt,
      everBuilt: { ...s.lifetime.everBuilt },
      earned: { ...s.lifetime.earned },
    },
    recentWords: [...s.recentWords],
    questsCompleted: s.questIndex,
    freeRedraws: s.freeRerolls,
    // Rounded so a save made, loaded and saved again is identical (no floating-point drift).
    camera: { centreX: round(camera.centreX, 2), centreY: round(camera.centreY, 2), zoom: round(camera.zoom, 4) },
  };
}

function round(v: number, places: number): number {
  const k = 10 ** places;
  return Math.round(v * k) / k;
}

/** What a loaded save turns into: everything a fresh GameState needs from it. */
export interface RestoredGame extends SaveSource {
  nextBuildingId: number;
  camera: SavedCamera;
}

export type ParseResult = { ok: true; save: SaveV1 } | { ok: false; reason: string };

/** One step that turns a save of version N into version N + 1. */
export type Migration = (old: Record<string, unknown>) => Record<string, unknown>;

/**
 * Section 11 migrations, keyed by the version they upgrade FROM. Version 1 is the first
 * format, so there are none yet. When the format changes, add the step here and raise
 * SAVE_VERSION: old saves then load through it instead of failing.
 */
export const MIGRATIONS: Record<number, Migration> = {};

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
    return { ok: false, reason: "This file isn't a WordCity save: it could not be read as a save file." };
  }
  return parseSave(raw, migrations);
}

/**
 * Checks a save from IndexedDB or a file, upgrading it through the migrations if it is
 * older. Returns the save, or a plain message saying exactly why it can't be loaded.
 */
export function parseSave(raw: unknown, migrations: Record<number, Migration> = MIGRATIONS): ParseResult {
  try {
    if (!isObj(raw) || raw.format !== SAVE_FORMAT) fail("This file isn't a WordCity save.");
    let data = raw as Record<string, unknown>;
    if (!isInt(data.version, 0, Number.MAX_SAFE_INTEGER)) fail('This save has no format version, so it cannot be loaded safely.');
    let version = data.version as number;
    if (version > SAVE_VERSION) {
      fail(`This save was made by a newer version of WordCity (save format ${version}; this game reads up to ${SAVE_VERSION}). Update the game, then try again.`);
    }
    while (version < SAVE_VERSION) {
      const step = migrations[version];
      if (!step) fail(`This save is from an older version of WordCity (save format ${version}) that this game can no longer load.`);
      data = step(data);
      if (!isObj(data) || data.version !== version + 1) fail(`Upgrading this save from format ${version} did not work, so it was not loaded.`);
      version += 1;
    }
    return { ok: true, save: checkV1(data) };
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

/** Every Section 11 field, checked against the map the seed makes. */
function checkV1(d: Record<string, unknown>): SaveV1 {
  // Seed: the base map must regenerate exactly.
  const seed = d.seed;
  if (!isObj(seed) || typeof seed.text !== 'string' || seed.text.length === 0 || seed.text.length > 200 || !isInt(seed.value, 0, 0xffffffff)) {
    fail('This save is damaged: its map seed is missing.');
  }
  const seedObj = seed as { text: string; value: number };
  const terrain = generateTerrain(seedObj.text);
  if (terrain.seed !== seedObj.value || terrain.seedWasInvalid) fail('This save is damaged: its map seed does not rebuild the same map.');
  const tilesAt = terrain.tiles;

  // Tile changes.
  if (!isObj(d.tiles)) fail('This save is damaged: the map changes are missing.');
  const t = d.tiles as Record<string, unknown>;
  const cleared = checkIndexList(t.cleared, 'cleared forest');
  for (const i of cleared) if (tilesAt[i] !== Terrain.Forest) fail('This save is damaged: it clears forest where this map has none.');
  const clearedSet = new Set(cleared);
  const roads = checkIndexList(t.roads, 'road');
  for (const i of roads) {
    const ter = tilesAt[i];
    if (ter === Terrain.Water || ter === Terrain.Thicket) fail('This save is damaged: it has a road on water or thicket.');
    if (ter === Terrain.Forest && !clearedSet.has(i)) fail('This save is damaged: it has a road on uncleared forest.');
  }
  if (!Array.isArray(t.bridges)) fail('This save is damaged: the bridge list is missing.');
  const roadSet = new Set(roads);
  const bridgeSeen = new Set<number>();
  const bridges: [number, 1 | 2][] = [];
  for (const b of t.bridges as unknown[]) {
    if (!Array.isArray(b) || b.length !== 2 || !isInt(b[0], 0, TILE_COUNT - 1) || (b[1] !== 1 && b[1] !== 2)) {
      fail('This save is damaged: a bridge entry is not readable.');
    }
    const [i, axis] = b as [number, 1 | 2];
    if (tilesAt[i] !== Terrain.Water) fail('This save is damaged: it has a bridge on dry land.');
    if (roadSet.has(i) || bridgeSeen.has(i)) fail('This save is damaged: a bridge tile is listed twice.');
    bridgeSeen.add(i);
    bridges.push([i, axis]);
  }
  if (!Array.isArray(t.flowers)) fail('This save is damaged: the flower list is missing.');
  const flowers: [number, number][] = [];
  for (const f of t.flowers as unknown[]) {
    if (!Array.isArray(f) || f.length !== 2 || !isInt(f[0], 0, MAP_W - 1) || !isInt(f[1], 0, MAP_H - 1)) {
      fail('This save is damaged: a flower patch is off the map.');
    }
    const [fx, fy] = f as [number, number];
    flowers.push([fx, fy]);
  }

  // Buildings: rebuilt one by one on the restored map, so nothing overlaps, sits on a road,
  // water or thicket, or hangs off the map. (Road access and the Sawmill's forest edge are
  // not re-checked: removing a road or clearing nearby forest after building is allowed.)
  if (!Array.isArray(d.buildings)) fail('This save is damaged: the building list is missing.');
  const forestCleared = new Uint8Array(TILE_COUNT);
  for (const i of cleared) forestCleared[i] = 1;
  const roadGrid = new Uint8Array(TILE_COUNT);
  for (const i of roads) roadGrid[i] = 1;
  for (const [i] of bridges) roadGrid[i] = 2;
  const placed: Building[] = [];
  const buildings: SaveV1['buildings'] = [];
  for (const b of d.buildings as unknown[]) {
    if (!isObj(b) || typeof b.type !== 'string' || !BUILDING_TYPES.includes(b.type as BuildingType) || !isInt(b.x, 0, MAP_W - 1) || !isInt(b.y, 0, MAP_H - 1)) {
      fail('This save is damaged: a building entry is not readable.');
    }
    const type = (b as { type: BuildingType }).type;
    const { x, y } = b as { x: number; y: number };
    const problem = placementProblem(
      { tiles: tilesAt, forestCleared, roads: roadGrid, buildings: placed, mapW: MAP_W, mapH: MAP_H },
      type,
      x,
      y,
    );
    if (problem === 'bounds' || problem === 'water' || problem === 'thicket' || problem === 'road' || problem === 'occupied' || problem === 'forest') {
      fail(`This save is damaged: a ${BUILDINGS[type].name} is placed where it can't stand.`);
    }
    placed.push({ id: placed.length + 1, type, x, y });
    buildings.push({ type, x, y });
  }

  // Flower patches may not sit under a building or a road.
  for (const [x, y] of flowers) {
    const i = y * MAP_W + x;
    if (roadGrid[i] || placed.some((b) => x >= b.x && y >= b.y && x < b.x + BUILDINGS[b.type].w && y < b.y + BUILDINGS[b.type].h)) {
      fail('This save is damaged: a flower patch is under a road or building.');
    }
  }

  // Economy and word game.
  const resources = checkResources(d.resources, 'resources');
  if (!Array.isArray(d.rack) || d.rack.length !== 8 || !(d.rack as unknown[]).every((c) => typeof c === 'string' && /^[A-Z]$/.test(c))) {
    fail('This save is damaged: the letter rack must hold 8 letters.');
  }
  if (!isInt(d.rerolls, 0, 3)) fail('This save is damaged: rerolls held must be 0 to 3.');
  if (d.tier !== 1 && d.tier !== 2 && d.tier !== 3) fail('This save is damaged: the tier must be 1, 2 or 3.');
  if (!Array.isArray(d.recentWords) || d.recentWords.length > 10 || !(d.recentWords as unknown[]).every((w) => typeof w === 'string' && /^[A-Z]{1,8}$/.test(w))) {
    fail('This save is damaged: the recent word list is not readable.');
  }
  if (!isInt(d.questsCompleted, 0, QUESTS.length)) fail(`This save is damaged: quests completed must be 0 to ${QUESTS.length}.`);
  if (!isInt(d.freeRedraws, 0, MAX_AMOUNT)) fail('This save is damaged: the free redraw count is not a sensible number.');

  if (!isObj(d.lifetime)) fail('This save is damaged: lifetime totals are missing.');
  const lt = d.lifetime as Record<string, unknown>;
  for (const k of ['submissions', 'validWords', 'longWords', 'bridgesBuilt'] as const) {
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

  if (!isObj(d.camera) || !isFiniteNum(d.camera.centreX) || !isFiniteNum(d.camera.centreY) || !isFiniteNum(d.camera.zoom) || (d.camera.zoom as number) <= 0) {
    fail('This save is damaged: the camera position is not readable.');
  }
  const cam = d.camera as Record<string, number>;

  return {
    format: SAVE_FORMAT,
    version: 1,
    savedAt: typeof d.savedAt === 'string' ? d.savedAt : '',
    seed: { text: seedObj.text, value: seedObj.value },
    tiles: { cleared, roads, bridges, flowers },
    buildings,
    resources,
    rack: [...(d.rack as string[])],
    rerolls: d.rerolls as number,
    tier: d.tier as Tier,
    lifetime: {
      submissions: lt.submissions as number,
      validWords: lt.validWords as number,
      longWords: lt.longWords as number,
      bridgesBuilt: lt.bridgesBuilt as number,
      everBuilt,
      earned,
    },
    recentWords: [...(d.recentWords as string[])],
    questsCompleted: d.questsCompleted as number,
    freeRedraws: d.freeRedraws as number,
    camera: { centreX: cam.centreX, centreY: cam.centreY, zoom: cam.zoom },
  };
}

/** Turns a checked save back into game state. Only call with a save from parseSave(). */
export function restoreGame(save: SaveV1): RestoredGame {
  const terrain = generateTerrain(save.seed.text);
  const forestCleared = new Uint8Array(TILE_COUNT);
  const roads = new Uint8Array(TILE_COUNT);
  const bridgeAxis = new Uint8Array(TILE_COUNT);
  for (const i of save.tiles.cleared) forestCleared[i] = 1;
  for (const i of save.tiles.roads) roads[i] = 1;
  for (const [i, axis] of save.tiles.bridges) {
    roads[i] = 2;
    bridgeAxis[i] = axis;
  }
  const buildings: Building[] = save.buildings.map((b, k) => ({ id: k + 1, type: b.type, x: b.x, y: b.y }));
  return {
    terrain,
    forestCleared,
    roads,
    bridgeAxis,
    flowers: save.tiles.flowers.map(([x, y]) => ({ x, y })),
    buildings,
    nextBuildingId: buildings.length + 1,
    resources: { ...save.resources },
    rack: [...save.rack],
    rerolls: save.rerolls,
    tier: save.tier,
    lifetime: { ...save.lifetime, everBuilt: { ...save.lifetime.everBuilt }, earned: { ...save.lifetime.earned } },
    recentWords: [...save.recentWords],
    questIndex: save.questsCompleted,
    freeRerolls: save.freeRedraws,
    camera: { ...save.camera },
  };
}

/** A one-line description of a save for the slot list. Population is recalculated, never stored. */
export function describeSave(save: SaveV1): { tier: Tier; population: number; words: number; buildings: number; savedAt: string } {
  const buildings = save.buildings.map((b, k) => ({ id: k + 1, ...b }));
  return {
    tier: save.tier,
    population: population(buildings),
    words: save.lifetime.validWords,
    buildings: buildings.length,
    savedAt: save.savedAt,
  };
}
