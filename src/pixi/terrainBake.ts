// Isometric terrain bake (Build Spec v1.5, Sections 2, 3 and 10).
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
import { VARIANTS, effectiveTiles, planVariants, tileHash } from './terrainVariants';

/** Room above the map's top vertex for trees and hills on the back rows. */
export const BAKE_PAD_TOP = 56;
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

const hex = (c: string) => parseInt(c.replace('#', ''), 16);
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
    if (!Assets.resolver.hasKey(key)) Assets.add(key, url);
    keys.push(key);
  }
  const loaded = (await Assets.load(keys)) as Record<string, Texture>;
  const out: TerrainTextures = {};
  for (const v of VARIANTS) {
    const t = loaded['terrain-' + v.id];
    if (!t || !t.valid || t.width <= 0 || t.height <= 0) throw new Error(`Terrain art ${v.id} did not load.`);
    out[v.id] = t;
  }
  return out;
}

// ---------- drawing helpers ----------

/** Draws a texture into a rectangle as a texture fill (optionally mirrored). */
function stamp(g: Graphics, tex: Texture, x: number, y: number, w: number, h: number, flipX = false): void {
  const sx = (w / tex.width) * (flipX ? -1 : 1);
  const m = new Matrix(sx, 0, 0, h / tex.height, flipX ? x + w : x, y);
  g.beginTextureFill({ texture: tex, matrix: m });
  g.drawRect(x, y, w, h);
  g.endFill();
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

export function bakeTerrain(
  renderer: IRenderer,
  map: TerrainMap,
  forestCleared: Uint8Array,
  tex: TerrainTextures,
): BakedTerrain {
  const resolution = bakeResolution(renderer);
  const height = WORLD_H + BAKE_PAD_TOP + EDGE_DEPTH + 4;
  const texture = RenderTexture.create({ width: WORLD_W, height, resolution });
  const rand = mulberry32(map.seed ^ 0x150);
  const order = depthOrder();
  const tiles = effectiveTiles(map.tiles, forestCleared);
  const plan = planVariants(map.seed, tiles);
  const at = (x: number, y: number) => tiles[y * MAP_W + x];

  // Everything is drawn in world coordinates inside `root`, shifted down by the top padding.
  const root = new Container();
  root.position.set(0, BAKE_PAD_TOP);

  // ---- 1. Ground, clipped to the map's diamond
  const clip = new Graphics().beginFill(0xffffff).drawPolygon(mapDiamond()).endFill();
  const ground = new Container();
  ground.mask = clip;
  root.addChild(clip, ground);
  ground.addChild(new Graphics().beginFill(COLORS.meadow).drawPolygon(mapDiamond()).endFill());

  /** Splats for tiles of one terrain type (each tile's own variant), or calm meadow under all. */
  const splats = (type: number | 'under'): Graphics => {
    const g = new Graphics();
    for (const [x, y] of order) {
      const i = y * MAP_W + x;
      let id: string;
      let flip: boolean;
      if (type === 'under') {
        if (at(x, y) === Terrain.Meadow) continue;
        id = tileHash(map.seed, x, y, 3) < 0.5 ? 'meadow-1' : 'meadow-3';
        flip = tileHash(map.seed, x, y, 4) < 0.5;
      } else {
        if (at(x, y) !== type) continue;
        id = plan[i].entry.id;
        flip = plan[i].flip;
      }
      const art = ART[id];
      const w = TILE_W * (art.span ?? 1.35);
      const h = TILE_H * (art.span ?? 1.35);
      const c = tileCentre(x, y);
      stamp(g, tex[id], c.x - w / 2 + (tileHash(map.seed, x, y, 5) - 0.5) * 4, c.y - h / 2, w, h, flip);
    }
    return g;
  };
  // Meadow: every meadow tile shows its own variant; other tiles get calm meadow underneath.
  ground.addChild(splats('under'));
  ground.addChild(splats(Terrain.Meadow));

  // Feathered colour for terrains whose surface is their sampled Gemini ground colour.
  const feathered = (types: [number, number, number][], strength: number): Container => {
    const g = new Graphics();
    for (const [x, y] of order) {
      const t = at(x, y);
      for (const [type, color, scale] of types) {
        if (t !== type) continue;
        const c = tileCentre(x, y);
        g.beginFill(color).drawPolygon(blob(c.x, c.y, scale, rand)).endFill();
      }
    }
    const holder = new Container();
    holder.addChild(g);
    holder.filters = [new BlurFilter(strength, 3, resolution)];
    holder.filterArea = new Rectangle(0, BAKE_PAD_TOP, WORLD_W, WORLD_H);
    return holder;
  };
  ground.addChild(
    feathered(
      [
        [Terrain.Hill, COLORS.hill, 1.15],
        [Terrain.Forest, COLORS.forest, 1.15],
        [Terrain.Thicket, COLORS.thicket, 1.12],
        [Terrain.Marsh, COLORS.marsh, 1.1],
      ],
      6,
    ),
  );
  ground.addChild(splats(Terrain.Marsh));
  // Water: a lighter bank edge first (Section 3), then the river colour, then the Gemini water face.
  ground.addChild(feathered([[Terrain.Water, COLORS.bank, 1.55]], 7));
  ground.addChild(feathered([[Terrain.Water, COLORS.water, 1.05]], 4));
  ground.addChild(splats(Terrain.Water));

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

  // ---- 4. Props (trees, hill mounds, brambles), back to front
  const props = new Graphics();
  for (const [x, y] of order) {
    const t = at(x, y);
    if (t !== Terrain.Forest && t !== Terrain.Thicket && t !== Terrain.Hill) continue;
    const pick = plan[y * MAP_W + x];
    // Hills: a mound on about a third of the tiles (always on the rockiest centre tiles), drawn
    // a little larger, so a hill patch reads as rolling ground rather than a field of mounds.
    if (t === Terrain.Hill && !pick.entry.where && tileHash(map.seed, x, y, 6) >= 0.32) continue;
    const art = ART[pick.entry.id];
    const big = t === Terrain.Hill ? 1.15 : 1;
    const k = (big * (0.92 + tileHash(map.seed, x, y, 7) * 0.16)) / DENSITY;
    const w = art.width * k;
    const h = art.height * k;
    const c = tileCentre(x, y);
    const ax = pick.flip ? 1 - (art.anchorX ?? 0.5) : art.anchorX ?? 0.5;
    stamp(props, tex[pick.entry.id], c.x - ax * w, c.y - (art.anchorY ?? 0.5) * h, w, h, pick.flip);
  }
  root.addChild(props);

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
