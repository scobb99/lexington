// Building catalog and the values derived from buildings.
// Costs and production: Build Spec v2.0 Section 6. Footprints, tiers, terrain rules, the
// placement ghost reasons and the build card text: Section 7. Population and happiness:
// Section 8. Art: the approved Gemini sprites in src/assets/buildings/ (Section 3).

import { Terrain, emptyResources, type Building, type BuildingType, type Resources, type Tier } from './types';

export type TerrainRule =
  | 'meadowOrCleared' // Cottage, Market, Library, Town Hall, Tavern, Greenhouse, Wizard Tower, Park
  | 'nearForest' // Sawmill: adjacent to forest or thicket edge
  | 'nearHill' // Quarry: hill adjacency or hill tiles in the footprint
  | 'pier'; // Pier: next to water and a road; footprint entirely on land

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

// Section 6 (v2.0) costs are Coins, Lumber, Stone, Knowledge, Magic. Section 6 (v2.0) production
// rates per valid word. Section 7 footprints and tiers.
export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  // Tier 1
  // Cottage: Section 6 v2.0 gains a 2 Stone cost (Stu's seed idea): 10, 8, 2, 0, 0.
  cottage: { type: 'cottage', name: 'Cottage', tier: 1, w: 1, h: 1, cost: r(10, 8, 2, 0, 0), terrain: 'meadowOrCleared', housing: 3, production: r(0, 0, 0, 0, 0) },
  // Sawmill: Section 6 v2.0 25, 15, 0, 0, 0 (was 25, 12, 5). Pays 3 Lumber (was 2).
  sawmill: { type: 'sawmill', name: 'Sawmill', tier: 1, w: 2, h: 2, cost: r(25, 15, 0, 0, 0), terrain: 'nearForest', housing: 0, production: r(0, 3, 0, 0, 0) },
  // Quarry: Section 6 v2.0 25, 15, 0, 0, 0 (was 25, 0, 15). Pays 3 Stone (was 2).
  quarry: { type: 'quarry', name: 'Quarry', tier: 1, w: 2, h: 2, cost: r(25, 15, 0, 0, 0), terrain: 'nearHill', housing: 0, production: r(0, 0, 3, 0, 0) },
  // Tier 2
  // Market: Section 6 60, 20, 10, 0, 0 (unchanged). Pays 4 Coins (v2.0, was 2).
  market: { type: 'market', name: 'Market', tier: 2, w: 3, h: 2, cost: r(60, 20, 10, 0, 0), terrain: 'meadowOrCleared', housing: 0, production: r(4, 0, 0, 0, 0) },
  // Library: Section 6 50, 15, 10, 0, 0. Pays 2 Knowledge (v2.0, was 1).
  library: { type: 'library', name: 'Library', tier: 2, w: 2, h: 2, cost: r(50, 15, 10, 0, 0), terrain: 'meadowOrCleared', housing: 0, production: r(0, 0, 0, 2, 0) },
  // Pier: Section 6 40, 10, 0, 0, 0. Pays 2 Coins and 2 Lumber (v2.0, was 1 and 1).
  pier: { type: 'pier', name: 'Pier', tier: 2, w: 2, h: 1, cost: r(40, 10, 0, 0, 0), terrain: 'pier', housing: 0, production: r(2, 2, 0, 0, 0) },
  // Tier 3
  // Town Hall: Section 6 150, 40, 40, 20, 0.
  townHall: { type: 'townHall', name: 'Town Hall', tier: 3, w: 3, h: 3, cost: r(150, 40, 40, 20, 0), terrain: 'meadowOrCleared', housing: 0, production: r(0, 0, 0, 0, 0) },
  // Park: Section 6 30, 10, 0, 0, 0.
  park: { type: 'park', name: 'Park', tier: 3, w: 2, h: 2, cost: r(30, 10, 0, 0, 0), terrain: 'meadowOrCleared', housing: 0, production: r(0, 0, 0, 0, 0) },
  // Greenhouse: Section 6 90, 30, 15, 0, 0. Pays 2 Lumber and 2 Knowledge (v2.0, was 1 and 1).
  greenhouse: { type: 'greenhouse', name: 'Greenhouse', tier: 3, w: 3, h: 2, cost: r(90, 30, 15, 0, 0), terrain: 'meadowOrCleared', housing: 0, production: r(0, 2, 0, 2, 0) },
  // Tavern: Section 6 70, 25, 10, 0, 0. Pays 2 Coins (v2.0, was 1).
  tavern: { type: 'tavern', name: 'Tavern', tier: 3, w: 2, h: 2, cost: r(70, 25, 10, 0, 0), terrain: 'meadowOrCleared', housing: 0, production: r(2, 0, 0, 0, 0) },
  // Wizard Tower: Section 6 80, 0, 20, 30, 10. 1 Magic per 5 valid words (unchanged).
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

// ---------- Section 7 (v2.0): build menu cards, exact text ----------

export interface CardText {
  /** "Cottage · Tier 1 · 1 by 1" */
  header: string;
  /** "10 Coins, 8 Lumber, 2 Stone" */
  cost: string;
  does: string;
  goes: string;
}

/** Section 7 table: the wording the game shows on each card. */
export const CARD_TEXT: Record<BuildingType, CardText> = {
  cottage: { header: 'Cottage · Tier 1 · 1 by 1', cost: '10 Coins, 8 Lumber, 2 Stone', does: 'Houses 3 people. People unlock tiers and finish quests.', goes: 'Meadow or cleared land, beside a road.' },
  sawmill: { header: 'Sawmill · Tier 1 · 2 by 2', cost: '25 Coins, 15 Lumber', does: 'Pays 3 Lumber every time you submit a valid word.', goes: 'Meadow or cleared land beside forest or thicket, with a road beside it.' },
  quarry: { header: 'Quarry · Tier 1 · 2 by 2', cost: '25 Coins, 15 Lumber', does: 'Pays 3 Stone every time you submit a valid word.', goes: 'A hill in its footprint or beside it, with a road beside it.' },
  market: { header: 'Market · Tier 2 · 3 by 2', cost: '60 Coins, 20 Lumber, 10 Stone', does: 'Pays 4 Coins every time you submit a valid word.', goes: 'Meadow or cleared land, beside a road.' },
  library: { header: 'Library · Tier 2 · 2 by 2', cost: '50 Coins, 15 Lumber, 10 Stone', does: 'Pays 2 Knowledge every time you submit a valid word. Raises happiness by 4.', goes: 'Meadow or cleared land, beside a road.' },
  pier: { header: 'Pier · Tier 2 · 2 by 1', cost: '40 Coins, 10 Lumber', does: 'Pays 2 Coins and 2 Lumber every time you submit a valid word. Raises happiness by 2.', goes: 'On land beside water, with a road beside it.' },
  townHall: { header: 'Town Hall · Tier 3 · 3 by 3', cost: '150 Coins, 40 Lumber, 40 Stone, 20 Knowledge', does: 'Raises happiness by 10. The last quest asks for a Town Hall.', goes: 'Meadow or cleared land, beside a road.' },
  park: { header: 'Park · Tier 3 · 2 by 2', cost: '30 Coins, 10 Lumber', does: 'Raises happiness by 5.', goes: 'Meadow or cleared land, beside a road.' },
  greenhouse: { header: 'Greenhouse · Tier 3 · 3 by 2', cost: '90 Coins, 30 Lumber, 15 Stone', does: 'Pays 2 Lumber and 2 Knowledge every time you submit a valid word.', goes: 'Meadow or cleared land, beside a road.' },
  tavern: { header: 'Tavern · Tier 3 · 2 by 2', cost: '70 Coins, 25 Lumber, 10 Stone', does: 'Pays 2 Coins every time you submit a valid word. Raises happiness by 6.', goes: 'Meadow or cleared land, beside a road.' },
  wizardTower: { header: 'Wizard Tower · Tier 3 · 2 by 2', cost: '80 Coins, 20 Stone, 30 Knowledge, 10 Magic', does: 'Pays 1 Magic for every 5 valid words you submit, and doubles the Magic your rare letters earn.', goes: 'Meadow or cleared land, beside a road.' },
};

/** Section 7: the two standing notes, shown in the build panel's help line. */
export const CARD_NOTES = [
  'Pays lines show the full rate. The fourth and later buildings of a type pay half, rounded down.',
  'Happiness lines show the amount per building, up to the caps: road-connected Cottages stop adding at plus 10, Parks at plus 15, Libraries at plus 12, Taverns at plus 12, Piers at plus 6.',
];

/** Section 7: the line a locked card shows instead of its does line. */
export function lockedLine(tier: Tier): string {
  return `Locked. Opens at Tier ${tier}.`;
}

// ---------- derived values ----------

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

/** Empty tiles between two footprints (0 = touching or overlapping), Chebyshev distance. */
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

const PLURAL: Record<keyof Resources, [string, string]> = {
  coins: ['Coin', 'Coins'],
  lumber: ['Lumber', 'Lumber'],
  stone: ['Stone', 'Stone'],
  knowledge: ['Knowledge', 'Knowledge'],
  magic: ['Magic', 'Magic'],
};
const ORDER: (keyof Resources)[] = ['coins', 'lumber', 'stone', 'knowledge', 'magic'];

/** "4 Coins", "1 Coin", "2 Lumber" */
export function amount(k: keyof Resources, v: number): string {
  return `${v} ${v === 1 ? PLURAL[k][0] : PLURAL[k][1]}`;
}

/** "a, b and c" */
export function andList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
}

/** A cost written out: "10 Coins, 8 Lumber, 2 Stone" (Section 7 card and confirm bar form). */
export function costList(c: Resources): string {
  return ORDER.filter((k) => c[k] > 0)
    .map((k) => amount(k, c[k]))
    .join(', ');
}

/** A cost written as speech: "9 Coins and 6 Lumber" (Section 4 and 12 message form). */
export function costWords(c: Resources): string {
  return andList(ORDER.filter((k) => c[k] > 0).map((k) => amount(k, c[k])));
}

/**
 * Section 6 and 7 not-enough line, naming every missing resource and amount:
 * "Not enough: needs 4 more Coins and 2 more Lumber."
 */
export function notEnoughLine(missing: Resources): string {
  const parts = ORDER.filter((k) => missing[k] > 0).map((k) => `${amount(k, missing[k])}`.replace(/^(\d+) /, '$1 more '));
  return `Not enough: needs ${andList(parts)}.`;
}

export function anyMissing(missing: Resources): boolean {
  return ORDER.some((k) => missing[k] > 0);
}

// ---------- Section 7: placement ----------

export interface PlacementContext {
  tiles: Uint8Array;
  /**
   * 1 where the player changed the tile (Section 4, v2.0): forest to cleared forest, thicket to
   * cleared thicket, marsh to drained marsh (meadow). Changed tiles count as cleared land.
   */
  cleared: Uint8Array;
  roads: Uint8Array;
  buildings: Building[];
  mapW: number;
  mapH: number;
}

/**
 * Why a footprint cannot be used, in the Section 7 ghost reason order: off the map; occupied
 * (a building, road or bridge); wrong terrain (ground first, then the building's own
 * neighbour rule); no road beside it. Not enough resources is checked by the caller.
 */
export type PlacementProblem =
  | 'bounds'
  | 'road'
  | 'occupied'
  | 'water'
  | 'thicket'
  | 'forest'
  | 'marsh'
  | 'terrain'
  | 'sawmill'
  | 'quarry'
  | 'pier'
  | 'noRoad';

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

/** Effective terrain (Section 4, v2.0): a changed forest, thicket or marsh tile is open land. */
export function effectiveAt(tiles: Uint8Array, cleared: Uint8Array, i: number): number {
  const t = tiles[i];
  if (cleared[i] === 1 && (t === Terrain.Forest || t === Terrain.Thicket || t === Terrain.Marsh)) return Terrain.Meadow;
  return t;
}

/**
 * Section 7 placement rule (locked): footprint fully inside the map, unoccupied, on allowed
 * terrain, never on a road or bridge, and at least one side next to a road or bridge.
 * Terrain rules (v2.0):
 *  - Cottage, Market, Library, Town Hall, Tavern, Greenhouse, Wizard Tower, Park: meadow or
 *    cleared land (cleared forest, cleared thicket, drained marsh).
 *  - Sawmill: a footprint side next to uncleared forest or thicket.
 *  - Quarry: hill tiles in the footprint or next to it.
 *  - Pier: next to water; the footprint stays entirely on land (Stu ruling, Nov 20, 2026).
 *  - Marsh that has not been drained is never buildable (v2.0).
 * Build interpretation (the spec names no ground for these three): Sawmill, Quarry and Pier
 * stand on meadow, cleared land or hill.
 * Returns null when the spot is fine.
 */
export function placementProblem(ctx: PlacementContext, type: BuildingType, x: number, y: number): PlacementProblem | null {
  const def = BUILDINGS[type];
  const inMap = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < ctx.mapW && yy < ctx.mapH;
  const at = (xx: number, yy: number) => (inMap(xx, yy) ? effectiveAt(ctx.tiles, ctx.cleared, yy * ctx.mapW + xx) : -1);
  const link = (xx: number, yy: number) => inMap(xx, yy) && ctx.roads[yy * ctx.mapW + xx] !== 0;

  const cells: [number, number][] = [];
  for (let yy = y; yy < y + def.h; yy++) for (let xx = x; xx < x + def.w; xx++) cells.push([xx, yy]);
  const ring: [number, number][] = [];
  for (let xx = x; xx < x + def.w; xx++) ring.push([xx, y - 1], [xx, y + def.h]);
  for (let yy = y; yy < y + def.h; yy++) ring.push([x - 1, yy], [x + def.w, yy]);

  if (cells.some(([xx, yy]) => !inMap(xx, yy))) return 'bounds';
  if (cells.some(([xx, yy]) => link(xx, yy))) return 'road';
  if (cells.some(([xx, yy]) => buildingAt(ctx.buildings, xx, yy))) return 'occupied';
  if (cells.some(([xx, yy]) => at(xx, yy) === Terrain.Water)) return 'water';
  if (cells.some(([xx, yy]) => at(xx, yy) === Terrain.Thicket)) return 'thicket';
  if (cells.some(([xx, yy]) => at(xx, yy) === Terrain.Forest)) return 'forest';
  if (cells.some(([xx, yy]) => at(xx, yy) === Terrain.Marsh)) return 'marsh';

  if (def.terrain === 'meadowOrCleared') {
    if (cells.some(([xx, yy]) => at(xx, yy) !== Terrain.Meadow)) return 'terrain';
  }

  const ringTerrain = ring.filter(([xx, yy]) => inMap(xx, yy)).map(([xx, yy]) => at(xx, yy));
  if (def.terrain === 'nearForest' && !ringTerrain.some((t) => t === Terrain.Forest || t === Terrain.Thicket)) return 'sawmill';
  if (def.terrain === 'nearHill' && !(cells.some(([xx, yy]) => at(xx, yy) === Terrain.Hill) || ringTerrain.some((t) => t === Terrain.Hill))) return 'quarry';
  if (def.terrain === 'pier' && !ringTerrain.some((t) => t === Terrain.Water)) return 'pier';

  if (!ring.some(([xx, yy]) => link(xx, yy))) return 'noRoad';
  return null;
}

/**
 * Section 7 (v2.0) ghost reason text, first matching reason in the spec's order. Build
 * interpretation: a footprint on the wrong ground reads "Needs meadow or cleared land." (the
 * Pier reads its own line, which already says "on land"); a footprint on good ground that misses
 * its neighbour rule reads that building's own line.
 */
export function placementReason(problem: PlacementProblem, type: BuildingType): string {
  switch (problem) {
    case 'bounds':
      return 'Part of the building is off the map.';
    case 'road':
    case 'occupied':
      return 'Something is already there.';
    case 'water':
    case 'thicket':
    case 'forest':
    case 'marsh':
    case 'terrain':
      return type === 'pier' ? 'Must sit on land beside water.' : type === 'quarry' && problem === 'terrain' ? 'Needs a hill in its footprint or beside it.' : 'Needs meadow or cleared land.';
    case 'sawmill':
      return 'Must sit beside forest or thicket.';
    case 'quarry':
      return 'Needs a hill in its footprint or beside it.';
    case 'pier':
      return 'Must sit on land beside water.';
    case 'noRoad':
      return 'Needs a road beside it.';
  }
}
