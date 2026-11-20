// Building catalog and the values derived from buildings.
// Costs: Build Spec v1.1 Section 6. Footprints, tiers, terrain rules: Section 7.
// Population and happiness: Section 8. Production: Section 6.
// Phase 1 status: catalog and formulas are complete; placement arrives in Phase 2.
// Art: the approved Gemini sprites in src/assets/buildings/ (Section 3, v1.2).

import { emptyResources, type Building, type BuildingType, type Resources, type Tier } from './types';

export type TerrainRule =
  | 'meadowOrCleared' // Cottage, Market, Library, Town Hall, Tavern, Greenhouse, Wizard Tower, Park
  | 'nearForest' // Sawmill: adjacent to forest or thicket edge
  | 'nearHill' // Quarry: hill adjacency or hill tiles in the footprint
  | 'pier'; // Pier: next to water and a road, deck over water

export interface BuildingDef {
  type: BuildingType;
  name: string;
  tier: Tier;
  w: number;
  h: number;
  cost: Resources;
  terrain: TerrainRule;
  /** Section 7: only Cottages house anyone (3 each). */
  housing: number;
  /** Section 6: payout per valid word (Wizard Tower handled separately). */
  production: Resources;
}

const r = (coins: number, lumber: number, stone: number, knowledge: number, magic: number): Resources => ({
  coins,
  lumber,
  stone,
  knowledge,
  magic,
});

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  // Tier 1 (Section 7)
  cottage: { type: 'cottage', name: 'Cottage', tier: 1, w: 1, h: 1, cost: r(10, 8, 0, 0, 0), terrain: 'meadowOrCleared', housing: 3, production: r(0, 0, 0, 0, 0) },
  sawmill: { type: 'sawmill', name: 'Sawmill', tier: 1, w: 2, h: 2, cost: r(25, 12, 5, 0, 0), terrain: 'nearForest', housing: 0, production: r(0, 2, 0, 0, 0) },
  quarry: { type: 'quarry', name: 'Quarry', tier: 1, w: 2, h: 2, cost: r(25, 0, 15, 0, 0), terrain: 'nearHill', housing: 0, production: r(0, 0, 2, 0, 0) },
  // Tier 2
  market: { type: 'market', name: 'Market', tier: 2, w: 3, h: 2, cost: r(60, 20, 10, 0, 0), terrain: 'meadowOrCleared', housing: 0, production: r(2, 0, 0, 0, 0) },
  library: { type: 'library', name: 'Library', tier: 2, w: 2, h: 2, cost: r(50, 15, 10, 0, 0), terrain: 'meadowOrCleared', housing: 0, production: r(0, 0, 0, 1, 0) },
  pier: { type: 'pier', name: 'Pier', tier: 2, w: 2, h: 1, cost: r(40, 10, 0, 0, 0), terrain: 'pier', housing: 0, production: r(1, 1, 0, 0, 0) },
  // Tier 3
  townHall: { type: 'townHall', name: 'Town Hall', tier: 3, w: 3, h: 3, cost: r(150, 40, 40, 20, 0), terrain: 'meadowOrCleared', housing: 0, production: r(0, 0, 0, 0, 0) },
  park: { type: 'park', name: 'Park', tier: 3, w: 2, h: 2, cost: r(30, 10, 0, 0, 0), terrain: 'meadowOrCleared', housing: 0, production: r(0, 0, 0, 0, 0) },
  greenhouse: { type: 'greenhouse', name: 'Greenhouse', tier: 3, w: 3, h: 2, cost: r(90, 30, 15, 0, 0), terrain: 'meadowOrCleared', housing: 0, production: r(0, 1, 0, 1, 0) },
  tavern: { type: 'tavern', name: 'Tavern', tier: 3, w: 2, h: 2, cost: r(70, 25, 10, 0, 0), terrain: 'meadowOrCleared', housing: 0, production: r(1, 0, 0, 0, 0) },
  wizardTower: { type: 'wizardTower', name: 'Wizard Tower', tier: 3, w: 2, h: 2, cost: r(80, 0, 20, 30, 10), terrain: 'meadowOrCleared', housing: 0, production: r(0, 0, 0, 0, 0) },
};

export const TIER_ORDER: BuildingType[] = [
  'cottage', 'sawmill', 'quarry',
  'market', 'library', 'pier',
  'townHall', 'park', 'greenhouse', 'tavern', 'wizardTower',
];

/** Section 6: the first three buildings of a type pay full; extras pay half, rounded down. */
export const FULL_RATE_COUNT = 3;
/** Section 6: Wizard Tower pays 1 Magic per 5 valid words. */
export const WIZARD_MAGIC_EVERY = 5;

/** Buildings that count for the economy (art-showcase buildings never count). */
export function realBuildings(buildings: Building[]): Building[] {
  return buildings.filter((b) => !b.preview);
}

/** Section 8: population is derived, never stored. 3 per Cottage. */
export function population(buildings: Building[]): number {
  return realBuildings(buildings).reduce((n, b) => n + BUILDINGS[b.type].housing, 0);
}

export function countOf(buildings: Building[], type: BuildingType): number {
  return realBuildings(buildings).filter((b) => b.type === type).length;
}

export interface HappinessInputs {
  buildings: Building[];
  tier: Tier;
  /** True when the building touches a road or bridge (Section 7 placement guarantees this). */
  isRoadConnected: (b: Building) => boolean;
}

export interface HappinessPart {
  label: string;
  value: number;
}

/**
 * Section 8: every part of the happiness score, for the town summary. Only parts that apply
 * are listed (the base is always listed). happiness() is the clamped sum of these.
 */
export function happinessBreakdown({ buildings, tier, isRoadConnected }: HappinessInputs): HappinessPart[] {
  const list = realBuildings(buildings);
  const n = (t: BuildingType) => list.filter((b) => b.type === t).length;
  const parts: HappinessPart[] = [{ label: 'Base', value: 50 }];
  const add = (label: string, value: number) => {
    if (value !== 0) parts.push({ label, value });
  };
  const connected = list.filter((b) => b.type === 'cottage' && isRoadConnected(b)).length;
  add(`Road-connected Cottages (${connected}, +1 each, up to +10)`, Math.min(10, connected));
  add(`Parks (${n('park')}, +5 each, up to +15)`, Math.min(15, n('park') * 5));
  add(`Libraries (${n('library')}, +4 each, up to +12)`, Math.min(12, n('library') * 4));
  add(`Taverns (${n('tavern')}, +6 each, up to +12)`, Math.min(12, n('tavern') * 6));
  add('Town Hall', n('townHall') > 0 ? 10 : 0);
  add(`Piers (${n('pier')}, +2 each, up to +6)`, Math.min(6, n('pier') * 2));
  // Minus 4 for each Sawmill or Quarry within 2 tiles of any Cottage, capped at minus 16.
  const cottages = list.filter((b) => b.type === 'cottage');
  const noisy = list.filter((b) => b.type === 'sawmill' || b.type === 'quarry');
  const near = noisy.filter((m) => cottages.some((c) => footprintGap(m, c) <= 2)).length;
  add(`Sawmills or Quarries near homes (${near}, -4 each, down to -16)`, -Math.min(16, near * 4));
  if (tier >= 2 && cottages.length > 0 && n('library') === 0) add('No Library yet (Tier 2 and up)', -10);
  return parts;
}

/** Section 8: happiness 0 to 100, calculated, never stored. Base 50. */
export function happiness(inputs: HappinessInputs): number {
  const sum = happinessBreakdown(inputs).reduce((n, p) => n + p.value, 0);
  return Math.max(0, Math.min(100, sum));
}

/** Tiles between two footprints (0 = touching or overlapping), Chebyshev distance. */
export function footprintGap(a: Building, b: Building): number {
  const da = BUILDINGS[a.type];
  const db = BUILDINGS[b.type];
  const gx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + da.w, b.x + db.w));
  const gy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + da.h, b.y + db.h));
  return Math.max(gx, gy);
}

/**
 * Section 6: one production payout per valid word from every built, road-connected
 * production building. `validWordsAfter` is the lifetime valid word count including this word.
 */
export function production(
  buildings: Building[],
  isRoadConnected: (b: Building) => boolean,
  validWordsAfter: number,
): Resources {
  const out = emptyResources();
  const seen: Partial<Record<BuildingType, number>> = {};
  for (const b of realBuildings(buildings)) {
    if (!isRoadConnected(b)) continue;
    const def = BUILDINGS[b.type];
    const nth = (seen[b.type] = (seen[b.type] ?? 0) + 1);
    const full = nth <= FULL_RATE_COUNT;
    for (const k of Object.keys(out) as (keyof Resources)[]) {
      const v = def.production[k];
      out[k] += full ? v : Math.floor(v / 2);
    }
    if (b.type === 'wizardTower' && validWordsAfter % WIZARD_MAGIC_EVERY === 0) {
      out.magic += full ? 1 : 0; // half of 1, rounded down, is 0
    }
  }
  return out;
}

/** Section 7: refund half of Coin, Lumber, Stone (rounded down each); never Knowledge or Magic. */
export function removalRefund(type: BuildingType): Resources {
  const c = BUILDINGS[type].cost;
  return {
    coins: Math.floor(c.coins / 2),
    lumber: Math.floor(c.lumber / 2),
    stone: Math.floor(c.stone / 2),
    knowledge: 0,
    magic: 0,
  };
}

/** Section 6: lists exactly which resources are missing and by how much. */
export function missingResources(have: Resources, cost: Resources): Resources {
  const out = emptyResources();
  for (const k of Object.keys(out) as (keyof Resources)[]) out[k] = Math.max(0, cost[k] - have[k]);
  return out;
}

// ---------- Section 7: placement ----------

export interface PlacementContext {
  tiles: Uint8Array;
  forestCleared: Uint8Array;
  roads: Uint8Array;
  buildings: Building[];
  mapW: number;
  mapH: number;
}

export type PlacementProblem =
  | 'bounds'
  | 'water'
  | 'thicket'
  | 'road'
  | 'occupied'
  | 'forest'
  | 'terrain'
  | 'sawmill'
  | 'quarry'
  | 'pier'
  | 'noRoad';

// Terrain codes (kept local so this file stays free of rendering imports).
const MEADOW = 0;
const FOREST = 1;
const HILL = 2;
const MARSH = 3;
const THICKET = 4;
const WATER = 5;

/** Top-left tile of a footprint centred under the pointer's tile. */
export function footprintOrigin(type: BuildingType, tx: number, ty: number): { x: number; y: number } {
  const def = BUILDINGS[type];
  return { x: tx - Math.floor((def.w - 1) / 2), y: ty - Math.floor((def.h - 1) / 2) };
}

/** The building whose footprint covers (x, y), if any. */
export function buildingAt(buildings: Building[], x: number, y: number): Building | undefined {
  return buildings.find((b) => {
    const d = BUILDINGS[b.type];
    return x >= b.x && y >= b.y && x < b.x + d.w && y < b.y + d.h;
  });
}

/**
 * Section 7 placement rule (locked): footprint fully inside the map, unoccupied, on allowed
 * terrain, never on a road or bridge, and at least one side next to a road or bridge.
 * Terrain rules:
 *  - Cottage, Market, Library, Town Hall, Tavern, Greenhouse, Wizard Tower, Park: meadow or
 *    cleared forest.
 *  - Sawmill: a footprint tile next to forest or thicket.
 *  - Quarry: hill tiles in the footprint or next to it.
 *  - Pier: next to water and next to a road; the footprint stays entirely on land (Stu ruling,
 *    Nov 20, 2026): the approved art draws its own water and deck.
 * Build interpretation (the spec names no ground for these three): Sawmill, Quarry and Pier
 * stand on any open land (meadow, cleared forest, hill, or marsh), since river banks are
 * often marsh.
 * Returns null when the spot is fine.
 */
export function placementProblem(ctx: PlacementContext, type: BuildingType, x: number, y: number): PlacementProblem | null {
  const def = BUILDINGS[type];
  const inMap = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < ctx.mapW && yy < ctx.mapH;
  const at = (xx: number, yy: number) => (inMap(xx, yy) ? ctx.tiles[yy * ctx.mapW + xx] : -1);
  const cleared = (xx: number, yy: number) => ctx.forestCleared[yy * ctx.mapW + xx] === 1;
  const link = (xx: number, yy: number) => inMap(xx, yy) && ctx.roads[yy * ctx.mapW + xx] !== 0;

  const cells: [number, number][] = [];
  for (let yy = y; yy < y + def.h; yy++) for (let xx = x; xx < x + def.w; xx++) cells.push([xx, yy]);
  const ring: [number, number][] = [];
  for (let xx = x; xx < x + def.w; xx++) ring.push([xx, y - 1], [xx, y + def.h]);
  for (let yy = y; yy < y + def.h; yy++) ring.push([x - 1, yy], [x + def.w, yy]);

  if (cells.some(([xx, yy]) => !inMap(xx, yy))) return 'bounds';
  if (cells.some(([xx, yy]) => at(xx, yy) === WATER)) return 'water';
  if (cells.some(([xx, yy]) => at(xx, yy) === THICKET)) return 'thicket';
  if (cells.some(([xx, yy]) => link(xx, yy))) return 'road';
  if (cells.some(([xx, yy]) => buildingAt(ctx.buildings, xx, yy))) return 'occupied';
  if (cells.some(([xx, yy]) => at(xx, yy) === FOREST && !cleared(xx, yy))) return 'forest';

  if (def.terrain === 'meadowOrCleared') {
    if (cells.some(([xx, yy]) => at(xx, yy) !== MEADOW && !(at(xx, yy) === FOREST && cleared(xx, yy)))) return 'terrain';
  } else {
    const open = (t: number) => t === MEADOW || t === FOREST || t === HILL || t === MARSH;
    if (cells.some(([xx, yy]) => !open(at(xx, yy)))) return 'terrain';
  }

  const ringTerrain = ring.filter(([xx, yy]) => inMap(xx, yy)).map(([xx, yy]) => [at(xx, yy), xx, yy]);
  if (def.terrain === 'nearForest') {
    const ok = ringTerrain.some(([t, xx, yy]) => (t === FOREST && !cleared(xx, yy)) || t === THICKET);
    if (!ok) return 'sawmill';
  }
  if (def.terrain === 'nearHill') {
    const ok = cells.some(([xx, yy]) => at(xx, yy) === HILL) || ringTerrain.some(([t]) => t === HILL);
    if (!ok) return 'quarry';
  }
  if (def.terrain === 'pier') {
    if (!ringTerrain.some(([t]) => t === WATER)) return 'pier';
  }

  if (!ring.some(([xx, yy]) => link(xx, yy))) return 'noRoad';
  return null;
}

/** Section 12: friendly text naming why a spot cannot be used. */
export function placementMessage(problem: PlacementProblem, type: BuildingType): string {
  const name = BUILDINGS[type].name;
  switch (problem) {
    case 'bounds':
      return `The ${name} would run off the edge of the map there.`;
    case 'water':
      return `A ${name} can't be built on water.`;
    case 'thicket':
      return `The thicket there is too dense to build on.`;
    case 'road':
      return `Buildings sit beside roads, never on them. Move the ${name} off the road.`;
    case 'occupied':
      return `Something is already built there.`;
    case 'forest':
      return `That ground is still forest. Use Clear forest first, then build.`;
    case 'terrain':
      return BUILDINGS[type].terrain === 'meadowOrCleared'
        ? `A ${name} needs meadow or cleared forest.`
        : `A ${name} needs open land.`;
    case 'sawmill':
      return `A Sawmill must stand next to forest or thicket.`;
    case 'quarry':
      return `A Quarry needs hill ground under it or beside it.`;
    case 'pier':
      return `A Pier must stand at the water's edge, with a road beside it.`;
    case 'noRoad':
      return `The ${name} needs a road or bridge along one side.`;
  }
}
