// The map runtime (Build Spec v2.0, Section 10: the stability contract).
// createMapRuntime() is called exactly once per MapView mount. It creates the one Pixi
// Application, builds the stage once, and returns a destroy() for page unmount.
// Nothing in here runs because of typing, submitting a word, resource changes, or tool
// selection: those only update the store, and each layer redraws itself from the store.
//
// v2.0: the road and bridge preview, the placement ghost and the tutorial marks are single
// Graphics or Sprites on their own layers, redrawn only while the pointer moves during an
// active preview or placement (or when the store changes them). They never rebake the terrain.

import { Application, Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import { BUILDINGS } from '../game/buildings';
import {
  cancelPreview,
  ghostStatus,
  inspectTile,
  mapPainted,
  moveGhost,
  pendingCameraApplied,
  pinGhost,
  previewDragTo,
  previewSummary,
  requestRemoveAt,
  setCamera,
  setToolTile,
  store,
  workTile,
} from '../game/store';
import type { Camera } from '../game/types';
import type { SavedCamera } from '../game/save';
import { createBuildingLayer, spritePlacement } from './buildingLayer';
import { attachCamera, centredCamera, footprintDiamond, screenToTile, tileCentre, tileInMap, type Pt } from './camera';
import { createRoadLayers } from './roadLayer';
import { bakeTerrain, drawFlowers, loadTerrainTextures, shimmerSpots, type BakedTerrain, type TerrainTextures } from './terrainBake';

/**
 * Counters for the Section 14 checks ("Pixi Application instance count stays at 1",
 * "the stage is never rebuilt"). Open the browser console and type: wordcityDebug
 * terrainBakes goes up only when the ground itself changes (a tile is cleared or drained, or a
 * saved town is loaded): the one terrain texture is painted again, never the stage.
 * overlayDraws counts preview, ghost and mark redraws (they never touch the terrain).
 */
export const debugCounters = { appsCreated: 0, appsDestroyed: 0, stageBuilds: 0, terrainBakes: 0, resizes: 0, overlayDraws: 0 };
declare global {
  interface Window {
    wordcityDebug?: typeof debugCounters & { liveApps: number };
  }
}
if (typeof window !== 'undefined') {
  const view = {} as typeof debugCounters & { liveApps: number };
  for (const k of Object.keys(debugCounters) as (keyof typeof debugCounters)[]) {
    Object.defineProperty(view, k, { get: () => debugCounters[k], enumerable: true });
  }
  Object.defineProperty(view, 'liveApps', {
    get: () => debugCounters.appsCreated - debugCounters.appsDestroyed,
    enumerable: true,
  });
  window.wordcityDebug = view;
}

export interface MapRuntime {
  destroy(): void;
}

export interface RuntimeOptions {
  /** Called if something fails after start-up (for example, art fails to load). */
  onFatal: (err: unknown) => void;
}

function testFlag(name: string): boolean {
  try {
    return new URLSearchParams(window.location.search).has(name);
  } catch {
    return false;
  }
}

// Preview colours (Section 4: translucent road tiles at 60 percent; red where a tile can't go).
const ROAD_TINT = 0xc9a46a;
const ROAD_EDGE = 0x9c9586;
const BRIDGE_TINT = 0x9a6b42;
const BAD = 0xe0533f;
const GOLD = 0xf2c94c;
// Section 7: footprint tinted green or red at 35 percent.
const GHOST_OK = 0x5fd068;
const GHOST_BAD = 0xe0533f;

export function createMapRuntime(host: HTMLDivElement, opts: RuntimeOptions): MapRuntime {
  // Section 14 test hook: add ?testNoWebGL to the address to see the Error Boundary path.
  if (testFlag('testNoWebGL')) throw new Error('WebGL was turned off for testing (?testNoWebGL).');

  const viewSize = () => ({ w: Math.max(1, host.clientWidth), h: Math.max(1, host.clientHeight) });
  const v = viewSize();

  // Section 10: WebGL. pixi.js 7.4.2 has no Canvas renderer, so if WebGL is unavailable this
  // constructor throws and the Error Boundary shows the Reload Map message.
  const app = new Application({
    width: v.w,
    height: v.h,
    backgroundColor: 0x1d1916,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(2, window.devicePixelRatio || 1),
    powerPreference: 'high-performance',
  });
  debugCounters.appsCreated++;

  try {
    return buildStage(app, host, viewSize, opts);
  } catch (err) {
    app.destroy(true, { children: true, texture: false, baseTexture: false });
    debugCounters.appsDestroyed++;
    throw err;
  }
}

const diamond = (x: number, y: number, w = 1, h = 1, inset = 0): number[] => {
  const [top, right, bottom, left] = footprintDiamond(x, y, w, h);
  if (!inset) return [top.x, top.y, right.x, right.y, bottom.x, bottom.y, left.x, left.y];
  const cx = (left.x + right.x) / 2;
  const cy = (top.y + bottom.y) / 2;
  const k = 1 - inset;
  return [top, right, bottom, left].flatMap((p) => [cx + (p.x - cx) * k, cy + (p.y - cy) * k]);
};

function buildStage(
  app: Application,
  host: HTMLDivElement,
  viewSize: () => { w: number; h: number },
  opts: RuntimeOptions,
): MapRuntime {
  const canvas = app.view as HTMLCanvasElement;
  canvas.style.display = 'block';
  host.appendChild(canvas);

  // ---------- stage, built once ----------
  debugCounters.stageBuilds++;
  const world = new Container();
  app.stage.addChild(world);

  // Draw order: terrain, water shimmer, flowers, roads and bridges (Section 4: above water,
  // below buildings), tutorial marks, preview and ghost footprint, buildings, smoke, ghost
  // sprite, terrain labels.
  const terrainLayer = new Container();
  const waterFx = new Container();
  const flowerLayer = new Graphics();
  const ground = new Container();
  const marksLayer = new Graphics();
  const previewLayer = new Graphics();
  world.addChild(terrainLayer, waterFx, flowerLayer, ground, marksLayer, previewLayer);
  const roadLayers = createRoadLayers(ground, app.renderer);
  const buildingLayer = createBuildingLayer(world, opts.onFatal);
  const smokeLayer = new Container();
  const ghost = new Sprite();
  ghost.eventMode = 'none';
  ghost.visible = false;
  const labelLayer = new Container();
  world.addChild(smokeLayer, ghost, labelLayer);

  let disposed = false;
  let terrainTextures: TerrainTextures | null = null;
  let baked: BakedTerrain | null = null;
  const rebakeTerrain = () => {
    if (!terrainTextures || disposed) return;
    const next = bakeTerrain(app.renderer, store.state.terrain, store.state.cleared, terrainTextures);
    if (baked) {
      terrainLayer.removeChild(baked.sprite);
      baked.sprite.destroy();
      baked.texture.destroy(true);
    }
    baked = next;
    terrainLayer.addChild(baked.sprite);
    debugCounters.terrainBakes++;
  };

  // The Gemini terrain art loads once; the map is baked as soon as it arrives. After the bake,
  // tell the store the map has painted (Section 5 starts the dictionary then, if not started).
  loadTerrainTextures()
    .then((t) => {
      if (disposed) return;
      terrainTextures = t;
      rebakeTerrain();
      app.ticker.addOnce(() => {
        requestAnimationFrame(() => {
          if (!disposed) mapPainted();
        });
      });
    })
    .catch((err) => {
      if (!disposed) opts.onFatal(err);
    });
  // Clearing or draining changes the ground itself, so the terrain texture is painted again.
  const unsubscribeTiles = store.subscribe('tiles', rebakeTerrain);

  const redrawFlowers = () => drawFlowers(flowerLayer, store.state.flowers, store.state.terrain.seed);
  redrawFlowers();
  const unsubscribeTerrain = store.subscribe('terrain', redrawFlowers);

  // ---------- ticker job 1: water shimmer ----------
  const dash = new Graphics();
  dash.lineStyle({ width: 2, color: 0xffffff, alpha: 1, cap: 'round' as never });
  dash.moveTo(0, 0).lineTo(10, 0);
  const dashTexture: Texture = app.renderer.generateTexture(dash);
  dash.destroy();
  let spots: { sprite: Sprite; phase: number }[] = [];
  const placeShimmer = () => {
    for (const s of spots) s.sprite.destroy();
    spots = shimmerSpots(store.state.terrain).map((s) => {
      const sprite = new Sprite(dashTexture);
      sprite.eventMode = 'none';
      sprite.anchor.set(0.5);
      sprite.position.set(s.x, s.y);
      sprite.width = s.len;
      sprite.height = 1.6;
      sprite.alpha = 0;
      waterFx.addChild(sprite);
      return { sprite, phase: s.phase };
    });
  };
  placeShimmer();

  // ---------- ticker job 2: cottage chimney smoke ----------
  const puffGfx = new Graphics().beginFill(0xf4f1ea).drawCircle(0, 0, 6).endFill();
  const puffTexture: Texture = app.renderer.generateTexture(puffGfx);
  puffGfx.destroy();
  let puffs: { sprite: Sprite; x: number; y: number; phase: number }[] = [];
  const syncSmoke = () => {
    const chimneys = buildingLayer.chimneys();
    while (puffs.length > chimneys.length * 3) puffs.pop()!.sprite.destroy();
    chimneys.forEach((c, i) => {
      for (let k = 0; k < 3; k++) {
        const idx = i * 3 + k;
        if (!puffs[idx]) {
          const sprite = new Sprite(puffTexture);
          sprite.eventMode = 'none';
          sprite.anchor.set(0.5);
          smokeLayer.addChild(sprite);
          puffs[idx] = { sprite, x: 0, y: 0, phase: k / 3 };
        }
        puffs[idx].x = c.x;
        puffs[idx].y = c.y;
      }
    });
  };
  const unsubscribeSmoke = store.subscribe('buildings', syncSmoke);

  let t = 0;
  const tick = (delta: number) => {
    t += delta / 60;
    for (const s of spots) s.sprite.alpha = Math.max(0, Math.sin(t * 1.3 + s.phase)) * 0.45;
    if (puffs.length === 0 && buildingLayer.chimneys().length) syncSmoke(); // art finished loading
    for (const p of puffs) {
      const life = (t * 0.25 + p.phase) % 1; // each puff rises for 4 s, then starts again
      p.sprite.position.set(p.x + Math.sin(life * 5 + p.phase * 6) * 2 + life * 6, p.y - life * 22);
      p.sprite.scale.set(0.25 + life * 0.55);
      p.sprite.alpha = (1 - life) * 0.55 * Math.min(1, life * 6);
    }
    // Section 17: the tutorial's gold plot outline pulses (an alpha change only, no redraw).
    if (marksLayer.visible) marksLayer.alpha = 0.65 + 0.35 * Math.sin(t * 4);
  };
  app.ticker.add(tick);

  // ---------- Section 17: tutorial marks (gold plot outlines, the start marker, labels) ----------
  const labelPool: { box: Graphics; text: Text }[] = [];
  const drawMarks = () => {
    debugCounters.overlayDraws++;
    const m = store.state.marks;
    marksLayer.clear();
    marksLayer.visible = m.plots.length > 0 || !!m.start;
    for (const p of m.plots) {
      marksLayer.lineStyle({ width: 3.5, color: GOLD, alpha: 1 });
      marksLayer.beginFill(GOLD, 0.16).drawPolygon(diamond(p.x, p.y, p.w, p.h)).endFill();
      marksLayer.lineStyle(0);
    }
    if (m.start) {
      const c = tileCentre(m.start.x, m.start.y);
      marksLayer.lineStyle({ width: 3, color: 0xffffff, alpha: 1 });
      marksLayer.beginFill(GOLD, 0.85).drawCircle(c.x, c.y, 7).endFill();
      marksLayer.lineStyle(0);
    }
    while (labelPool.length < m.labels.length) {
      const box = new Graphics();
      const text = new Text('', { fontFamily: 'Nunito Sans, sans-serif', fontSize: 13, fontWeight: '700', fill: 0xf4ead5 });
      text.anchor.set(0.5);
      labelLayer.addChild(box, text);
      labelPool.push({ box, text });
    }
    labelPool.forEach((l, i) => {
      const lab = m.labels[i];
      l.box.visible = l.text.visible = !!lab;
      if (!lab) return;
      const c = tileCentre(lab.x, lab.y);
      l.text.text = lab.text;
      l.text.style.fill = lab.lit ? 0x2b2118 : 0xf4ead5;
      l.text.position.set(c.x, c.y - 26);
      const w = lab.text.length * 7.6 + 18;
      l.box.clear();
      if (lab.lit) l.box.lineStyle({ width: 2.5, color: 0xffffff, alpha: 1 });
      l.box.beginFill(lab.lit ? GOLD : 0x2b2118, lab.lit ? 1 : 0.85).drawRoundedRect(c.x - w / 2, c.y - 37, w, 22, 11).endFill();
      l.box.lineStyle(0);
      l.box.beginFill(lab.lit ? GOLD : 0x2b2118, lab.lit ? 1 : 0.85).drawPolygon([c.x - 5, c.y - 16, c.x + 5, c.y - 16, c.x, c.y - 9]).endFill();
    });
  };
  drawMarks();
  const unsubscribeMarks = store.subscribe('marks', drawMarks);

  // ---------- previews: road and bridge path, ghost, hover cursor ----------
  let hoverTile: Pt | null = null;

  const drawPreview = () => {
    debugCounters.overlayDraws++;
    previewLayer.clear();
    ghost.visible = false;
    const s = store.state;
    const tool = s.tool;

    // Section 4: the road or bridge preview.
    const sum = previewSummary();
    if (sum) {
      for (const tile of sum.tiles) {
        if (!tileInMap(tile)) continue;
        if (tile.state === 'bad') {
          previewLayer.lineStyle({ width: 2.5, color: BAD, alpha: 1 });
          previewLayer.beginFill(BAD, 0.45).drawPolygon(diamond(tile.x, tile.y)).endFill();
        } else if (tile.state === 'existing') {
          previewLayer.lineStyle({ width: 2, color: 0xffffff, alpha: 0.7 });
          previewLayer.beginFill(0xffffff, 0.08).drawPolygon(diamond(tile.x, tile.y, 1, 1, 0.1)).endFill();
        } else {
          previewLayer.lineStyle({ width: 2, color: sum.kind === 'road' ? ROAD_EDGE : 0x5a3d24, alpha: 0.6 });
          previewLayer.beginFill(sum.kind === 'road' ? ROAD_TINT : BRIDGE_TINT, 0.6).drawPolygon(diamond(tile.x, tile.y, 1, 1, 0.06)).endFill();
        }
        previewLayer.lineStyle(0);
      }
      return;
    }

    // Section 7: the placement ghost.
    const g = ghostStatus();
    if (g) {
      const def = BUILDINGS[g.type];
      for (let yy = g.y; yy < g.y + def.h; yy++)
        for (let xx = g.x; xx < g.x + def.w; xx++) {
          if (!tileInMap({ x: xx, y: yy })) continue;
          previewLayer.beginFill(g.ok ? GHOST_OK : GHOST_BAD, 0.35).drawPolygon(diamond(xx, yy)).endFill();
        }
      previewLayer.lineStyle({ width: g.pinned ? 3 : 2, color: g.ok ? GHOST_OK : GHOST_BAD, alpha: 0.95 });
      previewLayer.drawPolygon(diamond(g.x, g.y, def.w, def.h));
      previewLayer.lineStyle(0);
      const tex = buildingLayer.texture(g.type);
      if (tex) {
        const at = spritePlacement(g.type, g.x, g.y, tex);
        ghost.texture = tex;
        ghost.anchor.set(at.anchorX, at.anchorY);
        ghost.scale.set(at.scale);
        ghost.position.set(at.x, at.y);
        ghost.alpha = 0.5;
        ghost.visible = true;
      }
      return;
    }

    // The hover cursor for the other tools.
    if (!hoverTile || !tileInMap(hoverTile) || tool in BUILDINGS) return;
    const color = tool === 'remove' ? BAD : 0xffffff;
    previewLayer.lineStyle({ width: 2.5, color, alpha: 0.95 });
    previewLayer.beginFill(color, tool === 'inspect' ? 0.08 : 0.18).drawPolygon(diamond(hoverTile.x, hoverTile.y)).endFill();
    previewLayer.lineStyle(0);
  };
  const unsubscribePreview = store.subscribe('preview', drawPreview);
  const unsubscribeTool = store.subscribe('tool', drawPreview);
  const unsubscribeRoads = store.subscribe('roads', drawPreview);
  const unsubscribeBuildings = store.subscribe('buildings', drawPreview);
  const unsubscribeResources = store.subscribe('resources', drawPreview); // green turns red when funds drop

  /** Section 4: every tile the drag passes over joins the path (sampled along the pointer's move). */
  let lastPaint: { x: number; y: number } | null = null;
  const dragOver = (sx: number, sy: number, cam: Camera) => {
    const from = lastPaint ?? { x: sx, y: sy };
    const dist = Math.hypot(sx - from.x, sy - from.y);
    const steps = Math.max(1, Math.ceil(dist / 5));
    for (let k = 1; k <= steps; k++) {
      const px = from.x + ((sx - from.x) * k) / steps;
      const py = from.y + ((sy - from.y) * k) / steps;
      previewDragTo(screenToTile(cam, px, py));
    }
    lastPaint = { x: sx, y: sy };
  };

  const isBuildingTool = () => store.state.tool in BUILDINGS;
  const pathEnd = (): Pt | null => {
    const p = store.state.preview?.path;
    return p && p.length ? p[p.length - 1] : null;
  };

  // ---------- camera ----------
  // Section 11: a saved camera is the world point at the centre of the view, so the same save
  // frames the town on a desktop window or a phone screen.
  const fromSaved = (c: SavedCamera): Camera => {
    const v = viewSize();
    return { x: v.w / 2 - c.centreX * c.zoom, y: v.h / 2 - c.centreY * c.zoom, zoom: c.zoom };
  };
  const saved = store.state.pendingCamera;
  let goalAnim = 0;
  const camera = attachCamera({
    canvas,
    world,
    viewSize,
    initial: saved ? fromSaved(saved) : null,
    onChange: (cam) => setCamera(cam, viewSize()),
    // Which drags draw instead of panning: a road or bridge drag (a new path, or one that starts
    // on the current path's end), and on touch a building drag (Section 7: the map does not pan
    // while a building is selected on the phone). Right button and two fingers always pan.
    paintMode: (sx, sy, cam, pointerType) => {
      const tool = store.state.tool;
      if (tool === 'road' || tool === 'bridge') {
        const end = pathEnd();
        if (!end) return true;
        const tile = screenToTile(cam, sx, sy);
        return tile.x === end.x && tile.y === end.y;
      }
      return isBuildingTool() && pointerType !== 'mouse';
    },
    onPaint: (phase, sx, sy, cam) => {
      const tile = screenToTile(cam, sx, sy);
      if (isBuildingTool()) {
        // Phone: the ghost follows the finger; lifting it pins the ghost.
        if (phase === 'start' || phase === 'move') {
          const p = store.state.placement;
          if (p?.pinned) store.state.placement = { ...p, pinned: false };
          moveGhost(tile.x, tile.y);
        } else if (phase === 'end') pinGhost(tile.x, tile.y);
        return;
      }
      if (phase === 'start') {
        lastPaint = null;
        dragOver(sx, sy, cam);
      } else if (phase === 'move') dragOver(sx, sy, cam);
      else lastPaint = null; // lifting the pointer commits nothing (Section 4)
    },
    onHover: (sx, sy, cam) => {
      hoverTile = sx === null || sy === null ? null : screenToTile(cam, sx, sy);
      if (isBuildingTool()) moveGhost(hoverTile ? hoverTile.x : null, hoverTile ? hoverTile.y : null);
      else {
        if (hoverTile && tileInMap(hoverTile)) setToolTile(hoverTile);
        if (!store.state.preview) drawPreview();
      }
    },
    onTap: (sx, sy, cam) => {
      const tile = screenToTile(cam, sx, sy);
      const tool = store.state.tool;
      if (tool === 'inspect') {
        if (tileInMap(tile)) inspectTile(tile.x, tile.y);
      } else if (tool === 'remove') requestRemoveAt(tile.x, tile.y);
      else if (tool === 'road' || tool === 'bridge') previewDragTo(tile); // a tap makes a one-tile preview
      else if (tool === 'clear' || tool === 'drain') workTile(tool, tile.x, tile.y);
      else if (isBuildingTool()) pinGhost(tile.x, tile.y); // a click pins the ghost
      drawPreview();
    },
    // Section 4: a right-click while a preview is active cancels it.
    onSecondaryTap: () => {
      cancelPreview();
    },
  });

  if (saved) pendingCameraApplied();

  // ---------- Section 17: pan to a place in about 600 ms, keeping it clear of the caption ----------
  const panTo = () => {
    const goal = store.state.cameraGoal;
    if (!goal) return;
    const v = viewSize();
    const from = camera.get();
    const c = tileCentre(goal.x, goal.y);
    const zoom = from.zoom;
    // The caption panel sits at the bottom, so the place is framed in the upper part of the view.
    const to = { x: v.w / 2 - c.x * zoom, y: v.h * 0.38 - c.y * zoom, zoom };
    const start = performance.now();
    const id = ++goalAnim;
    const step = (now: number) => {
      if (disposed || id !== goalAnim) return;
      const k = Math.min(1, (now - start) / 600);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      camera.set({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, zoom });
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const unsubscribeGoal = store.subscribe('cameraGoal', panTo);

  // ---------- Section 11: a whole town was loaded (or a new one started) ----------
  // Roads, bridges, buildings, flowers and smoke redraw from their own topics, and the 'tiles'
  // topic repaints the baked terrain. Here: the river shimmer and the camera. Same stage, same app.
  const onLoad = () => {
    goalAnim++;
    placeShimmer();
    const c = store.state.pendingCamera;
    const v = viewSize();
    camera.set(c ? fromSaved(c) : centredCamera(v.w, v.h));
    pendingCameraApplied();
    hoverTile = null;
    drawPreview();
    drawMarks();
  };
  const unsubscribeLoad = store.subscribe('load', onLoad);

  // ---------- resize: renderer.resize only, never a rebuild (Section 2) ----------
  const resizeObserver = new ResizeObserver(() => {
    const s = viewSize();
    if (s.w === app.renderer.screen.width && s.h === app.renderer.screen.height) return;
    app.renderer.resize(s.w, s.h);
    debugCounters.resizes++;
    camera.onResize();
    app.render(); // draw immediately so the resized canvas never shows a blank frame
  });
  resizeObserver.observe(host);

  // ---------- lost GPU context: the baked terrain texture must be painted again ----------
  const onContextRestored = () => {
    try {
      rebakeTerrain();
    } catch (err) {
      opts.onFatal(err);
    }
  };
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  return {
    destroy() {
      if (disposed) return;
      disposed = true;
      resizeObserver.disconnect();
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      camera.destroy();
      for (const u of [
        unsubscribeLoad,
        unsubscribeGoal,
        unsubscribeTerrain,
        unsubscribeTiles,
        unsubscribeSmoke,
        unsubscribeTool,
        unsubscribePreview,
        unsubscribeRoads,
        unsubscribeBuildings,
        unsubscribeResources,
        unsubscribeMarks,
      ])
        u();
      app.ticker.remove(tick);
      roadLayers.destroy();
      buildingLayer.destroy();
      if (baked) baked.texture.destroy(true);
      dashTexture.destroy(true);
      puffTexture.destroy(true);
      app.destroy(true, { children: true, texture: false, baseTexture: false });
      debugCounters.appsDestroyed++;
    },
  };
}
