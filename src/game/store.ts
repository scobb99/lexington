// The single mutable game store (Build Spec v1.5, Section 10).
// Game state lives here, outside React. Pixi layers read it directly and subscribe to the
// one topic they draw. React components subscribe only to small interface values
// (resource totals, rack letters, selected tool, message line) through useGame().

import { useSyncExternalStore } from 'react';
import {
  BUILDINGS,
  buildingAt,
  footprintOrigin,
  happiness,
  happinessBreakdown,
  missingResources,
  placementMessage,
  placementProblem,
  population,
  production,
  realBuildings,
  removalRefund,
} from './buildings';
import { CHAIN_COMPLETE, FREE_PLAY, QUESTS, TIER_UNLOCKS, questDone, tierAfterCheck, tierRequirements, type ProgressInputs } from './progress';
import { allWords, dictionaryState, isWord, loadDictionary, type DictionaryState, type DictionaryTestMode } from './dictionary';
import {
  BRIDGE_COST,
  LINK_BRIDGE,
  LINK_NONE,
  LINK_ROAD,
  ROAD_COST,
  bridgeAxisFor,
  bridgeProblem,
  pathAxis,
  roadProblem,
  type MapContext,
  type TileProblem,
} from './roads';
import { generateTerrain, mulberry32 } from './terrain';
import { makeSave, restoreGame, type SaveV1, type SavedCamera } from './save';
import {
  MAP_H,
  MAP_W,
  Terrain,
  emptyResources,
  type Building,
  type BuildingType,
  type Camera,
  type GameMessage,
  type Lifetime,
  type MessageKind,
  type Resources,
  type TerrainMap,
  type Tier,
  type Tool,
} from './types';
import {
  REPEAT_WINDOW,
  REROLL_EVERY,
  computeWordReward,
  drawRack,
  ensurePlayable,
  formatResources,
  isRepeatWord,
  minWordLength,
  refillRack,
  rerollsAfterValidWord,
  validateWord,
} from './words';

/** Section 6: starting resources. */
export const STARTING_RESOURCES: Resources = { coins: 20, lumber: 15, stone: 10, knowledge: 0, magic: 0 };

export type MapStatus = 'starting' | 'ready' | 'failed';

export interface GameState {
  terrain: TerrainMap;
  /** 1 where the player cleared a forest tile (Sections 4 and 7). Saved as tile changes. */
  forestCleared: Uint8Array;
  /** 0 = nothing, 1 = road, 2 = bridge (Section 4). */
  roads: Uint8Array;
  /** Bridge deck direction per tile: 1 = north-south, 2 = east-west (Section 4). */
  bridgeAxis: Uint8Array;
  /** A building removal waiting for the player's confirmation (Section 7). */
  pendingRemoval: { buildingId: number; type: BuildingType; refund: Resources } | null;
  /** Section 5 dead rack rule: free redraws given so far (for tests and the town summary). */
  freeRerolls: number;
  /** Section 9: index of the current quest in QUESTS (QUESTS.length = chain complete). */
  questIndex: number;
  buildings: Building[];
  nextBuildingId: number;
  /** Section 5: decorative flower patches from long words. */
  flowers: { x: number; y: number }[];
  resources: Resources;
  rack: string[];
  rerolls: number;
  tier: Tier;
  lifetime: Lifetime;
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
  tool: Tool;
  message: GameMessage;
  /** Short persistent notice, e.g. when the fallback dictionary is in use. */
  notice: string | null;
  dict: DictionaryState;
  mapStatus: MapStatus;
}

/**
 * 'tiles' = the ground itself changed (a forest tile was cleared), so terrain is repainted.
 * 'load' = a whole town was loaded or a new one started (Section 11): the map repaints its
 * terrain and water and moves the camera. The stage and the app are never rebuilt.
 */
export type Topic = 'terrain' | 'tiles' | 'roads' | 'buildings' | 'resources' | 'rack' | 'tool' | 'message' | 'camera' | 'meta' | 'load';

type Listener = () => void;
const topicListeners = new Map<Topic, Set<Listener>>();
const anyListeners = new Set<Listener>();
let messageCounter = 0;

function urlFlag(name: string): boolean {
  try {
    return new URLSearchParams(window.location.search).has(name);
  } catch {
    return false;
  }
}

/** Test switch ?sandbox: every tier unlocked and plenty of resources, for trying placement. */
const SANDBOX = typeof window !== 'undefined' && urlFlag('sandbox');

function freshState(seedInput: unknown): GameState {
  const terrain = generateTerrain(seedInput);
  return {
    terrain,
    forestCleared: new Uint8Array(MAP_W * MAP_H),
    roads: new Uint8Array(MAP_W * MAP_H),
    bridgeAxis: new Uint8Array(MAP_W * MAP_H),
    pendingRemoval: null,
    freeRerolls: 0,
    questIndex: 0,
    buildings: [],
    nextBuildingId: 1,
    flowers: [],
    resources: SANDBOX ? { coins: 9999, lumber: 9999, stone: 9999, knowledge: 9999, magic: 9999 } : { ...STARTING_RESOURCES },
    rack: drawRack(),
    rerolls: 0,
    tier: SANDBOX ? 3 : 1,
    lifetime: { submissions: 0, validWords: 0, longWords: 0, bridgesBuilt: 0, everBuilt: {}, earned: emptyResources() },
    recentWords: [],
    camera: { x: 0, y: 0, zoom: 1 },
    cameraView: { w: 0, h: 0 },
    pendingCamera: null,
    tool: 'inspect',
    message: {
      id: ++messageCounter,
      kind: 'info',
      text: terrain.seedWasInvalid
        ? `That map seed could not be used, so the default map "${terrain.seedText}" was made instead.`
        : 'Welcome to WordCity. Make a word from your letters to earn resources.',
    },
    notice: null,
    dict: dictionaryState(),
    mapStatus: 'starting',
  };
}

function readSeedFromUrl(): string {
  try {
    const s = new URLSearchParams(window.location.search).get('seed');
    if (s !== null) return s;
  } catch {
    /* not in a browser */
  }
  return String(Math.floor(Math.random() * 1e9));
}

export const store = {
  state: freshState(typeof window === 'undefined' ? 'wordcity' : readSeedFromUrl()),

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

// ---------- derived values (never stored, Section 8) ----------

function isRoadConnected(b: Building): boolean {
  const def = BUILDINGS[b.type];
  const { roads } = store.state;
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H && roads[y * MAP_W + x] > 0;
  for (let x = b.x; x < b.x + def.w; x++) if (at(x, b.y - 1) || at(x, b.y + def.h)) return true;
  for (let y = b.y; y < b.y + def.h; y++) if (at(b.x - 1, y) || at(b.x + def.w, y)) return true;
  return false;
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
 */
function checkProgress(): string[] {
  const s = store.state;
  const out: string[] = [];
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
  return out;
}

/** Runs the Section 9 check and adds its messages to the current message line. */
function announceProgress(): void {
  const extra = checkProgress();
  if (extra.length === 0) return;
  const s = store.state;
  s.message = { id: ++messageCounter, kind: 'celebrate', text: `${s.message.text} ${extra.join(' ')}` };
  store.emit('message', 'resources', 'rack', 'meta');
}

// ---------- actions ----------

export function say(text: string, kind: MessageKind = 'info'): void {
  store.state.message = { id: ++messageCounter, kind, text };
  store.emit('message');
}

export interface SubmitOutcome {
  ok: boolean;
}

/** Section 5 submission flow with Section 12 messages. */
export function submitWord(raw: string): SubmitOutcome {
  const s = store.state;
  const result = validateWord(raw, s.rack, s.tier, isWord);
  s.lifetime = { ...s.lifetime, submissions: s.lifetime.submissions + 1 };

  if (!result.ok) {
    switch (result.reason) {
      case 'empty':
        say('Type a word made from your letters first.', 'warn');
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
        say(`"${result.word}" isn't in the WordCity dictionary.`, 'warn');
        break;
      case 'loading':
        say('The word list is still loading. Try that word again in a moment.', 'info');
        break;
    }
    return { ok: false };
  }

  const word = result.word;
  const repeat = isRepeatWord(word, s.recentWords);
  const wizardTowerStanding = realBuildings(s.buildings).some((b) => b.type === 'wizardTower');
  const reward = computeWordReward(word, { happiness: currentHappiness(), isRepeat: repeat, wizardTowerStanding });
  const validWords = s.lifetime.validWords + 1;
  const made = production(s.buildings, isRoadConnected, validWords);

  const gained = emptyResources();
  const next = { ...s.resources };
  const earned = { ...s.lifetime.earned };
  for (const k of Object.keys(gained) as (keyof Resources)[]) {
    gained[k] = reward.total[k] + made[k];
    next[k] += gained[k];
    earned[k] += gained[k];
  }

  const rerollsBefore = s.rerolls;
  s.resources = next;
  s.lifetime = { ...s.lifetime, validWords, earned, longWords: s.lifetime.longWords + (word.length >= 7 ? 1 : 0) };
  s.recentWords = [...s.recentWords, word].slice(-REPEAT_WINDOW);
  s.rack = refillRack(result.remaining);
  s.rerolls = rerollsAfterValidWord(validWords, s.rerolls);
  const deadRack = applyDeadRackRule();

  const parts: string[] = [];
  parts.push(
    repeat
      ? `${word} again: you played it within your last ${REPEAT_WINDOW} words, so it earns half. ${formatResources(reward.total)}.`
      : `${word}! ${formatResources(reward.total)}.`,
  );
  if (reward.longWordBonus) {
    parts.push('Long word bonus: +1 Magic and a flower patch near town.');
    addFlowerPatch();
  }
  const madeText = formatResources(made);
  if (madeText) parts.push(`Your town produced ${madeText}.`);
  if (s.rerolls > rerollsBefore) parts.push(`You earned a reroll (${s.rerolls} held).`);
  else if (validWords % REROLL_EVERY === 0 && s.rerolls === rerollsBefore) parts.push('Reroll limit reached (3 held).');
  if (deadRack) parts.push(deadRack);

  store.state.message = { id: ++messageCounter, kind: 'success', text: parts.join(' ') };
  store.emit('resources', 'rack', 'message', 'meta');
  announceProgress();
  return { ok: true };
}

/** Section 5: a reroll replaces all 8 letters, with no cost and no penalty. */
export function rerollRack(): void {
  const s = store.state;
  if (s.rerolls <= 0) {
    say(`No rerolls yet. You earn one for every ${REROLL_EVERY} valid words.`, 'info');
    return;
  }
  s.rerolls -= 1;
  s.rack = drawRack();
  const deadRack = applyDeadRackRule();
  const text = `Fresh letters! ${s.rerolls} reroll${s.rerolls === 1 ? '' : 's'} left.${deadRack ? ' ' + deadRack : ''}`;
  store.state.message = { id: ++messageCounter, kind: 'info', text };
  store.emit('rack', 'message', 'meta');
}

/**
 * Section 5 dead rack rule (Stu decision, Nov 20, 2026): whenever a new rack is drawn and it
 * holds no valid word at the current minimum length, the player gets a free new rack that
 * does not use a stored reroll. Runs after every refill and reroll, and once the word list
 * has loaded (the first rack is drawn before the list is ready). Returns a message, or null.
 */
export function recheckRack(): boolean {
  const msg = applyDeadRackRule();
  if (msg) {
    store.state.message = { id: ++messageCounter, kind: 'info', text: msg };
    store.emit('rack', 'message', 'meta');
  }
  return msg !== null;
}

function applyDeadRackRule(): string | null {
  const s = store.state;
  if (s.dict.status === 'loading') return null;
  const { rack, freeRedraws } = ensurePlayable(s.rack, minWordLength(s.tier), allWords());
  if (freeRedraws === 0) return null;
  s.rack = rack;
  s.freeRerolls += freeRedraws;
  return 'No word could be made from those letters, so you got a free new rack. Your stored rerolls are untouched.';
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

export function setTool(tool: Tool): void {
  store.state.tool = tool;
  if (store.state.pendingRemoval && tool !== 'remove') store.state.pendingRemoval = null;
  store.emit('tool', 'meta');
}

/** Called by the camera on every pan or zoom. React never subscribes to this. */
export function setCamera(cam: Camera, view?: { w: number; h: number }): void {
  store.state.camera = cam;
  if (view) store.state.cameraView = view;
  store.emit('camera');
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
export function currentSave(now: Date = new Date()): SaveV1 {
  return makeSave(store.state, savedCamera(), now);
}

/** Emits every topic so each layer and panel redraws from the new town. */
function emitWholeTown(): void {
  store.emit('load', 'terrain', 'tiles', 'roads', 'buildings', 'resources', 'rack', 'tool', 'message', 'camera', 'meta');
}

/**
 * Section 11: replaces the current town with a checked save (from parseSave). Happiness and
 * population are recalculated from the buildings. The dictionary, notices and the map stay as
 * they are: only the town changes, and the map repaints itself on the 'load' topic.
 */
export function loadSavedGame(save: SaveV1, message: string): void {
  const r = restoreGame(save);
  const s = store.state;
  store.state = {
    ...s,
    terrain: r.terrain,
    forestCleared: r.forestCleared,
    roads: r.roads,
    bridgeAxis: r.bridgeAxis,
    flowers: r.flowers,
    buildings: r.buildings,
    nextBuildingId: r.nextBuildingId,
    resources: r.resources,
    rack: r.rack,
    rerolls: r.rerolls,
    tier: r.tier,
    lifetime: r.lifetime,
    recentWords: r.recentWords,
    questIndex: r.questIndex,
    freeRerolls: r.freeRerolls,
    pendingCamera: r.camera,
    pendingRemoval: null,
    tool: 'inspect',
    message: { id: ++messageCounter, kind: 'success', text: message },
  };
  emitWholeTown();
}

/** Section 11 New Game: a fresh map and starting resources. Saves are handled by the caller. */
export function startNewGame(seedInput?: string): void {
  const s = store.state;
  const seed = seedInput && seedInput.trim() ? seedInput.trim() : String(Math.floor(Math.random() * 1e9));
  const fresh = freshState(seed);
  store.state = { ...fresh, dict: s.dict, notice: s.notice, mapStatus: s.mapStatus };
  if (!fresh.terrain.seedWasInvalid) {
    store.state.message = { id: ++messageCounter, kind: 'success', text: `A new town on a fresh map (seed "${fresh.terrain.seedText}"). Make a word to begin.` };
  }
  applyDeadRackRule();
  emitWholeTown();
}

/** The map took the loaded camera; the live camera is the truth again. */
export function pendingCameraApplied(): void {
  store.state.pendingCamera = null;
}

const TERRAIN_LABELS = ['Meadow', 'Forest', 'Hill', 'Marsh', 'Thicket (impassable)', 'Water'];

export function inspectTile(x: number, y: number): void {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return;
  const t = store.state.terrain.tiles[y * MAP_W + x];
  const b = store.state.buildings.find(
    (b) => x >= b.x && y >= b.y && x < b.x + BUILDINGS[b.type].w && y < b.y + BUILDINGS[b.type].h,
  );
  const link = store.state.roads[y * MAP_W + x];
  const cleared = t === Terrain.Forest && store.state.forestCleared[y * MAP_W + x] === 1;
  if (b) say(`${BUILDINGS[b.type].name}${b.preview ? ' (art showcase)' : ''} at tile ${x}, ${y}.`);
  else if (link === LINK_ROAD) say(`Road at tile ${x}, ${y}.`);
  else if (link === LINK_BRIDGE) say(`Bridge at tile ${x}, ${y}.`);
  else say(`Tile ${x}, ${y}: ${cleared ? 'Cleared forest' : TERRAIN_LABELS[t] ?? 'Unknown'}.`);
}

// ---------- map and dictionary lifecycle ----------

function dictionaryTestMode(): DictionaryTestMode {
  try {
    const v = new URLSearchParams(window.location.search).get('testDict');
    return v === 'corrupt' || v === 'block' ? v : null;
  } catch {
    return null;
  }
}

let dictionaryStarted = false;

/** Section 5: the list is parsed after the map first paints (or the map fails, or 4 s pass). */
export function startDictionary(): void {
  if (dictionaryStarted) return;
  dictionaryStarted = true;
  void loadDictionary(dictionaryTestMode()).then((d) => {
    store.state.dict = d;
    store.state.notice =
      d.status === 'fallback'
        ? 'The main word list could not load, so WordCity is using a small backup list of 200 common words. Reload the page to try again.'
        : null;
    const deadRack = applyDeadRackRule();
    if (deadRack) store.state.message = { id: ++messageCounter, kind: 'info', text: deadRack };
    store.emit('meta', 'rack', 'message');
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
 * Showcase buildings are marked `preview` and never count for the economy. Normal games start
 * with an empty town.
 */
export function placeShowcase(): void {
  const s = store.state;
  const free = new Uint8Array(MAP_W * MAP_H);
  const open = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < MAP_W && y < MAP_H && !free[y * MAP_W + x] &&
    s.terrain.tiles[y * MAP_W + x] === Terrain.Meadow;
  const fits = (x: number, y: number, w: number, h: number) => {
    for (let yy = y - 2; yy <= y + h + 1; yy++) for (let xx = x - 2; xx <= x + w + 1; xx++) if (!open(xx, yy)) return false;
    return true;
  };
  const take = (x: number, y: number, w: number, h: number) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) free[yy * MAP_W + xx] = 1;
  };
  const order: BuildingType[] = [
    'townHall', 'market', 'greenhouse', 'library', 'tavern', 'wizardTower',
    'sawmill', 'quarry', 'park', 'cottage', 'pier',
  ];
  const placed: Building[] = [];
  const cx = MAP_W >> 1;
  const cy = MAP_H >> 1;
  for (const type of order) {
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
            // The pier's art includes its own water; keep it on the river bank.
            let nearWater = false;
            for (let yy = y - 1; yy <= y + h && !nearWater; yy++)
              for (let xx = x - 1; xx <= x + w && !nearWater; xx++)
                nearWater = s.terrain.tiles[yy * MAP_W + xx] === Terrain.Water;
            if (!nearWater) continue;
          }
          take(x, y, w, h);
          placed.push({ id: s.nextBuildingId++, type, x, y, preview: true });
          done = true;
        }
      }
    }
  }
  s.buildings = placed;
  store.emit('buildings');
}

// ---------- Phase 2: roads, bridges, clearing, placement, removal ----------

export function mapContext(): MapContext {
  const s = store.state;
  return {
    tiles: s.terrain.tiles,
    forestCleared: s.forestCleared,
    roads: s.roads,
    occupied: (x, y) => !!buildingAt(s.buildings, x, y),
  };
}

function placementContext() {
  const s = store.state;
  return { tiles: s.terrain.tiles, forestCleared: s.forestCleared, roads: s.roads, buildings: s.buildings, mapW: MAP_W, mapH: MAP_H };
}

/** Section 6: "lists exactly which resources are missing and by how much". */
function missingText(missing: Resources): string {
  const parts = formatResources(missing, '').split(', ').filter(Boolean);
  const list = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0];
  return `Not enough resources: you need ${list} more.`;
}

function canAfford(cost: Resources): Resources | null {
  const missing = missingResources(store.state.resources, cost);
  return Object.values(missing).some((v) => v > 0) ? missing : null;
}

function pay(cost: Resources): void {
  const next = { ...store.state.resources };
  for (const k of Object.keys(next) as (keyof Resources)[]) next[k] -= cost[k];
  store.state.resources = next;
}

const costOf = (c: Partial<Resources>, n = 1): Resources => ({
  coins: (c.coins ?? 0) * n,
  lumber: (c.lumber ?? 0) * n,
  stone: (c.stone ?? 0) * n,
  knowledge: (c.knowledge ?? 0) * n,
  magic: (c.magic ?? 0) * n,
});

/** Section 12 messages for road and bridge tiles. */
export function tileProblemMessage(kind: 'road' | 'bridge' | 'clear', p: TileProblem | 'notForest'): string {
  switch (p) {
    case 'bounds':
      return 'That is off the edge of the map.';
    case 'exists':
      return kind === 'bridge' ? 'There is already a road or bridge there.' : 'There is already a road there.';
    case 'occupied':
      return 'A building is in the way.';
    case 'thicket':
      return kind === 'clear' ? 'Thicket is too dense to clear, and roads cannot pass through it.' : 'Thicket is too dense for a road.';
    case 'water':
      return 'Roads cannot cross water. Use the Bridge tool to build a bridge.';
    case 'forest':
      return 'That is forest. Use Clear forest first, then build the road.';
    case 'notWater':
      return 'Bridges go on water. Use the Road tool on land.';
    case 'notForest':
      return 'Only forest tiles can be cleared.';
  }
}

/**
 * Builds a dragged road or bridge path (Section 4). Tiles that already have a road are skipped.
 * If any other tile is not allowed, or the player cannot pay for the whole path, nothing is
 * built and the message says why. Costs are deducted only after every check passes.
 */
export function buildPath(kind: 'road' | 'bridge', path: { x: number; y: number }[]): boolean {
  const s = store.state;
  const ctx = mapContext();
  const unique = path.filter((p, i) => path.findIndex((q) => q.x === p.x && q.y === p.y) === i);
  const todo: { x: number; y: number }[] = [];
  for (const t of unique) {
    const p = kind === 'road' ? roadProblem(ctx, t.x, t.y) : bridgeProblem(ctx, t.x, t.y);
    if (p === 'exists' || (p === 'bounds' && unique.length > 1)) continue;
    if (p) {
      say(tileProblemMessage(kind, p), 'warn');
      return false;
    }
    todo.push(t);
  }
  if (todo.length === 0) {
    say(tileProblemMessage(kind, 'exists'), 'info');
    return false;
  }
  const cost = costOf(kind === 'road' ? ROAD_COST : BRIDGE_COST, todo.length);
  const missing = canAfford(cost);
  if (missing) {
    say(missingText(missing), 'warn');
    return false;
  }
  pay(cost);
  const roads = s.roads.slice();
  const axis = s.bridgeAxis.slice();
  const dragAxis = pathAxis(todo);
  for (const t of todo) {
    const i = t.y * MAP_W + t.x;
    roads[i] = kind === 'road' ? LINK_ROAD : LINK_BRIDGE;
    if (kind === 'bridge') axis[i] = bridgeAxisFor({ ...ctx, roads }, t.x, t.y, dragAxis);
  }
  s.roads = roads;
  s.bridgeAxis = axis;
  const n = todo.length;
  if (kind === 'bridge') s.lifetime = { ...s.lifetime, bridgesBuilt: s.lifetime.bridgesBuilt + n };
  say(
    kind === 'road'
      ? `Built ${n} road tile${n === 1 ? '' : 's'} for ${formatResources(cost, '')}.`
      : `Built ${n} bridge tile${n === 1 ? '' : 's'} for ${formatResources(cost, '')}.`,
    'success',
  );
  store.emit('roads', 'resources', 'buildings');
  announceProgress(); // roads can connect Cottages (happiness), bridges complete a quest
  return true;
}

/** Section 4 (Stu ruling, Nov 20, 2026): clearing forest costs 2 Coins per tile. */
export const CLEAR_FOREST_COST: Resources = { coins: 2, lumber: 0, stone: 0, knowledge: 0, magic: 0 };

/**
 * Clears forest tiles so roads and buildings can use them (Section 4). Thicket cannot be
 * cleared. Non-forest tiles in a dragged path are skipped; if the player cannot pay for every
 * forest tile in the path, nothing is cleared and the message lists what is missing.
 * The baked terrain texture is repainted in place (Section 4: not a terrain rebuild).
 */
export function clearForest(path: { x: number; y: number }[]): boolean {
  const s = store.state;
  const unique = path.filter((p, i) => path.findIndex((q) => q.x === p.x && q.y === p.y) === i);
  const todo = unique.filter((t) => {
    if (t.x < 0 || t.y < 0 || t.x >= MAP_W || t.y >= MAP_H) return false;
    const i = t.y * MAP_W + t.x;
    return s.terrain.tiles[i] === Terrain.Forest && !s.forestCleared[i] && !buildingAt(s.buildings, t.x, t.y);
  });
  if (todo.length === 0) {
    const t = unique[0];
    const code = t && t.x >= 0 && t.y >= 0 && t.x < MAP_W && t.y < MAP_H ? s.terrain.tiles[t.y * MAP_W + t.x] : -1;
    say(tileProblemMessage('clear', code === Terrain.Thicket ? 'thicket' : 'notForest'), 'warn');
    return false;
  }
  const cost = costOf(CLEAR_FOREST_COST, todo.length);
  const missing = canAfford(cost);
  if (missing) {
    say(missingText(missing), 'warn');
    return false;
  }
  pay(cost);
  const cleared = s.forestCleared.slice();
  for (const t of todo) cleared[t.y * MAP_W + t.x] = 1;
  s.forestCleared = cleared;
  const n = todo.length;
  say(`Cleared ${n} forest tile${n === 1 ? '' : 's'} for ${formatResources(cost, '')}. The ground is open for roads and buildings.`, 'success');
  store.emit('tiles', 'roads', 'resources');
  return true;
}

/** Section 7 placement with Section 6 costs and Section 12 messages. (tx, ty) = pointer tile. */
export function placeBuilding(type: BuildingType, tx: number, ty: number): boolean {
  const s = store.state;
  const def = BUILDINGS[type];
  if (def.tier > s.tier) {
    say(`The ${def.name} unlocks at Tier ${def.tier}.`, 'warn');
    return false;
  }
  const { x, y } = footprintOrigin(type, tx, ty);
  const problem = placementProblem(placementContext(), type, x, y);
  if (problem) {
    say(placementMessage(problem, type), 'warn');
    return false;
  }
  const missing = canAfford(def.cost);
  if (missing) {
    say(missingText(missing), 'warn');
    return false;
  }
  pay(def.cost);
  s.buildings = [...s.buildings, { id: s.nextBuildingId++, type, x, y }];
  s.lifetime = { ...s.lifetime, everBuilt: { ...s.lifetime.everBuilt, [type]: (s.lifetime.everBuilt[type] ?? 0) + 1 } };
  say(`${def.name} built! ${formatResources(def.cost, '-')}.`, 'success');
  store.emit('buildings', 'resources');
  announceProgress();
  return true;
}

/**
 * Remove tool. Roads and bridges go at once, free, with no refund (Section 4). A building asks
 * for one confirmation that shows the exact refund (Section 7).
 */
export function requestRemoveAt(x: number, y: number): void {
  const s = store.state;
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return;
  const b = buildingAt(s.buildings, x, y);
  if (b) {
    if (b.preview) {
      say('That building is part of the art showcase and cannot be removed.', 'info');
      return;
    }
    const refund = removalRefund(b.type);
    s.pendingRemoval = { buildingId: b.id, type: b.type, refund };
    const back = formatResources(refund);
    say(`Remove the ${BUILDINGS[b.type].name}? You will get back ${back || 'nothing'}. Confirm in the Build panel.`, 'warn');
    store.emit('meta');
    return;
  }
  const i = y * MAP_W + x;
  const link = s.roads[i];
  if (link === LINK_NONE) {
    say('There is nothing to remove there.', 'info');
    return;
  }
  const roads = s.roads.slice();
  roads[i] = LINK_NONE;
  const axis = s.bridgeAxis.slice();
  axis[i] = 0;
  s.roads = roads;
  s.bridgeAxis = axis;
  say(`${link === LINK_BRIDGE ? 'Bridge' : 'Road'} removed. Roads and bridges are removed free and refund nothing.`, 'info');
  store.emit('roads', 'buildings');
}

export function confirmRemoval(): void {
  const s = store.state;
  const p = s.pendingRemoval;
  if (!p) return;
  s.pendingRemoval = null;
  if (!s.buildings.some((b) => b.id === p.buildingId)) {
    store.emit('meta');
    return;
  }
  s.buildings = s.buildings.filter((b) => b.id !== p.buildingId);
  const next = { ...s.resources };
  for (const k of Object.keys(next) as (keyof Resources)[]) next[k] += p.refund[k];
  s.resources = next;
  const back = formatResources(p.refund);
  say(`${BUILDINGS[p.type].name} removed.${back ? ' Refunded ' + back + '.' : ''}`, 'info');
  store.emit('buildings', 'resources', 'meta');
  announceProgress(); // removing a noisy Sawmill can raise happiness
}

export function cancelRemoval(): void {
  if (!store.state.pendingRemoval) return;
  store.state.pendingRemoval = null;
  say('Nothing was removed.', 'info');
  store.emit('meta');
}

export interface PreviewCell {
  x: number;
  y: number;
  ok: boolean;
}

/**
 * What the map should highlight under the pointer for the current tool: the cells, whether
 * each is allowed, and for buildings the footprint origin. Used by the cursor layer only.
 */
export function previewFor(tool: Tool, tx: number, ty: number, path: { x: number; y: number }[] | null): {
  cells: PreviewCell[];
  building?: { type: BuildingType; x: number; y: number; ok: boolean };
} {
  const s = store.state;
  const ctx = mapContext();
  if (tool === 'road' || tool === 'bridge') {
    const tiles = path && path.length ? path : [{ x: tx, y: ty }];
    return {
      cells: tiles.map((t) => {
        const p = tool === 'road' ? roadProblem(ctx, t.x, t.y) : bridgeProblem(ctx, t.x, t.y);
        return { x: t.x, y: t.y, ok: p === null || p === 'exists' };
      }),
    };
  }
  if (tool === 'clear') {
    const tiles = path && path.length ? path : [{ x: tx, y: ty }];
    return {
      cells: tiles.map((t) => {
        const inMap = t.x >= 0 && t.y >= 0 && t.x < MAP_W && t.y < MAP_H;
        const i = t.y * MAP_W + t.x;
        return { x: t.x, y: t.y, ok: inMap && s.terrain.tiles[i] === Terrain.Forest && !s.forestCleared[i] };
      }),
    };
  }
  if (tool === 'remove') {
    const b = buildingAt(s.buildings, tx, ty);
    if (b) {
      const d = BUILDINGS[b.type];
      const cells: PreviewCell[] = [];
      for (let y = b.y; y < b.y + d.h; y++) for (let x = b.x; x < b.x + d.w; x++) cells.push({ x, y, ok: false });
      return { cells };
    }
    return { cells: [{ x: tx, y: ty, ok: false }] };
  }
  if (tool === 'inspect') return { cells: [{ x: tx, y: ty, ok: true }] };
  const type = tool;
  const { x, y } = footprintOrigin(type, tx, ty);
  const ok = !placementProblem(placementContext(), type, x, y) && BUILDINGS[type].tier <= s.tier;
  const d = BUILDINGS[type];
  const cells: PreviewCell[] = [];
  for (let yy = y; yy < y + d.h; yy++) for (let xx = x; xx < x + d.w; xx++) cells.push({ x: xx, y: yy, ok });
  return { cells, building: { type, x, y, ok } };
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
