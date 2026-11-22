// The desktop keyboard (Build Spec v2.0, Sections 5 and 10).
//
// One document-level keydown listener, registered once. It writes only to the store, through
// the same tile functions the touch and mouse handlers use, and never reads or writes a DOM
// input value. A letter key places that letter from the rack (the first unused tile with it),
// Backspace deletes the last placed letter, Enter submits (or confirms an active road preview,
// a pinned placement, or a swap), and Esc cancels an active preview, placement or swap.
// The listener ignores key presses while a panel with a real text field is open (the New Town
// seed box and the typed NEW confirmation are the only real text fields in the game).

import { deleteLast, enterKey, escape, store, typeLetter } from '../game/store';

let installed = false;

/** True while a dialog or panel is open over the game (it handles its own keys). */
function dialogOpen(): boolean {
  return !!document.querySelector('.dialog-backdrop, [data-text-modal]');
}

function onKey(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  const mode = store.state.mode;
  if (mode !== 'town' && mode !== 'tutorial') return;
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
  if (dialogOpen()) return;

  if (e.key === 'Escape') {
    escape();
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault(); // never "click" a focused button as well
    enterKey();
    return;
  }
  if (e.key === 'Backspace') {
    e.preventDefault(); // never navigate back
    deleteLast();
    return;
  }
  if (e.key.length === 1 && /^[a-zA-Z]$/.test(e.key)) {
    e.preventDefault();
    typeLetter(e.key);
  }
}

export function installKeyboard(): void {
  if (installed) return;
  installed = true;
  document.addEventListener('keydown', onKey);
}
