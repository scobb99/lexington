import { createRoot } from 'react-dom/client';
import App from './App';
import { NAME } from './game/config';
import * as game from './game/store';
import * as saves from './game/persistence';
import * as session from './game/session';
import * as tutorial from './game/tutorialFlow';
import { startDictionary } from './game/store';
import { installKeyboard } from './ui/keyboard';
import './styles.css';

// Section 14 test hook: ?testHooks exposes the store, the save functions and the tutorial flow to
// automated browser tests only.
const params = new URLSearchParams(window.location.search);
if (params.has('testHooks')) {
  (window as unknown as Record<string, unknown>).wordcityTest = { ...game, saves, session, tutorial };
}

document.title = NAME;

async function start(): Promise<void> {
  // Section 16: the title screen comes first, so nothing is restored here. The title screen
  // reads the autosave (with a time limit) to decide whether Continue shows.
  void session.refreshBoot().catch((err) => console.warn(`[${NAME}] The saves could not be read at start-up:`, err));

  // Section 5 and 16: the word list is parsed once; the title screen shows its size, and no map
  // is drawn behind the title, so it starts loading now.
  startDictionary();

  // Section 10: one document-level keydown listener, registered once.
  installKeyboard();

  // StrictMode is left off on purpose: in development it mounts every component twice, which
  // would show two Pixi Applications during the Section 14 instance-count check.
  createRoot(document.getElementById('root')!).render(<App />);

  // Test switch ?skipTitle (automated tests only): go straight into a new test town.
  if (params.has('skipTitle')) await saves.newGame();

  void saves.checkUnreadableKept();
}

void start();
