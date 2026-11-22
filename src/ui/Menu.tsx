// The in-game menu (Build Spec v2.0, Section 16): Saves, How to Play, and Title Screen.
// How to Play autosaves the current town first and returns the player to it when the tutorial
// ends; Title Screen autosaves and returns to the title screen.

import { useEffect, useRef } from 'react';
import { goToTitle } from '../game/session';
import { startTutorial } from '../game/tutorialFlow';
import { setUi, useUi } from './uiState';

export function MenuButton({ className = '' }: { className?: string }) {
  const open = useUi((u) => u.menuOpen);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setUi({ menuOpen: false });
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  const pick = (fn: () => void) => () => {
    setUi({ menuOpen: false });
    fn();
  };

  return (
    <div className={`menu-wrap ${className}`} ref={ref}>
      <button className="pill menu-button" onClick={() => setUi({ menuOpen: !open })} aria-haspopup="menu" aria-expanded={open}>
        Menu
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          <button role="menuitem" className="menu-item" onClick={pick(() => setUi({ savesOpen: true }))}>
            Saves
          </button>
          <button role="menuitem" className="menu-item" onClick={pick(() => void startTutorial('town'))}>
            How to Play
          </button>
          <button role="menuitem" className="menu-item" onClick={pick(() => void goToTitle())}>
            Title Screen
          </button>
        </div>
      )}
    </div>
  );
}
