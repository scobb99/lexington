// The title screen (Build Spec v2.0, Section 16).
// It comes first on every load, before any town is created or loaded, and no town renders
// behind it. The game icon art sits at the top, the game name under it (the NAME constant),
// and four buttons in a column: Continue (only when a loadable autosave exists), New Town, How
// to Play, and Saves. The footer shows the word list size.

import { useEffect, useSyncExternalStore } from 'react';
import gameIconUrl from '../assets/ui/game-icon.png?url';
import { NAME } from '../game/config';
import { continueGame, getBoot, refreshBoot, subscribeBoot } from '../game/session';
import { useGame } from '../game/store';
import { startTutorial } from '../game/tutorialFlow';
import { setUi } from './uiState';

export const UNREADABLE_LINE = 'Your saved town could not be read. It has been kept aside, and a new town can be started.';
export const FIRST_VISIT_LINE = 'New here? How to Play shows you the whole game in about two minutes.';

export function TitleScreen() {
  const boot = useSyncExternalStore(subscribeBoot, getBoot);
  const dictStatus = useGame((s) => s.dict.status);
  const dictCount = useGame((s) => s.dict.count);

  useEffect(() => {
    if (!getBoot()) void refreshBoot();
  }, []);

  const words =
    dictStatus === 'loading'
      ? 'Word list: loading…'
      : dictStatus === 'ready'
        ? `Word list: ${dictCount.toLocaleString('en-US')} words.`
        : `Word list: backup list (${dictCount} words).`;

  return (
    <div className="title-screen" role="main" aria-label={`${NAME} title screen`}>
      <div className="title-column">
        <img className="title-icon" src={gameIconUrl} alt="" width={220} height={220} />
        <h1 className="title-name">{NAME}</h1>
        <div className="title-buttons">
          {boot?.autosave === 'ok' && (
            <button className="pill pill-primary title-button" onClick={() => void continueGame()}>
              Continue
            </button>
          )}
          <button className={`pill title-button${boot?.autosave === 'ok' ? '' : ' pill-primary'}`} onClick={() => setUi({ newTownOpen: true })}>
            New Town
          </button>
          <button className="pill title-button" onClick={() => void startTutorial('title')}>
            How to Play
          </button>
          <button className="pill title-button" onClick={() => setUi({ savesOpen: true })}>
            Saves
          </button>
        </div>
        {boot?.autosave === 'unreadable' && <p className="title-line title-warn">{UNREADABLE_LINE}</p>}
        {boot?.firstVisit && <p className="title-line title-prompt">{FIRST_VISIT_LINE}</p>}
        {boot?.autosave === 'paused' && <p className="title-line">A test switch is in the address, so autosave is off for this visit.</p>}
        {boot?.autosave === 'unavailable' && <p className="title-line title-warn">This browser window does not allow saving. Your town won't be kept after you close it, but Export still works.</p>}
      </div>
      <footer className="title-footer">{words}</footer>
    </div>
  );
}
