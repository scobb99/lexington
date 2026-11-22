// Dictionary loading (Build Spec v2.0, Section 5, Fork B).
// The curated list ships inside the app at src/data/words.txt and is imported as raw text.
// It is loaded with a dynamic import so it becomes its own bundled chunk, and it is parsed
// once into a Set after the map first paints. If anything goes wrong, the game runs on the
// 200-word fallback set below, shows a short notice, and never crashes.

import type { DictStatus } from './types';

/** Section 5: hard-coded fallback set of 200 common words (all also in words.txt). */
export const FALLBACK_WORDS: readonly string[] = `
  the and are ant art ate eat tea ten net tan tin sit sat set sea see sun son not nor now new one
  our out own oil old odd ore oar ear era air aim arm rat tar tie toe toes tone note notes nest
  rest test tent tens tear tears rate rates rain rains stain train trains saint satin stone stones
  store story start star stars stair seat seats east heat hear heart hearts earth other others
  three there these those horse shore share hare hate hats hits hint hunt hurt rush shut shot host
  hose nose rose rise ride side site dine diner dinner dish dirt done dose door dear dare date
  dates dust duet den dent dense end ends need needs deer reed read reads road roads rode lead
  lane line lines lion lions loan lone lost lots slot list lint tile tiles tale tales late later
  alert alter after often offer heron honest hornet nature mature meat meant mean means mane name
  names mine minor more most mist time times item items emit smite mite tame team teams steam
  stream metal meal male mail sail tail tails nail snail slain plain plane plant plants pant
`.trim().split(/\s+/);

/** A list this short or this broken is treated as corrupt (Section 14: corrupt dictionary test). */
export const MIN_VALID_WORDS = 1000;
const MAX_BAD_LINE_SHARE = 0.01;

export interface DictionaryState {
  status: DictStatus;
  count: number;
  /** Plain reason when the fallback set is in use. */
  problem?: string;
}

let words: Set<string> = new Set(FALLBACK_WORDS);
let state: DictionaryState = { status: 'loading', count: words.size };
let loading: Promise<DictionaryState> | null = null;

/**
 * Parses words.txt: one lower-case word per line. Throws if the text does not look like a
 * real word list, so a corrupted file can never produce a half-working dictionary.
 */
export function parseWordList(text: unknown): Set<string> {
  if (typeof text !== 'string') throw new Error('word list is not text');
  const out = new Set<string>();
  let bad = 0;
  let lines = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    lines++;
    if (/^[a-z]{2,15}$/.test(line)) out.add(line);
    else bad++;
  }
  if (out.size < MIN_VALID_WORDS) throw new Error(`word list has only ${out.size} valid words`);
  if (bad / Math.max(1, lines) > MAX_BAD_LINE_SHARE) throw new Error(`word list has ${bad} broken lines`);
  return out;
}

export type DictionaryTestMode = 'corrupt' | 'block' | null;

/** Loads and parses the bundled list once. Safe to call many times. */
export function loadDictionary(testMode: DictionaryTestMode = null): Promise<DictionaryState> {
  if (loading) return loading;
  loading = (async () => {
    try {
      let text: unknown;
      if (testMode === 'block') throw new Error('dictionary blocked for testing');
      if (testMode === 'corrupt') {
        text = 'this is not\na word list \u0000\u0001 %%\n12345';
      } else {
        const mod = await import('../data/words.txt?raw');
        text = mod.default;
      }
      const parsed = parseWordList(text);
      words = parsed;
      state = { status: 'ready', count: parsed.size };
    } catch (err) {
      words = new Set(FALLBACK_WORDS);
      state = {
        status: 'fallback',
        count: words.size,
        problem: err instanceof Error ? err.message : String(err),
      };
      console.warn('[Lexington] Main word list failed to load; using the 200-word fallback set.', err);
    }
    return state;
  })();
  return loading;
}

/**
 * true or false once the main list (or the fallback) is settled.
 * While the main list is still loading, fallback words are accepted at once and other
 * words return null so the game can say "still loading" instead of a wrong "not a word".
 */
export function isWord(upperWord: string): boolean | null {
  const w = upperWord.toLowerCase();
  if (words.has(w)) return true;
  return state.status === 'loading' ? null : false;
}

/** Every word currently accepted (lower-case). Used by the dead rack rule (Section 5). */
export function allWords(): Iterable<string> {
  return words;
}

export function dictionaryState(): DictionaryState {
  return state;
}

/** Test helper only: forget the loaded list so loadDictionary() can run again. */
export function resetDictionaryForTests(): void {
  words = new Set(FALLBACK_WORDS);
  state = { status: 'loading', count: words.size };
  loading = null;
}

/** Test helper only: use this word list text as if it had loaded (Node tests have no bundler). */
export function useWordListForTests(text: string): DictionaryState {
  words = parseWordList(text);
  state = { status: 'ready', count: words.size };
  loading = Promise.resolve(state);
  return state;
}
