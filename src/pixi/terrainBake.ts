// Isometric terrain bake (Build Spec v2.0, Sections 2, 3, 10 and 13).
//
// The whole map is painted ONCE into one RenderTexture, shown as one Sprite. There are never
// 2,916 tile sprites: during the bake, tiles are drawn as texture fills inside a few Graphics
// objects, which are destroyed as soon as the texture is painted. The texture is painted again
// only when the ground itself changes (a forest tile is cleared) or the GPU context is lost;
// the stage is never rebuilt.
//
// Surfaces come from the approved Gemini terrain tiles and their variants (Section 3). The art
// pipeline (scripts/art/process_art.py) cut each Gemini tile into:
//   - a soft-edged "splat" of its top face (meadow, marsh, water), placed per tile with
//     overlap, so seams never show;
//   - a "props" stamp (forest trees, hill mounds, thicket brambles) that stands on the
//     tile's sampled ground colour.
// Which variant each tile shows, and whether it is mirrored, comes from terrainVariants.ts.
// Blending and decoration follow Section 3: biome edges are feathered, a seeded decoration pass
// adds flowers and pebbles, and the player never sees grid lines. The map's two front edges
// show the soil slab from the Gemini tiles.
//
// v2.0 terrain polish (Section 13, with Stu's ruling of Nov 22, 2026: blending is a general
// requirement of the pass, not only an edge treatment). The blending lives in the splat system:
//  - every tile on a terrain boundary spills a softer, fainter copy of its own splat across the
//    boundary, in both directions (water into land and land back over water), so no boundary
//    shows the diamond grid;
//  - forest, hill and thicket ground gets a wide, faint feather as well as its core colour;
//  - a light colour wash runs across the whole map;
//  - the Gemini edge pieces add bank detail on the front-facing banks (support, not the fix).
// Cluster-aware props (terrainClusters.ts): prop scale and density grow with patch size, big
// forest interiors are the Gemini canopy pieces, forest edges mix in the large tree, and every
// hill patch of 4+ tiles gets the Gemini mountain peak at its centre (very large patches add
// smaller peaks on their deep interior). Building grounding lives in buildingLayer.ts.

import {
  Assets,
  BlurFilter,
  Container,
  Graphics,
  Matrix,
  Rectangle,
  RenderTexture,
  Sprite,
  type IRenderer,
  type Texture,
} from 'pixi.js';
import { mulberry32 } from '../game/terrain';
import { MAP_H, MAP_W, TILE_H, TILE_W, Terrain, WORLD_H, WORLD_W, type TerrainMap } from '../game/types';
import terrainMeta from '../assets/terrain/terrain.json';
import { gridToWorld, tileCentre } from './camera';
import { TERRAIN_URLS } from './terrainAssets';
import { POLISH_ART, VARIANTS, effectiveTiles, planVariants, tileHash } from './terrainVariants';
import { CANOPY_MIN_TILES, findClusters, peakSites, propScale } from './terrainClusters';
import { TUTORIAL_MARKED_TILES, TUTORIAL_SEED } from '../game/tutorial';

/** Room above the map's top vertex for trees and hills on the back rows. */
export const BAKE_PAD_TOP = 170; // v2.0: room for a mountain peak on the back rows
/** Height of the soil slab drawn under the map's two front edges. */
export const EDGE_DEPTH = 22;

interface VariantArt {
  kind: 'splat' | 'props';
  file: string;
  width: number;
  height: number;
  span?: number;
  anchorX?: number;
  anchorY?: number;
}
const TYPES = terrainMeta.types as Record<string, { groundColor: string; soilColor: string; bankColor?: string }>;
const ART = terrainMeta.variants as unknown as Record<string, VariantArt>;
const DENSITY = terrainMeta.textureDensity;
/** Measured anchors of the Section 13 polish pieces (written by process_art.py). */
const POLISH_META = ((terrainMeta as unknown as { polish?: Record<string, { anchorX: number; anchorY: number; baseWidth: number; height?: number }> }).polish ?? {});

const hex = (c: string) => parseInt(c.replace('#', ''), 16);
/** Blends two colours (k = 0 gives a, 1 gives b). */
function mix(a: number, b: number, k: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
export const COLORS = {
  meadow: hex(TYPES.meadow.groundColor),
  forest: hex(TYPES.forest.groundColor),
  hill: hex(TYPES.hill.groundColor),
  marsh: hex(TYPES.marsh.groundColor),
  thicket: hex(TYPES.thicket.groundColor),
  water: hex(TYPES.water.groundColor),
  bank: hex(TYPES.water.bankColor ?? '#98c9cd'),
  soil: hex(TYPES.meadow.soilColor),
  shadow: 0x1f3324,
  flowers: [0xfff6e0, 0xf6d55c, 0xeea0b8, 0xc9b3f0],
  pebble: 0xc9c4b6,
};

export type TerrainTextures = Record<string, Texture>;

/** Loads every variant's art once (cached by Pixi Assets for any later rebake). */
export async function loadTerrainTextures(): Promise<TerrainTextures> {
  const keys: string[] = [];
  for (const v of VARIANTS) {
    const art = ART[v.id];
    const url = art && TERRAIN_URLS[art.file];
    if (!url) throw new Error(`Terrain variant ${v.id} has no processed art (run scripts/art/process_art.py).`);
    const key = 'terrain-' + v.id;
    if (!Assets.resolver.hasKey(key)) Assets.add({ alias: key, src: url }); // object form: no v7.2 deprecation warning
    keys.push(key);
  }
  // Section 13 polish pieces: loaded only when their processed art is in the folder.
  const polish = POLISH_ART.filter((a) => TERRAIN_URLS[a.file]);
  for (const a of polish) {
    const key = 'polish-' + a.id;
    if (!Assets.resolver.hasKey(key)) Assets.add({ alias: key, src: TERRAIN_URLS[a.file] });
    keys.push(key);
  }
  const loaded = (await Assets.load(keys)) as Record<string, Texture>;
  const out: TerrainTextures = {};
  for (const v of VARIANTS) {
    const t = loaded['terrain-' + v.id];
    if (!t || !t.valid || t.width <= 0 || t.height <= 0) throw new Error(`Terrain art ${v.id} did not load.`);
    out[v.id] = t;
  }
  for (const a of polish) {
    const t = loaded['polish-' + a.id];
    if (t && t.valid && t.width > 0) out['polish-' + a.id] = t;
  }
  return out;
}

/** The polish piece for a use, if its art has arrived (Section 13), else null. */
function polishFor(tex: TerrainTextures, use: string, pick: number): { anchorX: number; anchorY: number; baseWidth: number; tiles: number; texture: Texture } | null {
  const ready = POLISH_ART.filter((a) => a.use === use && tex['polish-' + a.id]);
  if (!ready.length) return null;
  const art = ready[Math.floor(pick * ready.length) % ready.length];
  const texture = tex['polish-' + art.id];
  const m = POLISH_META[art.id];
  return { anchorX: m?.anchorX ?? art.anchorX, anchorY: m?.anchorY ?? art.anchorY, baseWidth: m?.baseWidth ?? texture.width, tiles: art.tiles, texture };
}

// ---------- drawing helpers ----------

/** Draws a texture into a rectangle as a texture fill (optionally mirrored, optionally faint). */
function stamp(g: Graphics, tex: Texture, x: number, y: number, w: number, h: number, flipX = false, alpha = 1): void {
  const sx = (w / tex.width) * (flipX ? -1 : 1);
  const m = new Matrix(sx, 0, 0, h / tex.height, flipX ? x + w : x, y);
  g.beginTextureFill({ texture: tex, matrix: m, alpha });
  g.drawRect(x, y, w, h);
  g.endFill();
}

/** Stamps a polish piece so its ground part is `tiles` tiles wide, anchored at world (cx, cy). */
function stampPolish(g: Graphics, p: NonNullable<ReturnType<typeof polishFor>>, cx: number, cy: number, tiles: number, flip: boolean, alpha = 1): void {
  const k = (TILE_W * tiles) / p.baseWidth;
  const w = p.texture.width * k;
  const h = p.texture.height * k;
  const ax = flip ? 1 - p.anchorX : p.anchorX;
  stamp(g, p.texture, cx - ax * w, cy - p.anchorY * h, w, h, flip, alpha);
}

/** An irregular, roughly diamond-shaped blob around a tile centre (for feathered colour). */
function blob(cx: number, cy: number, scale: number, rand: () => number): number[] {
  const pts: number[] = [];
  const sides = 10;
  const turn = rand() * Math.PI * 2;
  for (let i = 0; i < sides; i++) {
    const a = turn + (i / sides) * Math.PI * 2;
    const r = scale * (0.82 + rand() * 0.36);
    pts.push(cx + Math.cos(a) * (TILE_W / 2) * r, cy + Math.sin(a) * (TILE_H / 2) * r);
  }
  return pts;
}

/** Tiles in back-to-front draw order (rows of equal x + y, left to right). */
function depthOrder(): [number, number][] {
  const out: [number, number][] = [];
  for (let d = 0; d <= MAP_W + MAP_H - 2; d++) {
    for (let x = Math.max(0, d - (MAP_H - 1)); x <= Math.min(MAP_W - 1, d); x++) out.push([x, d - x]);
  }
  return out;
}

/** The whole map's diamond (used to clip the ground and draw the soil edge). */
export function mapDiamond(): number[] {
  const t = gridToWorld(0, 0);
  const r = gridToWorld(MAP_W, 0);
  const b = gridToWorld(MAP_W, MAP_H);
  const l = gridToWorld(0, MAP_H);
  return [t.x, t.y, r.x, r.y, b.x, b.y, l.x, l.y];
}

// The four grid neighbours, with their screen direction (north and west are at the back).
const N4: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// ---------- the bake ----------

/** Uses a sharper texture when the GPU allows a big enough one (desktop GPUs: 8,192 px). */
function bakeResolution(renderer: IRenderer): number {
  const gl = (renderer as unknown as { gl?: WebGLRenderingContext }).gl;
  if (!gl) return 1;
  const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  return max >= 8192 ? 1.5 : 1;
}

export interface BakedTerrain {
  sprite: Sprite;
  texture: RenderTexture;
}

/** (v3.0) Section 2: grid lines are 1 pixel, black at 10 percent (proposed), baked with the terrain. */
export const GRID_ALPHA = 0.1;

/** How far (in tiles) a repaint reaches around a changed tile: its blends and props spill this far. */
const REPAINT_REACH = 2.6;

/**
 * Bakes the terrain into one RenderTexture (Section 10). With `into` and `region`, it repaints only
 * the area around the listed tiles inside the existing texture, in place (Sections 4, 10 and 20:
 * clearing, draining, growth and overflow repaint the changed tiles' areas; never a whole rebake).
 */
export function bakeTerrain(
  renderer: IRenderer,
  map: TerrainMap,
  cleared: Uint8Array,
  tex: TerrainTextures,
  opts: { into?: BakedTerrain; region?: number[] } = {},
): BakedTerrain {
  const resolution = bakeResolution(renderer);
  const height = WORLD_H + BAKE_PAD_TOP + EDGE_DEPTH + 4;
  const texture = opts.into ? opts.into.texture : RenderTexture.create({ width: WORLD_W, height, resolution });
  const rand = mulberry32(map.seed ^ 0x150);
  const order = depthOrder();
  const tiles = effectiveTiles(map.tiles, cleared);
  const plan = planVariants(map.seed, tiles);
  const clusters = findClusters(tiles);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H ? -1 : tiles[y * MAP_W + x]);
  const h = (x: number, y: number, salt: number) => tileHash(map.seed, x, y, salt);

  // Everything is drawn in world coordinates inside `root`, shifted down by the top padding.
  const root = new Container();
  root.position.set(0, BAKE_PAD_TOP);

  // ---- 1. Ground, clipped to the map's diamond
  const clip = new Graphics().beginFill(0xffffff).drawPolygon(mapDiamond()).endFill();
  const ground = new Container();
  ground.mask = clip;
  root.addChild(clip, ground);
  ground.addChild(new Graphics().beginFill(COLORS.meadow).drawPolygon(mapDiamond()).endFill());

  /** One splat of a variant, centred at world (cx, cy). */
  const splatAt = (g: Graphics, id: string, cx: number, cy: number, scale: number, flip: boolean, alpha = 1) => {
    const art = ART[id];
    const w = TILE_W * (art.span ?? 1.35) * scale;
    const hh = TILE_H * (art.span ?? 1.35) * scale;
    stamp(g, tex[id], cx - w / 2, cy - hh / 2, w, hh, flip, alpha);
  };

  /** Splats for tiles of one terrain type (each tile's own variant), or calm meadow under all. */
  const splats = (type: number | 'under'): Graphics => {
    const g = new Graphics();
    for (const [x, y] of order) {
      const i = y * MAP_W + x;
      const c = tileCentre(x, y);
      if (type === 'under') {
        if (at(x, y) === Terrain.Meadow) continue;
        splatAt(g, h(x, y, 3) < 0.5 ? 'meadow-1' : 'meadow-3', c.x + (h(x, y, 5) - 0.5) * 4, c.y, 1, h(x, y, 4) < 0.5);
        continue;
      }
      if (at(x, y) !== type) continue;
      splatAt(g, plan[i].entry.id, c.x + (h(x, y, 5) - 0.5) * 4, c.y, 1, plan[i].flip);
    }
    return g;
  };

  /**
   * Section 13 blending, in the splat system: every tile of `type` that borders a tile of
   * another kind (`into` decides which) spills a fainter, slightly smaller copy of its own splat
   * part of the way across the boundary, with a little seeded jitter, so the boundary reads as a
   * soft, irregular edge instead of a row of diamonds.
   */
  const spills = (type: number, into: (t: number) => boolean, reach: number, alpha: number, salt: number): Graphics => {
    const g = new Graphics();
    for (const [x, y] of order) {
      if (at(x, y) !== type) continue;
      const i = y * MAP_W + x;
      const id = type === Terrain.Meadow ? (h(x, y, 3) < 0.5 ? 'meadow-1' : 'meadow-3') : plan[i].entry.id;
      for (const [dx, dy] of N4) {
        const t = at(x + dx, y + dy);
        if (t === -1 || t === type || !into(t)) continue;
        const r = reach * (0.8 + h(x + dx, y + dy, salt) * 0.4);
        const c = tileCentre(x + dx * r, y + dy * r);
        const jx = (h(x, y, salt + 1) - 0.5) * 10;
        const jy = (h(x, y, salt + 2) - 0.5) * 6;
        splatAt(g, id, c.x + jx, c.y + jy, 0.78 + h(x, y, salt + 3) * 0.2, h(x, y, salt + 4) < 0.5, alpha);
      }
    }
    return g;
  };
  const isWet = (t: number) => t === Terrain.Water || t === Terrain.Marsh;
  const isLand = (t: number) => t !== Terrain.Water;

  // Meadow: every meadow tile shows its own variant; other tiles get calm meadow underneath.
  ground.addChild(splats('under'));
  ground.addChild(splats(Terrain.Meadow));

  // Feathered colour for terrains whose surface is their sampled Gemini ground colour.
  const feathered = (types: [number, number, number, number][], strength: number): Container => {
    const g = new Graphics();
    for (const [x, y] of order) {
      const t = at(x, y);
      for (const [type, color, scale, alpha] of types) {
        if (t !== type) continue;
        const c = tileCentre(x, y);
        g.beginFill(color, alpha).drawPolygon(blob(c.x, c.y, scale, rand)).endFill();
      }
    }
    const holder = new Container();
    holder.addChild(g);
    holder.filters = [new BlurFilter(strength, 3, resolution)];
    holder.filterArea = new Rectangle(0, BAKE_PAD_TOP, WORLD_W, WORLD_H);
    return holder;
  };
  // Forest, hill and thicket ground: a wide, faint feather first (the soft transition), then the
  // core colour.
  ground.addChild(
    feathered(
      [
        [Terrain.Hill, COLORS.hill, 1.75, 0.45],
        [Terrain.Forest, COLORS.forest, 1.75, 0.45],
        [Terrain.Thicket, mix(COLORS.thicket, COLORS.meadow, 0.5), 1.7, 0.35],
      ],
      14,
    ),
  );
  ground.addChild(
    feathered(
      [
        [Terrain.Hill, COLORS.hill, 1.15, 1],
        [Terrain.Forest, COLORS.forest, 1.15, 1],
        [Terrain.Thicket, COLORS.thicket, 0.92, 1], // inside the pulled-in bramble edge, so no dark rim shows
      ],
      6,
    ),
  );
  // Marsh: a wide, well-blurred wash, its core colour, its splats, then spills across every edge.
  ground.addChild(feathered([[Terrain.Marsh, mix(COLORS.marsh, COLORS.meadow, 0.45), 1.6, 1]], 12));
  ground.addChild(feathered([[Terrain.Marsh, COLORS.marsh, 1.05, 1]], 7));
  ground.addChild(splats(Terrain.Marsh));
  ground.addChild(spills(Terrain.Marsh, (t) => t !== Terrain.Water, 0.42, 0.5, 31));
  // Water: the lighter bank (Section 3), the river colour, the Gemini water face, then spills.
  ground.addChild(feathered([[Terrain.Water, mix(COLORS.bank, COLORS.meadow, 0.35), 1.85, 1]], 12));
  ground.addChild(feathered([[Terrain.Water, COLORS.bank, 1.45, 1]], 8));
  ground.addChild(feathered([[Terrain.Water, COLORS.water, 1.05, 1]], 4));
  ground.addChild(splats(Terrain.Water));
  ground.addChild(spills(Terrain.Water, isLand, 0.36, 0.4, 41));
  // The shore pass: land spills back over the water and marsh edge (the other direction), so the
  // two sides of every wet boundary meet in a gradient rather than a line.
  ground.addChild(spills(Terrain.Meadow, isWet, 0.28, 0.18, 51));
  ground.addChild(spills(Terrain.Marsh, (t) => t === Terrain.Water, 0.3, 0.3, 61));

  // ---- Section 13 edge pieces (support): bank detail on the front-facing banks. The Gemini
  // pieces have land at their lower left, which is a land tile to the south (+y); mirrored, a
  // land tile to the east (+x). Back banks (north, west) are hidden behind the water's far side
  // and keep the splat blend only.
  const edges = new Graphics();
  for (const [x, y] of order) {
    const t = at(x, y);
    if (t !== Terrain.Water && t !== Terrain.Marsh) continue;
    for (const [dx, dy, flip] of [[0, 1, false], [1, 0, true]] as const) {
      const n = at(x + dx, y + dy);
      if (n !== Terrain.Meadow) continue; // both pieces show grass on their land side
      // About a quarter of the meadow banks, so the art never
      // repeats in a row; the marsh piece smaller and fainter (it carries reeds, not colour).
      const wet = t === Terrain.Water;
      if (h(x, y, 71 + dx) >= 0.25) continue;
      const piece = polishFor(tex, wet ? 'waterEdge' : 'marshEdge', h(x, y, 73));
      if (!piece) continue;
      const c = tileCentre(x + dx * 0.5, y + dy * 0.5);
      const size = piece.tiles * (wet ? 0.75 + h(x, y, 74) * 0.45 : 0.7 + h(x, y, 74) * 0.25);
      stampPolish(edges, piece, c.x + (h(x, y, 75) - 0.5) * 12, c.y, size, flip, wet ? 0.75 : 0.6);
    }
  }
  ground.addChild(edges);

  // ---- Section 13: colour blending pass across the whole map. Every dry tile's own colour is
  // washed very lightly over its neighbours, so biome colours harmonise instead of meeting hard.
  // Water and marsh are not wash sources: they blend through their spills, and a wash over them
  // greys the river and flattens the marsh reeds.
  const wash = new Graphics();
  const washColor: Record<number, number> = {
    [Terrain.Meadow]: COLORS.meadow,
    [Terrain.Forest]: COLORS.forest,
    [Terrain.Hill]: COLORS.hill,
    [Terrain.Marsh]: COLORS.marsh,
    [Terrain.Thicket]: COLORS.thicket,
  };
  for (const [x, y] of order) {
    const t = at(x, y);
    if (t === Terrain.Water || t === Terrain.Marsh) continue;
    const c = tileCentre(x, y);
    wash.beginFill(washColor[t], 0.14).drawPolygon(blob(c.x, c.y, 1.6, rand)).endFill();
  }
  // Rock ground under each mountain peak, so the peak's base sits in the hill rather than on it.
  // The peak's outline comes from the processed art, so a re-run of the pipeline keeps it on its hill.
  const pm = POLISH_META['hill-peak'];
  const keepClear = map.seedText.trim().toLowerCase() === TUTORIAL_SEED ? new Set(TUTORIAL_MARKED_TILES.map(([x, y]) => y * MAP_W + x)) : undefined;
  const peaks = peakSites(clusters, pm?.height && pm.baseWidth ? { aspect: pm.height / pm.baseWidth, anchorY: pm.anchorY } : undefined, keepClear);
  for (const p of peaks) {
    const c = tileCentre(p.x, p.y);
    wash.beginFill(0x9a8f80, 0.55).drawPolygon(blob(c.x, c.y, p.tiles * 0.55, rand)).endFill();
  }
  const washHolder = new Container();
  washHolder.addChild(wash);
  washHolder.filters = [new BlurFilter(16, 3, resolution)];
  washHolder.filterArea = new Rectangle(0, BAKE_PAD_TOP, WORLD_W, WORLD_H);
  ground.addChild(washHolder);

  // ---- 2. Soil slab under the two front edges (the Gemini tiles' soil)
  const edge = new Graphics();
  const l = gridToWorld(0, MAP_H);
  const b = gridToWorld(MAP_W, MAP_H);
  const r = gridToWorld(MAP_W, 0);
  edge.beginFill(COLORS.soil).drawPolygon([l.x, l.y, b.x, b.y, b.x, b.y + EDGE_DEPTH, l.x, l.y + EDGE_DEPTH]).endFill();
  edge.beginFill(COLORS.soil).drawPolygon([b.x, b.y, r.x, r.y, r.x, r.y + EDGE_DEPTH, b.x, b.y + EDGE_DEPTH]).endFill();
  edge.beginFill(0x000000, 0.18).drawPolygon([b.x, b.y, r.x, r.y, r.x, r.y + EDGE_DEPTH, b.x, b.y + EDGE_DEPTH]).endFill();
  edge.beginFill(0x000000, 0.25).drawPolygon([l.x, l.y + EDGE_DEPTH - 4, b.x, b.y + EDGE_DEPTH - 4, b.x, b.y + EDGE_DEPTH, l.x, l.y + EDGE_DEPTH]).endFill();
  edge.beginFill(0x000000, 0.32).drawPolygon([b.x, b.y + EDGE_DEPTH - 4, r.x, r.y + EDGE_DEPTH - 4, r.x, r.y + EDGE_DEPTH, b.x, b.y + EDGE_DEPTH]).endFill();
  root.addChild(edge);

  // ---- 3. Seeded decoration pass (Section 3): pebbles on hills
  const decor = new Graphics();
  for (const [x, y] of order) {
    if (at(x, y) !== Terrain.Hill || rand() >= 0.4) continue;
    const c = tileCentre(x, y);
    const px = c.x + (rand() - 0.5) * TILE_W * 0.6;
    const py = c.y + (rand() - 0.5) * TILE_H * 0.6;
    decor.beginFill(COLORS.shadow, 0.2).drawEllipse(px + 1, py + 1, 2.6, 1.6).endFill();
    decor.beginFill(COLORS.pebble).drawEllipse(px, py, 2.4, 1.5).endFill();
  }
  root.addChild(decor);

  // ---- 4. Props (trees, hill mounds, brambles, peaks), back to front, cluster-aware (Section 13)
  const props = new Graphics();
  const peakAt = new Map(peaks.map((p) => [p.y * MAP_W + p.x, p]));
  // Mounds under or right in front of a peak are left out, so the peak reads as one mountain.
  const underPeak = (x: number, y: number) => peaks.some((p) => Math.hypot(x - p.x, y - p.y) < p.tiles * 0.62);
  const stampArt = (id: string, x: number, y: number, scale: number, flip: boolean, offX = 0, offY = 0, alpha = 1) => {
    const art = ART[id];
    const k = (scale * (0.92 + h(x, y, 7) * 0.16)) / DENSITY;
    const w = art.width * k;
    const hh = art.height * k;
    const c = tileCentre(x + offX, y + offY);
    const ax = flip ? 1 - (art.anchorX ?? 0.5) : art.anchorX ?? 0.5;
    stamp(props, tex[id], c.x - ax * w, c.y - (art.anchorY ?? 0.5) * hh, w, hh, flip, alpha);
  };
  for (const [x, y] of order) {
    const i = y * MAP_W + x;
    const t = at(x, y);
    if (t !== Terrain.Forest && t !== Terrain.Thicket && t !== Terrain.Hill) continue;
    const pick = plan[i];
    const id = clusters.patch[i];
    const size = clusters.size[id];
    const depth = clusters.depth[i];
    const grow = propScale(size, depth);
    const big = Math.min(1, (size - 1) / 15);

    if (t === Terrain.Hill) {
      const peak = peakAt.get(i);
      if (peak) {
        // The Gemini mountain peak (Stu-approved as generated). Until it is in the folder, the
        // rockiest approved hill art, scaled to the patch, stands in.
        const piece = polishFor(tex, 'hillPeak', h(x, y, 23));
        const c = tileCentre(x, y);
        if (piece) stampPolish(props, piece, c.x, c.y, peak.tiles, pick.flip);
        else stampArt('hill-4', x, y, 0.8 * peak.tiles, pick.flip);
        continue;
      }
      if (underPeak(x, y)) continue;
      // Foothill mounds on about a third of the tiles (always on the rockiest centre tiles). In
      // big patches the mounds grow, so fewer are drawn and the patch reads as rolling ground.
      if (h(x, y, 6) >= (pick.entry.where && !big ? 1 : 0.32 * (1 - 0.5 * big))) continue;
      stampArt(pick.entry.id, x, y, 1.15 * (1 + 0.6 * (grow - 1)), pick.flip);
      continue;
    }

    if (t === Terrain.Forest) {
      // Big forests read as one canopy: inside the edge, the Gemini canopy pieces on every other
      // tile, so the crowns overlap into one continuous, lighter canopy.
      if (size >= CANOPY_MIN_TILES && depth >= 2) {
        if ((x + y) % 2 === 1) continue;
        const piece = polishFor(tex, 'forestCanopy', h(x, y, 24));
        const c = tileCentre(x, y);
        if (piece) stampPolish(props, piece, c.x + (h(x, y, 26) - 0.5) * 6, c.y, piece.tiles * (0.95 + h(x, y, 27) * 0.15), pick.flip);
        else stampArt(pick.entry.id === 'forest-2' ? 'forest-1' : pick.entry.id, x, y, 1.5 * grow, pick.flip);
        continue;
      }
      // Forest edges are thinned: about one tile in five shows only its ground (lighter treatment).
      if (h(x, y, 8) < 0.2) continue;
      // The large single tree stands on some edge tiles and on most lone forest tiles.
      const lone = size <= 2;
      const large = h(x, y, 25) < (lone ? 0.6 : 0.22) ? polishFor(tex, 'treeLarge', h(x, y, 28)) : null;
      if (large) {
        const c = tileCentre(x, y);
        stampPolish(props, large, c.x, c.y, large.tiles * (0.9 + h(x, y, 29) * 0.2) * Math.min(1.2, grow), pick.flip);
      } else stampArt(pick.entry.id, x, y, grow, pick.flip);
      continue;
    }

    // Thicket: scaled with its patch. Edge tiles are drawn a little smaller and pulled toward the
    // patch, so the bramble mat ends in a ragged, soft edge instead of a hard square.
    if (depth >= 2 && size >= CANOPY_MIN_TILES && (x + y) % 2 === 1) continue;
    if (depth === 1) {
      const cen = clusters.centre[id];
      const dx = Math.sign(cen.x - x) * 0.14;
      const dy = Math.sign(cen.y - y) * 0.14;
      stampArt(pick.entry.id, x, y, 0.84 * grow, pick.flip, dx, dy, 0.92);
    } else stampArt(pick.entry.id, x, y, size >= CANOPY_MIN_TILES ? 1.3 * grow : grow, pick.flip);
  }
  root.addChild(props);

  // ---- (v3.0) Section 2: faint grid lines on every tile edge, the one exception to the soft look.
  const grid = new Graphics();
  grid.lineStyle({ width: 1, color: 0x000000, alpha: GRID_ALPHA });
  const corner = gridToWorld;
  for (let k = 0; k <= MAP_W; k++) {
    const a = corner(k, 0);
    const b = corner(k, MAP_H);
    grid.moveTo(a.x, a.y).lineTo(b.x, b.y);
  }
  for (let k = 0; k <= MAP_H; k++) {
    const a = corner(0, k);
    const b = corner(MAP_W, k);
    grid.moveTo(a.x, a.y).lineTo(b.x, b.y);
  }
  root.addChild(grid);

  if (opts.into && opts.region) {
    // Repaint in place: only the changed tiles' areas are drawn over the existing texture.
    const mask = new Graphics().beginFill(0xffffff);
    for (const i of opts.region) {
      const c = tileCentre(i % MAP_W, Math.floor(i / MAP_W));
      const w = (TILE_W / 2) * REPAINT_REACH;
      const hh = (TILE_H / 2) * REPAINT_REACH;
      // The area reaches higher above the tile than below it, for the props that stand on it.
      mask.drawPolygon([c.x, c.y - hh - TILE_H * 1.5, c.x + w, c.y, c.x, c.y + hh, c.x - w, c.y]);
    }
    mask.endFill();
    root.addChild(mask);
    root.mask = mask;
    renderer.render(root, { renderTexture: texture, clear: false });
    root.destroy({ children: true });
    return opts.into;
  }

  renderer.render(root, { renderTexture: texture, clear: true });
  root.destroy({ children: true });

  const sprite = new Sprite(texture);
  sprite.eventMode = 'none';
  sprite.position.set(0, -BAKE_PAD_TOP);
  return { sprite, texture };
}

// ---------- small live layers (not part of the bake) ----------

/**
 * Section 5: long-word flower patches (decoration only). Drawn on their own small layer so a
 * new patch never forces the big terrain texture to be baked again.
 */
export function drawFlowers(g: Graphics, flowers: { x: number; y: number }[], seed: number): void {
  g.clear();
  for (const f of flowers) {
    const rand = mulberry32(seed ^ (f.x * 73856093) ^ (f.y * 19349663));
    const c = tileCentre(f.x, f.y);
    for (let k = 0; k < 9; k++) {
      const u = rand() - 0.5;
      const v = rand() - 0.5;
      const x = c.x + (u - v) * TILE_W * 0.55;
      const y = c.y + (u + v) * TILE_H * 0.55;
      g.beginFill(COLORS.shadow, 0.18).drawCircle(x, y + 0.8, 2).endFill();
      g.beginFill(COLORS.flowers[k % COLORS.flowers.length]).drawCircle(x, y, 1.8).endFill();
      g.beginFill(0xf2c94c).drawCircle(x, y, 0.6).endFill();
    }
  }
}

/**
 * (v3.0) Section 20: flood gravel deposits, on the same small live layer as the flowers.
 * PLACEHOLDER art (a scatter of grey stones) until a Gemini gravel piece is drawn.
 */
export function drawGravel(g: Graphics, gravel: Uint8Array, seed: number): void {
  for (let i = 0; i < gravel.length; i++) {
    if (!gravel[i]) continue;
    const x0 = i % MAP_W;
    const y0 = Math.floor(i / MAP_W);
    const rand = mulberry32(seed ^ (x0 * 2654435761) ^ (y0 * 40503));
    const c = tileCentre(x0, y0);
    g.beginFill(0x8f877a, 0.55).drawEllipse(c.x, c.y, TILE_W * 0.34, TILE_H * 0.3).endFill();
    for (let k = 0; k < 14; k++) {
      const u = rand() - 0.5;
      const v = rand() - 0.5;
      const x = c.x + (u - v) * TILE_W * 0.5;
      const y = c.y + (u + v) * TILE_H * 0.5;
      const r = 1.6 + rand() * 2.2;
      g.beginFill(COLORS.shadow, 0.2).drawEllipse(x, y + 1, r * 1.2, r * 0.7).endFill();
      g.beginFill(k % 3 === 0 ? 0xb8b0a2 : k % 3 === 1 ? 0x9c9486 : 0xcdc6b8).drawEllipse(x, y, r, r * 0.7).endFill();
    }
  }
}

/** Spots on water for the animated shimmer (the ticker's only terrain job). */
export function shimmerSpots(map: TerrainMap, max = 90): { x: number; y: number; phase: number; len: number }[] {
  const rand = mulberry32(map.seed ^ 0x51a7);
  const water: number[] = [];
  for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === Terrain.Water) water.push(i);
  const out: { x: number; y: number; phase: number; len: number }[] = [];
  for (let k = 0; k < Math.min(max, water.length); k++) {
    const i = water[Math.floor(rand() * water.length)];
    const c = tileCentre(i % MAP_W, Math.floor(i / MAP_W));
    out.push({
      x: c.x + (rand() - 0.5) * TILE_W * 0.4,
      y: c.y + (rand() - 0.5) * TILE_H * 0.4,
      phase: rand() * Math.PI * 2,
      len: 8 + rand() * 8,
    });
  }
  return out;
}
