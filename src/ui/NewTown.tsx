// The New Town flow (Build Spec v2.0, Section 11): the typed confirmation word NEW and an
// optional seed box. It deletes only the autosave; Slots 1 to 3 are kept. Opened from the title
// screen, the Saves panel, and the tutorial's finish screen ("Start your town").
//
// Build interpretation (flagged): the typed NEW is asked for only when there is an autosave to
// delete. A brand-new player, with nothing saved, starts a town with one tap.

import { useEffect, useState, type ChangeEvent, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { hasAutosave, testSwitchInAddress } from '../game/persistence';
import { startTown } from '../game/session';
import { endTutorial, getTutorial } from '../game/tutorialFlow';
import { setUi, useUi } from './uiState';

/** Section 11: New Town needs this word typed, because it deletes the autosave. */
export const NEW_GAME_WORD = 'NEW';

export function NewTownDialog() {
  const open = useUi((u) => u.newTownOpen);
  const [typed, setTyped] = useState('');
  const [seed, setSeed] = useState('');
  const [needWord, setNeedWord] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const test = testSwitchInAddress();

  useEffect(() => {
    if (!open) return;
    setTyped('');
    setSeed('');
    setNeedWord(null);
    let live = true;
    void hasAutosave().then((has) => live && setNeedWord(has && !test));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setUi({ newTownOpen: false });
    };
    window.addEventListener('keydown', onKey);
    return () => {
      live = false;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, test]);

  if (!open) return null;
  const typedOk = !needWord || typed.trim().toUpperCase() === NEW_GAME_WORD;

  const go = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!typedOk || busy || needWord === null) return;
    setBusy(true);
    try {
      if (getTutorial().active) endTutorial();
      await startTown(seed);
      setUi({ newTownOpen: false, savesOpen: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" data-text-modal onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => e.target === e.currentTarget && setUi({ newTownOpen: false })}>
      <form className="dialog new-town" role="dialog" aria-modal="true" aria-labelledby="new-town-title" onSubmit={go}>
        <div className="dialog-head">
          <h2 id="new-town-title">New town</h2>
          <button type="button" className="pill" onClick={() => setUi({ newTownOpen: false })}>
            Close
          </button>
        </div>
        {test ? (
          <p>The test switch ?{test} is in the address, so this starts a test town and deletes nothing. Autosave stays off for this visit.</p>
        ) : needWord ? (
          <p>
            Starts a fresh map. This deletes your autosave; Slots 1 to 3 are kept. Type <strong>{NEW_GAME_WORD}</strong> to confirm.
          </p>
        ) : (
          <p>Starts a fresh map. Leave the seed box empty for a surprise map, or type a seed to pick one.</p>
        )}
        <div className="new-game-row">
          {needWord && (
            <input
              className="text-input"
              value={typed}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setTyped(e.target.value)}
              placeholder={`Type ${NEW_GAME_WORD}`}
              aria-label={`Type ${NEW_GAME_WORD} to confirm a new town`}
              autoComplete="off"
              autoCapitalize="characters"
              autoFocus
            />
          )}
          <input
            className="text-input"
            value={seed}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setSeed(e.target.value)}
            placeholder="Map seed (optional)"
            aria-label="Map seed (optional)"
            autoComplete="off"
          />
          <button type="submit" className={`pill ${needWord ? 'pill-danger' : 'pill-primary'}`} disabled={!typedOk || busy || needWord === null}>
            Start new town
          </button>
        </div>
      </form>
    </div>
  );
}
