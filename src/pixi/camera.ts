// Camera and isometric projection (Build Spec v1.2, Section 2).
// Logic runs on the square 54 x 54 grid; this file turns grid positions into isometric world
// pixels (64 x 32 diamonds) and back. Camera: drag to pan, wheel or trackpad to zoom, pinch
// zoom. Zoom 0.5 to 2.5, centred on the pointer. Pan is clamped so the world edge can never
// move more than 200 px past the viewport edge. Uses unified Pointer Events (Section 10).

import type { Container } from 'pixi.js';
import { MAP_H, MAP_W, TILE_H, TILE_W, WORLD_H, WORLD_W, type Camera } from '../game/types';

// ---------- isometric projection ----------

const HALF_W = TILE_W / 2;
const HALF_H = TILE_H / 2;
/** World x of grid corner (0, 0): the map's top vertex. Keeps every world x >= 0. */
export const ISO_ORIGIN_X = MAP_H * HALF_W;

export interface Pt {
  x: number;
  y: number;
}

/** Grid point (tile corners at whole numbers; fractions allowed) to isometric world pixels. */
export function gridToWorld(gx: number, gy: number): Pt {
  return { x: ISO_ORIGIN_X + (gx - gy) * HALF_W, y: (gx + gy) * HALF_H };
}

/** Centre of tile (tx, ty) in world pixels. */
export function tileCentre(tx: number, ty: number): Pt {
  return gridToWorld(tx + 0.5, ty + 0.5);
}

/** World pixels to the tile under them (may be outside the map; check with tileInMap). */
export function worldToTile(wx: number, wy: number): Pt {
  const u = (wx - ISO_ORIGIN_X) / HALF_W;
  const v = wy / HALF_H;
  return { x: Math.floor((v + u) / 2), y: Math.floor((v - u) / 2) };
}

export function tileInMap(t: Pt): boolean {
  return t.x >= 0 && t.y >= 0 && t.x < MAP_W && t.y < MAP_H;
}

/** The four corners of a footprint's diamond: top, right, bottom, left. */
export function footprintDiamond(x: number, y: number, w: number, h: number): [Pt, Pt, Pt, Pt] {
  return [gridToWorld(x, y), gridToWorld(x + w, y), gridToWorld(x + w, y + h), gridToWorld(x, y + h)];
}

/**
 * Where a building sprite is anchored (Section 3: bottom-centre to its footprint): horizontally
 * the centre of the footprint diamond, vertically its bottom vertex. Also returns the diamond's
 * width, which the sprite's grass base is scaled to match.
 */
export function footprintAnchor(x: number, y: number, w: number, h: number): Pt & { width: number } {
  const [, right, bottom, left] = footprintDiamond(x, y, w, h);
  return { x: (left.x + right.x) / 2, y: bottom.y, width: right.x - left.x };
}

/** Draw-order key: things whose footprint reaches further down the screen draw on top. */
export function depthKey(x: number, y: number, w = 1, h = 1): number {
  return (x + w + y + h) * 4096 + (x + w);
}

export const ZOOM_MIN = 0.5; // Section 2
export const ZOOM_MAX = 2.5; // Section 2
export const PAN_SLACK = 200; // Section 2: 200 px past the viewport edge
const TAP_SLOP = 6; // px of movement before a press counts as a drag

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

/** Keeps the world inside the allowed pan range. If the world is smaller than the view, it is centred. */
export function clampCamera(cam: Camera, viewW: number, viewH: number): Camera {
  const zoom = clampZoom(cam.zoom);
  const axis = (pos: number, view: number, size: number) => {
    const max = PAN_SLACK; // world left/top edge may sit at most 200 px inside the view
    const min = view - PAN_SLACK - size; // world right/bottom edge may sit at most 200 px inside
    if (min > max) return (view - size) / 2;
    if (!Number.isFinite(pos)) return (view - size) / 2;
    return Math.min(max, Math.max(min, pos));
  };
  return { x: axis(cam.x, viewW, WORLD_W * zoom), y: axis(cam.y, viewH, WORLD_H * zoom), zoom };
}

/** Zooms by `factor` keeping the world point under (px, py) fixed on screen. */
export function zoomAt(cam: Camera, factor: number, px: number, py: number): Camera {
  const zoom = clampZoom(cam.zoom * factor);
  const k = zoom / cam.zoom;
  return { x: px - (px - cam.x) * k, y: py - (py - cam.y) * k, zoom };
}

/** Screen pixel (relative to the canvas) to the grid tile under it. */
export function screenToTile(cam: Camera, sx: number, sy: number): Pt {
  return worldToTile((sx - cam.x) / cam.zoom, (sy - cam.y) / cam.zoom);
}

export function centredCamera(viewW: number, viewH: number, zoom = 1): Camera {
  return clampCamera({ x: (viewW - WORLD_W * zoom) / 2, y: (viewH - WORLD_H * zoom) / 2, zoom }, viewW, viewH);
}

export interface CameraController {
  get(): Camera;
  set(cam: Camera): void;
  /** Call after the renderer resizes. */
  onResize(): void;
  destroy(): void;
}

export type PaintPhase = 'start' | 'move' | 'end' | 'cancel';

export interface CameraOptions {
  canvas: HTMLCanvasElement;
  world: Container;
  viewSize: () => { w: number; h: number };
  initial: Camera | null;
  onChange: (cam: Camera) => void;
  onTap: (screenX: number, screenY: number, cam: Camera) => void;
  /**
   * True while a painting tool (road, bridge, clear forest) is selected. Then a one-finger or
   * left-button drag paints tiles instead of panning. The right or middle mouse button, and
   * two fingers, always pan.
   */
  paintMode?: () => boolean;
  onPaint?: (phase: PaintPhase, screenX: number, screenY: number, cam: Camera) => void;
  /** Pointer moved over the map (or left it: null), for the placement preview. */
  onHover?: (screenX: number | null, screenY: number | null, cam: Camera) => void;
}

export function attachCamera(opts: CameraOptions): CameraController {
  const { canvas, world, viewSize, onChange, onTap } = opts;
  const v0 = viewSize();
  let cam = opts.initial ? clampCamera(opts.initial, v0.w, v0.h) : centredCamera(v0.w, v0.h);

  const apply = () => {
    world.position.set(Math.round(cam.x), Math.round(cam.y));
    world.scale.set(cam.zoom);
    onChange(cam);
  };
  const setCam = (next: Camera) => {
    const v = viewSize();
    cam = clampCamera(next, v.w, v.h);
    apply();
  };

  // Pointer tracking for drag and pinch.
  const pointers = new Map<number, { x: number; y: number }>();
  let dragStart: { x: number; y: number; cam: Camera } | null = null;
  let moved = false;
  let pinch: { dist: number; cam: Camera; mid: { x: number; y: number } } | null = null;
  let painting = false;

  const local = (e: PointerEvent | WheelEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e: PointerEvent) => {
    const p = local(e);
    pointers.set(e.pointerId, p);
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* some browsers refuse capture for synthetic events */
    }
    if (pointers.size === 1) {
      dragStart = { x: p.x, y: p.y, cam };
      moved = false;
      const primary = e.pointerType !== 'mouse' || e.button === 0;
      if (primary && opts.paintMode?.()) {
        painting = true;
        opts.onPaint?.('start', p.x, p.y, cam);
      }
    } else if (pointers.size === 2) {
      if (painting) {
        painting = false;
        opts.onPaint?.('cancel', p.x, p.y, cam);
      }
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cam, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      dragStart = null;
      moved = true;
    }
  };

  const onMove = (e: PointerEvent) => {
    const p = local(e);
    if (!pointers.has(e.pointerId)) {
      if (e.pointerType === 'mouse') opts.onHover?.(p.x, p.y, cam);
      return;
    }
    pointers.set(e.pointerId, p);
    if (painting) {
      opts.onHover?.(p.x, p.y, cam);
      opts.onPaint?.('move', p.x, p.y, cam);
      return;
    }
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const z = zoomAt(pinch.cam, dist / pinch.dist, pinch.mid.x, pinch.mid.y);
      setCam({ ...z, x: z.x + (mid.x - pinch.mid.x), y: z.y + (mid.y - pinch.mid.y) });
      return;
    }
    if (dragStart) {
      const dx = p.x - dragStart.x;
      const dy = p.y - dragStart.y;
      if (!moved && Math.hypot(dx, dy) > TAP_SLOP) moved = true;
      if (moved) setCam({ ...dragStart.cam, x: dragStart.cam.x + dx, y: dragStart.cam.y + dy });
    }
  };

  const onUp = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    const p = local(e);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      if (painting) {
        painting = false;
        opts.onPaint?.(e.type === 'pointerup' ? 'end' : 'cancel', p.x, p.y, cam);
      } else if (dragStart && !moved && e.type === 'pointerup') onTap(p.x, p.y, cam);
      dragStart = null;
    } else if (pointers.size === 1) {
      const [only] = [...pointers.values()];
      dragStart = { x: only.x, y: only.y, cam };
    }
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = local(e);
    // Trackpad pinch arrives as wheel + ctrlKey with small deltas; mouse wheels use larger steps.
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const delta = e.deltaY * unit;
    const factor = Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0015));
    setCam(zoomAt(cam, factor, p.x, p.y));
    opts.onHover?.(p.x, p.y, cam);
  };

  const onLeave = () => {
    if (!painting) opts.onHover?.(null, null, cam);
  };
  const noMenu = (e: Event) => e.preventDefault(); // right-drag pans instead of opening a menu

  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('contextmenu', noMenu);

  apply();

  return {
    get: () => cam,
    set: setCam,
    onResize: () => setCam(cam),
    destroy: () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('contextmenu', noMenu);
    },
  };
}
