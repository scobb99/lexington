// Section 18 (v3.0) solvability check, run offline against the shipped dictionary.
// For each rack size the game can have (6 to 9) it draws 1,000 random racks from the game's
// weighted bag (Section 5) and records, for every order condition the generator can post, the
// share of racks from which at least one dictionary word meets the condition. The generator posts
// a condition only when its share is at least 25 percent (the Section 18 bar).
//
// Run from the project folder:  node scripts/orders/solvability.mjs
// It writes src/data/orderSolvability.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const words = fs.readFileSync(path.join(root, 'src/data/words.txt'), 'utf8').split(/\r?\n/).map((w) => w.trim().toUpperCase()).filter((w) => /^[A-Z]+$/.test(w));
const WEIGHTS = { E: 12, T: 9, A: 9, O: 8, I: 8, N: 7, S: 7, H: 6, R: 7, D: 4, L: 4, U: 4, C: 3, M: 3, G: 3, W: 2, F: 2, Y: 2, P: 2, B: 2, V: 2, K: 2, J: 1, Q: 1, X: 1, Z: 1 };
const BAG = Object.entries(WEIGHTS).flatMap(([l, w]) => Array(w).fill(l));
const RARE = new Set(['J', 'Q', 'X', 'Z', 'K', 'V']);
const TWICE = ['E', 'S', 'T', 'R', 'L', 'O', 'A', 'N'];
const START = ['S', 'C', 'P', 'T', 'M', 'B', 'R', 'L', 'D', 'G'];
const RACKS = 1000;
const BAR = 0.25;
const SEED = 20261122;

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const counts = words.map((w) => { const c = new Uint8Array(26); for (const ch of w) c[ch.charCodeAt(0) - 65]++; return c; });

// Minimum word length by rack size: racks of 6 and 7 only occur at Tier 1 (3 letters); Tier 2
// needs 5 Cottages, so racks of 8 and 9 are checked at the stricter 4-letter minimum.
const minFor = (size) => (size <= 7 ? 3 : 4);

const rng = mulberry32(SEED);
const results = {};
for (const size of [6, 7, 8, 9]) {
  const keys = ['len6', 'len7', ...TWICE.map((l) => `twice:${l}`), ...START.map((l) => `start:${l}`), 'rare', 'stamp'];
  const hits = Object.fromEntries(keys.map((k) => [k, 0]));
  const min = minFor(size);
  for (let r = 0; r < RACKS; r++) {
    const rack = Array.from({ length: size }, () => BAG[Math.floor(rng() * BAG.length)]);
    const have = new Uint8Array(26);
    for (const ch of rack) have[ch.charCodeAt(0) - 65]++;
    const stamped = rack[Math.floor(rng() * size)];
    const ok = new Set();
    for (let k = 0; k < words.length; k++) {
      const w = words[k];
      if (w.length < min || w.length > size) continue;
      const c = counts[k];
      let fits = true;
      for (let i = 0; i < 26; i++) if (c[i] > have[i]) { fits = false; break; }
      if (!fits) continue;
      if (w.length >= 6) ok.add('len6');
      if (w.length >= 7) ok.add('len7');
      for (const l of TWICE) if (c[l.charCodeAt(0) - 65] >= 2) ok.add(`twice:${l}`);
      if (w.length >= 5) ok.add(`start:${w[0]}`);
      if ([...w].some((ch) => RARE.has(ch))) ok.add('rare');
      if (w.includes(stamped)) ok.add('stamp');
    }
    for (const k of keys) if (ok.has(k)) hits[k]++;
  }
  results[size] = Object.fromEntries(keys.map((k) => [k, Math.round((hits[k] / RACKS) * 1000) / 1000]));
}
const out = { note: 'Section 18 solvability: share of 1,000 random racks per rack size with at least one dictionary word meeting the condition. Posted only at bar or above.', bar: BAR, racks: RACKS, seed: SEED, words: words.length, results };
fs.writeFileSync(path.join(root, 'src/data/orderSolvability.json'), JSON.stringify(out, null, 1) + '\n');
for (const [size, row] of Object.entries(results)) {
  const pass = Object.entries(row).filter(([, v]) => v >= BAR).map(([k]) => k);
  const fail = Object.entries(row).filter(([, v]) => v < BAR).map(([k, v]) => `${k} ${v}`);
  console.log(`rack ${size}: ${pass.length} pass; fail: ${fail.join(', ') || 'none'}`);
}
