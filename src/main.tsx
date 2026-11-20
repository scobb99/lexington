import { createRoot } from 'react-dom/client';
import App from './App';
import * as game from './game/store';
import * as saves from './game/persistence';
import { placeShowcase, say, startDictionary } from './game/store';
import './styles.css';

// Section 14 test hook: ?testHooks exposes the store (and the save functions) to automated
// browser tests only.
if (new URLSearchParams(window.location.search).has('testHooks')) {
  (window as unknown as { wordcityTest: typeof game & { saves: typeof saves } }).wordcityTest = { ...game, saves };
}

async function start(): Promise<void> {
  // Section 11: continue the autosaved town, if there is one, before the map is created, so the
  // map paints the restored town the first time.
  let outcome: saves.BootOutcome = 'new';
  try {
    outcome = await saves.bootFromAutosave();
  } catch (err) {
    console.warn('[WordCity] The autosave could not be read at start-up:', err);
  }
  if (outcome === 'paused') {
    say(`${game.store.state.message.text} (Test switch in the address: autosave is off for this visit.)`, game.store.state.message.kind);
  } else if (outcome === 'unavailable') {
    say(`${game.store.state.message.text} This browser window doesn't allow saving, so your town won't be kept after you close it. Export (in Saves) still works.`, 'warn');
  }

  // Art showcase: add ?showcase to the address to see all 11 buildings on the map.
  if (new URLSearchParams(window.location.search).has('showcase')) placeShowcase();

  // Section 5: the word list is parsed after the map first paints. If the map never reports
  // (for example, it failed), start anyway after 4 seconds so the word game always works.
  window.setTimeout(startDictionary, 4000);

  // StrictMode is left off on purpose: in development it mounts every component twice, which
  // would show two Pixi Applications during the Section 14 instance-count check.
  createRoot(document.getElementById('root')!).render(<App />);

  saves.startAutosave();
  void saves.checkUnreadableKept();
}

void start();
