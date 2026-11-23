// The tutorial flow (Build Spec v3.0, Section 17, reworked): runs the steps of tutorial.ts in order.
//
// - The tutorial town is a sandbox on the fixed seed "hearth", with the normal starting wallet,
//   fixed racks for the word and Commission steps, Tier 1, no quests, and the real dictionary,
//   rack and reward rules. (v3.0) The town center is founded by step 3, and the cascade is off in
//   the tutorial town (Section 4).
// - Autosave is paused for the whole tutorial; nothing in it is saved to any slot. Entering from
//   the in-game menu autosaves the real town first, and the player returns to that town at the
//   end (the real town is also kept in memory, so it comes back even if saving is blocked).
// - Reading steps have a Next button; action steps advance when the player does the action.
//   Every step has Skip tutorial, which shows the finish screen at once.
// - Finishing or skipping sets the tutorial flag in the settings record (Section 11).
// - (v3.0, LOCKED ruling 7) Wallet handling: in the road and build steps the wallet is kept at or
//   above what the step still needs, after every purchase, without comment; this folds in the
//   Step 8 overspend fix (extra road pieces can no longer strand the Sawmill step).

import { BUILDINGS } from './buildings';
import type { Order } from './orders';
import { flushAutosave, markTutorialDone, setTutorialPause } from './persistence';
import {
  currentSave,
  foundTownCenterAt,
  hooks,
  loadSavedGame,
  panCameraTo,
  placeBuildingAt,
  setMarks,
  setOrders,
  setRackLetters,
  setResources,
  setTool,
  setTutorialLocks,
  startTutorialTown,
  store,
  type MapMarks,
} from './store';
import type { SaveData } from './save';
import {
  COTTAGE_PLOT,
  FRAME_ORDER,
  FRAMES,
  LAND_LABELS,
  OFF_PLOT_REASON,
  PLOT_PIECE_REASON,
  ROAD_PIECE_COINS,
  SAWMILL_SAVED_REASON,
  ROAD_START,
  SAWMILL_PLOT,
  SAWMILL_ROAD_START,
  TUTORIAL_CENTER,
  TUTORIAL_CENTRE,
  TUTORIAL_FIRST_RACK,
  TUTORIAL_ORDER_RACK,
  TUTORIAL_REMOVE_ONLY,
  TUTORIAL_SEED,
  landLabelTiles,
  type FrameId,
} from './tutorial';
import { pieceTiles, type Piece } from './network';
import type { Pt } from './roads';
import { TILE_H, TILE_W, MAP_H, MAP_W, type Building, type Resources, type Tool } from './types';

export interface TutorialView {
  active: boolean;
  frame: FrameId;
  /** The road step (a piece was laid, but not beside the plot) or the Commission step (a word missed the order). */
  retry: boolean;
  /** The build steps: a Cottage or Sawmill stands off the marked plot (safety net). */
  offPlot: boolean;
  /** (v3.0.1) The build steps: a road or bridge piece lies on the marked plot (safety net). */
  plotBlocked: boolean;
  /** Where the tutorial was started from (the menu returns the player to their town). */
  from: 'title' | 'town';
}

let view: TutorialView = { active: false, frame: 'welcome', retry: false, offPlot: false, plotBlocked: false, from: 'title' };
let realTown: SaveData | null = null;
const listeners = new Set<() => void>();

function setView(patch: Partial<TutorialView>): void {
  view = { ...view, ...patch };
  listeners.forEach((fn) => fn());
}
export function getTutorial(): TutorialView {
  return view;
}
export function subscribeTutorial(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** World point at the centre of a tile (the camera starts centred on the centre tile). */
function tileCentreWorld(x: number, y: number) {
  return { centreX: MAP_H * (TILE_W / 2) + (x - y) * (TILE_W / 2), centreY: (x + y + 1) * (TILE_H / 2) };
}

let labels: { x: number; y: number }[] = [];

function marksFor(frame: FrameId): MapMarks {
  const f = FRAMES[frame];
  const showLabels = f.step >= 2 && f.step <= 13;
  const lit = f.label;
  const out: MapMarks = {
    plots: [],
    start: null,
    labels: showLabels ? labels.map((p, i) => ({ ...p, text: LAND_LABELS[i], lit: lit === i })) : [],
  };
  if (frame === 'center') out.plots.push({ ...TUTORIAL_CENTER, w: 2, h: 2 });
  if (frame === 'road') {
    out.plots.push({ ...COTTAGE_PLOT, w: 1, h: 1 });
    out.start = ROAD_START;
  }
  if (frame === 'cottage') out.plots.push({ ...COTTAGE_PLOT, w: 1, h: 1 });
  if (frame === 'sawmill') {
    out.plots.push({ ...SAWMILL_PLOT, w: BUILDINGS.sawmill.w, h: BUILDINGS.sawmill.h });
    out.start = SAWMILL_ROAD_START;
  }
  return out;
}

/** What each frame allows (word submission only in the word, Commission and pay steps). */
function locksFor(frame: FrameId): { submit: boolean; tools: Tool[] } {
  switch (frame) {
    case 'word':
    case 'order':
    case 'pay':
      return { submit: true, tools: [] };
    case 'road':
      return { submit: false, tools: ['road'] };
    // Remove is open in the two build steps as a safety net (v2.1.1 fix); the guard below lets it
    // act only on a building placed off the marked plot.
    case 'cottage':
      return { submit: false, tools: ['cottage', 'remove'] };
    case 'sawmill':
      return { submit: false, tools: ['road', 'sawmill', 'remove'] };
    default:
      return { submit: false, tools: [] };
  }
}

/** The first Commission: two E's, paying 10 Coins, with two other orders beside it. */
function firstOrders(): Order[] {
  const at = store.state.lifetime.validWords;
  return [
    { id: 1, cond: { type: 'twice', letter: 'E' }, reward: { res: 'coins', amount: 10 }, postedAt: at },
    { id: 2, cond: { type: 'rare' }, reward: { res: 'stone', amount: 6 }, postedAt: at },
    { id: 3, cond: { type: 'len', min: 6 }, reward: { res: 'lumber', amount: 8 }, postedAt: at },
  ];
}

/** (v3.0.1) The marked plots as footprints (origin and size). */
const COTTAGE_FOOT = { ...COTTAGE_PLOT, w: BUILDINGS.cottage.w, h: BUILDINGS.cottage.h };
const SAWMILL_FOOT = { ...SAWMILL_PLOT, w: BUILDINGS.sawmill.w, h: BUILDINGS.sawmill.h };
type Foot = typeof COTTAGE_FOOT;

function inFoot(t: Pt, f: Foot): boolean {
  return t.x >= f.x && t.x < f.x + f.w && t.y >= f.y && t.y < f.y + f.h;
}

/**
 * (v3.0.1) Centres the camera on a footprint, in the part of the map the card leaves visible. In
 * a step that also lays a road from a marked start tile, the camera centres between the plot and
 * that tile, so both stay on screen.
 */
function focusFoot(f: Foot, start?: Pt): void {
  const cx = f.x + (f.w - 1) / 2;
  const cy = f.y + (f.h - 1) / 2;
  if (start) panCameraTo((cx + start.x) / 2, (cy + start.y) / 2);
  else panCameraTo(cx, cy);
}

/**
 * (v3.0.1) The plots a road or bridge piece may not cover in this frame, with the reason. The
 * first road step keeps both the Cottage plot and the Sawmill's future plot clear; the Sawmill
 * step keeps its own plot clear.
 */
function reservedFor(frame: FrameId): { foot: Foot; reason: string }[] {
  if (frame === 'road') return [{ foot: COTTAGE_FOOT, reason: PLOT_PIECE_REASON }, { foot: SAWMILL_FOOT, reason: SAWMILL_SAVED_REASON }];
  if (frame === 'sawmill') return [{ foot: SAWMILL_FOOT, reason: PLOT_PIECE_REASON }];
  return [];
}

/** (v3.0.1) A piece on the map whose tiles cover the plot of the current build step. */
function pieceOnPlot(): Piece | null {
  const want = wantedFoot();
  if (!want) return null;
  return store.state.pieces.find((p) => pieceTiles(p).some((t) => inFoot(t, want))) ?? null;
}

function wantedFoot(): Foot | null {
  if (view.frame === 'cottage') return COTTAGE_FOOT;
  if (view.frame === 'sawmill') return SAWMILL_FOOT;
  return null;
}

/**
 * (v3.0.1) The one-tap assist in the build steps: places the step's building on its marked plot
 * through the normal placement (same checks, cost and message). The step's wallet cover already
 * guarantees the funds. Returns whether it was placed.
 */
export function placeOnMarkedPlot(): boolean {
  const want = wantedPlot();
  if (!view.active || !want) return false;
  keepWallet(want.type);
  return placeBuildingAt(want.type, want.x, want.y);
}

function go(frame: FrameId): void {
  setView({ frame, retry: false, offPlot: false, plotBlocked: false });
  setTutorialLocks(locksFor(frame));
  setMarks(marksFor(frame));
  switch (frame) {
    case 'land0':
      panCameraTo(TUTORIAL_CENTRE.x, TUTORIAL_CENTRE.y);
      break;
    case 'center':
      // (v3.0) The founding step: the town center appears, free, as the town's first building.
      foundTownCenterAt(TUTORIAL_CENTER.x, TUTORIAL_CENTER.y);
      panCameraTo(TUTORIAL_CENTER.x + 1, TUTORIAL_CENTER.y + 1);
      break;
    case 'order':
      setRackLetters(TUTORIAL_ORDER_RACK);
      setOrders(firstOrders());
      setTool('inspect');
      break;
    case 'road':
      keepWallet('road');
      setTool('road');
      focusFoot(COTTAGE_FOOT, ROAD_START);
      break;
    case 'cottage':
      keepWallet('cottage');
      setTool('cottage');
      setView({ plotBlocked: !!pieceOnPlot() });
      focusFoot(COTTAGE_FOOT);
      break;
    case 'cottageDone':
    case 'sawmillDone':
      setTool('inspect');
      break;
    case 'sawmill':
      keepWallet('sawmill');
      setTool('road');
      setView({ plotBlocked: !!pieceOnPlot() });
      focusFoot(SAWMILL_FOOT, SAWMILL_ROAD_START);
      break;
    case 'pay':
    case 'word':
      setTool('inspect');
      break;
    case 'finish':
      setTool('inspect');
      setTutorialLocks({ submit: false, tools: [] });
      void markTutorialDone();
      break;
    default:
      break;
  }
}

/**
 * Tutorial practice money (the tutorial town is never saved): raises each resource to at least
 * what the step still needs. Road step: one 3 tile piece plus a Cottage. Cottage step: a Cottage.
 * Sawmill step: one 3 tile piece plus a Sawmill (the Step 8 overspend fix).
 */
function keepWallet(step: 'road' | 'cottage' | 'sawmill'): void {
  const need: Resources = { coins: 0, lumber: 0, stone: 0, knowledge: 0, magic: 0 };
  const add = (c: Resources) => (Object.keys(need) as (keyof Resources)[]).forEach((k) => (need[k] += c[k]));
  if (step === 'road' || step === 'cottage') add(BUILDINGS.cottage.cost);
  if (step === 'sawmill') add(BUILDINGS.sawmill.cost);
  if (step !== 'cottage') need.coins += ROAD_PIECE_COINS;
  const r = store.state.resources;
  const next = { ...r };
  let changed = false;
  for (const k of Object.keys(need) as (keyof Resources)[]) {
    if (next[k] < need[k]) {
      next[k] = need[k];
      changed = true;
    }
  }
  if (changed) setResources(next);
}

/** (v3.0.1) A connected road or bridge tile sits beside the Cottage plot. */
function cottagePlotHasRoad(): boolean {
  const s = store.state;
  return [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ].some(([dx, dy]) => {
    const x = COTTAGE_PLOT.x + dx;
    const y = COTTAGE_PLOT.y + dy;
    const i = y * MAP_W + x;
    return s.pieceAt[i] > 0 && s.net[i] === 1;
  });
}

function adjacentToCottagePlot(t: { x: number; y: number }): boolean {
  return Math.abs(t.x - COTTAGE_PLOT.x) + Math.abs(t.y - COTTAGE_PLOT.y) === 1;
}

/** The build steps: the building the step asks for and its marked plot (footprint origin). */
function wantedPlot(): { type: 'cottage' | 'sawmill'; x: number; y: number } | null {
  if (view.frame === 'cottage') return { type: 'cottage', ...COTTAGE_PLOT };
  if (view.frame === 'sawmill') return { type: 'sawmill', ...SAWMILL_PLOT };
  return null;
}

/** A Cottage or Sawmill standing on its own marked plot. */
function onItsPlot(b: Building): boolean {
  return (b.type === 'cottage' && b.x === COTTAGE_PLOT.x && b.y === COTTAGE_PLOT.y) || (b.type === 'sawmill' && b.x === SAWMILL_PLOT.x && b.y === SAWMILL_PLOT.y);
}

function strayStanding(type: 'cottage' | 'sawmill'): boolean {
  return store.state.buildings.some((b) => b.type === type && !onItsPlot(b));
}

let ordersBefore = 0;

function attachHooks(): void {
  hooks.onWord = ({ ok, produced }) => {
    if (!ok) return;
    if (view.frame === 'word') go('reward');
    else if (view.frame === 'order') {
      // The Commission step advances when the first order completes; otherwise it asks again.
      if (store.state.lifetime.ordersCompleted > ordersBefore) go('road');
      else {
        // The fixed rack comes back, so the two-E order can always still be spelled.
        setRackLetters(TUTORIAL_ORDER_RACK);
        setView({ retry: true });
      }
    } else if (view.frame === 'pay' && produced) go('lanterns');
  };
  hooks.onPathConfirmed = (kind, tiles) => {
    if (view.frame !== 'road' || kind !== 'road') return;
    // The road step advances when a laid piece puts a road tile beside the Cottage plot;
    // otherwise the piece stays in the network and the caption asks again.
    if (tiles.some(adjacentToCottagePlot)) go('cottage');
    else setView({ retry: true });
  };
  hooks.onBought = () => {
    // LOCKED ruling 7: buying pieces in the road or Sawmill step can never strand the step.
    if (view.frame === 'road' || view.frame === 'sawmill') keepWallet(view.frame);
  };
  hooks.onBuilt = (b) => {
    const want = wantedPlot();
    if (!want || b.type !== want.type) return;
    if (onItsPlot(b)) go(want.type === 'cottage' ? 'cottageDone' : 'sawmillDone');
    // Safety net: the ghost already refuses this, but if one is ever built off the plot the
    // caption says so and asks for Remove, instead of the step silently waiting forever.
    else setView({ offPlot: true });
  };
  // Build steps: a legal spot that is not the marked plot shows red with this reason, so the
  // wrong placement cannot be confirmed. The normal reasons (road, hill, no road) still come first.
  hooks.placementGuard = (type, x, y) => {
    const want = wantedPlot();
    return want && type === want.type && (x !== want.x || y !== want.y) ? OFF_PLOT_REASON : null;
  };
  // Remove acts only on a building placed off its plot, or (v3.0.1 safety net) on a road or bridge
  // piece lying on the step's marked plot, so it can't take away a road piece the step needs or a
  // building the tutorial still needs.
  hooks.removeGuard = (_x, _y, b, piece) => {
    const want = wantedFoot();
    if (!want) return null;
    if (b) return onItsPlot(b) ? TUTORIAL_REMOVE_ONLY : null;
    if (piece && pieceTiles(piece).some((t) => inFoot(t, want))) return null;
    return TUTORIAL_REMOVE_ONLY;
  };
  // (v3.0.1) The road steps: a piece may not cover a marked plot (the Step 9 soft-lock fix).
  hooks.pieceGuard = (tiles) => {
    for (const r of reservedFor(view.frame)) {
      const over = tiles.filter((t) => inFoot(t, r.foot));
      if (over.length) return { tiles: over, reason: r.reason };
    }
    return null;
  };
  hooks.onPieceRemoved = () => {
    const want = wantedPlot();
    if (!want) return;
    const blocked = !!pieceOnPlot();
    setView({ plotBlocked: blocked });
    // If the piece that went was the Cottage's only road, the Cottage step can't be finished
    // (it has no road tool), so the tutorial steps back to the road step with the piece banked.
    if (!blocked && want.type === 'cottage' && !cottagePlotHasRoad()) {
      go('road');
      return;
    }
    keepWallet(want.type);
    if (!blocked) setTool(want.type);
  };
  hooks.onRemoved = (b) => {
    const want = wantedPlot();
    if (!want || b.type !== want.type) return;
    // Removal refunds only half, so top the wallet up again (tutorial practice money).
    keepWallet(want.type);
    if (!strayStanding(want.type)) setView({ offPlot: false });
    setTool(want.type);
  };
}

function detachHooks(): void {
  hooks.onWord = undefined;
  hooks.onPathConfirmed = undefined;
  hooks.onBuilt = undefined;
  hooks.onBought = undefined;
  hooks.placementGuard = undefined;
  hooks.removeGuard = undefined;
  hooks.onRemoved = undefined;
  hooks.onPieceRemoved = undefined;
  hooks.pieceGuard = undefined;
}

/**
 * Starts (or replays) the tutorial: rebuilds the tutorial town from the seed, resets the wallet
 * and the rack, and runs the steps from step 1.
 */
export async function startTutorial(from: 'title' | 'town'): Promise<void> {
  if (from === 'town' && store.state.mode === 'town') {
    await flushAutosave(); // Section 16: the current town is autosaved first
    realTown = currentSave();
  } else if (from === 'title') {
    realTown = null;
  }
  setTutorialPause(true);
  store.state.pendingCamera = { ...tileCentreWorld(TUTORIAL_CENTRE.x, TUTORIAL_CENTRE.y), zoom: 1 };
  startTutorialTown(TUTORIAL_SEED, TUTORIAL_FIRST_RACK);
  labels = landLabelTiles(store.state.terrain);
  attachHooks();
  setView({ active: true, from: realTown ? 'town' : 'title' });
  go('welcome');
}

/** Next on a reading step. */
export function nextFrame(): void {
  const i = FRAME_ORDER.indexOf(view.frame);
  if (i < 0 || i >= FRAME_ORDER.length - 1) return;
  if (FRAME_ORDER[i + 1] === 'order') ordersBefore = store.state.lifetime.ordersCompleted;
  go(FRAME_ORDER[i + 1]);
}

/** Skip tutorial: ends at once and shows the finish screen. */
export function skipTutorial(): void {
  go('finish');
}

/** Leaves the tutorial town. The caller decides where to go next. */
function leave(): void {
  detachHooks();
  setTutorialPause(false);
  setMarks({ plots: [], start: null, labels: [] });
  setTutorialLocks({ submit: true, tools: 'all' });
  setView({ active: false });
}

/** Finish: back to the player's own town (when the tutorial was opened from the menu). */
export function backToTown(): boolean {
  if (!realTown) return false;
  const save = realTown;
  leave();
  loadSavedGame(save, 'Back in your town, just as you left it.');
  realTown = null;
  return true;
}

/** Finish: leave the tutorial without loading anything (the title screen or New Town follows). */
export function endTutorial(): void {
  leave();
  realTown = null;
}

export function tutorialFromTown(): boolean {
  return realTown !== null;
}
