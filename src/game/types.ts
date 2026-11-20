// WordCity shared types and constants.
// Every number here traces to the Build Spec v1.1 section noted beside it.

// Section 2: logic is a square 54 x 54 grid; rendering is isometric.
export const MAP_W = 54;
export const MAP_H = 54;
// Section 2 (v1.5, Stu decision Nov 20, 2026): isometric tile 64 px wide by 40 px high, matching
// the Gemini art's measured proportions (about 1.58 : 1). Every isometric calculation reads
// these two constants.
export const TILE_W = 64;
export const TILE_H = 40;
// Section 2: world size from the projection: 3,456 x 2,160 before building overhang.
export const WORLD_W = ((MAP_W + MAP_H) * TILE_W) / 2;
export const WORLD_H = ((MAP_W + MAP_H) * TILE_H) / 2;

// Section 2: terrain types. Stored as small integers in a Uint8Array.
export const Terrain = {
  Meadow: 0,
  Forest: 1,
  Hill: 2,
  Marsh: 3,
  Thicket: 4,
  Water: 5,
} as const;
export type TerrainCode = (typeof Terrain)[keyof typeof Terrain];
export const TERRAIN_NAMES = ['meadow', 'forest', 'hill', 'marsh', 'thicket', 'water'] as const;
export type TerrainName = (typeof TERRAIN_NAMES)[number];

export interface TerrainMap {
  /** Numeric seed actually used by the generator (unsigned 32-bit). */
  seed: number;
  /** The seed as the player typed it (or the default, if the input was invalid). */
  seedText: string;
  /** True when the requested seed was invalid and the default was used instead. */
  seedWasInvalid: boolean;
  width: number;
  height: number;
  /** One TerrainCode per tile, row-major (index = y * width + x). */
  tiles: Uint8Array;
  // Visual variants are never stored: they are derived from the seed and tile coordinates
  // at render time (Section 3, variant rule 1). See src/pixi/terrainVariants.ts.
}

// Section 6: the five resources.
export type ResourceKey = 'coins' | 'lumber' | 'stone' | 'knowledge' | 'magic';
export const RESOURCE_KEYS: ResourceKey[] = ['coins', 'lumber', 'stone', 'knowledge', 'magic'];
export const RESOURCE_LABELS: Record<ResourceKey, string> = {
  coins: 'Coins',
  lumber: 'Lumber',
  stone: 'Stone',
  knowledge: 'Knowledge',
  magic: 'Magic',
};
export type Resources = Record<ResourceKey, number>;

export function emptyResources(): Resources {
  return { coins: 0, lumber: 0, stone: 0, knowledge: 0, magic: 0 };
}

// Section 7: building catalog keys.
export type BuildingType =
  | 'cottage'
  | 'sawmill'
  | 'quarry'
  | 'market'
  | 'library'
  | 'pier'
  | 'townHall'
  | 'park'
  | 'greenhouse'
  | 'tavern'
  | 'wizardTower';

export interface Building {
  id: number;
  type: BuildingType;
  /** Top-left footprint tile. */
  x: number;
  y: number;
  /**
   * Art showcase only (add ?showcase to the address): buildings placed so the art can be
   * reviewed on the map. Showcase buildings never count for population, happiness,
   * production, or quests.
   */
  preview?: boolean;
}

/** Map tools. 'clear' clears a forest tile so roads and buildings can use it (Section 4, 7). */
export type Tool = 'inspect' | 'road' | 'bridge' | 'clear' | 'remove' | BuildingType;

export type MessageKind = 'info' | 'success' | 'warn' | 'error' | 'celebrate';
export interface GameMessage {
  id: number;
  kind: MessageKind;
  text: string;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export type DictStatus = 'loading' | 'ready' | 'fallback';

export interface Lifetime {
  /** Every submission, valid or not. */
  submissions: number;
  /** Valid words only. */
  validWords: number;
  /** Valid words of 7 letters or more (Section 9, quest 7). */
  longWords: number;
  /** Bridge tiles ever built (Section 9, quest 3). */
  bridgesBuilt: number;
  /** Buildings ever built, by type (Section 9 quests; removal does not lower it). */
  everBuilt: Partial<Record<BuildingType, number>>;
  /** Section 9 uses lifetime Knowledge earned for tier unlocks. Quest rewards count too. */
  earned: Resources;
}

export type Tier = 1 | 2 | 3;
