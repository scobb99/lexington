// Small interface-only state shared by a few panels (not game state, never saved): whether the
// phone's build sheet, the happiness breakdown, the in-game menu, the Saves panel and the New
// Town panel are open. The tutorial opens some of these for its steps (Section 17).

import { useSyncExternalStore } from 'react';

export interface UiState {
  sheetOpen: boolean;
  happyOpen: boolean;
  menuOpen: boolean;
  savesOpen: boolean;
  /** The New Town panel (Section 11 flow: typed NEW, optional seed box). */
  newTownOpen: boolean;
  /** (v3.0.2) The on-map Roads tray: the banked road and bridge pieces, ready to lay. */
  roadsOpen: boolean;
}

let ui: UiState = { sheetOpen: false, happyOpen: false, menuOpen: false, savesOpen: false, newTownOpen: false, roadsOpen: false };
const listeners = new Set<() => void>();

export function setUi(patch: Partial<UiState>): void {
  ui = { ...ui, ...patch };
  listeners.forEach((fn) => fn());
}

export function getUi(): UiState {
  return ui;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useUi<T>(pick: (u: UiState) => T): T {
  return useSyncExternalStore(subscribe, () => pick(ui));
}

/** Section 10 phone layout: narrow screens (under 768 px) use the bottom-sheet arrangement. */
export const PHONE_QUERY = '(max-width: 767px)';
export const isPhone = () => typeof window !== 'undefined' && !!window.matchMedia?.(PHONE_QUERY).matches;
