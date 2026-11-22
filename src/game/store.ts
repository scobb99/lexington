// The single mutable game store (Build Spec v2.0, Section 10).
// Game state lives here, outside React. Pixi layers read it directly and subscribe to the
// one topic they draw. React components subscribe only to small interface values
// (resource totals, the rack's tile objects, selected tool, message line) through useGame().
//
// v2.0 additions: the rack is a list of tile objects with their own used state (Section 5);
// Hint and Swap; roads and bridges are drawn as a preview and charged once at Confirm
// (Section 4); clearing thicket and draining marsh (Section 4); the placement ghost (Section 7);
// the title screen and tutorial modes (Sections 16 and 17).

import { useSyncExternalStore } from 'react';
import {
  BUILDINGS,
  amount,
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
import {
  BRIDGE_COST,
  LINK_BRIDGE,
  LINK_NONE,
  LINK_ROAD,
  ROAD_COST,
  bridgeAxisFor,
  bridgeProblem,
  extendPath,
  pathAxis,
  roadProblem,
  type MapContext,
  type Pt,
  type TileProblem,
} from './roads';
import { generateTerrain, mulberry32 } from './terrain';
import { makeSave, restoreGame, type MigrationNotes, type SaveData, type SavedCamera } from './save';
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
  type RackTile,
  type Resources,
  type TerrainMap,
  type Tier,
  type Tool,
} from './types';
import {
  REPEAT_WINDOW,
  REROLL_EVERY,
  SWAP_COST_PER_TILE,
  computeWordReward,
  drawLetter,
  drawRack,
  ensurePlayable,
  formatResources,
  isRepeatWord,
  longestWord,
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

/** Section 5 (v2.0): Hint presses since the rack last changed, and the hint word. Never saved. */
export interface HintState {
  presses: number;
  word: string | null;
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
  terrain: TerrainMap;
  /**
   * 1 where the player changed the land (Section 4, v2.0): forest to cleared forest, thicket to
   * cleared thicket, marsh to drained marsh (meadow). Saved as tile changes (Section 11).
   */
  cleared: Uint8Array;
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

function freshState(seedInput: unknown, opts: { sandbox?: boolean } = {}): GameState {
  const terrain = generateTerrain(seedInput);
  const sandbox = opts.sandbox ?? SANDBOX;
  return {
    mode: 'title',
    terrain,
    cleared: new Uint8Array(MAP_W * MAP_H),
    roads: new Uint8Array(MAP_W * MAP_H),
    bridgeAxis: new Uint8Array(MAP_W * MAP_H),
    pendingRemoval: null,
    freeRerolls: 0,
    questIndex: 0,
    buildings: [],
    nextBuildingId: 1,
    flowers: [],
    resources: sandbox ? { coins: 9999, lumber: 9999, stone: 9999, knowledge: 9999, magic: 9999 } : { ...STARTING_RESOURCES },
    rack: makeTiles(drawRack()),
    word: [],
    hint: { presses: 0, word: null },
    swap: { active: false, selected: [] },
    shake: null,
    rerolls: 0,
    tier: sandbox ? 3 : 1,
    lifetime: { submissions: 0, validWords: 0, longWords: 0, bridgesBuilt: 0, everBuilt: {}, earned: emptyResources() },
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
} = {};

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
 * Section 17: in the tutorial, quests do not run and the tier stays at Tier 1.
 */
function checkProgress(): string[] {
  const s = store.state;
  if (s.mode === 'tutorial') return [];
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
  store.emit('message', 'resources', 'rack', 'word', 'meta');
}

// ---------- messages ----------

export function say(text: string, kind: MessageKind = 'info'): void {
  store.state.message = { id: ++messageCounter, kind, text };
  store.emit('message');
}

// ---------- Section 5 (v2.0): the rack, tile identity, and the current word ----------

/** The letters of the rack, left to right (what a save stores). */
export function rackLetters(): string[] {
  return store.state.rack.map((t) => t.letter);
}

/** The current word as text, in the order the letters were placed. */
export function currentWord(): string {
  const s = store.state;
  return s.word.map((id) => s.rack.find((t) => t.id === id)?.letter ?? '').join('');
}

/** Replaces the rack's tiles; any change to the rack clears the word, the Hint and Swap. */
function setRack(tiles: RackTile[]): void {
  const s = store.state;
  s.rack = tiles;
  s.word = [];
  s.hint = { presses: 0, word: null };
  s.swap = { active: false, selected: [] };
}

function markUsed(): void {
  const s = store.state;
  const inWord = new Set(s.word);
  s.rack = s.rack.map((t) => (t.used === inWord.has(t.id) ? t : { ...t, used: inWord.has(t.id) }));
}

/**
 * Tapping a tile greys that exact tile and appends its id to the word. Tapping a tile that is
 * already used removes that tile's id from the word, wherever it sits, and un-greys it; the
 * other letters stay in place. In swap mode a tap selects the tile for the swap instead.
 */
export function tapTile(id: number): void {
  const s = store.state;
  const tile = s.rack.find((t) => t.id === id);
  if (!tile) return;
  if (s.swap.active) {
    toggleSwapSelect(id);
    return;
  }
  if (tile.used) s.word = s.word.filter((w) => w !== id);
  else s.word = [...s.word, id];
  markUsed();
  store.emit('word');
}

/** A desktop letter key consumes the first unused tile with that letter, scanning from the left. */
export function typeLetter(letter: string): boolean {
  const s = store.state;
  const L = letter.toUpperCase();
  if (s.swap.active) return false;
  const tile = s.rack.find((t) => t.letter === L && !t.used);
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

/** Deleting removes the last id in the word list and frees exactly that tile. */
export function deleteLast(): void {
  const s = store.state;
  if (s.word.length === 0) return;
  s.word = s.word.slice(0, -1);
  markUsed();
  store.emit('word');
}

/** Section 5: a long press of the delete button clears the whole word. */
export function clearWord(announce = true): void {
  const s = store.state;
  if (s.word.length === 0) return;
  s.word = [];
  markUsed();
  if (announce) s.message = { id: ++messageCounter, kind: 'info', text: 'Word cleared.' };
  store.emit('word', 'message');
}

export interface SubmitOutcome {
  ok: boolean;
}

/**
 * Section 5 submission flow with Section 12 messages. The word is the placed tiles. On a valid
 * word the used tiles are removed by id, the unused tiles keep their ids and positions, and new
 * tiles with fresh ids fill the empty slots. `text` is for tests: it places those letters first.
 */
export function submitWord(text?: string): SubmitOutcome {
  const s = store.state;
  if (s.preview) {
    say('Confirm or cancel the road first.', 'info');
    return { ok: false };
  }
  if (!s.locks.submit) {
    say('Words are paused for this step of the tour.', 'info');
    return { ok: false };
  }
  if (text !== undefined) {
    s.word = [];
    markUsed();
    for (const ch of text.toUpperCase().replace(/[^A-Z]/g, '')) typeLetter(ch);
  }
  if (s.swap.active) cancelSwap(false);
  const word = currentWord();
  const result = validateWord(word, rackLetters(), s.tier, isWord);
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

  const repeat = isRepeatWord(result.word, s.recentWords);
  const wizardTowerStanding = realBuildings(s.buildings).some((b) => b.type === 'wizardTower');
  const reward = computeWordReward(result.word, { happiness: currentHappiness(), isRepeat: repeat, wizardTowerStanding });
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
  s.lifetime = { ...s.lifetime, validWords, earned, longWords: s.lifetime.longWords + (result.word.length >= 7 ? 1 : 0) };
  s.recentWords = [...s.recentWords, result.word].slice(-REPEAT_WINDOW);
  // Used tiles go by id; the others keep their ids and positions; fresh tiles fill the gaps.
  const used = new Set(s.word);
  setRack(s.rack.map((t) => (used.has(t.id) ? { id: ++tileCounter, letter: drawLetter(), used: false } : { ...t, used: false })));
  s.rerolls = rerollsAfterValidWord(validWords, s.rerolls);
  const deadRack = applyDeadRackRule();

  const parts: string[] = [];
  parts.push(
    repeat
      ? `${result.word} again: you played it within your last ${REPEAT_WINDOW} words, so it earns half. ${formatResources(reward.total)}.`
      : `${result.word}! ${formatResources(reward.total)}.`,
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
  store.emit('resources', 'rack', 'word', 'message', 'meta');
  announceProgress();
  hooks.onWord?.({ ok: true, produced: madeText.length > 0 });
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
  setRack(makeTiles(drawRack()));
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
 * not use a stored reroll. Also runs once the word list has loaded.
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
  setRack(makeTiles(rack));
  s.freeRerolls += freeRedraws;
  return DEAD_RACK_MESSAGE;
}

// ---------- Section 5 (v2.0): Hint ----------

/**
 * Hint button: free, unlimited, no penalty. The hint word is the longest word the rack can make
 * (ties alphabetical), worked out on the first press and kept until the rack changes.
 * Press 1 names the length; press 2 places the first letter (tile identity rules); press 3 and
 * later reveal the word.
 */
export function pressHint(): void {
  const s = store.state;
  if (s.dict.status === 'loading') {
    say('The word list is still loading. Try Hint again in a moment.', 'info');
    return;
  }
  if (s.swap.active) cancelSwap(false);
  if (!s.hint.word) {
    const w = longestWord(rackLetters(), minWordLength(s.tier), allWords());
    if (!w) {
      say(DEAD_RACK_MESSAGE, 'info');
      recheckRack();
      return;
    }
    s.hint = { presses: 0, word: w };
  }
  const word = s.hint.word!;
  const presses = s.hint.presses + 1;
  s.hint = { presses, word };
  if (presses === 1) {
    say(`You can make a ${word.length} letter word from these letters.`, 'info');
  } else if (presses === 2) {
    // The first letter is placed from the rack: the word starts again from that letter.
    s.word = [];
    markUsed();
    typeLetter(word[0]);
    say(`It starts with ${word[0]}.`, 'info');
  } else {
    say(`The word is ${word}. Play it to earn its reward.`, 'info');
  }
  store.emit('word');
}

// ---------- Section 5 (v2.0): Swap ----------

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
  const keepWord = s.word;
  setRack(s.rack.map((t) => (picked.has(t.id) ? { id: ++tileCounter, letter: drawLetter(), used: false } : t)));
  // Tiles in the word were never selectable, so the word survives a swap unchanged.
  s.word = keepWord.filter((id) => s.rack.some((t) => t.id === id));
  markUsed();
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
  if (s.preview && tool !== s.tool) {
    say('Confirm or cancel the road first.', 'info');
    return false;
  }
  if (!toolAllowed(tool)) return false;
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
  return makeSave({ ...s, rack: rackLetters() }, savedCamera(), now);
}

/** Emits every topic so each layer and panel redraws from the new town. */
function emitWholeTown(): void {
  store.emit('load', 'terrain', 'tiles', 'roads', 'buildings', 'resources', 'rack', 'word', 'tool', 'preview', 'message', 'camera', 'marks', 'meta', 'mode');
}

/** Section 11 (v2.0): the migration notice, with the count filled in. */
export function migrationMessage(notes?: MigrationNotes): string | null {
  const n = notes?.marshRoadsToBridges ?? 0;
  if (n <= 0) return null;
  return `Your save was updated: ${n} road tile${n === 1 ? '' : 's'} on marsh ${n === 1 ? 'is' : 'are'} now ${n === 1 ? 'a bridge' : 'bridges'}.`;
}

/**
 * Section 11: replaces the current town with a checked save (from parseSave). Happiness and
 * population are recalculated from the buildings. The dictionary, notices and the map stay as
 * they are: only the town changes, and the map repaints itself on the 'load' topic. A load
 * always starts with an empty word and no active tool preview (v2.0).
 */
export function loadSavedGame(save: SaveData, message: string, notes?: MigrationNotes): void {
  const r = restoreGame(save);
  const s = store.state;
  const migrated = migrationMessage(notes);
  store.state = {
    ...s,
    mode: 'town',
    terrain: r.terrain,
    cleared: r.cleared,
    roads: r.roads,
    bridgeAxis: r.bridgeAxis,
    flowers: r.flowers,
    buildings: r.buildings,
    nextBuildingId: r.nextBuildingId,
    resources: r.resources,
    rack: makeTiles(r.rack),
    word: [],
    hint: { presses: 0, word: null },
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
    store.state.message = { id: ++messageCounter, kind: 'success', text: `A new town on a fresh map (seed "${fresh.terrain.seedText}"). Make a word to begin.` };
  }
  applyDeadRackRule();
  emitWholeTown();
}

/** Section 17: the tutorial town, a sandbox on a fixed seed with a fixed first rack. */
export function startTutorialTown(seed: string, firstRack: string[]): void {
  const s = store.state;
  const fresh = freshState(seed, { sandbox: false });
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

/** Section 16: back to the title screen (the caller autosaves first). */
export function showTitle(): void {
  const s = store.state;
  s.mode = 'title';
  s.preview = null;
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
  if (b) say(`${BUILDINGS[b.type].name}${b.preview ? ' (art showcase)' : ''} at tile ${x}, ${y}.`);
  else if (link === LINK_ROAD) say(`Road at tile ${x}, ${y}.`);
  else if (link === LINK_BRIDGE) say(`Bridge at tile ${x}, ${y}${t === Terrain.Marsh ? ', over marsh' : ''}.`);
  else say(`Tile ${x}, ${y}: ${ground}.`);
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

/**
 * Section 5: the list is parsed once. v2.0: the title screen shows the word list size, and no
 * map is drawn behind the title, so the list starts loading on the title screen.
 */
export function startDictionary(): void {
  if (dictionaryStarted) return;
  dictionaryStarted = true;
  void loadDictionary(dictionaryTestMode()).then((d) => {
    store.state.dict = d;
    store.state.notice =
      d.status === 'fallback'
        ? `The main word list could not load, so ${NAME} is using a small backup list of 200 common words. Reload the page to try again.`
        : null;
    if (store.state.mode !== 'title') {
      const deadRack = applyDeadRackRule();
      if (deadRack) store.state.message = { id: ++messageCounter, kind: 'info', text: deadRack };
    }
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
  const order: BuildingType[] = ['townHall', 'market', 'greenhouse', 'library', 'tavern', 'wizardTower', 'sawmill', 'quarry', 'park', 'cottage', 'pier'];
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
            let nearWater = false;
            for (let yy = y - 1; yy <= y + h && !nearWater; yy++)
              for (let xx = x - 1; xx <= x + w && !nearWater; xx++) nearWater = s.terrain.tiles[yy * MAP_W + xx] === Terrain.Water;
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
  return { tiles: s.terrain.tiles, cleared: s.cleared, roads: s.roads, buildings: s.buildings, mapW: MAP_W, mapH: MAP_H };
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

const costOf = (c: Partial<Resources>, n = 1): Resources => ({
  coins: (c.coins ?? 0) * n,
  lumber: (c.lumber ?? 0) * n,
  stone: (c.stone ?? 0) * n,
  knowledge: (c.knowledge ?? 0) * n,
  magic: (c.magic ?? 0) * n,
});

// ---------- Section 4 (v2.0): road and bridge preview and confirm ----------

export type PreviewTileState = 'new' | 'existing' | 'bad';

export interface PreviewTile extends Pt {
  state: PreviewTileState;
  /** Section 4 reason wording, for a bad tile. */
  reason?: string;
}

export interface PreviewSummary {
  kind: 'road' | 'bridge';
  tiles: PreviewTile[];
  /** New tiles only (tiles already carrying a road or bridge are free and skipped). */
  count: number;
  cost: Resources;
  /** "Road: 7 tiles, 7 Coins." / "Bridge: 3 tiles, 9 Coins and 6 Lumber." */
  line: string;
  /** Why Confirm is disabled, first matching reason (Section 4 order), or null. */
  problem: string | null;
  canConfirm: boolean;
}

/** Section 4 (v2.0): the wording for a tile that cannot take this kind of path. */
function badTileReason(kind: 'road' | 'bridge', p: TileProblem, n: number): string {
  if (p === 'occupied') return 'That tile is already built on.';
  if (kind === 'bridge') return 'Bridges need water or marsh.';
  switch (p) {
    case 'water':
      return `Tile ${n} is water. Water needs a bridge.`;
    case 'marsh':
      return `Tile ${n} is marsh. Marsh needs a bridge, or drain it from Tier 2.`;
    case 'thicket':
      return `Tile ${n} is thicket. Clear it first.`;
    case 'forest':
      return `Tile ${n} is forest. Clear it first.`;
    default:
      return 'That tile cannot take a road.';
  }
}

/** The cost bar's contents for a path (Section 4). Pure: reads the store, changes nothing. */
export function summarizePath(kind: 'road' | 'bridge', path: Pt[]): PreviewSummary {
  const ctx = mapContext();
  const tiles: PreviewTile[] = path.map((t, k) => {
    const p = kind === 'road' ? roadProblem(ctx, t.x, t.y) : bridgeProblem(ctx, t.x, t.y);
    if (p === null) return { ...t, state: 'new' };
    if (p === 'exists') return { ...t, state: 'existing' };
    return { ...t, state: 'bad', reason: badTileReason(kind, p, k + 1) };
  });
  const count = tiles.filter((t) => t.state === 'new').length;
  const cost = costOf(kind === 'road' ? ROAD_COST : BRIDGE_COST, count);
  const word = kind === 'road' ? 'Road' : 'Bridge';
  const line = `${word}: ${count} tile${count === 1 ? '' : 's'}, ${count === 0 ? 'nothing to pay' : costWords(cost)}.`;
  const bad = tiles.find((t) => t.state === 'bad');
  let problem: string | null = null;
  if (bad) problem = bad.reason!;
  else if (count === 0) problem = kind === 'road' ? 'Those tiles are already road.' : 'Those tiles are already bridged.';
  else {
    const missing = missingFor(cost);
    if (missing) {
      const have = store.state.resources;
      const keys = (Object.keys(cost) as (keyof Resources)[]).filter((k) => cost[k] > 0);
      problem = `Needs ${costWords(cost)}. You have ${andWords(keys.map((k) => amount(k, have[k])))}.`;
    }
  }
  return { kind, tiles, count, cost, line, problem, canConfirm: problem === null };
}

function andWords(parts: string[]): string {
  return parts.length <= 1 ? parts[0] ?? '' : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
}

export function previewSummary(): PreviewSummary | null {
  const p = store.state.preview;
  return p ? summarizePath(p.kind, p.path) : null;
}

/** A drag (or a single tap) reached this tile with the Road or Bridge tool active. */
export function previewDragTo(tile: Pt): void {
  const s = store.state;
  if (s.tool !== 'road' && s.tool !== 'bridge') return;
  const kind = s.tool;
  const before = s.preview?.path ?? [];
  const path = extendPath(before, tile);
  if (path === before && s.preview) return;
  if (path.length === 0) return;
  s.preview = { kind, path };
  store.emit('preview');
}

/**
 * Confirm validates the whole path at once. If every tile is legal and the player can pay the
 * total, the total is charged once, every tile is placed, and one message shows.
 */
export function confirmPreview(): boolean {
  const s = store.state;
  const p = s.preview;
  if (!p) return false;
  const sum = summarizePath(p.kind, p.path);
  if (!sum.canConfirm) {
    say(sum.problem ?? 'That path cannot be built.', 'warn');
    return false;
  }
  const todo = sum.tiles.filter((t) => t.state === 'new');
  pay(sum.cost);
  const roads = s.roads.slice();
  const axis = s.bridgeAxis.slice();
  const dragAxis = pathAxis(todo);
  for (const t of todo) {
    const i = t.y * MAP_W + t.x;
    roads[i] = p.kind === 'road' ? LINK_ROAD : LINK_BRIDGE;
  }
  if (p.kind === 'bridge') {
    const ctx = { ...mapContext(), roads };
    for (const t of todo) axis[t.y * MAP_W + t.x] = bridgeAxisFor(ctx, t.x, t.y, dragAxis);
  }
  s.roads = roads;
  s.bridgeAxis = axis;
  s.preview = null;
  const n = todo.length;
  if (p.kind === 'bridge') s.lifetime = { ...s.lifetime, bridgesBuilt: s.lifetime.bridgesBuilt + n };
  say(`Built ${n} ${p.kind} tile${n === 1 ? '' : 's'} for ${costWords(sum.cost)}.`, 'success');
  store.emit('roads', 'resources', 'buildings', 'preview');
  announceProgress(); // roads can connect Cottages (happiness), bridges complete a quest
  hooks.onPathConfirmed?.(p.kind, todo.map((t) => ({ x: t.x, y: t.y })));
  return true;
}

/** Cancel discards the whole path and charges nothing (button, Esc, or right-click). */
export function cancelPreview(): boolean {
  const s = store.state;
  const p = s.preview;
  if (!p) return false;
  s.preview = null;
  say(`${p.kind === 'road' ? 'Road' : 'Bridge'} cancelled. Nothing was charged.`, 'info');
  store.emit('preview');
  return true;
}

/**
 * Test and tool helper: draws a path as a preview and confirms it in one go (the same checks
 * and the same single charge as the player's Confirm).
 */
export function buildPath(kind: 'road' | 'bridge', path: Pt[]): boolean {
  const s = store.state;
  const prevTool = s.tool;
  s.tool = kind;
  s.preview = { kind, path: path.filter((p, i) => path.findIndex((q) => q.x === p.x && q.y === p.y) === i) };
  const ok = confirmPreview();
  if (!ok) s.preview = null;
  s.tool = prevTool;
  store.emit('preview');
  return ok;
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
  const cleared = s.cleared.slice();
  cleared[y * MAP_W + x] = 1;
  s.cleared = cleared;
  say(w.done!, 'success');
  // Repaint the baked terrain in place (Section 4: not a terrain rebuild).
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
  pay(def.cost);
  const b: Building = { id: s.nextBuildingId++, type, x, y };
  s.buildings = [...s.buildings, b];
  s.lifetime = { ...s.lifetime, everBuilt: { ...s.lifetime.everBuilt, [type]: (s.lifetime.everBuilt[type] ?? 0) + 1 } };
  say(`${def.name} built! ${formatResources(def.cost, '-')}.`, 'success');
  store.emit('buildings', 'resources');
  announceProgress();
  hooks.onBuilt?.(b);
  return true;
}

/** Test and direct helper: places a building centred under the pointer tile (tx, ty). */
export function placeBuilding(type: BuildingType, tx: number, ty: number): boolean {
  const { x, y } = footprintOrigin(type, tx, ty);
  return placeAt(type, x, y);
}

// ---------- removal (Sections 4 and 7) ----------

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

/** Esc: cancels whatever is active, in this order: road preview, swap, placement, removal, tool. */
export function escape(): void {
  const s = store.state;
  if (s.preview) {
    cancelPreview();
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
  if (s.preview) {
    const sum = previewSummary();
    if (sum?.canConfirm) confirmPreview();
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
