// Moving between the title screen, a town and the tutorial (Build Spec v2.0, Sections 11, 16, 17).

import { continueTown, flushAutosave, newGame, readBootInfo, type BootInfo } from './persistence';
import { showTitle, store } from './store';

/** What the title screen shows (Continue, the unreadable line, the one-time prompt). */
let boot: BootInfo | null = null;
const bootListeners = new Set<() => void>();

export function getBoot(): BootInfo | null {
  return boot;
}
export function subscribeBoot(fn: () => void): () => void {
  bootListeners.add(fn);
  return () => bootListeners.delete(fn);
}

/** Reads the autosave and the tutorial flag again (on start-up and each return to the title). */
export async function refreshBoot(): Promise<BootInfo> {
  boot = await readBootInfo();
  bootListeners.forEach((fn) => fn());
  return boot;
}

/** Section 16 Continue. */
export async function continueGame(): Promise<boolean> {
  return continueTown();
}

/** Section 16 New Town (after the typed confirmation when a town would be deleted). */
export async function startTown(seed?: string): Promise<void> {
  await newGame(seed);
}

/** Section 16 in-game menu: Title Screen autosaves and returns to the title screen. */
export async function goToTitle(): Promise<void> {
  if (store.state.mode === 'town') await flushAutosave();
  showTitle();
  await refreshBoot();
}
