// The map runtime (Build Spec v1.8, Section 10: the stability contract).
// createMapRuntime() is called exactly once per MapView mount. It creates the one Pixi
// Application, builds the stage once, and returns a destroy() for page unmount.
// Nothing in here runs because of typing, submitting a word, resource changes, or tool
// selection: those only update the store, and each layer redraws itself from the store.

import { Application, Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { BUILDINGS } from '../game/buildings';
import { connectTiles } from '../game/roads';
import {
  buildPath,
  clearForest,
  inspectTile,
  mapPainted,
  pendingCameraApplied,
  placeBuilding,
  previewFor,
  requestRemoveAt,
  setCamera,
  store,
} from '../game/store';
import type { Camera, Tool } from '../game/types';
import type { SavedCamera } from '../game/save';
import { createBuildingLayer, spritePlacement } from './buildingLayer';
import { attachCamera, centredCamera, footprintDiamond, screenToTile, tileInMap, type Pt } from './camera';
import { createRoadLayers } from './roadLayer';
import { bakeTerrain, drawFlowers, loadTerrainTextures, shimmerSpots, type BakedTerrain, type TerrainTextures } from './terrainBake';

/**
 * Counters for the Section 14 checks ("Pixi Application instance count stays at 1",
 * "the stage is never rebuilt"). Open the browser console and type: wordcityDebug
 * terrainBakes goes up only when the ground itself changes (a forest tile is cleared, or a
 * saved town is loaded): the one terrain texture is painted again, never the stage.
 */
export const debugCounters = { appsCreated: 0, appsDestroyed: 0, stageBuilds: 0, terrainBakes: 0, resizes: 0 };
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

const PAINT_TOOLS: Tool[] = ['road', 'bridge', 'clear'];

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

  // Draw order: terrain, water shimmer, flowers, roads, bridges (Section 4: above water, below
  // buildings), placement preview footprint, buildings, smoke, preview building.
  const terrainLayer = new Container();
  const waterFx = new Container();
  const flowerLayer = new Graphics();
  const ground = new Container();
  const cursorGround = new Graphics();
  world.addChild(terrainLayer, waterFx, flowerLayer, ground, cursorGround);
  const roadLayers = createRoadLayers(ground, app.renderer);
  const buildingLayer = createBuildingLayer(world, opts.onFatal);
  const smokeLayer = new Container();
  const ghost = new Sprite();
  ghost.eventMode = 'none';
  ghost.visible = false;
  world.addChild(smokeLayer, ghost);

  let disposed = false;
  let terrainTextures: TerrainTextures | null = null;
  let baked: BakedTerrain | null = null;
  const rebakeTerrain = () => {
    if (!terrainTextures || disposed) return;
    const next = bakeTerrain(app.renderer, store.state.terrain, store.state.forestCleared, terrainTextures);
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
  // tell the store the map has painted so the dictionary can start parsing (Section 5).
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
  // Clearing forest changes the ground itself, so the terrain texture is painted again.
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
  // The shimmer follows the river, so a loaded town on another map gets its own (Section 11).
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
  };
  app.ticker.add(tick);

  // ---------- placement preview and tools ----------
  let hoverTile: Pt | null = null;
  let path: Pt[] | null = null;

  const drawPreview = () => {
    cursorGround.clear();
    ghost.visible = false;
    if (!hoverTile && !path) return;
    const tool = store.state.tool;
    const at = hoverTile ?? path![path!.length - 1];
    const preview = previewFor(tool, at.x, at.y, path);
    const inspect = tool === 'inspect';
    for (const c of preview.cells) {
      if (!tileInMap(c)) continue;
      const [top, right, bottom, left] = footprintDiamond(c.x, c.y, 1, 1);
      const color = inspect ? 0xffffff : c.ok ? 0xd8ff9e : 0xff6f5c;
      cursorGround.lineStyle({ width: 2.5, color, alpha: 1 });
      cursorGround.beginFill(c.ok || inspect ? color : 0xff6f5c, inspect ? 0.1 : 0.4);
      cursorGround.drawPolygon([top.x, top.y, right.x, right.y, bottom.x, bottom.y, left.x, left.y]);
      cursorGround.endFill();
      cursorGround.lineStyle(0);
    }
    const b = preview.building;
    if (b) {
      const tex = buildingLayer.texture(b.type);
      if (tex) {
        const placement = spritePlacement(b.type, b.x, b.y, tex);
        ghost.texture = tex;
        ghost.anchor.set(placement.anchorX, placement.anchorY);
        ghost.scale.set(placement.scale);
        ghost.position.set(placement.x, placement.y);
        ghost.alpha = b.ok ? 0.75 : 0.4;
        ghost.tint = b.ok ? 0xffffff : 0xff9a8a;
        ghost.visible = true;
      }
    }
  };
  const resetPreview = () => {
    path = null;
    drawPreview();
  };
  const unsubscribeTool = store.subscribe('tool', resetPreview);
  const unsubscribeRoads = store.subscribe('roads', drawPreview);
  const unsubscribeBuildings = store.subscribe('buildings', drawPreview);

  const commitPath = () => {
    if (!path || path.length === 0) return;
    const tool = store.state.tool;
    if (tool === 'road' || tool === 'bridge') buildPath(tool, path);
    else if (tool === 'clear') clearForest(path);
    path = null;
    drawPreview();
  };

  // ---------- camera ----------
  // Section 11: a saved camera is the world point at the centre of the view, so the same save
  // frames the town on a desktop window or a phone screen.
  const fromSaved = (c: SavedCamera): Camera => {
    const v = viewSize();
    return { x: v.w / 2 - c.centreX * c.zoom, y: v.h / 2 - c.centreY * c.zoom, zoom: c.zoom };
  };
  const saved = store.state.pendingCamera;
  const camera = attachCamera({
    canvas,
    world,
    viewSize,
    initial: saved ? fromSaved(saved) : null,
    onChange: (cam) => setCamera(cam, viewSize()),
    paintMode: () => PAINT_TOOLS.includes(store.state.tool),
    onPaint: (phase, sx, sy, cam) => {
      const tile = screenToTile(cam, sx, sy);
      if (phase === 'start') path = [tile];
      else if (phase === 'move' && path) {
        const last = path[path.length - 1];
        if (last.x !== tile.x || last.y !== tile.y) path = path.concat(connectTiles(last, tile).slice(1));
      } else if (phase === 'end') {
        commitPath();
        return;
      } else if (phase === 'cancel') path = null;
      hoverTile = tile;
      drawPreview();
    },
    onHover: (sx, sy, cam) => {
      hoverTile = sx === null || sy === null ? null : screenToTile(cam, sx, sy);
      drawPreview();
    },
    onTap: (sx, sy, cam) => {
      const tile = screenToTile(cam, sx, sy);
      const tool = store.state.tool;
      if (tool === 'inspect') {
        if (tileInMap(tile)) inspectTile(tile.x, tile.y);
      } else if (tool === 'remove') requestRemoveAt(tile.x, tile.y);
      else if (tool in BUILDINGS) placeBuilding(tool as keyof typeof BUILDINGS, tile.x, tile.y);
      drawPreview();
    },
  });

  if (saved) pendingCameraApplied();

  // ---------- Section 11: a whole town was loaded (or a new one started) ----------
  // Roads, bridges, buildings, flowers and smoke redraw from their own topics, and the 'tiles'
  // topic repaints the baked terrain. Here: the river shimmer and the camera. Same stage, same app.
  const onLoad = () => {
    placeShimmer();
    const c = store.state.pendingCamera;
    const v = viewSize();
    camera.set(c ? fromSaved(c) : centredCamera(v.w, v.h));
    pendingCameraApplied();
    resetPreview();
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
      unsubscribeLoad();
      unsubscribeTerrain();
      unsubscribeTiles();
      unsubscribeSmoke();
      unsubscribeTool();
      unsubscribeRoads();
      unsubscribeBuildings();
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
