// The single mutable game store (Build Spec v3.0, Section 10).
// Game state lives here, outside React. Pixi layers read it directly and subscribe to the
// one topic they draw. React components subscribe only to small interface values
// (resource totals, the rack's tile objects, selected tool, message line) through useGame().
//
// v2.0 additions: the rack is a list of tile objects with their own used state (Section 5);
// Hint and Swap; roads and bridges are drawn as a preview and charged once at Confirm
// (Section 4); clearing thicket and draining marsh (Section 4); the placement ghost (Section 7);
// the title screen and tutorial modes (Sections 16 and 17).
//
// v3.0 additions: material separation and the trickle (Section 6); the Growing Rack and Lantern
// Hints (Section 5); the town center and Commission orders (Section 18); road and bridge pieces,
// the banks, one network rooted at the town center, bridge landings and the removal cascade
// (Section 4); Workshop stamps, the Rune, the Reserve Shelf and the High Street (Section 19);
// dynamic terrain (Section 20); landmarks (Section 21).

import { useSyncExternalStore } from 'react';
import {
  BUILDINGS,
  LANDMARK_NAMES,
  amount,
  buildingName,
  effectiveAt,
  anyMissing,
  buildingAt,
  costList,
  costWords,
  footprintOrigin,
  happiness,
  happinessBreakdown,
  missingResources,
  notEnoughLine,
  placementProblem,
  placementReason,
  population,
  production,
  realBuildings,
  removalRefund,
} from './buildings';
import { NAME } from './config';
import { CHAIN_COMPLETE, FREE_PLAY, QUESTS, TIER_UNLOCKS, questDone, tierAfterCheck, tierRequirements, type ProgressInputs } from './progress';
import { allWords, dictionaryState, isWord, loadDictionary, type DictionaryState, type DictionaryTestMode } from './dictionary';
import { LINK_BRIDGE, LINK_ROAD, type MapContext, type Pt } from './roads';
import { generateTerrain, mulberry32 } from './terrain';
import {
  PIECE_PRICE,
  bridgeRunThrough,
  buildingConnected,
  cascadeFor,
  sharedTiles,
  checkPiece,
  computeNetwork,
  emptyBank,
  findCorridors,
  gridsFromPieces,
  highStreetBonus,
  pieceTiles,
  type Bank,
  type Dir,
  type Piece,
  type PieceCheck,
  type PieceKind,
  type PieceLen,
} from './network';
import { DISCARD_EVERY, OPEN_ORDERS, condText, makeOrder, meets, type Order } from './orders';
import { FIRST_STAMP_LINE, RUNE_EVERY, RUNE_ID, STAMP_NAMES, STAMP_PAY, STAMP_SOURCE, emptyCounters, stepStamps, type StampCounters } from './stamps';
import { LANDMARK_ORDER, LANDMARK_STAYS, earnedLine, landmarkFreeLine, landmarksEarnedBy, RIVER_BELL_TILES } from './landmarks';
import { GRAVEL_STONE, GROWTH_EVERY, OVERFLOW_EVERY, applyLand, growthStep, overflowStep, type LandChange } from './terrainChange';
import { roomiestSpot } from './founding';
import { makeSave, restoreGame, type MigrationNotes, type SaveData, type SavedCamera } from './save';
import {
  MAP_H,
  MAP_W,
  TILE_H,
  TILE_W,
  Terrain,
  emptyResources,
  type Building,
  type BuildingType,
  type Camera,
  type GameMessage,
  type LandmarkId,
  type Lifetime,
  type MessageKind,
  type RackTile,
  type Resources,
  type StampKind,
  type TerrainMap,
  type Tier,
  type Tool,
} from './types';
import {
  LANTERN_EVERY,
  LANTERN_EVERY_LIBRARY,
  LANTERN_LETTERS_PER_RACK,
  LANTERN_MAX,
  LANTERN_START,
  REPEAT_WINDOW,
  REROLL_EVERY,
  SWAP_COST_PER_TILE,
  computeWordReward,
  drawLetter,
  drawRack,
  ensurePlayable,
  formatResources,
  guideWord,
  isRepeatWord,
  longestWord,
  rackSizeFor,
  minWordLength,
  rerollsAfterValidWord,
  validateWord,
} from './words';

/** Section 6: starting resources. */
export const STARTING_RESOURCES: Resources = { coins: 20, lumber: 15, stone: 10, knowledge: 0, magic: 0 };

/** Section 4 (Stu ruling, Nov 20, 2026): clearing forest costs 2 Coins per tile. */
export const CLEAR_FOREST_COST: Resources = { coins: 2, lumber: 0, stone: 0, knowledge: 0, magic: 0 };
/** Section 4 (v2.0, Boone's call open to Stu's veto): clearing thicket, 6 Coins and 3 Lumber per tile. */
export const CLEAR_THICKET_COST: Resources = { coins: 6, lumber: 3, stone: 0, knowledge: 0, magic: 0 };
/** Section 4 (v2.0, same call): draining marsh from Tier 2, 5 Coins and 2 Lumber per tile. */
export const DRAIN_MARSH_COST: Resources = { coins: 5, lumber: 2, stone: 0, knowledge: 0, magic: 0 };
/** Section 4 (v2.0): the Drain tool opens at Tier 2. */
export const DRAIN_TIER = 2;
/** Section 5 (v2.0): a long press of 500 ms or more on the delete button clears the word. */
export const LONG_PRESS_MS = 500;

export type MapStatus = 'starting' | 'ready' | 'failed';

/** Section 16: the title screen comes first; Section 17: the tutorial is its own sandbox town. */
export type Mode = 'title' | 'town' | 'tutorial';

/** Section 4 (v2.0): a road or bridge drawn but not yet confirmed. Never saved. */
export interface RoadPreview {
  kind: 'road' | 'bridge';
  /** Tiles in the order the drag passed over them (legal or not). */
  path: Pt[];
}

/** Section 7 (v2.0): the placement ghost. Never saved. */
export interface Placement {
  type: BuildingType;
  /** Footprint origin (top-left tile) under the pointer, or null while off the map. */
  at: Pt | null;
  /** Pinned by a click (desktop) or by lifting the finger (phone): the confirm bar shows. */
  pinned: boolean;
}

/**
 * (v3.0) Section 5 Lantern Hints, per rack (never saved): whether the free length press was used,
 * the guide word (computed when the first Lantern is spent, held until the rack changes), and how
 * many letters Lanterns have placed on this rack (at most 2).
 */
export interface HintState {
  freeUsed: boolean;
  guide: string | null;
  placed: number;
  /**
   * (v3.0.2) The free press's answer, the longest word's length, shown at the rack until the rack
   * changes (new tiles, swap, reroll or a submitted word). Null before the free press.
   */
  longest: number | null;
  /** (v3.0.2) Hint was pressed while the word list was loading; the free reveal fires when it is ready. */
  pending: boolean;
}

/** (v3.0) Section 4: a picked road or bridge piece, before Confirm. Never saved. */
export interface PieceGhost {
  kind: PieceKind;
  len: PieceLen;
  dir: Dir;
  /** The anchor tile (the piece's first tile), or null before the first tap or hover. */
  anchor: Pt | null;
}

/** (v3.0) A removal waiting for its one confirmation (Sections 4 and 7). */
export type PendingRemoval =
  | { kind: 'building'; buildingId: number; type: BuildingType; refund: Resources }
  | {
      kind: 'piece';
      pieceId: number;
      pieceKind: PieceKind;
      len: number;
      legacy: boolean;
      cascade: number[];
      names: string[];
      /** (v3.0.2) Tiles of this piece another piece also covers; they stay on the map. */
      shared: number;
    };

/** (v3.0) Section 20: the dynamic terrain counters (saved). */
export interface TerrainTicks {
  sinceGrowth: number;
  sinceOverflow: number;
  growthTicks: number;
  overflowTicks: number;
}

/** Section 5 (v2.0): swap mode and the tiles selected for it. Never saved. */
export interface SwapState {
  active: boolean;
  selected: number[];
}

/** Section 17: what the tutorial flow locks or marks while it runs (read by the UI and map). */
export interface TutorialLocks {
  /** Word submission is enabled only in steps 3 and 9. */
  submit: boolean;
  /** Tools the current step allows (others are disabled). 'all' outside action steps. */
  tools: Tool[] | 'all';
}

/** Marks the tutorial draws on the map: gold plot outlines, the start marker, terrain labels. */
export interface MapMarks {
  plots: { x: number; y: number; w: number; h: number }[];
  start: Pt | null;
  labels: { x: number; y: number; text: string; lit: boolean }[];
}

export interface GameState {
  mode: Mode;
  /** The map. (v3.0) terrain.tiles is the CURRENT terrain (Section 20 changes it); baseTiles is the generated map. */
  terrain: TerrainMap;
  /** (v3.0) The generated base map, never changed (saves store the difference). */
  baseTiles: Uint8Array;
  /** (v3.0) Section 20: flood gravel deposits (1 = gravel). */
  gravel: Uint8Array;
  /** (v3.0) Section 4: placed road and bridge pieces. `roads` and `bridgeAxis` are rebuilt from them. */
  pieces: Piece[];
  nextPieceId: number;
  /** Which piece covers each tile (0 = none). Rebuilt with the grids. */
  pieceAt: Int32Array;
  /** (v3.0) Section 4: bought pieces waiting to be laid, by length. */
  roadBank: Bank;
  bridgeBank: Bank;
  pieceGhost: PieceGhost | null;
  /** The ghost was tapped into place (desktop hover stops moving it until the next tap). */
  pieceGhostPinned: boolean;
  /** (v3.0) Section 4: the network (town center tiles and connected road and bridge tiles). Cached. */
  net: Uint8Array;
  /** (v3.0) Tiles the map should repaint in place on the next 'tiles' event (null = the whole map). */
  dirtyTiles: number[] | null;
  /** (v3.0) Section 5: Lanterns held and valid words toward the next one. */
  lanterns: number;
  lanternProgress: number;
  /** (v3.0) Section 19: words since each producer type's last stamp, and the kinds seen so far. */
  stampCounters: StampCounters;
  stampsSeen: StampKind[];
  /** (v3.0) Section 19: the Rune (held, and its chosen letter while it is in the word) and its charge counter. */
  rune: { held: boolean; letter: string | null };
  runeCounter: number;
  /** (v3.0) Section 19: the Reserve Shelf's tile, and whether a tap on the shelf is waiting for a rack tile. */
  shelf: RackTile | null;
  shelfArmed: boolean;
  /** (v3.0) Section 18: the 3 open Commission orders and the free discard counter. */
  orders: Order[];
  nextOrderId: number;
  wordsSinceDiscard: number;
  /** (v3.0) The orders panel is open. */
  ordersOpen: boolean;
  /** (v3.0) Section 21: landmarks earned (placed ones are buildings of type 'landmark'). */
  landmarksEarned: LandmarkId[];
  /** (v3.0) Section 20 counters. */
  ticks: TerrainTicks;
  /**
   * 1 where the player changed the land (Section 4, v2.0): forest to cleared forest, thicket to
   * cleared thicket, marsh to drained marsh (meadow). Saved as tile changes (Section 11).
   */
  cleared: Uint8Array;
  /** 0 = nothing, 1 = road, 2 = bridge (Section 4). */
  roads: Uint8Array;
  /** Bridge deck direction per tile: 1 = north-south, 2 = east-west (Section 4). */
  bridgeAxis: Uint8Array;
  /** A removal waiting for the player's confirmation (Sections 4 and 7). */
  pendingRemoval: PendingRemoval | null;
  /** Section 5 dead rack rule: free redraws given so far (for tests and the town summary). */
  freeRerolls: number;
  /** Section 9: index of the current quest in QUESTS (QUESTS.length = chain complete). */
  questIndex: number;
  buildings: Building[];
  nextBuildingId: number;
  /** Section 5: decorative flower patches from long words. */
  flowers: { x: number; y: number }[];
  resources: Resources;
  /** Section 5 (v2.0): the rack as tile objects. A new array whenever any tile changes. */
  rack: RackTile[];
  /** Section 5 (v2.0): the current word, as tile ids in the order the letters were placed. */
  word: number[];
  hint: HintState;
  swap: SwapState;
  /** Visual only: the rack shakes the used tiles of this letter once (n changes each time). */
  shake: { letter: string; n: number } | null;
  rerolls: number;
  tier: Tier;
  lifetime: Lifetime;
  /** (v3.0) Placement of an earned landmark (the tool is 'landmark'). */
  landmarkPick: LandmarkId | null;
  /** Section 5: the last 10 submitted valid words, oldest first. */
  recentWords: string[];
  camera: Camera;
  /** Size of the map view the camera was last set for (to save the camera as a view centre). */
  cameraView: { w: number; h: number };
  /**
   * Section 11: a camera from a loaded save, waiting for the map to apply it. Saved cameras
   * are the world point at the centre of the view, so they fit any screen (desktop or phone).
   */
  pendingCamera: SavedCamera | null;
  /** Section 17: a requested camera move to a tile (the map pans there in about 600 ms). */
  cameraGoal: { x: number; y: number; id: number } | null;
  tool: Tool;
  preview: RoadPreview | null;
  placement: Placement | null;
  /** The tile under the pointer or last touched, for the Clear and Drain tool chip (Section 4). */
  toolTile: Pt | null;
  message: GameMessage;
  /** Short persistent notice, e.g. when the fallback dictionary is in use. */
  notice: string | null;
  dict: DictionaryState;
  mapStatus: MapStatus;
  locks: TutorialLocks;
  marks: MapMarks;
}

/**
 * 'tiles' = the ground itself changed (a tile was cleared or drained), so terrain is repainted.
 * 'load' = a whole town was loaded or a new one started (Section 11): the map repaints its
 * terrain and water and moves the camera. The stage and the app are never rebuilt.
 * 'word' = the current word, Hint or Swap changed (never saved, never autosaved).
 * 'preview' = the road or bridge preview or the placement ghost changed.
 */
export type Topic =
  | 'terrain'
  | 'tiles'
  | 'roads'
  | 'buildings'
  | 'resources'
  | 'rack'
  | 'word'
  | 'tool'
  | 'preview'
  | 'message'
  | 'camera'
  | 'cameraGoal'
  | 'marks'
  | 'meta'
  | 'mode'
  | 'load';

type Listener = () => void;
const topicListeners = new Map<Topic, Set<Listener>>();
const anyListeners = new Set<Listener>();
let messageCounter = 0;
let tileCounter = 0;
let goalCounter = 0;

function urlFlag(name: string): boolean {
  try {
    return new URLSearchParams(window.location.search).has(name);
  } catch {
    return false;
  }
}

/** Test switch ?sandbox: every tier unlocked and plenty of resources, for trying placement. */
const SANDBOX = typeof window !== 'undefined' && urlFlag('sandbox');

/** Section 5 (v2.0): fresh tile objects with fresh session-unique ids. */
export function makeTiles(letters: string[]): RackTile[] {
  return letters.map((letter) => ({ id: ++tileCounter, letter, used: false }));
}

const NO_LOCKS: TutorialLocks = { submit: true, tools: 'all' };
const NO_MARKS: MapMarks = { plots: [], start: null, labels: [] };

/** Lifetime totals for a new town. */
export function freshLifetime(): Lifetime {
  return { submissions: 0, validWords: 0, longWords: 0, bridgesBuilt: 0, everBuilt: {}, earned: emptyResources(), ordersCompleted: 0, stampedWords: 0 };
}

/**
 * (v3.0) Section 18 founding search: the tile nearest the map centre (27, 27) whose full 2 by 2
 * footprint is meadow or cleared land, unoccupied and inside the map; the search widens ring by
 * ring to the whole map. Returns the footprint's top-left tile, or null if none fits anywhere.
 */
export function foundingSpot(tiles: Uint8Array, cleared: Uint8Array, occupied: (x: number, y: number) => boolean, gravel?: Uint8Array): Pt | null {
  // (v3.0.1) Stu's roomier-founding ruling: the roomiest fitting spot in the middle band (founding.ts).
  return roomiestSpot((x, y) => {
    if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return false;
    const i = y * MAP_W + x;
    return effectiveAt(tiles, cleared, i) === Terrain.Meadow && !occupied(x, y) && !gravel?.[i];
  });
}

function freshState(seedInput: unknown, opts: { sandbox?: boolean; noCenter?: boolean } = {}): GameState {
  const terrain = generateTerrain(seedInput);
  const sandbox = opts.sandbox ?? SANDBOX;
  const cleared = new Uint8Array(MAP_W * MAP_H);
  const buildings: Building[] = [];
  // (v3.0) Section 18: the town center is placed as part of map setup, before the first action.
  const spot = opts.noCenter ? null : foundingSpot(terrain.tiles, cleared, () => false);
  if (spot) buildings.push({ id: 1, type: 'townCenter', x: spot.x, y: spot.y });
  const roads = new Uint8Array(MAP_W * MAP_H);
  const state: GameState = {
    mode: 'title',
    terrain: { ...terrain, tiles: terrain.tiles.slice() },
    baseTiles: terrain.tiles,
    gravel: new Uint8Array(MAP_W * MAP_H),
    pieces: [],
    nextPieceId: 1,
    pieceAt: new Int32Array(MAP_W * MAP_H),
    roadBank: emptyBank(),
    bridgeBank: emptyBank(),
    pieceGhost: null,
    pieceGhostPinned: false,
    net: computeNetwork(roads, buildings),
    dirtyTiles: null,
    lanterns: LANTERN_START,
    lanternProgress: 0,
    stampCounters: emptyCounters(),
    stampsSeen: [],
    rune: { held: false, letter: null },
    runeCounter: 0,
    shelf: null,
    shelfArmed: false,
    orders: [],
    nextOrderId: 1,
    wordsSinceDiscard: 0,
    ordersOpen: false,
    landmarksEarned: [],
    ticks: { sinceGrowth: 0, sinceOverflow: 0, growthTicks: 0, overflowTicks: 0 },
    cleared,
    roads,
    bridgeAxis: new Uint8Array(MAP_W * MAP_H),
    pendingRemoval: null,
    freeRerolls: 0,
    questIndex: 0,
    buildings,
    nextBuildingId: buildings.length + 1,
    flowers: [],
    resources: sandbox ? { coins: 9999, lumber: 9999, stone: 9999, knowledge: 9999, magic: 9999 } : { ...STARTING_RESOURCES },
    rack: makeTiles(drawRack(Math.random, rackSizeFor({}))),
    word: [],
    hint: { freeUsed: false, guide: null, placed: 0, longest: null, pending: false },
    swap: { active: false, selected: [] },
    shake: null,
    rerolls: 0,
    tier: sandbox ? 3 : 1,
    lifetime: freshLifetime(),
    landmarkPick: null,
    recentWords: [],
    camera: { x: 0, y: 0, zoom: 1 },
    cameraView: { w: 0, h: 0 },
    pendingCamera: null,
    cameraGoal: null,
    tool: 'inspect',
    preview: null,
    placement: null,
    toolTile: null,
    message: {
      id: ++messageCounter,
      kind: 'info',
      text: terrain.seedWasInvalid
        ? `That map seed could not be used, so the default map "${terrain.seedText}" was made instead.`
        : `Welcome to ${NAME}. Make a word from your letters to earn resources.`,
    },
    notice: null,
    dict: dictionaryState(),
    mapStatus: 'starting',
    locks: NO_LOCKS,
    marks: NO_MARKS,
  };
  return state;
}

/** The seed from the ?seed test switch, if the address has one. */
export function seedFromUrl(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('seed');
  } catch {
    return null;
  }
}

export function randomSeed(): string {
  return String(Math.floor(Math.random() * 1e9));
}

/**
 * Section 16: no town exists before the player leaves the title screen. The store still needs
 * a state object, so it starts with a placeholder that is never drawn, saved or shown: the map
 * is not mounted until a town is entered, and every way in replaces this state.
 */
export const store = {
  state: freshState(typeof window === 'undefined' ? 'lexington' : seedFromUrl() ?? randomSeed()),

  subscribe(topic: Topic, fn: Listener): () => void {
    let set = topicListeners.get(topic);
    if (!set) topicListeners.set(topic, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  },

  subscribeAny(fn: Listener): () => void {
    anyListeners.add(fn);
    return () => anyListeners.delete(fn);
  },

  emit(...topics: Topic[]): void {
    for (const t of topics) topicListeners.get(t)?.forEach((fn) => fn());
    anyListeners.forEach((fn) => fn());
  },
};

// ---------- hooks for the tutorial flow (Section 17) ----------

/** The tutorial flow listens here; the store never imports it (no circular imports). */
export const hooks: {
  onWord?: (info: { ok: boolean; produced: boolean }) => void;
  onPathConfirmed?: (kind: 'road' | 'bridge', tiles: Pt[]) => void;
  onBuilt?: (b: Building) => void;
  onToolChange?: (tool: Tool) => void;
  /**
   * Tutorial build steps only: a reason a building may not go at this footprint origin (the
   * marked plot), checked after the normal Section 7 reasons. Null when the spot is fine.
   */
  placementGuard?: (type: BuildingType, x: number, y: number) => string | null;
  /**
   * Tutorial build steps only: a reason Remove may not act on this tile (a building, or else the
   * road or bridge piece on it). Null when it may.
   */
  removeGuard?: (x: number, y: number, b: Building | undefined, piece: Piece | undefined) => string | null;
  onRemoved?: (b: Building) => void;
  /** (v3.0.1) A road or bridge piece left the map through Remove (the tutorial's safety net listens). */
  onPieceRemoved?: (piece: Piece) => void;
  /**
   * (v3.0.1) Tutorial road steps only: the tiles of a piece that would cover a reserved plot, and
   * the reason. Null (or no tiles) when the piece is clear of every reserved plot.
   */
  pieceGuard?: (tiles: Pt[]) => { tiles: Pt[]; reason: string } | null;
  /** (v3.0) A road or bridge piece was bought (the tutorial's wallet handling listens). */
  onBought?: (kind: PieceKind, len: PieceLen) => void;
} = {};

// ---------- derived values (never stored, Section 8) ----------

/** (v3.0) Section 4: a building is connected when a side of its footprint touches the network. */
export function isRoadConnected(b: Building): boolean {
  return buildingConnected(b, store.state.net);
}

/** (v3.0) Recomputes the cached network (Section 10: on road, bridge or building changes only). */
function refreshNetwork(): void {
  const s = store.state;
  s.net = computeNetwork(s.roads, s.buildings);
}

/** (v3.0) Replaces the pieces and rebuilds the grids and the network. */
function setPieces(pieces: Piece[]): void {
  const s = store.state;
  const g = gridsFromPieces(pieces);
  s.pieces = pieces;
  s.roads = g.roads;
  s.bridgeAxis = g.bridgeAxis;
  s.pieceAt = g.pieceAt;
  refreshNetwork();
}

/** (v3.0) Section 5: the rack size the town has earned. */
export function rackSize(): number {
  return rackSizeFor(store.state.lifetime.everBuilt);
}

/** Connected buildings of a type (the cadence, the trickle, the shelf and the Rune read this). */
export function connectedCount(type: BuildingType): number {
  return realBuildings(store.state.buildings).filter((b) => b.type === type && isRoadConnected(b)).length;
}

/** (v3.0) Section 19: the shelf works only while a Scribe stands and is road-connected. */
export function shelfUnlocked(): boolean {
  return connectedCount('scribe') > 0;
}

/** (v3.0) Section 19: the High Street bonus the next word would get, and the corridors. */
export function highStreetNow(): { bonus: number; corridors: number } {
  const s = store.state;
  const c = findCorridors(s.roads, s.net, s.buildings);
  return { bonus: highStreetBonus(c), corridors: c.length };
}

/** (v3.0) Section 12: buildings that stand but are not connected to the town center. */
export function disconnectedBuildings(): Building[] {
  return realBuildings(store.state.buildings).filter((b) => b.type !== 'townCenter' && b.type !== 'landmark' && !isRoadConnected(b));
}

export function currentPopulation(): number {
  return population(store.state.buildings);
}

export function currentHappiness(): number {
  return happiness({ buildings: store.state.buildings, tier: store.state.tier, isRoadConnected });
}

/** Section 8: each part of the happiness score, for the town summary. */
export function currentHappinessBreakdown() {
  return happinessBreakdown({ buildings: store.state.buildings, tier: store.state.tier, isRoadConnected });
}

/** Everything Section 9 looks at, read from the store. */
export function progressInputs(): ProgressInputs {
  const s = store.state;
  return {
    population: population(s.buildings),
    happiness: currentHappiness(),
    knowledgeEarned: s.lifetime.earned.knowledge,
    everBuilt: s.lifetime.everBuilt,
    bridgesBuilt: s.lifetime.bridgesBuilt,
    validWords: s.lifetime.validWords,
    longWords: s.lifetime.longWords,
    ordersCompleted: s.lifetime.ordersCompleted,
    stampedWords: s.lifetime.stampedWords,
  };
}

/** Section 9: requirements for the next tier (empty at Tier 3). */
export function nextTierRequirements() {
  const t = store.state.tier;
  return t >= 3 ? [] : tierRequirements((t + 1) as 2 | 3, progressInputs());
}

/**
 * Section 9: checks quests and tiers after anything that could change them, pays quest
 * rewards, unlocks tiers (never relocks), and returns the messages to show (Section 12).
 * Section 17: in the tutorial, quests do not run and the tier stays at Tier 1.
 */
function checkProgress(): string[] {
  const s = store.state;
  if (s.mode === 'tutorial') return [];
  const out: string[] = [];
  refreshNetwork();
  // Quests: complete in order; a revealed quest that is already satisfied completes at once.
  while (s.questIndex < QUESTS.length && questDone(s.questIndex, progressInputs())) {
    const q = QUESTS[s.questIndex];
    const next = { ...s.resources };
    const earned = { ...s.lifetime.earned };
    for (const k of Object.keys(next) as (keyof Resources)[]) {
      next[k] += q.reward[k];
      earned[k] += q.reward[k];
    }
    s.resources = next;
    s.lifetime = { ...s.lifetime, earned };
    s.questIndex++;
    out.push(`Quest complete: ${q.title}! ${formatResources(q.reward)}.`);
    if (s.questIndex === QUESTS.length) out.push(CHAIN_COMPLETE, FREE_PLAY);
  }
  // Tiers (after quests: a quest reward can push lifetime Knowledge over the line).
  const before = s.tier;
  const after = tierAfterCheck(before, progressInputs());
  if (after !== before) {
    s.tier = after;
    for (let t = before + 1; t <= after; t++) out.push(`Tier ${t} unlocked! ${TIER_UNLOCKS[t as 2 | 3]}`);
    const dead = applyDeadRackRule(); // the minimum word length may have risen
    if (dead) out.push(dead);
  }
  out.push(...earnLandmarks());
  return out;
}

/** (v3.0) Section 21: grants every landmark the lifetime record has newly earned. */
function earnLandmarks(riverBell = false): string[] {
  const s = store.state;
  const had = s.landmarksEarned.includes('riverBell');
  const now = landmarksEarnedBy(s.lifetime.everBuilt, had || riverBell);
  const fresh = now.filter((id) => !s.landmarksEarned.includes(id));
  if (!fresh.length) return [];
  s.landmarksEarned = LANDMARK_ORDER.filter((id) => s.landmarksEarned.includes(id) || fresh.includes(id));
  return fresh.map(earnedLine);
}

/** Runs the Section 9 check and adds its messages to the current message line. */
function announceProgress(): void {
  const extra = checkProgress();
  if (extra.length === 0) return;
  const s = store.state;
  s.message = { id: ++messageCounter, kind: 'celebrate', text: `${s.message.text} ${extra.join(' ')}` };
  store.emit('message', 'resources', 'rack', 'word', 'meta');
}

// ---------- messages ----------

export function say(text: string, kind: MessageKind = 'info'): void {
  store.state.message = { id: ++messageCounter, kind, text };
  store.emit('message');
}

// ---------- Section 5: the rack, tile identity, and the current word ----------

/** The letters of the rack, left to right (what a save stores). */
export function rackLetters(): string[] {
  return store.state.rack.map((t) => t.letter);
}

/** The letter an id in the word stands for (the Rune's chosen letter for RUNE_ID). */
function letterOf(id: number): string {
  const s = store.state;
  if (id === RUNE_ID) return s.rune.letter ?? '?';
  return s.rack.find((t) => t.id === id)?.letter ?? '';
}

/** The current word as text, in the order the letters were placed. */
export function currentWord(): string {
  return store.state.word.map(letterOf).join('');
}

/** (v3.0) Section 19: the Rune is in the current word. */
export function runeInWord(): boolean {
  return store.state.word.includes(RUNE_ID);
}

const freshHint = (): HintState => ({ freeUsed: false, guide: null, placed: 0, longest: null, pending: false });

/**
 * Replaces the rack's tiles. Any change to the rack resets the Lantern hint state (Section 5) and
 * leaves swap mode. The word is cleared unless `keepWord` (the tiles in it are still in the rack).
 */
function setRack(tiles: RackTile[], keepWord = false): void {
  const s = store.state;
  s.rack = tiles;
  if (keepWord) {
    s.word = s.word.filter((id) => id === RUNE_ID || tiles.some((t) => t.id === id));
  } else {
    s.word = s.word.filter((id) => id === RUNE_ID);
    if (!s.word.length) s.rune = { ...s.rune, letter: null };
  }
  s.hint = freshHint();
  s.swap = { active: false, selected: [] };
  markUsed();
}

function markUsed(): void {
  const s = store.state;
  const inWord = new Set(s.word);
  s.rack = s.rack.map((t) => (t.used === inWord.has(t.id) ? t : { ...t, used: inWord.has(t.id) }));
}

/**
 * Tapping a tile greys that exact tile and appends its id to the word. Tapping a tile that is
 * already used removes that tile's id from the word, wherever it sits, and un-greys it; the
 * other letters stay in place. In swap mode a tap selects the tile for the swap instead. (v3.0) A
 * tap after tapping the shelf stashes or swaps with the shelf (Section 19).
 */
export function tapTile(id: number): void {
  const s = store.state;
  const tile = s.rack.find((t) => t.id === id);
  if (!tile) return;
  if (s.swap.active) {
    toggleSwapSelect(id);
    return;
  }
  if (s.shelfArmed) {
    shelfWithTile(id);
    return;
  }
  if (tile.used) s.word = s.word.filter((w) => w !== id);
  else s.word = [...s.word, id];
  markUsed();
  store.emit('word');
}

/**
 * A desktop letter key consumes the first unused tile with that letter, scanning from the left.
 * (v3.0) If one unused tile with that letter carries a stamp and another does not, the stamped
 * tile goes first, so keyboard play can always reach a stamp.
 */
export function typeLetter(letter: string): boolean {
  const s = store.state;
  const L = letter.toUpperCase();
  if (s.swap.active) return false;
  const free = s.rack.filter((t) => t.letter === L && !t.used);
  const tile = free.find((t) => t.stamp) ?? free[0];
  if (!tile) {
    // No unused tile has that letter: nothing is placed, and the used tiles shake once.
    s.shake = { letter: L, n: (s.shake?.n ?? 0) + 1 };
    store.emit('word');
    return false;
  }
  s.word = [...s.word, tile.id];
  markUsed();
  store.emit('word');
  return true;
}

/** Deleting removes the last id in the word list and frees exactly that tile (or the Rune). */
export function deleteLast(): void {
  const s = store.state;
  if (s.word.length === 0) return;
  const last = s.word[s.word.length - 1];
  s.word = s.word.slice(0, -1);
  if (last === RUNE_ID) s.rune = { ...s.rune, letter: null };
  markUsed();
  store.emit('word');
}

/** Section 5: a long press of the delete button clears the whole word. */
export function clearWord(announce = true): void {
  const s = store.state;
  if (s.word.length === 0) return;
  s.word = [];
  s.rune = { ...s.rune, letter: null };
  markUsed();
  if (announce) s.message = { id: ++messageCounter, kind: 'info', text: 'Word cleared.' };
  store.emit('word', 'message');
}

/** Tapping a placed letter in the word display takes that letter back (its tile frees). */
export function removeFromWord(id: number): void {
  const s = store.state;
  if (!s.word.includes(id)) return;
  s.word = s.word.filter((w) => w !== id);
  if (id === RUNE_ID) s.rune = { ...s.rune, letter: null };
  markUsed();
  store.emit('word');
}

// ---------- (v3.0) Section 19: the Rune ----------

/** Tapping the Rune adds it to the word (the letter strip opens); tapping it again takes it back. */
export function tapRune(): void {
  const s = store.state;
  if (!s.rune.held) return;
  if (s.swap.active || s.shelfArmed) {
    say('The Rune cannot be swapped or shelved.', 'info');
    return;
  }
  if (runeInWord()) {
    removeFromWord(RUNE_ID);
    return;
  }
  s.word = [...s.word, RUNE_ID];
  s.rune = { ...s.rune, letter: null };
  store.emit('word');
}

/** The player picks the letter the Rune stands for. */
export function chooseRuneLetter(letter: string): void {
  const s = store.state;
  if (!runeInWord()) return;
  const L = letter.toUpperCase();
  if (!/^[A-Z]$/.test(L)) return;
  s.rune = { ...s.rune, letter: L };
  store.emit('word');
}

// ---------- (v3.0) Section 19: the Reserve Shelf ----------

export const SHELF_LOCKED_LINE = 'The Scribe is not connected to the town center. The shelf is locked.';

/**
 * Tapping the shelf. Empty shelf: the next rack tile tapped is set aside (build reading: the
 * shelf tap arms the stash, so a plain tile tap still spells). Shelf holding a letter: the next
 * rack tile tapped swaps with it; tapping the shelf again swaps it with the rightmost rack tile.
 */
export function tapShelf(): void {
  const s = store.state;
  if (!realBuildings(s.buildings).some((b) => b.type === 'scribe') && !s.shelf) return;
  if (!shelfUnlocked()) {
    say(SHELF_LOCKED_LINE, 'info');
    return;
  }
  if (s.swap.active) cancelSwap(false);
  if (s.shelfArmed) {
    if (s.shelf) {
      const free = s.rack.filter((t) => !t.used);
      const right = free[free.length - 1];
      if (right) shelfWithTile(right.id);
      return;
    }
    s.shelfArmed = false;
    say('Nothing was set aside.', 'info');
    store.emit('word');
    return;
  }
  s.shelfArmed = true;
  say(s.shelf ? 'Tap a rack tile to swap it with the shelf, or tap the shelf again for the rightmost tile.' : 'Tap a rack tile to set it aside on the shelf.', 'info');
  store.emit('word');
}

function shelfWithTile(id: number): void {
  const s = store.state;
  s.shelfArmed = false;
  const tile = s.rack.find((t) => t.id === id);
  if (!tile) return;
  if (!shelfUnlocked()) {
    say(SHELF_LOCKED_LINE, 'info');
    store.emit('word');
    return;
  }
  if (tile.used) {
    say('That tile is in your word. Take it back first.', 'info');
    store.emit('word');
    return;
  }
  const keep = { ...tile, used: false };
  if (!s.shelf) {
    // Stash: the tile moves to the shelf and a fresh tile is drawn into the rack at once.
    s.shelf = keep;
    setRack(s.rack.map((t) => (t.id === id ? { id: ++tileCounter, letter: drawLetter(), used: false } : t)), true);
    const dead = applyDeadRackRule();
    say(`${keep.letter} is on the shelf. A fresh tile was drawn.${dead ? ' ' + dead : ''}`, 'success');
  } else {
    const back = { ...s.shelf, used: false };
    s.shelf = keep;
    setRack(s.rack.map((t) => (t.id === id ? back : t)), true);
    say(`Swapped ${keep.letter} for ${back.letter} from the shelf.`, 'success');
  }
  store.emit('rack', 'word', 'message', 'meta');
}

// ---------- submitting a word ----------

export interface SubmitOutcome {
  ok: boolean;
}

/** Placed tiles of the current word (the Rune is not a rack tile). */
function wordTiles(): RackTile[] {
  const s = store.state;
  return s.word.filter((id) => id !== RUNE_ID).map((id) => s.rack.find((t) => t.id === id)!).filter(Boolean);
}

/**
 * Section 5 submission flow with Section 12 messages, (v3.0) Sections 6, 18, 19 and 20. The word is
 * the placed tiles (and the Rune as its chosen letter). On a valid word the used tiles are removed
 * by id, the unused tiles keep their ids, positions and stamps, and new tiles with fresh ids fill
 * the empty slots up to the current rack size. `text` is for tests: it places those letters first.
 */
export function submitWord(text?: string): SubmitOutcome {
  const s = store.state;
  if (s.preview || s.pieceGhost?.anchor) {
    say('Confirm or cancel the piece first.', 'info');
    return { ok: false };
  }
  if (!s.locks.submit) {
    say('Words are paused for this step of the tour.', 'info');
    return { ok: false };
  }
  if (text !== undefined) {
    s.word = [];
    s.rune = { ...s.rune, letter: null };
    markUsed();
    for (const ch of text.toUpperCase().replace(/[^A-Z]/g, '')) typeLetter(ch);
  }
  if (s.swap.active) cancelSwap(false);
  s.shelfArmed = false;
  if (runeInWord() && !s.rune.letter) {
    say('Choose a letter for the Rune first.', 'info');
    return { ok: false };
  }
  const word = currentWord();
  const pool = rackLetters();
  if (runeInWord() && s.rune.letter) pool.push(s.rune.letter);
  const result = validateWord(word, pool, s.tier, isWord);
  s.lifetime = { ...s.lifetime, submissions: s.lifetime.submissions + 1 };

  if (!result.ok) {
    switch (result.reason) {
      case 'empty':
        say('Tap letters to make a word first.', 'warn');
        break;
      case 'short':
        say(`Words need at least ${result.min} letters${s.tier > 1 ? ' from Tier 2 on' : ''}.`, 'warn');
        break;
      case 'letters':
        say(
          result.have === 0
            ? `Your rack has no ${result.letter}.`
            : `That word needs ${result.need} ${result.letter}'s, but your rack has only ${result.have}.`,
          'warn',
        );
        break;
      case 'dictionary':
        say(`"${result.word}" isn't in the ${NAME} dictionary.`, 'warn');
        break;
      case 'loading':
        say('The word list is still loading. Try that word again in a moment.', 'info');
        break;
    }
    hooks.onWord?.({ ok: false, produced: false });
    return { ok: false };
  }

  refreshNetwork();
  const used = wordTiles();
  const usedStamps = used.filter((t) => t.stamp).map((t) => t.stamp!) as StampKind[];
  const usedRune = runeInWord();
  const repeat = isRepeatWord(result.word, s.recentWords);
  const wizardTowerStanding = realBuildings(s.buildings).some((b) => b.type === 'wizardTower');
  // Section 19: the High Street, computed from the town as it stands at submission.
  const street = highStreetNow();
  const effLength = result.word.length + street.bonus;
  const gilded = usedStamps.includes('gilded');
  const reward = computeWordReward(result.word, { isRepeat: repeat, wizardTowerStanding, effLength, gilded });
  const validWords = s.lifetime.validWords + 1;
  // Section 6: the trickle (production, never halved).
  const made = production(s.buildings, isRoadConnected, validWords);
  // Section 19: Oak and Granite stamps pay as production.
  const stampPay = emptyResources();
  for (const k of usedStamps) {
    if (k === 'oak') stampPay.lumber += STAMP_PAY;
    if (k === 'granite') stampPay.stone += STAMP_PAY;
  }
  // Section 18: orders check the real word, never the payout (a halved repeat still completes).
  const done = s.orders.filter((o) => meets(o.cond, result.word, usedStamps.length > 0));
  const orderPay = emptyResources();
  for (const o of done) orderPay[o.reward.res] += o.reward.amount;

  const gained = emptyResources();
  const next = { ...s.resources };
  const earned = { ...s.lifetime.earned };
  for (const k of Object.keys(gained) as (keyof Resources)[]) {
    gained[k] = reward.total[k] + made[k] + stampPay[k] + orderPay[k];
    next[k] += gained[k];
    earned[k] += gained[k];
  }

  const rerollsBefore = s.rerolls;
  s.resources = next;
  s.lifetime = {
    ...s.lifetime,
    validWords,
    earned,
    longWords: s.lifetime.longWords + (result.word.length >= 7 ? 1 : 0),
    ordersCompleted: s.lifetime.ordersCompleted + done.length,
    stampedWords: s.lifetime.stampedWords + (usedStamps.length > 0 ? 1 : 0),
  };
  s.recentWords = [...s.recentWords, result.word].slice(-REPEAT_WINDOW);
  // Used tiles go by id (with their stamps); the others keep their ids, positions and stamps;
  // fresh tiles fill the gaps up to the current rack size.
  const usedIds = new Set(used.map((t) => t.id));
  const kept = s.rack.map((t) => (usedIds.has(t.id) ? { id: ++tileCounter, letter: drawLetter(), used: false } : { ...t, used: false }));
  const size = rackSize();
  while (kept.length < size) kept.push({ id: ++tileCounter, letter: drawLetter(), used: false });
  s.word = [];
  setRack(kept.slice(0, Math.max(size, kept.length)));
  if (usedRune) s.rune = { held: false, letter: null }; // Section 19: consumed by the submission
  s.rerolls = rerollsAfterValidWord(validWords, s.rerolls);

  const parts: string[] = [];
  parts.push(
    repeat
      ? `${result.word} again: you played it within your last ${REPEAT_WINDOW} words, so it earns half. ${formatResources(reward.total)}.`
      : `${result.word}! ${formatResources(reward.total)}.`,
  );
  if (street.bonus > 0) parts.push(`High Street: this word pays as a ${effLength} letter word.`);
  if (gilded) parts.push('Gilded stamp: double Coins.');
  if (reward.longWordBonus) {
    parts.push('Long word bonus: +1 Magic and a flower patch near town.');
    addFlowerPatch();
  }
  const madeText = formatResources(made);
  if (madeText) parts.push(`Your town produced ${madeText}.`);
  for (const k of usedStamps) {
    if (k === 'oak') parts.push(`Oak stamp: plus ${STAMP_PAY} Lumber.`);
    if (k === 'granite') parts.push(`Granite stamp: plus ${STAMP_PAY} Stone.`);
  }
  // Section 18: completed orders pay and are replaced at once.
  for (const o of done) {
    parts.push(`Commission complete: ${condText(o.cond).replace(/\.$/, '')}. Paid ${amount(o.reward.res, o.reward.amount)}.`);
  }
  if (done.length) {
    const ids = new Set(done.map((o) => o.id));
    s.orders = s.orders.filter((o) => !ids.has(o.id));
    fillOrders();
  }
  s.wordsSinceDiscard = Math.min(DISCARD_EVERY, s.wordsSinceDiscard + 1);
  // The dead rack check runs on the refilled rack BEFORE new stamps are placed, so a stamp just
  // earned is never lost to the free redraw (Section 19: a redraw, like a reroll, takes the
  // stamps on the tiles it replaces).
  const deadRack = applyDeadRackRule();
  parts.push(...stepWordSystems());
  if (s.rerolls > rerollsBefore) parts.push(`You earned a reroll (${s.rerolls} held).`);
  else if (validWords % REROLL_EVERY === 0 && s.rerolls === rerollsBefore) parts.push('Reroll limit reached (3 held).');
  if (deadRack) parts.push(deadRack);
  // Section 20: terrain ticks on word submissions only.
  parts.push(...tickTerrain());

  store.state.message = { id: ++messageCounter, kind: 'success', text: parts.join(' ') };
  store.emit('resources', 'rack', 'word', 'message', 'meta');
  announceProgress();
  hooks.onWord?.({ ok: true, produced: madeText.length > 0 || usedStamps.length > 0 });
  return { ok: true };
}

/**
 * (v3.0) After each valid word: Lanterns (Section 5), Workshop stamps and the Rune (Section 19).
 * Returns the message lines.
 */
function stepWordSystems(): string[] {
  const s = store.state;
  const out: string[] = [];
  // Lanterns: 1 per 10 valid words, 1 per 5 with a connected Library; held up to 3 (extra lost).
  const every = connectedCount('library') > 0 ? LANTERN_EVERY_LIBRARY : LANTERN_EVERY;
  s.lanternProgress += 1;
  if (s.lanternProgress >= every) {
    s.lanternProgress = 0;
    if (s.lanterns < LANTERN_MAX) {
      s.lanterns += 1;
      out.push(`You earned a Lantern (${s.lanterns} held).`);
    }
  }
  // Stamps: each producer type's counter; at most one stamp of each kind held.
  const held = new Set(s.rack.filter((t) => t.stamp).map((t) => t.stamp!));
  if (s.shelf?.stamp) held.add(s.shelf.stamp);
  const connected = { oak: connectedCount(STAMP_SOURCE.oak), granite: connectedCount(STAMP_SOURCE.granite), gilded: connectedCount(STAMP_SOURCE.gilded) };
  const step = stepStamps(s.stampCounters, connected, held);
  s.stampCounters = step.counters;
  if (step.place.length) {
    let rack = s.rack.slice();
    for (const kind of step.place) {
      // Section 19 (proposed): a random unstamped tile.
      const free = rack.map((t, k) => (t.stamp ? -1 : k)).filter((k) => k >= 0);
      if (!free.length) continue;
      const at = free[Math.floor(Math.random() * free.length) % free.length];
      rack = rack.map((t, k) => (k === at ? { ...t, stamp: kind } : t));
      if (!s.stampsSeen.includes(kind)) {
        s.stampsSeen = [...s.stampsSeen, kind];
        out.push(FIRST_STAMP_LINE[kind]);
      } else {
        out.push(`${STAMP_NAMES[kind]} stamp placed on ${rack[at].letter}.`);
      }
    }
    s.rack = rack;
  }
  // The Rune: every 10th valid word while a connected Wizard Tower stands and none is held.
  if (!s.rune.held && connectedCount('wizardTower') > 0) {
    s.runeCounter += 1;
    if (s.runeCounter >= RUNE_EVERY) {
      s.runeCounter = 0;
      s.rune = { held: true, letter: null };
      out.push('Your Wizard Tower charged a Rune: a wild letter you choose. Tap it to add it to a word.');
    }
  }
  return out;
}

/** Section 5: a reroll replaces every tile in the rack, with no cost and no penalty. */
export function rerollRack(): void {
  const s = store.state;
  if (s.rerolls <= 0) {
    say(`No rerolls yet. You earn one for every ${REROLL_EVERY} valid words.`, 'info');
    return;
  }
  s.rerolls -= 1;
  // (v3.0) Stamps on the replaced tiles are discarded; the shelf and a held Rune are untouched.
  setRack(makeTiles(drawRack(Math.random, rackSize())));
  const deadRack = applyDeadRackRule();
  const text = `Fresh letters! ${s.rerolls} reroll${s.rerolls === 1 ? '' : 's'} left.${deadRack ? ' ' + deadRack : ''}`;
  store.state.message = { id: ++messageCounter, kind: 'info', text };
  store.emit('rack', 'word', 'message', 'meta');
}

/** Section 5 dead rack message (v2.0 wording). */
export const DEAD_RACK_MESSAGE = 'No word can be made from these letters. Free reroll.';

/**
 * Section 5 dead rack rule: whenever a new rack is drawn (or the minimum length changes) and it
 * holds no valid word at the current minimum length, the player gets a free new rack that does
 * not use a stored reroll. Also runs once the word list has loaded. The shelf and the Rune do not
 * count (Section 19).
 */
export function recheckRack(): boolean {
  const msg = applyDeadRackRule();
  if (msg) {
    store.state.message = { id: ++messageCounter, kind: 'info', text: msg };
    store.emit('rack', 'word', 'message', 'meta');
  }
  return msg !== null;
}

function applyDeadRackRule(): string | null {
  const s = store.state;
  if (s.dict.status === 'loading') return null;
  const { rack, freeRedraws } = ensurePlayable(rackLetters(), minWordLength(s.tier), allWords());
  if (freeRedraws === 0) return null;
  // Build reading (flagged): the dead rack redraw is automatic, not the player's choice, so held
  // stamps move to tiles of the new rack instead of being lost (a 6-tile rack is dead on about 7
  // percent of draws). A player's own reroll or swap still discards them (Section 19).
  const held = s.rack.filter((t) => t.stamp).map((t) => t.stamp!);
  const fresh = makeTiles(rack);
  held.forEach((kind, k) => {
    if (fresh[k]) fresh[k] = { ...fresh[k], stamp: kind };
  });
  setRack(fresh);
  s.freeRerolls += freeRedraws;
  return DEAD_RACK_MESSAGE;
}

/**
 * (v3.0) Section 5: the rack grows when a purchase crosses a threshold. The new tiles are drawn
 * at once, as part of the placement. Returns the message line, or null.
 */
function growRack(): string | null {
  const s = store.state;
  const size = rackSize();
  if (s.rack.length >= size) return null;
  const extra = makeTiles(Array.from({ length: size - s.rack.length }, () => drawLetter()));
  setRack([...s.rack, ...extra], true);
  return 'Your rack grew. Cottages make room for more letters.';
}

// ---------- (v3.0) Section 5: Lantern Hints ----------

/** The Lantern line under the Hint button when none is held. */
export function noLanternLine(): string {
  return connectedCount('library') > 0 ? 'No Lanterns. You earn one every 5 words, thanks to your Library.' : 'No Lanterns. You earn one every 10 words.';
}

/**
 * Hint button. The first press on a rack is free and names only the length of the longest word.
 * Further presses spend a Lantern each to place the next letter of the guide word (never the
 * longest word), at most 2 letters per rack. The full word is never revealed.
 */
/** The message a pressed Hint gives while the word list is still loading (v3.0.2). */
export const HINT_PENDING_LINE = 'The word list is still loading. Your free hint will show the moment it is ready.';

/**
 * (v3.0.2) The free press: names the longest word's length, in the message line and at the rack
 * (it stays at the rack until the rack changes). `afterLoading` when the press waited for the word
 * list. Returns false on a dead rack.
 */
function revealLongest(afterLoading: boolean): boolean {
  const s = store.state;
  const w = longestWord(rackLetters(), minWordLength(s.tier), allWords());
  if (!w) {
    say(DEAD_RACK_MESSAGE, 'info');
    recheckRack();
    return false;
  }
  s.hint = { ...s.hint, freeUsed: true, longest: w.length, pending: false };
  say(`${afterLoading ? 'The word list was still loading; it is ready now. ' : ''}You can make a ${w.length} letter word from these letters.`, 'info');
  store.emit('word', 'meta');
  return true;
}

export function pressHint(): void {
  const s = store.state;
  if (s.dict.status === 'loading') {
    // (v3.0.2) No dead end: the press waits and the free reveal fires when the list is ready.
    s.hint = { ...s.hint, pending: true };
    say(HINT_PENDING_LINE, 'info');
    store.emit('word', 'meta');
    return;
  }
  if (s.swap.active) cancelSwap(false);
  const min = minWordLength(s.tier);
  if (!s.hint.freeUsed) {
    revealLongest(false);
    return;
  }
  if (s.hint.placed >= LANTERN_LETTERS_PER_RACK) {
    say('Lanterns have placed all the help they can on this rack.', 'info');
    return;
  }
  if (s.lanterns <= 0) {
    say(noLanternLine(), 'info');
    return;
  }
  const guide = s.hint.guide ?? guideWord(rackLetters(), min, [...allWords()]);
  if (!guide) {
    say(DEAD_RACK_MESSAGE, 'info');
    return;
  }
  const placed = s.hint.placed + 1;
  s.lanterns -= 1;
  s.hint = { ...s.hint, guide, placed };
  // The letters are placed from the rack in order, following the tile identity rules.
  s.word = [];
  s.rune = { ...s.rune, letter: null };
  markUsed();
  for (const ch of guide.slice(0, placed)) typeLetter(ch);
  s.hint = { ...s.hint, guide, placed }; // typeLetter does not touch the rack's letters
  say(`A Lantern placed the ${placed === 1 ? 'first' : 'second'} letter of a ${guide.length} letter word. ${s.lanterns} Lantern${s.lanterns === 1 ? '' : 's'} left.`, 'info');
  store.emit('word', 'meta');
}

// ---------- Section 5: Swap ----------

export function swapPrice(n: number): number {
  return n * SWAP_COST_PER_TILE;
}

/** Swap button text and state for the UI. */
export function swapStatus(): { label: string; disabled: boolean; note: string | null } {
  const s = store.state;
  const n = s.swap.selected.length;
  if (!s.swap.active) {
    if (s.resources.coins < SWAP_COST_PER_TILE) return { label: 'Swap', disabled: true, note: 'Swap costs 2 Coins a tile.' };
    return { label: 'Swap', disabled: false, note: null };
  }
  if (n === 0) return { label: 'Swap', disabled: true, note: 'Tap the tiles to swap.' };
  const price = swapPrice(n);
  const label = `Swap ${n} tile${n === 1 ? '' : 's'} for ${amount('coins', price)}.`;
  if (price > s.resources.coins) return { label, disabled: true, note: `Swap costs 2 Coins a tile. You have ${amount('coins', s.resources.coins)}.` };
  return { label, disabled: false, note: null };
}

/** Tapping Swap enters swap mode; tapping it again with a selection confirms. */
export function pressSwap(): void {
  const s = store.state;
  s.shelfArmed = false;
  if (!s.swap.active) {
    if (s.resources.coins < SWAP_COST_PER_TILE) {
      say('Swap costs 2 Coins a tile.', 'info');
      return;
    }
    s.swap = { active: true, selected: [] };
    say('Tap the tiles you want to swap. A tile in your word must be taken back first.', 'info');
    store.emit('word');
    return;
  }
  confirmSwap();
}

function toggleSwapSelect(id: number): void {
  const s = store.state;
  const tile = s.rack.find((t) => t.id === id);
  if (!tile) return;
  if (tile.used) {
    say('That tile is in your word. Take it back first, then swap it.', 'info');
    return;
  }
  const on = s.swap.selected.includes(id);
  s.swap = { active: true, selected: on ? s.swap.selected.filter((x) => x !== id) : [...s.swap.selected, id] };
  store.emit('word');
}

export function confirmSwap(): boolean {
  const s = store.state;
  const n = s.swap.selected.length;
  if (!s.swap.active || n === 0) return false;
  const price = swapPrice(n);
  if (price > s.resources.coins) {
    say(`Swap costs 2 Coins a tile. You have ${amount('coins', s.resources.coins)}.`, 'warn');
    return false;
  }
  const picked = new Set(s.swap.selected);
  s.resources = { ...s.resources, coins: s.resources.coins - price };
  // Tiles in the word were never selectable, so the word survives a swap unchanged. A swapped
  // tile takes its stamp with it (Section 19).
  setRack(s.rack.map((t) => (picked.has(t.id) ? { id: ++tileCounter, letter: drawLetter(), used: false } : t)), true);
  const dead = applyDeadRackRule();
  s.message = { id: ++messageCounter, kind: 'success', text: `Swapped ${n} tile${n === 1 ? '' : 's'} for ${amount('coins', price)}.${dead ? ' ' + dead : ''}` };
  store.emit('resources', 'rack', 'word', 'message');
  return true;
}

/** Cancel (or Esc) leaves swap mode and charges nothing. */
export function cancelSwap(announce = true): void {
  const s = store.state;
  if (!s.swap.active) return;
  s.swap = { active: false, selected: [] };
  if (announce) s.message = { id: ++messageCounter, kind: 'info', text: 'Swap cancelled. Nothing was charged.' };
  store.emit('word', 'message');
}

/** Section 5: decorative flower patch on a random meadow tile near the town. */
function addFlowerPatch(): void {
  const s = store.state;
  const real = realBuildings(s.buildings);
  const cx = real.length ? Math.round(real.reduce((n, b) => n + b.x, 0) / real.length) : MAP_W >> 1;
  const cy = real.length ? Math.round(real.reduce((n, b) => n + b.y, 0) / real.length) : MAP_H >> 1;
  const rng = mulberry32((s.lifetime.validWords * 2654435761) ^ s.terrain.seed);
  for (let attempt = 0; attempt < 60; attempt++) {
    const x = cx + Math.round((rng() - 0.5) * 16);
    const y = cy + Math.round((rng() - 0.5) * 16);
    if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
    const i = y * MAP_W + x;
    if (s.terrain.tiles[i] !== Terrain.Meadow || s.roads[i]) continue;
    if (s.buildings.some((b) => x >= b.x && y >= b.y && x < b.x + BUILDINGS[b.type].w && y < b.y + BUILDINGS[b.type].h)) continue;
    if (s.flowers.some((f) => f.x === x && f.y === y)) continue;
    s.flowers = [...s.flowers, { x, y }];
    store.emit('terrain');
    return;
  }
}

// ---------- (v3.0) Section 18: Commission orders ----------

function orderTown() {
  const s = store.state;
  return {
    rackSize: rackSize(),
    tier: s.tier,
    buildings: s.buildings,
    resources: s.resources,
    producerStands: realBuildings(s.buildings).some((b) => b.type === 'sawmill' || b.type === 'quarry' || b.type === 'market'),
  };
}

/** Posts orders until the board holds 3 (a replacement is posted at once). */
function fillOrders(): void {
  const s = store.state;
  while (s.orders.length < OPEN_ORDERS) {
    s.orders = [...s.orders, makeOrder(s.nextOrderId++, orderTown(), s.orders, s.lifetime.validWords)];
  }
}

/** Section 18: one free discard per 5 valid words; the replacement is posted at once. */
export function discardOrder(id: number): boolean {
  const s = store.state;
  if (s.wordsSinceDiscard < DISCARD_EVERY) {
    say(`The free discard comes back in ${DISCARD_EVERY - s.wordsSinceDiscard} word${DISCARD_EVERY - s.wordsSinceDiscard === 1 ? '' : 's'}.`, 'info');
    return false;
  }
  if (!s.orders.some((o) => o.id === id)) return false;
  s.orders = s.orders.filter((o) => o.id !== id);
  s.wordsSinceDiscard = 0;
  fillOrders();
  say('Commission discarded. A new one has been posted.', 'info');
  store.emit('meta', 'message');
  return true;
}

/** The orders panel (the town center, or the Orders button). */
export function openOrders(open: boolean): void {
  store.state.ordersOpen = open;
  store.emit('meta');
}

// ---------- (v3.0) Section 20: dynamic terrain ----------

/** The nearest building or landmark to some tiles, for the one-line terrain message. */
function nearestName(tiles: number[]): string {
  const real = realBuildings(store.state.buildings);
  let best: Building | null = null;
  let bestD = Infinity;
  for (const i of tiles) {
    const x = i % MAP_W;
    const y = (i / MAP_W) | 0;
    for (const b of real) {
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
  }
  return best ? `near the ${buildingName(best)}` : "at the map's edge";
}

/**
 * Advances the terrain counters by one valid word and runs a growth or overflow step when one is
 * due (growth first). Changed tiles repaint in place. Returns the message lines (one per tick).
 */
function tickTerrain(): string[] {
  const s = store.state;
  if (s.mode === 'tutorial') return [];
  const t = { ...s.ticks, sinceGrowth: s.ticks.sinceGrowth + 1, sinceOverflow: s.ticks.sinceOverflow + 1 };
  const out: string[] = [];
  const dirty: number[] = [];
  const land = () => ({ tiles: s.terrain.tiles, cleared: s.cleared, roads: s.roads, gravel: s.gravel, buildings: s.buildings });
  const apply = (changes: LandChange[], gravelAt: number | null) => {
    const next = applyLand(land(), changes, gravelAt);
    s.terrain = { ...s.terrain, tiles: next.tiles };
    s.cleared = next.cleared;
    s.gravel = next.gravel;
    const gone = new Set(changes.map((c) => c.i));
    if (s.flowers.some((f) => gone.has(f.y * MAP_W + f.x))) s.flowers = s.flowers.filter((f) => !gone.has(f.y * MAP_W + f.x));
    dirty.push(...changes.map((c) => c.i));
  };
  if (t.sinceGrowth >= GROWTH_EVERY) {
    t.sinceGrowth = 0;
    t.growthTicks += 1;
    const g = growthStep(land(), s.terrain.seed, t.growthTicks);
    const changes = [...g.forest.map((i) => ({ i, to: Terrain.Forest })), ...g.thicket.map((i) => ({ i, to: Terrain.Thicket }))];
    if (changes.length) {
      apply(changes, null);
      const where = nearestName(changes.map((c) => c.i));
      out.push(
        g.forest.length && g.thicket.length
          ? `The forest has grown and the thicket has spread ${where}.`
          : g.forest.length
            ? `The forest has grown ${where}.`
            : `The thicket has spread ${where}.`,
      );
    }
  }
  if (t.sinceOverflow >= OVERFLOW_EVERY) {
    t.sinceOverflow = 0;
    t.overflowTicks += 1;
    const o = overflowStep(land(), s.terrain.seed, t.overflowTicks);
    if (o.marsh.length) {
      apply(o.marsh.map((i) => ({ i, to: Terrain.Marsh })), o.gravel);
      const n = o.marsh.length;
      out.push(`The river has risen: ${n} tile${n === 1 ? '' : 's'} of meadow ${n === 1 ? 'is' : 'are'} marsh now.`);
      if (o.gravel !== null) out.push(`It left a gravel bank: clear it for ${GRAVEL_STONE} Stone.`);
    }
  }
  s.ticks = t;
  if (dirty.length) {
    s.dirtyTiles = dirty;
    store.emit('tiles', 'terrain');
  } else if (out.length) store.emit('terrain');
  return out;
}

// ---------- tools ----------

/** True when the tutorial (or nothing) allows this tool right now. */
export function toolAllowed(tool: Tool): boolean {
  const l = store.state.locks.tools;
  return l === 'all' || l.includes(tool) || tool === 'inspect';
}

/**
 * Choosing a tool. Section 4: while a road or bridge preview is active the player cannot start
 * another tool or select a building. Section 7: leaving placement mode discards the ghost and
 * charges nothing; a locked tier's building does not start placement.
 */
export function setTool(tool: Tool): boolean {
  const s = store.state;
  if (s.pieceGhost?.anchor && tool !== s.tool) {
    say('Confirm or cancel the piece first.', 'info');
    return false;
  }
  if (!toolAllowed(tool)) return false;
  if (tool === 'townCenter') return false; // founded, never placed by the player
  if (tool === 'landmark' && !s.landmarkPick) return false;
  if (tool in BUILDINGS && BUILDINGS[tool as BuildingType].tier > s.tier) {
    say(`The ${BUILDINGS[tool as BuildingType].name} is locked. It opens at Tier ${BUILDINGS[tool as BuildingType].tier}.`, 'info');
    return false;
  }
  if (tool === 'drain' && s.tier < DRAIN_TIER) {
    say('Draining marsh opens at Tier 2.', 'info');
    return false;
  }
  s.tool = tool;
  s.placement = tool in BUILDINGS ? { type: tool as BuildingType, at: null, pinned: false } : null;
  if (tool !== 'landmark') s.landmarkPick = null;
  if (s.pieceGhost && s.pieceGhost.kind !== tool) {
    s.pieceGhost = null;
    s.pieceGhostPinned = false;
  }
  s.shelfArmed = false;
  s.toolTile = null;
  if (s.pendingRemoval && tool !== 'remove') s.pendingRemoval = null;
  store.emit('tool', 'preview', 'meta');
  hooks.onToolChange?.(tool);
  return true;
}

/** Called by the camera on every pan or zoom. React never subscribes to this. */
export function setCamera(cam: Camera, view?: { w: number; h: number }): void {
  store.state.camera = cam;
  if (view) store.state.cameraView = view;
  store.emit('camera');
}

/** Section 17: asks the map to pan so this tile is on screen (about 600 ms). */
export function panCameraTo(x: number, y: number): void {
  store.state.cameraGoal = { x, y, id: ++goalCounter };
  store.emit('cameraGoal');
}

// ---------- Section 11: saving and loading ----------

/** The camera as the world point at the centre of the view (fits desktop and phone alike). */
export function savedCamera(): SavedCamera {
  const s = store.state;
  if (s.pendingCamera) return { ...s.pendingCamera }; // the map hasn't applied a loaded camera yet
  const { w, h } = s.cameraView;
  const { x, y, zoom } = s.camera;
  if (w <= 0 || h <= 0 || zoom <= 0) return { centreX: 1728, centreY: 1080, zoom: 1 }; // map not drawn yet
  return { centreX: (w / 2 - x) / zoom, centreY: (h / 2 - y) / zoom, zoom };
}

/** Section 11: everything the save holds, from the current game. */
export function currentSave(now: Date = new Date()): SaveData {
  const s = store.state;
  return makeSave({ ...s, rack: s.rack, shelf: s.shelf }, savedCamera(), now);
}

/** Emits every topic so each layer and panel redraws from the new town. */
function emitWholeTown(): void {
  store.state.dirtyTiles = null;
  store.emit('load', 'terrain', 'tiles', 'roads', 'buildings', 'resources', 'rack', 'word', 'tool', 'preview', 'message', 'camera', 'marks', 'meta', 'mode');
}

/** Section 11: the migration notices, with the counts filled in. */
export function migrationMessage(notes?: MigrationNotes): string | null {
  const parts: string[] = [];
  const n = notes?.marshRoadsToBridges ?? 0;
  if (n > 0) parts.push(`Your save was updated: ${n} road tile${n === 1 ? '' : 's'} on marsh ${n === 1 ? 'is' : 'are'} now ${n === 1 ? 'a bridge' : 'bridges'}.`);
  if (notes?.foundedCenter) parts.push('Your save was updated to the new town rules. A town center has been placed near the middle of your map.');
  for (const id of notes?.landmarksGranted ?? []) parts.push(earnedLine(id));
  return parts.length ? parts.join(' ') : null;
}

/**
 * Section 11: replaces the current town with a checked save (from parseSave). Happiness and
 * population are recalculated from the buildings. The dictionary, notices and the map stay as
 * they are: only the town changes, and the map repaints itself on the 'load' topic. A load
 * always starts with an empty word and no active tool preview.
 */
export function loadSavedGame(save: SaveData, message: string, notes?: MigrationNotes): void {
  const r = restoreGame(save);
  const s = store.state;
  const migrated = migrationMessage(notes);
  const grids = gridsFromPieces(r.pieces);
  store.state = {
    ...s,
    mode: 'town',
    terrain: r.terrain,
    baseTiles: r.baseTiles,
    cleared: r.cleared,
    gravel: r.gravel,
    pieces: r.pieces,
    nextPieceId: r.pieces.length + 1,
    roads: grids.roads,
    bridgeAxis: grids.bridgeAxis,
    pieceAt: grids.pieceAt,
    roadBank: r.roadBank,
    bridgeBank: r.bridgeBank,
    pieceGhost: null,
    pieceGhostPinned: false,
    net: computeNetwork(grids.roads, r.buildings),
    dirtyTiles: null,
    lanterns: r.lanterns,
    lanternProgress: r.lanternProgress,
    stampCounters: r.stampCounters,
    stampsSeen: r.stampsSeen,
    rune: r.rune,
    runeCounter: r.runeCounter,
    shelf: r.shelf ? { id: ++tileCounter, letter: r.shelf.letter, used: false, ...(r.shelf.stamp ? { stamp: r.shelf.stamp } : {}) } : null,
    shelfArmed: false,
    orders: r.orders,
    nextOrderId: r.orders.length + 1,
    wordsSinceDiscard: r.wordsSinceDiscard,
    ordersOpen: false,
    landmarksEarned: r.landmarksEarned,
    landmarkPick: null,
    ticks: r.ticks,
    flowers: r.flowers,
    buildings: r.buildings,
    nextBuildingId: r.nextBuildingId,
    resources: r.resources,
    rack: r.rack.map((t) => ({ id: ++tileCounter, letter: t.letter, used: false, ...(t.stamp ? { stamp: t.stamp } : {}) })),
    word: [],
    hint: freshHint(),
    swap: { active: false, selected: [] },
    shake: null,
    rerolls: r.rerolls,
    tier: r.tier,
    lifetime: r.lifetime,
    recentWords: r.recentWords,
    questIndex: r.questIndex,
    freeRerolls: r.freeRerolls,
    pendingCamera: r.camera,
    cameraGoal: null,
    pendingRemoval: null,
    tool: 'inspect',
    preview: null,
    placement: null,
    toolTile: null,
    locks: NO_LOCKS,
    marks: NO_MARKS,
    message: { id: ++messageCounter, kind: 'success', text: migrated ? `${message} ${migrated}` : message },
  };
  // Section 11 (v3.0): a migrated town's three orders are generated on first entry.
  fillOrders();
  emitWholeTown();
}

/** Section 11 New Game: a fresh map and starting resources. Saves are handled by the caller. */
export function startNewGame(seedInput?: string, opts: { sandbox?: boolean } = {}): void {
  const s = store.state;
  // An empty seed box means a surprise map; anything else typed is used (an unusable seed falls
  // back to the default map with a friendly message, Section 14).
  const seed = seedInput === undefined || seedInput === '' ? randomSeed() : seedInput;
  const fresh = freshState(seed, opts);
  store.state = { ...fresh, mode: 'town', dict: s.dict, notice: s.notice, mapStatus: s.mapStatus };
  if (!fresh.terrain.seedWasInvalid) {
    store.state.message = {
      id: ++messageCounter,
      kind: 'success',
      text: `A new town on a fresh map (seed "${fresh.terrain.seedText}"). Your town center stands on open meadow with room to grow: buy a road piece and connect your first building to it.`,
    };
  }
  fillOrders(); // Section 18: a new town starts with 3 open orders
  applyDeadRackRule();
  focusTownCenter();
  emitWholeTown();
}

/**
 * Section 18: the camera starts centred on the town center. (v3.0.1) Set as the camera the map
 * applies when the town loads: in v3.0.0 this was a pan goal that the load cancelled, which went
 * unnoticed while the town center always stood near the middle of the map.
 */
function focusTownCenter(): void {
  const tc = store.state.buildings.find((b) => b.type === 'townCenter');
  if (!tc) return;
  // The world point at the middle of the 2 by 2 footprint (its shared corner, grid point x+1, y+1).
  const gx = tc.x + 1;
  const gy = tc.y + 1;
  store.state.pendingCamera = { centreX: MAP_H * (TILE_W / 2) + (gx - gy) * (TILE_W / 2), centreY: (gx + gy) * (TILE_H / 2), zoom: 1 };
}

/**
 * Section 17: the tutorial town, a sandbox on a fixed seed with a fixed first rack. (v3.0) The
 * town center is founded by the tutorial's own founding step, so the town starts without one.
 */
export function startTutorialTown(seed: string, firstRack: string[]): void {
  const s = store.state;
  const fresh = freshState(seed, { sandbox: false, noCenter: true });
  store.state = {
    ...fresh,
    mode: 'tutorial',
    rack: makeTiles(firstRack),
    dict: s.dict,
    notice: s.notice,
    mapStatus: s.mapStatus,
    message: { id: ++messageCounter, kind: 'info', text: `Welcome to ${NAME}.` },
  };
  emitWholeTown();
}

/** (v3.0) Section 17: the tutorial's founding step places the town center at a given spot. */
export function foundTownCenterAt(x: number, y: number): boolean {
  const s = store.state;
  if (s.buildings.some((b) => b.type === 'townCenter')) return false;
  const b: Building = { id: s.nextBuildingId++, type: 'townCenter', x, y };
  s.buildings = [...s.buildings, b];
  refreshNetwork();
  if (!s.orders.length && s.mode !== 'tutorial') fillOrders();
  store.emit('buildings', 'roads', 'meta');
  return true;
}

/** (v3.0) Section 17: the tutorial sets its fixed racks (a sandbox town; never saved). */
export function setRackLetters(letters: string[]): void {
  setRack(makeTiles(letters));
  store.emit('rack', 'word');
}

/** (v3.0) Section 17: the tutorial posts its own first order (a fixed, easy one). */
export function setOrders(orders: Order[]): void {
  store.state.orders = orders;
  store.state.nextOrderId = Math.max(store.state.nextOrderId, ...orders.map((o) => o.id + 1));
  store.emit('meta');
}

/** (v3.0) Test and tutorial helper: put pieces straight into a bank (no charge). */
export function grantPieces(kind: PieceKind, len: PieceLen, n: number): void {
  const s = store.state;
  const bank = { ...bankOf(kind), [len]: bankOf(kind)[len] + n };
  if (kind === 'road') s.roadBank = bank;
  else s.bridgeBank = bank;
  store.emit('meta');
}

/** Section 16: back to the title screen (the caller autosaves first). */
export function showTitle(): void {
  const s = store.state;
  s.mode = 'title';
  s.preview = null;
  s.pieceGhost = null;
  s.pieceGhostPinned = false;
  s.ordersOpen = false;
  s.placement = null;
  s.tool = 'inspect';
  s.locks = NO_LOCKS;
  s.marks = NO_MARKS;
  store.emit('mode', 'tool', 'preview', 'marks', 'meta');
}

/** Section 17: the tutorial flow sets what is locked and marked. */
export function setTutorialLocks(locks: TutorialLocks): void {
  store.state.locks = locks;
  store.emit('meta', 'tool');
}

export function setMarks(marks: MapMarks): void {
  store.state.marks = marks;
  store.emit('marks');
}

/** Section 17: wallet adjustments the tutorial makes (top-up, practice money). */
export function setResources(r: Resources): void {
  store.state.resources = r;
  store.emit('resources');
}

/** The map took the loaded camera; the live camera is the truth again. */
export function pendingCameraApplied(): void {
  store.state.pendingCamera = null;
}

const TERRAIN_LABELS = ['Meadow', 'Forest', 'Hill', 'Marsh', 'Thicket (clear it first)', 'Water'];

export function inspectTile(x: number, y: number): void {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return;
  const s = store.state;
  const i = y * MAP_W + x;
  const t = s.terrain.tiles[i];
  const b = buildingAt(s.buildings, x, y);
  const link = s.roads[i];
  const changed = s.cleared[i] === 1;
  const ground = changed
    ? t === Terrain.Forest
      ? 'Cleared forest'
      : t === Terrain.Thicket
        ? 'Cleared thicket'
        : 'Drained marsh (meadow)'
    : TERRAIN_LABELS[t] ?? 'Unknown';
  if (b?.type === 'townCenter' && !b.preview) {
    openOrders(true);
    return;
  }
  if (b) {
    const cut = !b.preview && b.type !== 'landmark' && !isRoadConnected(b) ? ` It is not connected to the town center and pays nothing.` : '';
    say(`${buildingName(b)}${b.preview ? ' (art showcase)' : ''} at tile ${x}, ${y}.${cut}`);
  } else if (s.gravel[i] === 1) say(`Tile ${x}, ${y}: gravel. Clear it for ${GRAVEL_STONE} Stone.`);
  else if (link === LINK_ROAD) say(`Road at tile ${x}, ${y}${s.net[i] ? '' : ', not connected to the town center'}.`);
  else if (link === LINK_BRIDGE) say(`Bridge at tile ${x}, ${y}${t === Terrain.Marsh ? ', over marsh' : ''}.`);
  else say(`Tile ${x}, ${y}: ${ground}.`);
}

// ---------- map and dictionary lifecycle ----------

function dictionaryTestMode(): DictionaryTestMode {
  try {
    const v = new URLSearchParams(window.location.search).get('testDict');
    return v === 'corrupt' || v === 'block' || v === 'slow' ? v : null;
  } catch {
    return null;
  }
}

let dictionaryStarted = false;

/**
 * Section 5: the list is parsed once. v2.0: the title screen shows the word list size, and no
 * map is drawn behind the title, so the list starts loading on the title screen.
 */
export function startDictionary(): void {
  if (dictionaryStarted) return;
  dictionaryStarted = true;
  void loadDictionary(dictionaryTestMode()).then((d) => {
    const hintWaiting = store.state.hint.pending; // (v3.0.2) a Hint pressed while loading
    store.state.dict = d;
    store.state.notice =
      d.status === 'fallback'
        ? `The main word list could not load, so ${NAME} is using a small backup list of 200 common words. Reload the page to try again.`
        : null;
    if (store.state.mode !== 'title') {
      const deadRack = applyDeadRackRule();
      if (deadRack) store.state.message = { id: ++messageCounter, kind: 'info', text: deadRack };
      if (hintWaiting && !store.state.hint.freeUsed) revealLongest(true);
    }
    store.state.hint = { ...store.state.hint, pending: false };
    store.emit('meta', 'rack', 'word', 'message');
  });
}

export function mapPainted(): void {
  store.state.mapStatus = 'ready';
  store.emit('meta');
  startDictionary();
}

export function mapFailed(): void {
  store.state.mapStatus = 'failed';
  store.emit('meta');
  startDictionary();
}

/**
 * Art showcase (add ?showcase to the address): places one of each of the 11 buildings on
 * open land near the map centre so the approved Gemini art can be reviewed in the game.
 * Showcase buildings are marked `preview` and never count for the economy.
 */
export function placeShowcase(): void {
  const s = store.state;
  const free = new Uint8Array(MAP_W * MAP_H);
  const open = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < MAP_W && y < MAP_H && !free[y * MAP_W + x] && s.terrain.tiles[y * MAP_W + x] === Terrain.Meadow;
  const fits = (x: number, y: number, w: number, h: number) => {
    for (let yy = y - 2; yy <= y + h + 1; yy++) for (let xx = x - 2; xx <= x + w + 1; xx++) if (!open(xx, yy)) return false;
    return true;
  };
  const take = (x: number, y: number, w: number, h: number) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) free[yy * MAP_W + xx] = 1;
  };
  // (v3.0.2) The v3 art too: the town center (kept where it was founded), the Scribe and the six
  // landmarks, so every sprite can be reviewed on one map.
  const order: (BuildingType | `landmark:${LandmarkId}`)[] = [
    'townHall', 'market', 'greenhouse', 'library', 'tavern', 'wizardTower', 'scribe', 'sawmill', 'quarry', 'park', 'cottage', 'pier',
    ...LANDMARK_ORDER.map((id) => `landmark:${id}` as const),
  ];
  const placed: Building[] = s.buildings.filter((b) => b.type === 'townCenter');
  for (const b of placed) take(b.x - 1, b.y - 1, BUILDINGS.townCenter.w + 2, BUILDINGS.townCenter.h + 2);
  const cx = MAP_W >> 1;
  const cy = MAP_H >> 1;
  for (const entry of order) {
    const lm = entry.startsWith('landmark:') ? (entry.slice(9) as LandmarkId) : null;
    const type: BuildingType = lm ? 'landmark' : (entry as BuildingType);
    const { w, h } = BUILDINGS[type];
    let done = false;
    for (let r = 0; r < MAP_W && !done; r++) {
      for (let dy = -r; dy <= r && !done; dy++) {
        for (let dx = -r; dx <= r && !done; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (type !== 'pier' && !fits(x, y, w, h)) continue;
          if (type === 'pier') {
            let land = true;
            for (let yy = y; yy < y + h && land; yy++) for (let xx = x; xx < x + w && land; xx++) land = open(xx, yy);
            if (!land) continue;
            let nearWater = false;
            for (let yy = y - 1; yy <= y + h && !nearWater; yy++)
              for (let xx = x - 1; xx <= x + w && !nearWater; xx++) nearWater = s.terrain.tiles[yy * MAP_W + xx] === Terrain.Water;
            if (!nearWater) continue;
          }
          take(x, y, w, h);
          placed.push({ id: s.nextBuildingId++, type, x, y, preview: true, ...(lm ? { landmark: lm } : {}) });
          done = true;
        }
      }
    }
  }
  s.buildings = placed;
  store.emit('buildings');
}

// ---------- shared helpers for building and paying ----------

export function mapContext(): MapContext {
  const s = store.state;
  return {
    tiles: s.terrain.tiles,
    cleared: s.cleared,
    roads: s.roads,
    occupied: (x, y) => !!buildingAt(s.buildings, x, y),
  };
}

function placementContext() {
  const s = store.state;
  const net = s.net;
  return {
    tiles: s.terrain.tiles,
    cleared: s.cleared,
    roads: s.roads,
    buildings: s.buildings,
    mapW: MAP_W,
    mapH: MAP_H,
    gravel: s.gravel,
    networkAt: (x: number, y: number) => net[y * MAP_W + x] === 1,
  };
}

function missingFor(cost: Resources): Resources | null {
  const missing = missingResources(store.state.resources, cost);
  return anyMissing(missing) ? missing : null;
}

function pay(cost: Resources): void {
  const next = { ...store.state.resources };
  for (const k of Object.keys(next) as (keyof Resources)[]) next[k] -= cost[k];
  store.state.resources = next;
}



// ---------- (v3.0) Section 4: road and bridge pieces ----------


export function bankOf(kind: PieceKind): Bank {
  return kind === 'road' ? store.state.roadBank : store.state.bridgeBank;
}

/**
 * Buy: adds a piece to the bank and charges its price at once. Buying is not placing (Section 4).
 * Banked pieces are never sold back (LOCKED ruling 9).
 */
export function buyPiece(kind: PieceKind, len: PieceLen): boolean {
  const s = store.state;
  const price = PIECE_PRICE[kind][len];
  const missing = missingFor(price);
  if (missing) {
    say(notEnoughLine(missing), 'warn');
    return false;
  }
  pay(price);
  const bank = { ...bankOf(kind), [len]: bankOf(kind)[len] + 1 };
  if (kind === 'road') s.roadBank = bank;
  else s.bridgeBank = bank;
  say(`Bought a ${len} tile ${kind} piece for ${costWords(price)}. It is in your ${kind} bank.`, 'success');
  store.emit('resources', 'meta');
  hooks.onBought?.(kind, len);
  return true;
}

/** Pick: picks up a banked piece; the ghost follows the pointer or the last tapped tile. */
export function pickPiece(kind: PieceKind, len: PieceLen): boolean {
  const s = store.state;
  if (s.pieceGhost?.anchor) {
    say('Confirm or cancel the piece first.', 'info');
    return false;
  }
  if (bankOf(kind)[len] <= 0) {
    say(`No ${len} tile ${kind} pieces in the bank. Buy one first.`, 'info');
    return false;
  }
  if (s.tool !== kind) setTool(kind);
  s.pieceGhost = { kind, len, dir: s.pieceGhost?.dir ?? 0, anchor: null };
  say(`Tap the map where the piece should start. Rotate turns it.`, 'info');
  store.emit('preview', 'meta');
  return true;
}

/** The pointer is over (or the player tapped) a tile: the anchor moves there. */
export function movePieceAnchor(tile: Pt | null, tapped = false): void {
  const s = store.state;
  const g = s.pieceGhost;
  if (!g) return;
  if (!tapped && g.anchor && s.pieceGhostPinned) return;
  if (tile && g.anchor && tile.x === g.anchor.x && tile.y === g.anchor.y && (!tapped || s.pieceGhostPinned)) return;
  s.pieceGhost = { ...g, anchor: tile };
  if (tapped && tile) s.pieceGhostPinned = true;
  store.emit('preview', 'meta');
}

/** Rotate: cycles east, south, west, north; live until Confirm (LOCKED ruling 10), same anchor. */
export function rotatePiece(): void {
  const s = store.state;
  const g = s.pieceGhost;
  if (!g) return;
  s.pieceGhost = { ...g, dir: ((g.dir + 1) % 4) as Dir };
  store.emit('preview', 'meta');
}

export interface PieceStatus extends PieceCheck {
  kind: PieceKind;
  len: number;
  dir: Dir;
  tiles: Pt[];
  pinned: boolean;
}

/** Green or red, and the reason, for the current ghost (Section 4). */
export function pieceStatus(): PieceStatus | null {
  const s = store.state;
  const g = s.pieceGhost;
  if (!g || !g.anchor) return null;
  const c = checkPiece(
    { tiles: s.terrain.tiles, cleared: s.cleared, roads: s.roads, gravel: s.gravel, buildings: s.buildings, net: s.net },
    g.kind,
    g.anchor,
    g.dir,
    g.len,
  );
  const tiles = pieceTiles({ ...g.anchor, dir: g.dir, len: g.len });
  const base = { kind: g.kind, len: g.len, dir: g.dir, tiles, pinned: s.pieceGhostPinned };
  // (v3.0.1) Tutorial road steps: a piece may not cover a marked plot. The tiles over the plot
  // turn red; a terrain reason on another tile still speaks first.
  const guard = hooks.pieceGuard?.(tiles);
  if (guard && guard.tiles.length) {
    return { ...c, ...base, ok: false, reason: c.badTiles.length ? c.reason : guard.reason, badTiles: [...c.badTiles, ...guard.tiles] };
  }
  return { ...c, ...base };
}

/** Confirm: places the piece and takes it out of the bank. Nothing is charged (it was paid for). */
export function confirmPiece(): boolean {
  const s = store.state;
  const g = s.pieceGhost;
  const st = pieceStatus();
  if (!g || !st) return false;
  if (!st.ok) {
    say(st.reason ?? 'That piece cannot go there.', 'warn');
    return false;
  }
  const bank = { ...bankOf(g.kind), [g.len]: bankOf(g.kind)[g.len] - 1 };
  if (g.kind === 'road') s.roadBank = bank;
  else s.bridgeBank = bank;
  const piece: Piece = { id: s.nextPieceId++, kind: g.kind, x: g.anchor!.x, y: g.anchor!.y, dir: g.dir, len: g.len };
  setPieces([...s.pieces, piece]);
  s.pieceGhost = bank[g.len] > 0 ? { ...g, anchor: null } : null;
  s.pieceGhostPinned = false;
  const lines = [g.kind === 'road' ? 'Road piece placed.' : 'Bridge piece placed.'];
  if (g.kind === 'bridge') {
    s.lifetime = { ...s.lifetime, bridgesBuilt: s.lifetime.bridgesBuilt + g.len };
    // Section 21 River Bell: the first bridge path of 8 or more tiles (build reading: a straight
    // run of 8 or more bridge tiles through the piece just placed).
    if (s.mode !== 'tutorial' && !s.landmarksEarned.includes('riverBell')) {
      const run = Math.max(...st.tiles.map((t) => bridgeRunThrough(s.roads, t.x, t.y, g.dir)));
      if (run >= RIVER_BELL_TILES) lines.push(...earnLandmarks(true));
    }
  }
  say(lines.join(' '), 'success');
  store.emit('roads', 'buildings', 'preview', 'meta');
  announceProgress(); // roads connect Cottages (happiness); bridges complete a quest
  hooks.onPathConfirmed?.(g.kind, st.tiles);
  return true;
}

/** Cancel (button, Esc or right-click): the ghost goes away and the piece stays in the bank. */
export function cancelPiece(announce = true): boolean {
  const s = store.state;
  if (!s.pieceGhost) return false;
  s.pieceGhost = null;
  s.pieceGhostPinned = false;
  if (announce) say('Piece put back in the bank.', 'info');
  store.emit('preview', 'meta');
  return true;
}

/**
 * Test and tool helper: buys (if the bank is empty) and lays one piece in one go, through the
 * same checks and the same single charge as the player's taps.
 */
export function layPiece(kind: PieceKind, len: PieceLen, x: number, y: number, dir: Dir): boolean {
  const s = store.state;
  if (bankOf(kind)[len] <= 0 && !buyPiece(kind, len)) return false;
  if (!pickPiece(kind, len)) return false;
  s.pieceGhost = { kind, len, dir, anchor: { x, y } };
  s.pieceGhostPinned = true;
  const ok = confirmPiece();
  if (!ok) cancelPiece(false);
  return ok;
}

/** Kept for v2 callers: the old drag preview no longer exists (Section 4 is pieces now). */
export function previewSummary(): null {
  return null;
}
export function confirmPreview(): boolean {
  return confirmPiece();
}
export function cancelPreview(): boolean {
  return cancelPiece();
}

// ---------- Section 4 (v2.0): clearing and draining, one tile per click or tap ----------

/** What the Clear or Drain tool would do on this tile: its cost, or why it can't. */
export function landWork(tool: 'clear' | 'drain', x: number, y: number): { cost: Resources | null; chip: string; problem: string | null; done?: string } {
  const s = store.state;
  const label = tool === 'clear' ? 'Clear' : 'Drain';
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return { cost: null, chip: `${label}: off the map.`, problem: 'That is off the edge of the map.' };
  const i = y * MAP_W + x;
  const t = s.terrain.tiles[i];
  const changed = s.cleared[i] === 1;
  if (tool === 'clear' && s.gravel[i] === 1) {
    // (v3.0) LOCKED ruling 4 with Stu's clarification: clearing gravel is free and gives 3 Stone.
    return { cost: emptyResources(), chip: `Clear: gravel, free. It gives ${GRAVEL_STONE} Stone.`, problem: null, done: `Gravel cleared for ${GRAVEL_STONE} Stone. It is meadow now.` };
  }
  if (tool === 'clear') {
    if (t === Terrain.Forest && !changed) return { cost: CLEAR_FOREST_COST, chip: 'Clear: forest, 2 Coins.', problem: null, done: 'Forest cleared for 2 Coins.' };
    if (t === Terrain.Thicket && !changed)
      return { cost: CLEAR_THICKET_COST, chip: 'Clear: thicket, 6 Coins and 3 Lumber.', problem: null, done: 'Thicket cleared for 6 Coins and 3 Lumber.' };
    return { cost: null, chip: 'Clear: forest or thicket only.', problem: 'Only forest and thicket can be cleared.' };
  }
  if (t !== Terrain.Marsh || changed) return { cost: null, chip: 'Drain: marsh only.', problem: 'Only marsh can be drained.' };
  if (s.roads[i] === LINK_BRIDGE) return { cost: null, chip: 'Drain: Remove the bridge first.', problem: 'Remove the bridge first.' };
  if (buildingAt(s.buildings, x, y)) return { cost: null, chip: 'Drain: a building stands here.', problem: 'A building stands on that marsh.' };
  if (s.tier < DRAIN_TIER) return { cost: null, chip: 'Drain: opens at Tier 2.', problem: 'Draining marsh opens at Tier 2.' };
  return { cost: DRAIN_MARSH_COST, chip: 'Drain: marsh, 5 Coins and 2 Lumber.', problem: null, done: 'Marsh drained for 5 Coins and 2 Lumber. It is meadow now.' };
}

/** Section 4: the tool chip follows the tile under the pointer or last touched. */
export function setToolTile(t: Pt | null): void {
  const s = store.state;
  if (s.tool !== 'clear' && s.tool !== 'drain') return;
  if (t && s.toolTile && t.x === s.toolTile.x && t.y === s.toolTile.y) return;
  if (!t) return; // keep the last touched tile
  s.toolTile = t;
  store.emit('preview');
}

export function toolChipText(): string | null {
  const s = store.state;
  if (s.tool !== 'clear' && s.tool !== 'drain') return null;
  if (!s.toolTile) return s.tool === 'clear' ? 'Clear: forest 2 Coins, thicket 6 Coins and 3 Lumber.' : 'Drain: marsh, 5 Coins and 2 Lumber.';
  return landWork(s.tool, s.toolTile.x, s.toolTile.y).chip;
}

/** Clears or drains one tile, charged at once when the tile changes. */
export function workTile(tool: 'clear' | 'drain', x: number, y: number): boolean {
  const s = store.state;
  const w = landWork(tool, x, y);
  s.toolTile = { x, y };
  if (!w.cost) {
    say(w.problem ?? 'Nothing to do there.', 'warn');
    store.emit('preview');
    return false;
  }
  const missing = missingFor(w.cost);
  if (missing) {
    say(notEnoughLine(missing), 'warn');
    store.emit('preview');
    return false;
  }
  pay(w.cost);
  const i = y * MAP_W + x;
  if (s.gravel[i] === 1) {
    const gravel = s.gravel.slice();
    gravel[i] = 0;
    s.gravel = gravel;
    s.resources = { ...s.resources, stone: s.resources.stone + GRAVEL_STONE };
    s.lifetime = { ...s.lifetime, earned: { ...s.lifetime.earned, stone: s.lifetime.earned.stone + GRAVEL_STONE } };
    say(w.done!, 'success');
    store.emit('terrain', 'resources', 'preview', 'meta');
    return true;
  }
  const cleared = s.cleared.slice();
  cleared[i] = 1;
  s.cleared = cleared;
  say(w.done!, 'success');
  // Repaint that tile's area of the baked terrain in place (Section 4: not a terrain rebuild).
  s.dirtyTiles = [i];
  store.emit('tiles', 'roads', 'resources', 'preview');
  return true;
}

/** Test helper kept from v1: clear the first forest or thicket tile in a list. */
export function clearForest(path: Pt[]): boolean {
  for (const t of path) if (workTile('clear', t.x, t.y)) return true;
  return false;
}

// ---------- Section 7 (v2.0): the placement ghost ----------

export interface GhostStatus {
  type: BuildingType;
  x: number;
  y: number;
  ok: boolean;
  /** Green: "Cottage: 10 Coins, 8 Lumber, 2 Stone." Red: the first matching reason. */
  line: string;
  pinned: boolean;
}

/** Green or red, and the line, for a footprint origin (Section 7 reason order). */
export function ghostCheck(type: BuildingType, x: number, y: number): { ok: boolean; line: string } {
  const def = BUILDINGS[type];
  const problem = placementProblem(placementContext(), type, x, y);
  if (problem) return { ok: false, line: placementReason(problem, type) };
  const guard = hooks.placementGuard?.(type, x, y);
  if (guard) return { ok: false, line: guard };
  // (v3.0) Section 21: a landmark shows no cost line.
  if (type === 'landmark') {
    const id = store.state.landmarkPick;
    return id ? { ok: true, line: landmarkFreeLine(id) } : { ok: false, line: 'Choose a landmark first.' };
  }
  const missing = missingFor(def.cost);
  if (missing) return { ok: false, line: notEnoughLine(missing) };
  return { ok: true, line: `${def.name}: ${costList(def.cost)}.` };
}

export function ghostStatus(): GhostStatus | null {
  const p = store.state.placement;
  if (!p || !p.at) return null;
  const c = ghostCheck(p.type, p.at.x, p.at.y);
  return { type: p.type, x: p.at.x, y: p.at.y, ok: c.ok, line: c.line, pinned: p.pinned };
}

/** The ghost follows the pointer (or finger): (tx, ty) is the tile under it. */
export function moveGhost(tx: number | null, ty: number | null): void {
  const s = store.state;
  const p = s.placement;
  if (!p || p.pinned) return;
  const at = tx === null || ty === null ? null : footprintOrigin(p.type, tx, ty);
  if (at && p.at && at.x === p.at.x && at.y === p.at.y) return;
  if (!at && !p.at) return;
  s.placement = { ...p, at };
  store.emit('preview');
}

/** A click (desktop) or lifting the finger (phone) pins the ghost where it sits. */
export function pinGhost(tx: number, ty: number): void {
  const s = store.state;
  const p = s.placement;
  if (!p) return;
  s.placement = { ...p, at: footprintOrigin(p.type, tx, ty), pinned: true };
  store.emit('preview');
}

/** Cancel unpins: the ghost follows the pointer again. Nothing is charged. */
export function unpinGhost(): void {
  const s = store.state;
  const p = s.placement;
  if (!p || !p.pinned) return;
  s.placement = { ...p, pinned: false };
  store.emit('preview');
}

/** Confirm on a green, pinned placement charges the cost once and places the building. */
export function confirmPlacement(): boolean {
  const s = store.state;
  const p = s.placement;
  if (!p || !p.at || !p.pinned) return false;
  const ok = placeAt(p.type, p.at.x, p.at.y);
  if (ok) {
    s.placement = { type: p.type, at: null, pinned: false };
    store.emit('preview');
  }
  return ok;
}

/**
 * (v3.0.1) The tutorial's one-tap assist: places a building with its footprint origin at (x, y)
 * through the normal placement path (same checks, cost and message), as if the ghost had been
 * pinned there and Confirm tapped.
 */
export function placeBuildingAt(type: BuildingType, x: number, y: number): boolean {
  const s = store.state;
  if (s.tool !== type) setTool(type);
  s.placement = { type, at: { x, y }, pinned: true };
  store.emit('preview');
  const ok = confirmPlacement();
  if (!ok && s.placement?.type === type) {
    s.placement = { type, at: null, pinned: false };
    store.emit('preview');
  }
  return ok;
}

/** Places a building with its footprint origin at (x, y). Costs are deducted only on success. */
function placeAt(type: BuildingType, x: number, y: number): boolean {
  const s = store.state;
  const def = BUILDINGS[type];
  if (def.tier > s.tier) {
    say(`The ${def.name} is locked. It opens at Tier ${def.tier}.`, 'warn');
    return false;
  }
  const check = ghostCheck(type, x, y);
  if (!check.ok) {
    say(check.line, 'warn');
    return false;
  }
  if (type === 'landmark') return placeLandmark(x, y);
  pay(def.cost);
  const b: Building = { id: s.nextBuildingId++, type, x, y };
  s.buildings = [...s.buildings, b];
  s.lifetime = { ...s.lifetime, everBuilt: { ...s.lifetime.everBuilt, [type]: (s.lifetime.everBuilt[type] ?? 0) + 1 } };
  refreshNetwork();
  const lines = [`${def.name} built! ${formatResources(def.cost, '-')}.`];
  const grew = growRack(); // Section 5: the new tiles are drawn at once, as part of the placement
  if (grew) lines.push(grew);
  say(lines.join(' '), 'success');
  store.emit('buildings', 'resources', 'rack', 'word');
  announceProgress();
  hooks.onBuilt?.(b);
  return true;
}

/** (v3.0) Section 21: places the picked landmark (free; it waits in the build panel until placed). */
function placeLandmark(x: number, y: number): boolean {
  const s = store.state;
  const id = s.landmarkPick;
  if (!id || !landmarksWaiting().includes(id)) return false;
  const b: Building = { id: s.nextBuildingId++, type: 'landmark', x, y, landmark: id };
  s.buildings = [...s.buildings, b];
  s.landmarkPick = null;
  s.placement = null;
  s.tool = 'inspect';
  refreshNetwork();
  say(`${LANDMARK_NAMES[id]} placed. It adds 2 to happiness.`, 'success');
  store.emit('buildings', 'tool', 'preview', 'meta');
  announceProgress();
  return true;
}

/** (v3.0) Section 21: landmarks earned and not yet placed (the build panel's Landmarks row). */
export function landmarksWaiting(): LandmarkId[] {
  const s = store.state;
  const placed = new Set(s.buildings.filter((b) => b.type === 'landmark').map((b) => b.landmark));
  return s.landmarksEarned.filter((id) => !placed.has(id));
}

/** Picks an earned landmark for placement. */
export function pickLandmark(id: LandmarkId): boolean {
  const s = store.state;
  if (!landmarksWaiting().includes(id)) return false;
  s.landmarkPick = id;
  const ok = setTool('landmark');
  if (!ok) s.landmarkPick = null;
  return ok;
}

/** Test and direct helper: places a building centred under the pointer tile (tx, ty). */
export function placeBuilding(type: BuildingType, tx: number, ty: number): boolean {
  const { x, y } = footprintOrigin(type, tx, ty);
  return placeAt(type, x, y);
}

// ---------- removal (Sections 4 and 7) ----------

/**
 * Remove tool. A building asks for one confirmation that shows the exact refund (Section 7).
 * (v3.0) A road or bridge tile selects its whole piece; the confirmation names every building the
 * removal would disconnect (Section 4, the cascade). The town center and landmarks stay.
 */
export function requestRemoveAt(x: number, y: number): void {
  const s = store.state;
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return;
  const b = buildingAt(s.buildings, x, y);
  const onTile = b ? undefined : s.pieces.find((p) => p.id === s.pieceAt[y * MAP_W + x]);
  const guard = hooks.removeGuard?.(x, y, b, onTile);
  if (guard) {
    say(guard, 'info');
    return;
  }
  if (b) {
    if (b.preview) {
      say('That building is part of the art showcase and cannot be removed.', 'info');
      return;
    }
    if (b.type === 'townCenter') {
      say('The town center cannot be removed.', 'info');
      return;
    }
    if (b.type === 'landmark') {
      say(LANDMARK_STAYS, 'info');
      return;
    }
    const refund = removalRefund(b.type);
    s.pendingRemoval = { kind: 'building', buildingId: b.id, type: b.type, refund };
    const back = formatResources(refund);
    say(`Remove the ${BUILDINGS[b.type].name}? You will get back ${back || 'nothing'}. Confirm in the Build panel.`, 'warn');
    store.emit('meta');
    return;
  }
  const pid = s.pieceAt[y * MAP_W + x];
  const piece = s.pieces.find((p) => p.id === pid);
  if (!piece) {
    say('There is nothing to remove there.', 'info');
    return;
  }
  // Section 4: the tutorial town is exempt from the cascade (Section 17).
  const cascade = s.mode === 'tutorial' ? [] : cascadeFor(s.pieces, piece.id, s.buildings);
  const names = cascade.map(buildingName);
  const shared = sharedTiles(s.pieces, piece).length;
  s.pendingRemoval = { kind: 'piece', pieceId: piece.id, pieceKind: piece.kind, len: piece.len, legacy: !!piece.legacy, cascade: cascade.map((c) => c.id), names, shared };
  say(removalWarning(s.pendingRemoval), 'warn');
  store.emit('meta', 'preview');
}

/** Section 4 (proposed wording): the cascade warning, on the removal confirmation. */
export function removalWarning(p: PendingRemoval): string {
  if (p.kind === 'building') {
    const back = formatResources(p.refund);
    return `Remove the ${BUILDINGS[p.type].name}? You will get back ${back || 'nothing'}.`;
  }
  const what = p.pieceKind === 'road' ? 'road' : 'bridge';
  const back = p.legacy
    ? `This ${what} tile is from before road pieces, so nothing returns to a bank.`
    : `The piece returns to your bank.`;
  // (v3.0.2) Crossing tiles another piece also covers stay on the map.
  const stays = p.shared ? ` ${p.shared === 1 ? '1 of its tiles is' : `${p.shared} of its tiles are`} shared with another piece and will stay.` : '';
  if (!p.names.length) return `Remove this ${p.legacy ? '' : p.len + ' tile '}${what} ${p.legacy ? 'tile' : 'piece'}? ${back}${stays}`.replace('  ', ' ');
  const n = p.names.length;
  return `Removing this piece will also remove ${n} building${n === 1 ? '' : 's'}: ${p.names.join(', ')}. Buildings removed this way are gone. ${back}${stays}`;
}

export function confirmRemoval(): void {
  const s = store.state;
  const p = s.pendingRemoval;
  if (!p) return;
  s.pendingRemoval = null;
  if (p.kind === 'piece') {
    const piece = s.pieces.find((q) => q.id === p.pieceId);
    if (!piece) {
      store.emit('meta');
      return;
    }
    // The cascade is recomputed at the moment of removal, so it matches the warning's state.
    const cascade = s.mode === 'tutorial' ? [] : cascadeFor(s.pieces, piece.id, s.buildings);
    const gone = new Set(cascade.map((b) => b.id));
    if (!piece.legacy) {
      const len = piece.len as PieceLen;
      if (piece.kind === 'road') s.roadBank = { ...s.roadBank, [len]: s.roadBank[len] + 1 };
      else s.bridgeBank = { ...s.bridgeBank, [len]: s.bridgeBank[len] + 1 };
    }
    s.buildings = s.buildings.filter((b) => !gone.has(b.id)); // LOCKED ruling 2: cascaded buildings refund nothing
    setPieces(s.pieces.filter((q) => q.id !== piece.id));
    const what = piece.kind === 'road' ? 'Road' : 'Bridge';
    const lines = [piece.legacy ? `${what} tile removed. No money changes hands.` : `${what} piece removed and returned to your bank. No money changes hands.`];
    if (cascade.length) lines.push(`Also removed: ${cascade.map(buildingName).join(', ')}.`);
    say(lines.join(' '), 'info');
    store.emit('roads', 'buildings', 'resources', 'meta', 'preview');
    announceProgress();
    for (const b of cascade) hooks.onRemoved?.(b);
    hooks.onPieceRemoved?.(piece);
    return;
  }
  if (!s.buildings.some((b) => b.id === p.buildingId)) {
    store.emit('meta');
    return;
  }
  const removed = s.buildings.find((b) => b.id === p.buildingId)!;
  s.buildings = s.buildings.filter((b) => b.id !== p.buildingId);
  refreshNetwork();
  const next = { ...s.resources };
  for (const k of Object.keys(next) as (keyof Resources)[]) next[k] += p.refund[k];
  s.resources = next;
  const back = formatResources(p.refund);
  say(`${BUILDINGS[p.type].name} removed.${back ? ' Refunded ' + back + '.' : ''}`, 'info');
  store.emit('buildings', 'resources', 'meta');
  announceProgress(); // removing a noisy Sawmill can raise happiness
  hooks.onRemoved?.(removed);
}

export function cancelRemoval(): void {
  if (!store.state.pendingRemoval) return;
  store.state.pendingRemoval = null;
  say('Nothing was removed.', 'info');
  store.emit('meta', 'preview');
}

/** Esc: cancels whatever is active, in this order: road preview, swap, placement, removal, tool. */
export function escape(): void {
  const s = store.state;
  if (s.pieceGhost) {
    cancelPiece();
    return;
  }
  if (s.shelfArmed) {
    s.shelfArmed = false;
    store.emit('word');
    return;
  }
  if (s.swap.active) {
    cancelSwap();
    return;
  }
  if (s.pendingRemoval) {
    cancelRemoval();
    return;
  }
  if (s.tool !== 'inspect') setTool('inspect');
}

/** Enter: confirms an active road preview or a pinned green placement; otherwise submits. */
export function enterKey(): void {
  const s = store.state;
  if (s.pieceGhost) {
    if (pieceStatus()?.ok) confirmPiece();
    return;
  }
  if (s.placement?.pinned) {
    const g = ghostStatus();
    if (g?.ok) confirmPlacement();
    return;
  }
  if (s.swap.active) {
    if (s.swap.selected.length) confirmSwap();
    return;
  }
  submitWord();
}

export function minLengthNow(): number {
  return minWordLength(store.state.tier);
}

// ---------- React binding ----------

/**
 * Subscribes a component to one small slice of the store. The selector must return a
 * primitive or an object the store replaces when it changes (resources, rack), so React
 * re-renders only when that slice really changed.
 */
export function useGame<T>(selector: (s: GameState) => T): T {
  return useSyncExternalStore(store.subscribeAny, () => selector(store.state));
}
