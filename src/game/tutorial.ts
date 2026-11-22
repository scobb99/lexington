// The tutorial's fixed data (Build Spec v2.0, Section 17): the seed, the first rack, the
// marked plots, and every step with the exact text the game shows. Pure data and pure helpers
// only; the flow that runs the steps lives in tutorialFlow.ts.

import { NAME } from './config';
import { MAP_H, MAP_W, Terrain, type TerrainMap } from './types';

/** Section 17: the tutorial town's seed text. */
export const TUTORIAL_SEED = 'hearth';
/** Section 17: the centre tile; the camera starts centred on it. */
export const TUTORIAL_CENTRE = { x: 27, y: 27 };
/** Section 17: the first rack, in this order. Later racks are drawn normally. */
export const TUTORIAL_FIRST_RACK = ['A', 'C', 'E', 'E', 'L', 'R', 'S', 'T'];

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
/** Section 17 step 6: the start marker, a meadow tile 4 tiles from the Cottage plot. */
export const ROAD_START = { x: 27, y: 28 };

/**
 * The tiles the tutorial marks or builds on: the Cottage plot, the Sawmill's 2 x 2 footprint and
 * the road between them. The terrain bake keeps the mountain peak art off these on the tutorial
 * map, so the Sawmill is never drawn over the peak (render only; no rule uses this).
 */
export const TUTORIAL_MARKED_TILES: readonly (readonly [number, number])[] = [
  [27, 24], [27, 25], [27, 26], [27, 27], [27, 28],
  [28, 25], [29, 25], [30, 25], [31, 25], [32, 25], [31, 26], [32, 26],
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
  for (const [x, y] of [[28, 25], [29, 25], [30, 25], [31, 25], [32, 25], [31, 26], [32, 26]]) reserved.add(`${x},${y}`);
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
  | null;

export interface Frame {
  /** Section 17 step number, 1 to 11. */
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

export const STEP_TITLES: Record<number, string> = {
  1: 'Welcome',
  2: 'The land',
  3: 'Play a word',
  4: 'Reading the reward',
  5: 'What resources are for',
  6: 'Build a road',
  7: 'Place the Cottage',
  8: 'Production buildings',
  9: 'Watch it pay',
  10: 'Happiness',
  11: 'Finish',
};

const LAND_CAPTIONS = [
  'Meadow: open grass. Roads and most buildings go here.',
  'Forest: clear it for 2 Coins a tile, and the land can be built on.',
  'Hill: roads can cross it. The Quarry is built on it or beside it.',
  'Marsh: needs a bridge to cross it until you can drain it at Tier 2. Nothing is built on it.',
  'Thicket: too dense to use. Clearing it costs 6 Coins and 3 Lumber a tile.',
  'Water: bridges cross it. The Pier is built on land beside it.',
];

export const STEP6_RETRY = 'That road is built and paid for. Now draw one that ends beside the marked Cottage plot.';

// Steps 7 and 8, the build steps (bug fix, Nov 22, 2026: a building placed off the marked plot
// used to stall the tutorial with no feedback). These three lines are build wording; the spec
// gives the first one ("The glowing plot is the tutorial spot.") and the intent of the others.
/** Placement ghost reason in steps 7 and 8 for a legal spot that is not the marked plot. */
export const OFF_PLOT_REASON = 'The glowing plot is the tutorial spot.';
/** Caption if a Cottage or Sawmill somehow stands off the plot (a safety net; the ghost blocks it). */
export const OFF_PLOT_CAPTION: Record<'cottage' | 'sawmill', string> = {
  cottage: 'That Cottage is off the tutorial spot. Choose Remove and tap the Cottage to take it away, then place a Cottage on the glowing plot.',
  sawmill: 'That Sawmill is off the tutorial spot. Choose Remove and tap the Sawmill to take it away, then place a Sawmill on the glowing plot.',
};
/** Message when Remove is used on a road or a building on its plot in steps 7 and 8. */
export const TUTORIAL_REMOVE_ONLY = 'In the tutorial, Remove only takes away a building placed off the glowing plot.';

/** Every frame of the tutorial, in order. Frame ids are stable names used by the flow. */
export const FRAMES: Record<string, Frame> = {
  welcome: {
    step: 1,
    title: STEP_TITLES[1],
    kind: 'read',
    highlight: null,
    text: `Welcome to ${NAME}. You build a town by playing words. Letters earn resources, resources build roads and buildings, and buildings earn more resources with every word. This tour takes about two minutes, and you can skip it at any time.`,
  },
  ...Object.fromEntries(
    LAND_CAPTIONS.map((text, i) => [`land${i}`, { step: 2, title: STEP_TITLES[2], kind: 'read', highlight: null, text, label: i } as Frame]),
  ),
  word: {
    step: 3,
    title: STEP_TITLES[3],
    kind: 'action',
    highlight: 'rack',
    text: 'These 8 letters are your rack. Tap letters to spell a word of 3 or more letters, then tap Submit. Try it now.',
  },
  reward: {
    step: 4,
    title: STEP_TITLES[4],
    kind: 'read',
    highlight: 'message',
    text: 'That message is your pay slip. It names every resource the word earned. Longer words earn more. Words with more consonants earn more Lumber and Stone, and vowels earn Knowledge. The rare letters, J, Q, X, Z, K, and V, earn Magic.',
  },
  resources: {
    step: 5,
    title: STEP_TITLES[5],
    kind: 'read',
    highlight: 'hud-resources',
    text: [
      'Coins pay for roads, bridges, and most buildings.',
      'Lumber builds buildings and bridges.',
      'Stone builds later buildings. The Quarry produces it.',
      'Knowledge unlocks new tiers as it adds up. Tier 2 needs 25 earned in total.',
      'Magic comes from rare letters and long words. It buys the Wizard Tower at Tier 3.',
    ],
  },
  road: {
    step: 6,
    title: STEP_TITLES[6],
    kind: 'action',
    highlight: 'road-tool',
    text: 'Buildings must sit beside a road. Drag from the marked tile toward the Cottage plot to draw a road. The bar shows the whole cost before you pay, and nothing is charged until you tap Confirm. If you change your mind, Cancel throws the road away for free.',
  },
  cottage: {
    step: 7,
    title: STEP_TITLES[7],
    kind: 'action',
    highlight: 'cottage-card',
    text: 'This is a Cottage. Its card says what it costs, what it does, and where it can go. Move the Cottage over the marked plot. Green means the spot is legal. Try the road or the hill: it turns red and tells you why.',
  },
  cottageDone: {
    step: 7,
    title: STEP_TITLES[7],
    kind: 'read',
    highlight: 'hud-resources',
    text: 'Population 3. A Cottage houses 3 people, and people are how your town reaches new tiers.',
  },
  grant: {
    step: 8,
    title: STEP_TITLES[8],
    kind: 'read',
    highlight: null,
    text: 'Here is 30 Coins and 10 Lumber of practice money, so you can try a Sawmill now. In a real town, you earn this by playing words.',
  },
  sawmill: {
    step: 8,
    title: STEP_TITLES[8],
    kind: 'action',
    highlight: 'sawmill-card',
    text: 'A Sawmill pays Lumber every time you submit a word. Extend the road so it ends beside the marked Sawmill plot, then place the Sawmill on the plot. It sits beside the forest it cuts.',
  },
  sawmillDone: {
    step: 8,
    title: STEP_TITLES[8],
    kind: 'read',
    highlight: null,
    text: 'The Quarry works the same way on a hill: it pays Stone with every word. You will build one in your own town.',
  },
  pay: {
    step: 9,
    title: STEP_TITLES[9],
    kind: 'action',
    highlight: 'rack',
    text: 'Play any word now, and watch the second part of the message. That is your Sawmill paying out. Buildings pay on every word you submit, never on a timer.',
  },
  happiness: {
    step: 10,
    title: STEP_TITLES[10],
    kind: 'read',
    highlight: 'happiness',
    text: 'This is happiness. Your town is at 51: every town starts at 50, and your Cottage added 1 because it sits beside a road. Parks, the Library, the Tavern, the Town Hall, and Piers raise it. A Sawmill or Quarry within 2 tiles of a Cottage lowers it. Happiness sets what your words pay: at 60 your words pay a tenth more, at 80 a fifth more, and it slides down the same way below 40.',
  },
  finish: {
    step: 11,
    title: STEP_TITLES[11],
    kind: 'finish',
    highlight: null,
    text: 'That is the whole game: words earn, roads connect, buildings produce, and happiness multiplies. In your own town, quests give you one goal at a time, starting with First Words.',
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
  'word',
  'reward',
  'resources',
  'road',
  'cottage',
  'cottageDone',
  'grant',
  'sawmill',
  'sawmillDone',
  'pay',
  'happiness',
  'finish',
] as const;
export type FrameId = (typeof FRAME_ORDER)[number];

/** Section 17 step 8: the practice money, applied when the player taps Next. */
export const PRACTICE_GRANT = { coins: 30, lumber: 10, stone: 0, knowledge: 0, magic: 0 };
/** Section 17 step 7: Coins are topped up to this, without comment, if below it. */
export const COTTAGE_TOP_UP = 10;
