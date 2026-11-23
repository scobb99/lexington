// Saving to the browser (Build Spec v3.0, Section 11).
//
// - IndexedDB through the idb-keyval library (Boone ruling: not localStorage, which blocks the
//   main thread and is too small for a full city).
// - One autosave slot plus three manual slots (Fork F). The autosave is written 1 second after
//   the last change (debounced), and straight away when the page is hidden or closed, when the
//   Saves panel opens, and after a load or import.
// - Export and Import move the same data as one JSON file.
// - New Town deletes only the autosave after a typed confirmation (the UI asks for it).
// - Every save is checked by parseSave() before it is used. A save that can't be read is
//   never loaded silently: the player gets a plain message, and an unreadable autosave is
//   kept aside (never overwritten) so it can still be downloaded.
// - (v2.0) The game no longer restores the autosave on open: the title screen comes first, and
//   Continue loads the autosave. The tutorial runs with autosave paused, like ?sandbox.
// - (v2.0) A separate settings record in the same database, outside every town slot, holds one
//   flag: whether the player has finished or skipped the tutorial. It is never exported.
//
// The game never waits on saving. If the browser blocks IndexedDB (some private windows do),
// the game keeps working, the Saves panel says so, and Export still works.

import { createStore, del, get, set, type UseStore } from 'idb-keyval';
import { NAME, NAME_SLUG } from './config';
import { describeSave, parseSave, parseSaveText, type MigrationNotes, type SaveData } from './save';
import { currentSave, loadSavedGame, placeShowcase, say, startNewGame, store, type Topic } from './store';

export type SlotId = 'autosave' | 'slot-1' | 'slot-2' | 'slot-3';
export const MANUAL_SLOTS: SlotId[] = ['slot-1', 'slot-2', 'slot-3'];
export const SLOT_NAMES: Record<SlotId, string> = {
  autosave: 'Autosave',
  'slot-1': 'Slot 1',
  'slot-2': 'Slot 2',
  'slot-3': 'Slot 3',
};
/** Where an autosave that couldn't be read is kept, so it is never lost. */
const UNREADABLE_KEY = 'autosave-unreadable';
/** (v2.0) The settings record: outside every town slot, never exported. */
const SETTINGS_KEY = 'settings';
/** Section 11: autosave is debounced 1 second after any change. */
export const AUTOSAVE_DELAY_MS = 1000;
/** If IndexedDB doesn't answer at start-up, carry on rather than wait forever. */
const BOOT_TIMEOUT_MS = 2500;

// ---------- status for the Saves panel and title screen ----------

export interface SaveStatus {
  /** False when the browser blocks IndexedDB. */
  available: boolean;
  /** Why autosave is off for this visit (a test switch), or null when it is on. */
  autosavePaused: string | null;
  /** When the autosave was last written in this visit. */
  lastAutosave: Date | null;
  /** Last write error, shown in the Saves panel. */
  lastError: string | null;
  /** True when an autosave that could not be loaded is being kept aside. */
  unreadableKept: boolean;
  /** Changes whenever a slot is written or deleted, so the panel re-reads the list. */
  revision: number;
}

let status: SaveStatus = {
  available: true,
  autosavePaused: null,
  lastAutosave: null,
  lastError: null,
  unreadableKept: false,
  revision: 0,
};
const statusListeners = new Set<() => void>();
function setStatus(patch: Partial<SaveStatus>): void {
  status = { ...status, ...patch };
  statusListeners.forEach((fn) => fn());
}
export function getSaveStatus(): SaveStatus {
  return status;
}
export function subscribeSaveStatus(fn: () => void): () => void {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

// ---------- IndexedDB ----------

let db: UseStore | null = null;
function database(): UseStore {
  // The database keeps the game's working name, so towns saved before the rename are found.
  if (!db) db = createStore('wordcity', 'saves');
  return db;
}

/** Writes run one after another, so an older autosave can never land after a newer one. */
let writeChain: Promise<unknown> = Promise.resolve();
function queued<T>(job: () => Promise<T>): Promise<T> {
  const run = writeChain.then(job, job);
  writeChain = run.catch(() => undefined);
  return run;
}

function blocked(err: unknown): void {
  console.warn(`[${NAME}] Saving is not available in this browser window:`, err);
  setStatus({ available: false, lastError: 'This browser window does not allow saving (private browsing can block it). Use Export to keep a copy of your town.' });
}

export type SlotRead =
  | { status: 'empty' }
  | { status: 'ok'; save: SaveData; notes: MigrationNotes }
  | { status: 'bad'; reason: string; raw: unknown }
  | { status: 'unavailable' };

export async function readSlot(id: SlotId): Promise<SlotRead> {
  let raw: unknown;
  try {
    raw = await get(id, database());
  } catch (err) {
    blocked(err);
    return { status: 'unavailable' };
  }
  if (raw === undefined) return { status: 'empty' };
  const parsed = parseSave(raw);
  return parsed.ok ? { status: 'ok', save: parsed.save, notes: parsed.notes } : { status: 'bad', reason: parsed.reason, raw };
}

async function writeKey(key: string, value: unknown): Promise<boolean> {
  return queued(async () => {
    try {
      await set(key, value, database());
      setStatus({ available: true, lastError: null, revision: status.revision + 1 });
      return true;
    } catch (err) {
      blocked(err);
      return false;
    }
  });
}

async function deleteKey(key: string): Promise<boolean> {
  return queued(async () => {
    try {
      await del(key, database());
      setStatus({ revision: status.revision + 1 });
      return true;
    } catch (err) {
      blocked(err);
      return false;
    }
  });
}

// ---------- slot list ----------

export interface SlotInfo {
  id: SlotId;
  name: string;
  state: 'empty' | 'ok' | 'bad' | 'unavailable';
  /** "Tier 2 · Pop. 15 · 42 words" */
  summary?: string;
  savedAt?: Date;
  reason?: string;
}

export async function listSlots(): Promise<SlotInfo[]> {
  const ids: SlotId[] = ['autosave', ...MANUAL_SLOTS];
  return Promise.all(
    ids.map(async (id): Promise<SlotInfo> => {
      const r = await readSlot(id);
      if (r.status !== 'ok') return { id, name: SLOT_NAMES[id], state: r.status, reason: r.status === 'bad' ? r.reason : undefined };
      const d = describeSave(r.save);
      return {
        id,
        name: SLOT_NAMES[id],
        state: 'ok',
        summary: `Tier ${d.tier} · Pop. ${d.population} · ${d.words} word${d.words === 1 ? '' : 's'} · ${d.buildings} building${d.buildings === 1 ? '' : 's'}`,
        savedAt: d.savedAt ? new Date(d.savedAt) : undefined,
      };
    }),
  );
}

// ---------- the player actions on slots ----------

/** Saves the current town into a manual slot. */
export async function saveToSlot(id: SlotId): Promise<boolean> {
  const ok = await writeKey(id, currentSave());
  say(ok ? `Saved your town to ${SLOT_NAMES[id]}.` : 'Your town could not be saved here. Use Export to keep a copy.', ok ? 'success' : 'error');
  return ok;
}

/** Loads a slot into the game and enters the town. The loaded town becomes the autosave. */
export async function loadFromSlot(id: SlotId): Promise<{ ok: boolean; reason?: string }> {
  const r = await readSlot(id);
  if (r.status === 'ok') {
    loadSavedGame(r.save, `Loaded your town from ${SLOT_NAMES[id]}.`, r.notes);
    startAutosave();
    await flushAutosave();
    return { ok: true };
  }
  const reason =
    r.status === 'empty'
      ? `${SLOT_NAMES[id]} is empty.`
      : r.status === 'bad'
        ? `${SLOT_NAMES[id]} could not be loaded. ${r.reason}`
        : 'Saving is not available in this browser window.';
  if (store.state.mode !== 'title') say(`${reason} Your current town is unchanged.`, 'warn');
  return { ok: false, reason };
}

/**
 * Section 11 New Town (after the typed confirmation): deletes only the autosave (Slots 1 to 3
 * are kept), then starts a fresh town. With a test switch in the address nothing is deleted:
 * the test town starts and autosave stays off for the visit.
 */
export async function newGame(seed?: string): Promise<void> {
  cancelPendingAutosave();
  const test = testSwitchInAddress();
  if (!test) await deleteKey('autosave');
  const sandbox = !!test && new URLSearchParams(window.location.search).has('sandbox');
  const urlSeed = test ? new URLSearchParams(window.location.search).get('seed') : null;
  startNewGame(seed && seed.trim() ? seed : urlSeed ?? undefined, { sandbox });
  if (test && new URLSearchParams(window.location.search).has('showcase')) placeShowcase(); // ?showcase: every building and landmark on the map, for art review
  startAutosave();
  await flushAutosave();
}

// ---------- export and import (one JSON file) ----------

/** The file name for an export, e.g. lexington-town-2026-11-22.json */
export function exportFileName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${NAME_SLUG}-town-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

function download(name: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Export: downloads the current town as one JSON file (the same data the slots hold). */
export function exportTown(): void {
  download(exportFileName(), JSON.stringify(currentSave(), null, 1));
  say('Exported your town as a file. Keep it somewhere safe; Import loads it back.', 'success');
}

/** Section 16: from the title screen, Export downloads a slot's town as it is stored. */
export async function exportSlot(id: SlotId): Promise<boolean> {
  const r = await readSlot(id);
  if (r.status !== 'ok') return false;
  download(exportFileName(), JSON.stringify(r.save, null, 1));
  return true;
}

/** Downloads the autosave that couldn't be loaded, exactly as it was stored. */
export async function exportUnreadable(): Promise<void> {
  try {
    const raw = await get(UNREADABLE_KEY, database());
    if (raw !== undefined) download(`${NAME_SLUG}-unreadable-autosave.json`, JSON.stringify(raw, null, 1));
  } catch (err) {
    blocked(err);
  }
}

/** Import, step 1: reads and checks a file. Nothing changes until importChecked(). */
export async function checkImportFile(file: File): Promise<{ ok: true; save: SaveData; notes: MigrationNotes } | { ok: false; reason: string }> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, reason: 'That file could not be opened.' };
  }
  return parseSaveText(text);
}

/** Import, step 2: loads the checked save, enters the town, and makes it the autosave. */
export async function importChecked(save: SaveData, fileName: string, notes?: MigrationNotes): Promise<void> {
  loadSavedGame(save, `Imported your town from ${fileName}.`, notes);
  startAutosave();
  await flushAutosave();
}

// ---------- autosave ----------

let autosaveTimer: number | null = null;
let autosaveStarted = false;
/** (v2.0) Section 17: autosave is paused for the whole tutorial. */
let tutorialPaused = false;

function cancelPendingAutosave(): void {
  if (autosaveTimer !== null) window.clearTimeout(autosaveTimer);
  autosaveTimer = null;
}

/** Only a real town is ever autosaved: never the title placeholder, never the tutorial. */
function autosaveAllowed(): boolean {
  return !status.autosavePaused && !tutorialPaused && store.state.mode === 'town';
}

/** Writes the autosave now (used after loads, imports and when the page is hidden). */
export async function flushAutosave(): Promise<boolean> {
  cancelPendingAutosave();
  if (!autosaveAllowed()) return false;
  const ok = await writeKey('autosave', currentSave());
  if (ok) setStatus({ lastAutosave: new Date() });
  return ok;
}

/** Writes a waiting autosave straight away (when the Saves panel opens, so it lists the town as it is). */
export function flushPendingAutosave(): Promise<boolean> {
  return autosaveTimer !== null ? flushAutosave() : Promise.resolve(false);
}

function scheduleAutosave(): void {
  if (!autosaveAllowed()) return;
  cancelPendingAutosave();
  autosaveTimer = window.setTimeout(() => {
    autosaveTimer = null;
    void flushAutosave();
  }, AUTOSAVE_DELAY_MS);
}

/** (v2.0) Section 17: the tutorial pauses autosave; nothing in the tutorial is ever saved. */
export function setTutorialPause(on: boolean): void {
  tutorialPaused = on;
  if (on) cancelPendingAutosave();
}

/**
 * Things that change the town. Tool choice, the current word, previews and messages are not
 * saved (v2.0: Hint, Swap, previews and the ghost are never saved).
 */
const SAVED_TOPICS: Topic[] = ['terrain', 'tiles', 'roads', 'buildings', 'resources', 'rack', 'camera', 'load'];

/** Starts the Section 11 autosave. Safe to call many times; it starts once. */
export function startAutosave(): void {
  if (autosaveStarted) return;
  autosaveStarted = true;
  for (const t of SAVED_TOPICS) store.subscribe(t, scheduleAutosave);
  const flushIfPending = () => {
    if (autosaveTimer !== null) void flushAutosave();
  };
  window.addEventListener('pagehide', flushIfPending);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushIfPending();
  });
}

// ---------- start-up: the title screen's view of the saves ----------

/**
 * Test switches build a test town on purpose (?seed picks a map, ?sandbox and ?showcase add
 * test buildings or resources). Autosave stays off for those visits so the real town is never
 * replaced; manual slots and Export still work.
 */
export function testSwitchInAddress(): string | null {
  try {
    const q = new URLSearchParams(window.location.search);
    for (const k of ['seed', 'sandbox', 'showcase']) if (q.has(k)) return k;
  } catch {
    /* not in a browser */
  }
  return null;
}

/** What the title screen needs to know about the autosave (Section 16). */
export interface BootInfo {
  /** 'ok' = a loadable autosave exists (Continue shows). */
  autosave: 'ok' | 'empty' | 'unreadable' | 'unavailable' | 'paused';
  /** True when the player has never finished or skipped the tutorial. */
  firstVisit: boolean;
}

let bootSave: { save: SaveData; notes: MigrationNotes } | null = null;

/**
 * Section 16 start-up: reads the autosave (never more than 2.5 seconds) so the title screen
 * knows whether to show Continue. Nothing is loaded. An autosave that can't be read is kept
 * aside under its own key (never overwritten), and the title screen says so.
 */
export async function readBootInfo(): Promise<BootInfo> {
  const firstVisit = !(await tutorialDone());
  const sw = testSwitchInAddress();
  if (sw) {
    setStatus({ autosavePaused: `Autosave is off for this visit because the address has the test switch ?${sw}. Your saved town is untouched; Save to a slot or Export works as usual.` });
    return { autosave: 'paused', firstVisit };
  }
  const timeout = new Promise<'timeout'>((resolve) => window.setTimeout(() => resolve('timeout'), BOOT_TIMEOUT_MS));
  const r = await Promise.race([readSlot('autosave'), timeout]);
  if (r === 'timeout') {
    blocked(new Error('IndexedDB did not answer in time'));
    return { autosave: 'unavailable', firstVisit };
  }
  if (r.status === 'unavailable') return { autosave: 'unavailable', firstVisit };
  if (r.status === 'empty') return { autosave: 'empty', firstVisit };
  if (r.status === 'ok') {
    bootSave = { save: r.save, notes: r.notes };
    return { autosave: 'ok', firstVisit };
  }
  const kept = await writeKey(UNREADABLE_KEY, r.raw);
  setStatus({ unreadableKept: kept });
  return { autosave: 'unreadable', firstVisit };
}

/** Section 16 Continue: loads the autosave and enters the town with the Welcome back message. */
export async function continueTown(): Promise<boolean> {
  const r = await readSlot('autosave');
  const got = r.status === 'ok' ? { save: r.save, notes: r.notes } : bootSave;
  if (!got) return false;
  loadSavedGame(got.save, 'Welcome back! Your town is just as you left it.', got.notes);
  startAutosave();
  // A migrated save is written back in the new format straight away.
  if (got.notes.marshRoadsToBridges > 0 || got.notes.foundedCenter) await flushAutosave();
  return true;
}

/** Checks whether an unreadable autosave was kept by an earlier visit. */
export async function checkUnreadableKept(): Promise<void> {
  try {
    const raw = await get(UNREADABLE_KEY, database());
    setStatus({ unreadableKept: raw !== undefined });
  } catch {
    /* status already says saving is unavailable */
  }
}

/** Is there a loadable autosave right now (for the New Town confirmation)? */
export async function hasAutosave(): Promise<boolean> {
  const r = await readSlot('autosave');
  return r.status === 'ok' || r.status === 'bad';
}

// ---------- (v2.0) the settings record: the tutorial flag ----------

let tutorialFlagCache: boolean | null = null;

export async function tutorialDone(): Promise<boolean> {
  if (tutorialFlagCache !== null) return tutorialFlagCache;
  try {
    const raw = (await get(SETTINGS_KEY, database())) as { tutorialDone?: unknown } | undefined;
    tutorialFlagCache = raw?.tutorialDone === true;
  } catch {
    tutorialFlagCache = false;
  }
  return tutorialFlagCache;
}

/** Finishing or skipping the tutorial sets the flag (Section 11). */
export async function markTutorialDone(): Promise<void> {
  tutorialFlagCache = true;
  await writeKey(SETTINGS_KEY, { tutorialDone: true });
}

export function formatWhen(d: Date): string {
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return sameDay ? `today at ${time}` : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${time}`;
}
