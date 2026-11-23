// (v3.0.1) Where the town center is founded (Section 18), shared by a new town and the v2 to v3
// save migration (Section 11).
//
// Stu's ruling, Nov 22, 2026 (roomier founding): among the 2 by 2 meadow spots in the middle
// 60 percent of the map, prefer the one with the most open meadow around it, not simply the
// fitting spot nearest the centre. A spot hemmed in by river, marsh or hills with one way out
// loses to a spot with room to grow, when one exists in the middle band.
//
// Build reading of "roomier" (flagged in the build note):
//  - ring: the open, buildable tiles among the 8 tiles that share an edge with the footprint, where
//    the first roads can start (each worth 4);
//  - clearing: the open tiles reachable from the footprint through open tiles, without leaving a
//    window of 5 tiles around the footprint (each worth 1; at most 140);
//  - a pull to the middle: minus 4 per tile of distance from the map centre, so a spot must be
//    clearly roomier to win from further out (over 200 sample maps: no spot with 4 or fewer open
//    edge tiles, against 62 under v3.0.0; mean distance from the centre 9.2 tiles, against 2.2);
//  - ties go to the spot nearer the centre, then the lower row, then the lower column.
// If no spot fits in the middle band, the v3.0 search runs: the fitting spot nearest the centre,
// widening ring by ring to the whole map.

import type { Pt } from './roads';
import { MAP_H, MAP_W } from './types';

/** The middle 60 percent of the map: tiles 11 to 42 on each axis. */
export const BAND_LO = Math.ceil(MAP_W * 0.2);
export const BAND_HI = Math.floor(MAP_W * 0.8) - 1;
/** How far the clearing is counted around the footprint. */
export const CLEARING_REACH = 5;
const RING_WEIGHT = 4;
const CENTRE_PULL = 4;
const CX = 27;
const CY = 27;
const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

type Open = (x: number, y: number) => boolean;

function fits(open: Open, x: number, y: number): boolean {
  return open(x, y) && open(x + 1, y) && open(x, y + 1) && open(x + 1, y + 1);
}

/** Distance from the footprint's middle to the map centre (27.5, 27.5 in tile terms). */
function centreDistance(x: number, y: number): number {
  return Math.hypot(x + 0.5 - (CX + 0.5), y + 0.5 - (CY + 0.5));
}

/** The 8 tiles that share an edge with a 2 by 2 footprint at (x, y). */
export function ringTiles(x: number, y: number): Pt[] {
  const out: Pt[] = [];
  for (let yy = y - 1; yy <= y + 2; yy++)
    for (let xx = x - 1; xx <= x + 2; xx++) {
      const inside = xx >= x && xx <= x + 1 && yy >= y && yy <= y + 1;
      const corner = (xx === x - 1 || xx === x + 2) && (yy === y - 1 || yy === y + 2);
      if (!inside && !corner) out.push({ x: xx, y: yy });
    }
  return out;
}

/** How roomy a fitting spot is (see the header). */
export function roominess(open: Open, x: number, y: number): { ring: number; clearing: number; score: number } {
  const ok = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < MAP_W && yy < MAP_H && open(xx, yy);
  const ring = ringTiles(x, y).filter((t) => ok(t.x, t.y)).length;
  const x0 = x - CLEARING_REACH;
  const x1 = x + 1 + CLEARING_REACH;
  const y0 = y - CLEARING_REACH;
  const y1 = y + 1 + CLEARING_REACH;
  const seen = new Set<number>();
  const queue: Pt[] = [];
  for (let yy = y; yy <= y + 1; yy++) for (let xx = x; xx <= x + 1; xx++) {
    seen.add(yy * MAP_W + xx);
    queue.push({ x: xx, y: yy });
  }
  let clearing = 0;
  while (queue.length) {
    const t = queue.pop()!;
    for (const [dx, dy] of N4) {
      const nx = t.x + dx;
      const ny = t.y + dy;
      if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue;
      const i = ny * MAP_W + nx;
      if (seen.has(i) || !ok(nx, ny)) continue;
      seen.add(i);
      clearing++;
      queue.push({ x: nx, y: ny });
    }
  }
  return { ring, clearing, score: ring * RING_WEIGHT + clearing - CENTRE_PULL * centreDistance(x, y) };
}

/** The v3.0 search: the fitting spot nearest the centre, widening ring by ring. */
function nearestSpot(open: Open): Pt | null {
  for (let r = 0; r < MAP_W; r++) {
    let best: Pt | null = null;
    let bestD = Infinity;
    for (let y = CY - r; y <= CY + r; y++)
      for (let x = CX - r; x <= CX + r; x++) {
        if (Math.max(Math.abs(x - CX), Math.abs(y - CY)) !== r) continue;
        if (x < 0 || y < 0 || x + 1 >= MAP_W || y + 1 >= MAP_H || !fits(open, x, y)) continue;
        const d = Math.hypot(x - CX, y - CY);
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    if (best) return best;
  }
  return null;
}

/**
 * The town center's footprint origin. `open(x, y)` says whether a tile is open, buildable land:
 * meadow or cleared land, inside the map, with nothing on it.
 */
export function roomiestSpot(open: Open): Pt | null {
  let best: Pt | null = null;
  let bestScore = -Infinity;
  let bestD = Infinity;
  for (let y = BAND_LO; y + 1 <= BAND_HI; y++)
    for (let x = BAND_LO; x + 1 <= BAND_HI; x++) {
      if (!fits(open, x, y)) continue;
      const { score } = roominess(open, x, y);
      const d = centreDistance(x, y);
      if (score > bestScore + 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && d < bestD - 1e-9)) {
        best = { x, y };
        bestScore = score;
        bestD = d;
      }
    }
  return best ?? nearestSpot(open);
}

/** (Reporting only) the v3.0.0 search, kept so tests and the build note can compare the two. */
export function nearestSpotV300(open: Open): Pt | null {
  return nearestSpot(open);
}
