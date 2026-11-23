// Road and bridge layers (Build Spec v1.5, Section 4).
//
// Roads: a 4-bit neighbour mask (north, east, south, west) picks one of 16 pre-rendered
// variants (isolated, end, straight, corner, T-junction, cross). Each variant is drawn once at
// start-up into a texture in the isometric projection (one 64 x 40 diamond). The warm tan dirt
// runs from the tile centre to the middle of every connected edge, so it is continuous across
// tiles; the stone edge runs along the dirt's sides and closes only at dead ends.
// Bridges: plank deck with side rails, posts in the water and a soft shadow on the water, in
// two deck directions chosen when the bridge is placed. Roads treat bridges as connections,
// so a road joins the bridge at each land end. Bridges sit on their own layer above water and
// below buildings.
// Both layers redraw only when a road or bridge tile changes (store topic 'roads').

import { Container, Graphics, Rectangle, Sprite, type IRenderer, type Texture } from 'pixi.js';
import { store } from '../game/store';
import { AXIS_BOTH, AXIS_EW, LINK_BRIDGE, LINK_ROAD, neighbourMask, N, E, S, W } from '../game/roads';
import { MAP_W, TILE_H, TILE_W } from '../game/types';
import { tileCentre } from './camera';

const DIRT = 0xc9a46a; // Section 3: warm tan dirt
const DIRT_LIGHT = 0xd9b984;
const STONE = 0x9c9586; // Section 3: stone edge
const STONE_DARK = 0x7d776b;
const PLANK = 0x9a6b42;
const PLANK_DARK = 0x6e4a2b;
const RAIL = 0x7a5232;
const POST = 0x4f3520;

/** Tile-local projection: (u, v) in [0, 1] across the tile's grid square -> pixels from its centre. */
const P = (u: number, v: number): [number, number] => [((u - v) * TILE_W) / 2, ((u + v - 1) * TILE_H) / 2];

function quad(g: Graphics, u0: number, v0: number, u1: number, v1: number, color: number, alpha = 1): void {
  g.beginFill(color, alpha).drawPolygon([...P(u0, v0), ...P(u1, v0), ...P(u1, v1), ...P(u0, v1)]).endFill();
}

/** Grid-space rectangles making up the road shape for a mask, at half-width h. */
function roadRects(mask: number, h: number): [number, number, number, number][] {
  const a = 0.5 - h;
  const b = 0.5 + h;
  const rects: [number, number, number, number][] = [[a, a, b, b]];
  if (mask & N) rects.push([a, 0, b, 0.5]);
  if (mask & E) rects.push([0.5, a, 1, b]);
  if (mask & S) rects.push([a, 0.5, b, 1]);
  if (mask & W) rects.push([0, a, 0.5, b]);
  return rects;
}

/** Draws one of the 16 road variants (Section 4) centred on (0, 0). */
export function drawRoadVariant(g: Graphics, mask: number): void {
  for (const r of roadRects(mask, 0.36)) quad(g, ...r, STONE_DARK);
  for (const r of roadRects(mask, 0.33)) quad(g, ...r, STONE);
  for (const r of roadRects(mask, 0.25)) quad(g, ...r, DIRT);
  // a lighter wheel-worn strip down the middle of the dirt
  for (const r of roadRects(mask, 0.07)) quad(g, ...r, DIRT_LIGHT, 0.7);
}

/** Draws a bridge deck running along the grid's east-west axis (u) or north-south axis (v). */
export function drawBridge(g: Graphics, axis: number): void {
  const ew = axis === AXIS_EW;
  const R = (along0: number, along1: number, across0: number, across1: number, color: number, alpha = 1) =>
    ew ? quad(g, along0, across0, along1, across1, color, alpha) : quad(g, across0, along0, across1, along1, color, alpha);
  const pt = (along: number, across: number) => (ew ? P(along, across) : P(across, along));
  // soft shadow on the water
  g.beginFill(0x1f3324, 0.22);
  const sh = [pt(0, 0.2), pt(1, 0.2), pt(1, 0.86), pt(0, 0.86)].flatMap(([x, y]) => [x + 2, y + 5]);
  g.drawPolygon(sh).endFill();
  // support posts in the water (front side)
  for (const along of [0.25, 0.75]) {
    const [x, y] = pt(along, 0.8);
    g.beginFill(POST).drawRect(x - 1.5, y, 3, 6).endFill();
    g.beginFill(0xffffff, 0.35).drawEllipse(x, y + 6, 3, 1).endFill();
  }
  // deck and planks
  R(0, 1, 0.2, 0.8, PLANK);
  for (let k = 0; k <= 8; k++) {
    const a = k / 8;
    const [x0, y0] = pt(a, 0.2);
    const [x1, y1] = pt(a, 0.8);
    g.lineStyle({ width: 0.8, color: PLANK_DARK, alpha: 0.8 }).moveTo(x0, y0).lineTo(x1, y1).lineStyle(0);
  }
  // side rails on short posts
  for (const across of [0.22, 0.78]) {
    for (const along of [0.08, 0.5, 0.92]) {
      const [x, y] = pt(along, across);
      g.lineStyle({ width: 1.4, color: RAIL }).moveTo(x, y).lineTo(x, y - 5).lineStyle(0);
    }
    const [x0, y0] = pt(0, across);
    const [x1, y1] = pt(1, across);
    g.lineStyle({ width: 1.6, color: RAIL }).moveTo(x0, y0 - 5).lineTo(x1, y1 - 5).lineStyle(0);
  }
}

export interface RoadLayers {
  roads: Container;
  bridges: Container;
  destroy(): void;
}

export function createRoadLayers(parent: Container, renderer: IRenderer): RoadLayers {
  const roads = new Container();
  const bridges = new Container();
  bridges.sortableChildren = true;
  parent.addChild(roads, bridges);

  // ---- pre-render the 16 road variants and 2 bridge directions once
  const region = new Rectangle(-TILE_W / 2, -TILE_H / 2 - 8, TILE_W, TILE_H + 16);
  const make = (draw: (g: Graphics) => void): Texture => {
    const g = new Graphics();
    draw(g);
    const t = renderer.generateTexture(g, { region, resolution: 2 });
    g.destroy();
    return t;
  };
  const roadTex: Texture[] = [];
  for (let m = 0; m < 16; m++) roadTex.push(make((g) => drawRoadVariant(g, m)));
  // (v3.0.2) A bridge crossing draws both decks: the plainest honest look for a bridge junction.
  const bridgeTex: Record<number, Texture> = {
    1: make((g) => drawBridge(g, 1)),
    2: make((g) => drawBridge(g, 2)),
    3: make((g) => {
      drawBridge(g, 1);
      drawBridge(g, 2);
    }),
  };

  const roadSprites = new Map<number, Sprite>();
  const bridgeSprites = new Map<number, Sprite>();
  const place = (pool: Map<number, Sprite>, layer: Container, i: number, tex: Texture) => {
    let s = pool.get(i);
    if (!s) {
      s = new Sprite(tex);
      s.eventMode = 'none';
      s.anchor.set(0.5, (TILE_H / 2 + 8) / (TILE_H + 16));
      const c = tileCentre(i % MAP_W, Math.floor(i / MAP_W));
      s.position.set(c.x, c.y);
      s.zIndex = c.y; // bridges further down the screen draw over ones behind them
      pool.set(i, s);
      layer.addChild(s);
    }
    s.texture = tex;
  };

  const redraw = () => {
    const { roads: links, bridgeAxis } = store.state;
    const isLink = (x: number, y: number) => links[y * MAP_W + x] !== 0;
    const liveRoads = new Set<number>();
    const liveBridges = new Set<number>();
    for (let i = 0; i < links.length; i++) {
      if (links[i] === LINK_ROAD) {
        liveRoads.add(i);
        place(roadSprites, roads, i, roadTex[neighbourMask(i % MAP_W, Math.floor(i / MAP_W), isLink)]);
      } else if (links[i] === LINK_BRIDGE) {
        liveBridges.add(i);
        place(bridgeSprites, bridges, i, bridgeTex[bridgeAxis[i] === AXIS_BOTH ? 3 : bridgeAxis[i] === AXIS_EW ? 2 : 1]);
      }
    }
    for (const [pool, live] of [
      [roadSprites, liveRoads],
      [bridgeSprites, liveBridges],
    ] as const) {
      for (const [i, s] of pool) {
        if (!live.has(i)) {
          s.destroy();
          pool.delete(i);
        }
      }
    }
  };
  const unsubscribe = store.subscribe('roads', redraw);
  redraw();

  return {
    roads,
    bridges,
    destroy() {
      unsubscribe();
      roads.destroy({ children: true });
      bridges.destroy({ children: true });
      for (const t of roadTex) t.destroy(true);
      bridgeTex[1].destroy(true);
      bridgeTex[2].destroy(true);
      bridgeTex[3].destroy(true);
    },
  };
}
