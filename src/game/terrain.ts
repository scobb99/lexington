// Seeded terrain generation (Build Spec v1.1, Section 2).
// Pure data: no Pixi, no React. The same seed always produces the same map,
// so a save only needs the seed plus the tile changes the player made.

import { MAP_H, MAP_W, Terrain, type TerrainMap } from './types';

/** Used when the requested seed is missing or invalid (Section 14: test invalid seeds). */
export const DEFAULT_SEED_TEXT = 'wordcity';

/** Build choice (not in the spec): every map keeps at least this share of open meadow. */
export const MIN_MEADOW_SHARE = 0.42;

// ---------- seeded randomness ----------

/** FNV-1a 32-bit hash of a string. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Small, fast, seeded PRNG returning numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Turns any input into a usable seed. Never throws.
 * - Non-negative whole numbers (or digit strings) are used as-is (mod 2^32).
 * - Other non-empty text is hashed.
 * - Anything else (empty, NaN, Infinity, objects, null) falls back to the default seed.
 */
export function normalizeSeed(input: unknown): { seed: number; text: string; invalid: boolean } {
  if (typeof input === 'number') {
    if (Number.isFinite(input)) {
      const n = Math.floor(Math.abs(input)) % 4294967296;
      return { seed: n >>> 0, text: String(n), invalid: false };
    }
  } else if (typeof input === 'string') {
    const text = input.trim().slice(0, 64);
    if (text.length > 0) {
      if (/^\d{1,15}$/.test(text)) {
        const n = Number(text) % 4294967296;
        return { seed: n >>> 0, text, invalid: false };
      }
      return { seed: hashString(text), text, invalid: false };
    }
  }
  return { seed: hashString(DEFAULT_SEED_TEXT), text: DEFAULT_SEED_TEXT, invalid: true };
}

// ---------- value noise ----------

function lattice(ix: number, iy: number, salt: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(salt, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, salt: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const a = lattice(ix, iy, salt);
  const b = lattice(ix + 1, iy, salt);
  const c = lattice(ix, iy + 1, salt);
  const d = lattice(ix + 1, iy + 1, salt);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Fractal noise in [0, 1). */
export function fbm(x: number, y: number, salt: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq, salt + o * 101);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// ---------- generator ----------

const idx = (x: number, y: number) => y * MAP_W + x;
const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

/** Multi-source BFS distance (8-neighbour, in tiles) from every water tile. */
export function distanceToWater(tiles: Uint8Array): Uint16Array {
  const dist = new Uint16Array(MAP_W * MAP_H).fill(65535);
  const queue: number[] = [];
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === Terrain.Water) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const x = i % MAP_W;
    const y = (i / MAP_W) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(nx, ny)) continue;
        const j = idx(nx, ny);
        if (dist[j] > dist[i] + 1) {
          dist[j] = dist[i] + 1;
          queue.push(j);
        }
      }
    }
  }
  return dist;
}

/**
 * Generates the base map for a seed.
 * River: crosses the whole map (west-east or north-south, chosen by seed) on a winding
 * path with varying width and occasional wider pools. Marsh forms near water.
 * Forest, hill, and thicket form as noise patches.
 */
export function generateTerrain(seedInput: unknown): TerrainMap {
  const { seed, text, invalid } = normalizeSeed(seedInput);
  const rng = mulberry32(seed);
  const tiles = new Uint8Array(MAP_W * MAP_H).fill(Terrain.Meadow);
  const salt = seed % 100000;

  // --- River ---
  const horizontal = rng() < 0.5;
  const start = 16 + rng() * 22; // centreline starts in the middle band of the map
  const phase = rng() * Math.PI * 2;
  const amp = 5 + rng() * 4;
  const drift = (rng() - 0.5) * 10;
  const mark = (along: number, across: number) => {
    const x = horizontal ? along : across;
    const y = horizontal ? across : along;
    if (inBounds(x, y)) tiles[idx(x, y)] = Terrain.Water;
  };
  for (let a = -3; a <= MAP_W + 3; a += 0.2) {
    const t = a / MAP_W;
    const centre =
      start +
      amp * Math.sin(a * 0.16 + phase) +
      amp * 0.45 * Math.sin(a * 0.37 + phase * 1.7) +
      (fbm(a * 0.07, 3.3, salt + 11, 3) - 0.5) * 16 +
      drift * t;
    // Half-width varies from about 0.8 to 2.4 tiles, with occasional wider pools.
    let half = 0.8 + Math.pow(fbm(a * 0.13, 7.7, salt + 23, 2), 1.5) * 2.6;
    const pool = fbm(a * 0.06, 1.9, salt + 37, 2);
    if (pool > 0.6) half += (pool - 0.6) * 11; // wider water, up to ~4 extra tiles
    for (let o = -Math.ceil(half) - 1; o <= Math.ceil(half) + 1; o++) {
      const across = Math.round(centre + o);
      if (Math.abs(across - centre) <= half) mark(Math.round(a), across);
    }
  }

  const waterDist = distanceToWater(tiles);

  // --- Marsh near water ---
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const i = idx(x, y);
      if (tiles[i] === Terrain.Water) continue;
      const d = waterDist[i];
      const n = fbm(x * 0.22, y * 0.22, salt + 51, 3);
      if ((d === 1 && n > 0.42) || (d === 2 && n > 0.55) || (d === 3 && n > 0.68)) {
        tiles[i] = Terrain.Marsh;
      }
    }
  }

  // --- Forest, hill, thicket patches ---
  // If a seed leaves too little open meadow to build a town, the patches are made a little
  // sparser and drawn again. This is deterministic, so a seed still always gives one map.
  const beforePatches = tiles.slice();
  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt > 0) tiles.set(beforePatches);
    const lift = attempt * 0.025;
    let meadow = 0;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const i = idx(x, y);
        const t = tiles[i];
        if (t === Terrain.Water || t === Terrain.Marsh) continue;
        const forest = fbm(x * 0.085, y * 0.085, salt + 71, 4);
        const hill = fbm(x * 0.075, y * 0.075, salt + 89, 4);
        const brush = fbm(x * 0.19, y * 0.19, salt + 97, 3);
        if (hill > 0.64 + lift && waterDist[i] > 2) {
          tiles[i] = Terrain.Hill;
        } else if (forest > 0.6 + lift) {
          // Thicket grows deep inside forests (Section 2: impassable).
          tiles[i] = forest > 0.69 + lift && brush > 0.56 ? Terrain.Thicket : Terrain.Forest;
        } else if (brush > 0.8 && waterDist[i] > 2) {
          tiles[i] = Terrain.Thicket; // occasional small standalone bramble patch
        } else {
          meadow++;
        }
      }
    }
    if (meadow / tiles.length >= MIN_MEADOW_SHARE) break;
  }

  return {
    seed,
    seedText: text,
    seedWasInvalid: invalid,
    width: MAP_W,
    height: MAP_H,
    tiles,
  };
}

export function terrainAt(map: TerrainMap, x: number, y: number): number {
  if (!inBounds(x, y)) return -1;
  return map.tiles[idx(x, y)];
}

/** Tile counts per terrain type, for tests and the build report. */
export function terrainStats(map: TerrainMap): Record<number, number> {
  const out: Record<number, number> = {};
  for (const t of map.tiles) out[t] = (out[t] ?? 0) + 1;
  return out;
}
