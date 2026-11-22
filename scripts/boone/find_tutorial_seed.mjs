// Finds a fixed seed for the v2.0 tutorial town (Spec v2.0, Section 17).
// Uses the game's own terrain generator (copied into game-src/ with the import
// extension fixed for Node) so the chosen seed is guaranteed to show every
// terrain type near the town centre, with meadow dominant, a Cottage plot, and
// a Sawmill plot beside forest far enough from the Cottage plot to avoid the
// Section 8 proximity penalty.
import { generateTerrain, terrainAt } from './game-src/terrain.ts';
import { Terrain } from './game-src/types.ts';

const CX = 27, CY = 27;
const NAMES = ['meadow', 'forest', 'hill', 'marsh', 'thicket', 'water'];
const R = 7;

function windowTiles(map, r) {
  const out = [];
  for (let y = CY - r; y <= CY + r; y++)
    for (let x = CX - r; x <= CX + r; x++) out.push({ x, y, t: terrainAt(map, x, y) });
  return out;
}

function evaluate(seedText) {
  const map = generateTerrain(seedText);
  const w = windowTiles(map, R);
  const counts = {};
  for (const c of w) counts[NAMES[c.t]] = (counts[NAMES[c.t]] || 0) + 1;
  for (const n of NAMES) if ((counts[n] || 0) < 2) return null;
  if (counts.meadow / w.length < 0.4) return null;
  const meadows = w.filter((c) => c.t === Terrain.Meadow);
  let cottage = null;
  for (const c of meadows) {
    const nb = [
      terrainAt(map, c.x + 1, c.y), terrainAt(map, c.x - 1, c.y),
      terrainAt(map, c.x, c.y + 1), terrainAt(map, c.x, c.y - 1),
    ];
    if (nb.every((t) => t === Terrain.Meadow)) { cottage = c; break; }
  }
  if (!cottage) return null;
  let sawmill = null;
  for (const c of meadows) {
    const nearForest = [
      terrainAt(map, c.x + 1, c.y), terrainAt(map, c.x - 1, c.y),
      terrainAt(map, c.x, c.y + 1), terrainAt(map, c.x, c.y - 1),
    ].includes(Terrain.Forest);
    const dist = Math.max(Math.abs(c.x - cottage.x), Math.abs(c.y - cottage.y));
    if (nearForest && dist >= 4) { sawmill = c; break; }
  }
  if (!sawmill) return null;
  return { seedText, cottage, sawmill, counts, meadowShare: +(counts.meadow / w.length).toFixed(2) };
}

const bases = ['tutorial', 'firsttown', 'welcome', 'beginnings', 'newtown', 'meadowbrook',
  'learn', 'guide', 'lesson', 'home', 'hearth', 'village', 'hamlet', 'founding',
  'start', 'primer', 'schoolhouse', 'wordcity', 'settlement'];
const candidates = [...bases];
for (const b of bases) for (let i = 1; i <= 60; i++) candidates.push(`${b}-${i}`);

let best = null;
for (const c of candidates) {
  const hit = evaluate(c);
  if (hit && (!best || hit.meadowShare > best.meadowShare)) best = hit;
  if (best && best.meadowShare >= 0.55) break;
}
console.log(JSON.stringify(best, null, 1));
