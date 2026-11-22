// The tutorial flow (Build Spec v2.0, Section 17): runs the steps of tutorial.ts in order.
//
// - The tutorial town is a sandbox on the fixed seed "hearth", with the normal starting wallet,
//   the fixed first rack, Tier 1, no quests, and the real dictionary, rack and reward rules.
// - Autosave is paused for the whole tutorial; nothing in it is saved to any slot. Entering from
//   the in-game menu autosaves the real town first, and the player returns to that town at the
//   end (the real town is also kept in memory, so it comes back even if saving is blocked).
// - Reading steps have a Next button; action steps advance when the player does the action.
//   Every step has Skip tutorial, which shows step 11's finish screen at once.
// - Finishing or skipping sets the tutorial flag in the settings record (Section 11).

import { BUILDINGS } from './buildings';
import { flushAutosave, markTutorialDone, setTutorialPause } from './persistence';
import { currentSave, hooks, loadSavedGame, panCameraTo, setMarks, setResources, setTool, setTutorialLocks, startTutorialTown, store, type MapMarks } from './store';
import type { SaveData } from './save';
import {
  COTTAGE_PLOT,
  COTTAGE_TOP_UP,
  FRAME_ORDER,
  FRAMES,
  LAND_LABELS,
  PRACTICE_GRANT,
  ROAD_START,
  SAWMILL_PLOT,
  TUTORIAL_CENTRE,
  TUTORIAL_FIRST_RACK,
  TUTORIAL_SEED,
  landLabelTiles,
  type FrameId,
} from './tutorial';
import { TILE_H, TILE_W, MAP_H, type Tool } from './types';

export interface TutorialView {
  active: boolean;
  frame: FrameId;
  /** Step 6: a legal road was confirmed that does not end beside the plot. */
  retry: boolean;
  /** Where the tutorial was started from (the menu returns the player to their town). */
  from: 'title' | 'town';
}

let view: TutorialView = { active: false, frame: 'welcome', retry: false, from: 'title' };
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
  const showLabels = f.step >= 2 && f.step <= 10;
  const lit = f.label;
  const out: MapMarks = {
    plots: [],
    start: null,
    labels: showLabels ? labels.map((p, i) => ({ ...p, text: LAND_LABELS[i], lit: lit === i })) : [],
  };
  if (frame === 'road') {
    out.plots.push({ ...COTTAGE_PLOT, w: 1, h: 1 });
    out.start = ROAD_START;
  }
  if (frame === 'cottage') out.plots.push({ ...COTTAGE_PLOT, w: 1, h: 1 });
  if (frame === 'grant' || frame === 'sawmill') out.plots.push({ ...SAWMILL_PLOT, w: BUILDINGS.sawmill.w, h: BUILDINGS.sawmill.h });
  return out;
}

/** What each frame allows (Section 17: word submission only in steps 3 and 9). */
function locksFor(frame: FrameId): { submit: boolean; tools: Tool[] } {
  switch (frame) {
    case 'word':
    case 'pay':
      return { submit: true, tools: [] };
    case 'road':
      return { submit: false, tools: ['road'] };
    case 'cottage':
      return { submit: false, tools: ['cottage'] };
    case 'sawmill':
      return { submit: false, tools: ['road', 'sawmill'] };
    default:
      return { submit: false, tools: [] };
  }
}

function go(frame: FrameId): void {
  setView({ frame, retry: false });
  setTutorialLocks(locksFor(frame));
  setMarks(marksFor(frame));
  const s = store.state;
  switch (frame) {
    case 'land0':
      panCameraTo(TUTORIAL_CENTRE.x, TUTORIAL_CENTRE.y);
      break;
    case 'road':
      setTool('road');
      panCameraTo(COTTAGE_PLOT.x, COTTAGE_PLOT.y + 2);
      break;
    case 'cottage':
      // Section 17: if extra roads left Coins below 10, top them up to 10 without comment.
      if (s.resources.coins < COTTAGE_TOP_UP) setResources({ ...s.resources, coins: COTTAGE_TOP_UP });
      setTool('cottage');
      break;
    case 'cottageDone':
    case 'sawmillDone':
      setTool('inspect');
      break;
    case 'grant':
      setTool('inspect');
      panCameraTo(SAWMILL_PLOT.x, SAWMILL_PLOT.y);
      break;
    case 'sawmill':
      setTool('road');
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

function adjacentToCottagePlot(t: { x: number; y: number }): boolean {
  return Math.abs(t.x - COTTAGE_PLOT.x) + Math.abs(t.y - COTTAGE_PLOT.y) === 1;
}

function attachHooks(): void {
  hooks.onWord = ({ ok, produced }) => {
    if (!ok) return;
    if (view.frame === 'word') go('reward');
    else if (view.frame === 'pay' && produced) go('happiness');
  };
  hooks.onPathConfirmed = (kind, tiles) => {
    if (view.frame !== 'road' || kind !== 'road') return;
    // Step 6 advances when a confirmed road path ends beside the Cottage plot. Build reading: any
    // new tile of the confirmed path beside the plot counts, so a road drawn from the plot outward
    // also works; otherwise the road stands, is paid for, and the caption asks again.
    if (tiles.some(adjacentToCottagePlot)) go('cottage');
    else setView({ retry: true });
  };
  hooks.onBuilt = (b) => {
    if (view.frame === 'cottage' && b.type === 'cottage' && b.x === COTTAGE_PLOT.x && b.y === COTTAGE_PLOT.y) go('cottageDone');
    else if (view.frame === 'sawmill' && b.type === 'sawmill' && b.x === SAWMILL_PLOT.x && b.y === SAWMILL_PLOT.y) go('sawmillDone');
  };
}

function detachHooks(): void {
  hooks.onWord = undefined;
  hooks.onPathConfirmed = undefined;
  hooks.onBuilt = undefined;
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

/** Next on a reading step. Step 8's practice money is applied when the player taps Next. */
export function nextFrame(): void {
  const f = view.frame;
  if (f === 'grant') {
    const r = store.state.resources;
    setResources({ ...r, coins: r.coins + PRACTICE_GRANT.coins, lumber: r.lumber + PRACTICE_GRANT.lumber });
  }
  const i = FRAME_ORDER.indexOf(f);
  if (i < 0 || i >= FRAME_ORDER.length - 1) return;
  go(FRAME_ORDER[i + 1]);
}

/** Skip tutorial: ends at once and shows step 11's finish screen. */
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
