// The tutorial's fixed data (Build Spec v3.0, Section 17): the seed, the first rack, the
// marked plots, and every step with the exact text the game shows.
//
// (v3.0) REWORKED. Section 17 flags the v2.0 tutorial for rework (its steps 4, 5, 8 and 9 teach
// the v2 loop) and lists what the rework needs: new step text at least in steps 4, 5, 8 and 9, a
// founding step for the town center early, a first order to complete, the rack taught at its
// starting size of 6, and the Step 8 overspend fix folded in (LOCKED ruling 7). The spec does
// not write the new text, so every caption below is BUILD WORDING for Stu to review (listed in the
// build note). Kept from v2.0: the seed "hearth", the Cottage plot (27, 24), the Sawmill plot
// (31, 25), autosave paused, Skip at every step, and the v2.1.1 off-plot safety net. Pure data and pure helpers
// only; the flow that runs the steps lives in tutorialFlow.ts.

import { NAME } from './config';
import { MAP_H, MAP_W, Terrain, type TerrainMap } from './types';

/** Section 17: the tutorial town's seed text. */
export const TUTORIAL_SEED = 'hearth';
/** Section 17: the centre tile; the camera starts centred on it. */
export const TUTORIAL_CENTRE = { x: 27, y: 27 };
/** (v3.0) The first rack, taught at the starting size of 6 (CASTLE uses all six). */
export const TUTORIAL_FIRST_RACK = ['A', 'C', 'E', 'L', 'S', 'T'];
/** (v3.0) The rack for the first Commission: two E's, so STEEL, TREES or STEER complete it. */
export const TUTORIAL_ORDER_RACK = ['E', 'R', 'E', 'T', 'S', 'L'];
/** (v3.0) The town center's founding spot on "hearth": meadow, beside the road to both plots. */
export const TUTORIAL_CENTER = { x: 25, y: 25 };

/**
 * Section 17: the two marked plots on the "hearth" map, as the spec gives them and as Boone's
 * find_tutorial_seed.mjs finds them on this terrain generator (checked Nov 22, 2026: identical).
 * That script takes the FIRST qualifying tile in reading order within 7 tiles of the centre;
 * the spec's prose says "nearest to the centre", which would pick (26, 27). The coordinates
 * are built as specified; the wording difference is reported as a disputed value.
 */
export const COTTAGE_PLOT = { x: 27, y: 24 };
/** The Sawmill plot is the top-left tile of the Sawmill's 2 by 2 footprint. */
export const SAWMILL_PLOT = { x: 31, y: 25 };
/** (v3.0) The road step's start marker: beside the town center and the Cottage plot. */
export const ROAD_START = { x: 27, y: 25 };
/** (v3.0) The Sawmill step's start marker: the tile where the second piece can start. */
export const SAWMILL_ROAD_START = { x: 28, y: 25 };

/**
 * The tiles the tutorial marks or builds on: the Cottage plot, the Sawmill's 2 x 2 footprint and
 * the road between them. The terrain bake keeps the mountain peak art off these on the tutorial
 * map, so the Sawmill is never drawn over the peak (render only; no rule uses this).
 */
export const TUTORIAL_MARKED_TILES: readonly (readonly [number, number])[] = [
  [27, 24], [27, 25], [27, 26], [27, 27], [27, 28],
  [28, 25], [29, 25], [30, 25], [31, 25], [32, 25], [31, 26], [32, 26],
  [25, 25], [26, 25], [25, 26], [26, 26],
];

const at = (map: TerrainMap, x: number, y: number) => (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H ? -1 : map.tiles[y * MAP_W + x]);

/**
 * The rule as Section 17 writes it, for the build report: the meadow tile with meadow on all
 * four sides nearest the centre, then the meadow tile beside forest at Chebyshev distance 4 or
 * more from it, nearest the centre.
 */
export function plotsByWrittenRule(map: TerrainMap): { cottage: { x: number; y: number }; sawmill: { x: number; y: number } | null } {
  const d = (x: number, y: number) => Math.hypot(x - TUTORIAL_CENTRE.x, y - TUTORIAL_CENTRE.y);
  const n4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let cottage = { x: TUTORIAL_CENTRE.x, y: TUTORIAL_CENTRE.y };
  let best = Infinity;
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      if (at(map, x, y) !== Terrain.Meadow || !n4.every(([a, b]) => at(map, x + a, y + b) === Terrain.Meadow)) continue;
      if (d(x, y) < best) {
        best = d(x, y);
        cottage = { x, y };
      }
    }
  let sawmill: { x: number; y: number } | null = null;
  best = Infinity;
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      if (at(map, x, y) !== Terrain.Meadow || !n4.some(([a, b]) => at(map, x + a, y + b) === Terrain.Forest)) continue;
      if (Math.max(Math.abs(x - cottage.x), Math.abs(y - cottage.y)) < 4) continue;
      if (d(x, y) < best) {
        best = d(x, y);
        sawmill = { x, y };
      }
    }
  return { cottage, sawmill };
}

/** Section 17 step 2: the six terrain labels pinned on the map, in caption order. */
export const LAND_ORDER = [Terrain.Meadow, Terrain.Forest, Terrain.Hill, Terrain.Marsh, Terrain.Thicket, Terrain.Water] as const;
export const LAND_LABELS = ['Meadow', 'Forest', 'Hill', 'Marsh', 'Thicket', 'Water'];

/**
 * Where each terrain label sits: for each type, the tile nearest the centre with the most
 * neighbours of the same type (so the label sits on the patch, not its edge), skipping the
 * plots and the intended road so no label covers them.
 */
export function landLabelTiles(map: TerrainMap): { x: number; y: number }[] {
  const reserved = new Set<string>();
  for (let y = 24; y <= 28; y++) reserved.add(`27,${y}`);
  for (const [x, y] of TUTORIAL_MARKED_TILES) reserved.add(`${x},${y}`);
  return LAND_ORDER.map((type) => {
    let pick = { x: TUTORIAL_CENTRE.x, y: TUTORIAL_CENTRE.y };
    let best = -Infinity;
    for (let y = 18; y <= 36; y++)
      for (let x = 18; x <= 36; x++) {
        if (at(map, x, y) !== type || reserved.has(`${x},${y}`)) continue;
        let same = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && at(map, x + dx, y + dy) === type) same++;
        const score = same * 2 - Math.hypot(x - TUTORIAL_CENTRE.x, y - TUTORIAL_CENTRE.y);
        if (score > best) {
          best = score;
          pick = { x, y };
        }
      }
    return pick;
  });
}

// ---------- the steps (Section 17: the wording here is the wording the game shows) ----------

export type FrameKind = 'read' | 'action' | 'finish';

/** What a step's pulsing gold outline points at (Section 17). */
export type Highlight =
  | 'rack'
  | 'submit'
  | 'message'
  | 'hud-resources'
  | 'road-tool'
  | 'cottage-card'
  | 'sawmill-card'
  | 'happiness'
  | 'hint'
  | null;

export interface Frame {
  /** Section 17 step number, 1 to 14 (v3.0). */
  step: number;
  /** Short step name, shown above the caption. */
  title: string;
  kind: FrameKind;
  /** One caption, or several lines shown together. */
  text: string | string[];
  highlight: Highlight;
  /** Step 2 only: which terrain label is lit (index into LAND_ORDER). */
  label?: number;
}

/** (v3.0) The reworked tour has 14 steps. */
export const STEP_COUNT = 14;

export const STEP_TITLES: Record<number, string> = {
  1: 'Welcome',
  2: 'The land',
  3: 'Your town center',
  4: 'Play a word',
  5: 'Reading the reward',
  6: 'What resources are for',
  7: 'A Commission',
  8: 'Lay a road piece',
  9: 'Place the Cottage',
  10: 'Workshops',
  11: 'Watch it pay',
  12: 'Hints and Lanterns',
  13: 'Happiness',
  14: 'Finish',
};

const LAND_CAPTIONS = [
  'Meadow: open grass. Roads and most buildings go here. The faint lines mark each tile.',
  'Forest: clear it for 2 Coins a tile, and the land can be built on. Forests slowly spread onto open land as you play.',
  'Hill: roads can cross it. The Quarry is built on it or beside it.',
  'Marsh: needs a bridge to cross it until you can drain it at Tier 2. Nothing is built on it.',
  'Thicket: too dense to use. Clearing it costs 6 Coins and 3 Lumber a tile. It spreads too, slowly.',
  'Water: bridges cross it. The Pier is built on land beside it. Now and then the river rises onto the meadow beside it.',
];

/** (v3.0) The road step's retry line (a piece was laid, but not beside the Cottage plot). */
export const STEP6_RETRY = 'That piece is laid and joins your network. Now lay one so a road tile sits right beside the marked Cottage plot.';
/** (v3.0) The Commission step's retry line (a valid word that did not meet the order). */
export const ORDER_RETRY = 'That word paid, but it has only one E. Your letters are back: spell a word with two E\'s, like the order asks.';

// Steps 9 and 10, the build steps (bug fix, Nov 22, 2026: a building placed off the marked plot
// used to stall the tutorial with no feedback).
/** Placement ghost reason in the build steps for a legal spot that is not the marked plot. */
export const OFF_PLOT_REASON = 'The glowing plot is the tutorial spot.';
/** Caption if a Cottage or Sawmill somehow stands off the plot (a safety net; the ghost blocks it). */
export const OFF_PLOT_CAPTION: Record<'cottage' | 'sawmill', string> = {
  cottage: 'That Cottage is off the tutorial spot. Choose Remove and tap the Cottage to take it away, then place a Cottage on the glowing plot.',
  sawmill: 'That Sawmill is off the tutorial spot. Choose Remove and tap the Sawmill to take it away, then place a Sawmill on the glowing plot.',
};
/** Message when Remove is used on a road or a building on its plot in the build steps. */
export const TUTORIAL_REMOVE_ONLY = 'In the tutorial, Remove only takes away a building placed off the glowing plot.';

/** Every frame of the tutorial, in order. Frame ids are stable names used by the flow. */
export const FRAMES: Record<string, Frame> = {
  welcome: {
    step: 1,
    title: STEP_TITLES[1],
    kind: 'read',
    highlight: null,
    text: `Welcome to ${NAME}. You build a town by playing words, and the town you build makes you better at words: buildings grow your rack, stamp your letters, and pay for the words your town asks for. This tour takes about three minutes, and you can skip it at any time.`,
  },
  ...Object.fromEntries(
    LAND_CAPTIONS.map((text, i) => [`land${i}`, { step: 2, title: STEP_TITLES[2], kind: 'read', highlight: null, text, label: i } as Frame]),
  ),
  center: {
    step: 3,
    title: STEP_TITLES[3],
    kind: 'read',
    highlight: null,
    text: 'Every town is founded on a town center. It is free, it is your first building, and every road must connect back to it. It is also your Commission board: tap it any time to see the words your town is asking for.',
  },
  word: {
    step: 4,
    title: STEP_TITLES[4],
    kind: 'action',
    highlight: 'rack',
    text: 'These 6 letters are your rack. Tap letters to spell a word of 3 or more letters, then tap Submit. Try it now.',
  },
  reward: {
    step: 5,
    title: STEP_TITLES[5],
    kind: 'read',
    highlight: 'message',
    text: 'That message is your pay slip. Words pay Coins, Knowledge and Magic. Longer words earn more Coins, vowels earn Knowledge, and the rare letters J, Q, X, Z, K and V earn Magic. Words never pay Lumber or Stone: your buildings make those.',
  },
  resources: {
    step: 6,
    title: STEP_TITLES[6],
    kind: 'read',
    highlight: 'hud-resources',
    text: [
      'Coins buy road pieces and most buildings.',
      'Lumber comes from Sawmills. Stone comes from Quarries. Both build bigger buildings.',
      'Knowledge unlocks new tiers as it adds up. Tier 2 needs 25 earned in total.',
      'Magic comes from rare letters and long words. It buys the Wizard Tower at Tier 3.',
    ],
  },
  order: {
    step: 7,
    title: STEP_TITLES[7],
    kind: 'action',
    highlight: 'rack',
    text: 'The town center posts three Commissions. Each asks for a word and pays a lump of what your next building needs. Orders never expire. Here is one: play a word with two E\'s. Your new letters can do it.',
  },
  road: {
    step: 8,
    title: STEP_TITLES[8],
    kind: 'action',
    highlight: 'road-tool',
    text: 'Buildings sit beside a road, and roads come in pieces of 3, 4 or 5 tiles. Choose Road, buy a 3 tile piece, and pick it from your bank. Tap the marked tile next to the town center to start the piece there, use Rotate to point it, then Confirm. A piece must touch your network, and nothing is placed until you Confirm.',
  },
  cottage: {
    step: 9,
    title: STEP_TITLES[9],
    kind: 'action',
    highlight: 'cottage-card',
    text: 'This is a Cottage. Its card says what it costs, what it does, and where it can go. Move the Cottage over the marked plot. Green means the spot is legal. Try the road or the hill: it turns red and tells you why.',
  },
  cottageDone: {
    step: 9,
    title: STEP_TITLES[9],
    kind: 'read',
    highlight: 'hud-resources',
    text: 'Population 3. A Cottage houses 3 people, and people are how your town reaches new tiers. Homes also make room for letters: your 2nd Cottage gives your rack a 7th tile, and your 4th an 8th.',
  },
  sawmill: {
    step: 10,
    title: STEP_TITLES[10],
    kind: 'action',
    highlight: 'sawmill-card',
    text: 'Words never pay Lumber, so your town needs a workshop. Lay another road piece from the marked tile so it ends beside the marked Sawmill plot, then place the Sawmill on the plot. It sits beside the forest it cuts.',
  },
  sawmillDone: {
    step: 10,
    title: STEP_TITLES[10],
    kind: 'read',
    highlight: null,
    text: 'A Sawmill pays 1 Lumber on every word. Every 3rd word it also stamps an Oak mark on one of your letters: play a word through that letter for 4 more Lumber. The Quarry does the same with Stone, and later the Market stamps Gilded letters that double a word\'s Coins.',
  },
  pay: {
    step: 11,
    title: STEP_TITLES[11],
    kind: 'action',
    highlight: 'rack',
    text: 'Play any word now, and watch the message: after the word\'s own pay comes the line from your town. Buildings pay on every word you submit, never on a timer, and only while their road connects to the town center.',
  },
  lanterns: {
    step: 12,
    title: STEP_TITLES[12],
    kind: 'read',
    highlight: 'hint',
    text: 'Stuck? The first Hint on a rack is free: it tells you the length of the longest word. After that, each Lantern places one letter of a guide word, up to 2 letters. You start with 3 Lanterns and earn one every 10 words. They never give away the whole word.',
  },
  happiness: {
    step: 13,
    title: STEP_TITLES[13],
    kind: 'read',
    highlight: 'happiness',
    text: 'This is happiness. Your town is at 51: every town starts at 50, and your Cottage added 1 because its road connects to the town center. Parks, the Library, the Tavern, the Town Hall, Piers and earned landmarks raise it. A Sawmill or Quarry within 2 tiles of a Cottage lowers it. Tier 3 needs happiness of 60.',
  },
  finish: {
    step: 14,
    title: STEP_TITLES[14],
    kind: 'finish',
    highlight: null,
    text: 'That is the whole loop: words earn Coins, Knowledge and Magic; Commissions and workshops pay for building; and buildings grow your rack and stamp your letters. Plan your roads: the map remembers. In your own town, quests give you one goal at a time, starting with First Words.',
  },
};

/** The order frames run in. */
export const FRAME_ORDER = [
  'welcome',
  'land0',
  'land1',
  'land2',
  'land3',
  'land4',
  'land5',
  'center',
  'word',
  'reward',
  'resources',
  'order',
  'road',
  'cottage',
  'cottageDone',
  'sawmill',
  'sawmillDone',
  'pay',
  'lanterns',
  'happiness',
  'finish',
] as const;
export type FrameId = (typeof FRAME_ORDER)[number];

/**
 * (v3.0) Section 17 wallet handling, with the Step 8 overspend fix folded in (LOCKED ruling 7):
 * in the build steps the tutorial keeps the wallet at or above the step building's cost plus one
 * 3 tile road piece, without comment, after every purchase. Extra pieces bought in the Sawmill
 * step can therefore never strand it. This replaces v2.0's practice grant and Coins top-up.
 */
export const ROAD_PIECE_COINS = 3;
