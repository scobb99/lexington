// Building layer (Build Spec v2.0, Sections 3, 10 and 13).
// v2.0 polish (Section 13): every building is grounded with a soft ground tint and a contact
// shadow under its footprint, drawn on one Graphics under the sprites, so buildings sit in the
// terrain instead of floating on it. It redraws only when the buildings change.
// The building art is the approved Gemini set, keyed to PNG with transparency by
// scripts/art/process_art.py. Pixi loads each PNG once through Assets, and every building is
// ONE Sprite (a 2 x 2 building is one sprite, never four tiles), anchored bottom-centre to its
// footprint and scaled so its grass base spans the footprint's isometric diamond.
// Sprites are pooled by building id, sorted so buildings nearer the viewer draw on top, and
// only change when the buildings in the store change.

import { Assets, Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { BUILDINGS } from '../game/buildings';
import { store } from '../game/store';
import type { BuildingType } from '../game/types';
import spriteMeta from '../assets/buildings/sprites.json';
import cottageUrl from '../assets/buildings/cottage.png?url';
import sawmillUrl from '../assets/buildings/sawmill.png?url';
import quarryUrl from '../assets/buildings/quarry.png?url';
import marketUrl from '../assets/buildings/market.png?url';
import libraryUrl from '../assets/buildings/library.png?url';
import pierUrl from '../assets/buildings/pier.png?url';
import townHallUrl from '../assets/buildings/townhall.png?url';
import parkUrl from '../assets/buildings/park.png?url';
import greenhouseUrl from '../assets/buildings/greenhouse.png?url';
import tavernUrl from '../assets/buildings/tavern.png?url';
import wizardTowerUrl from '../assets/buildings/wizardtower.png?url';
import { depthKey, footprintAnchor, footprintDiamond } from './camera';

const ART: Record<BuildingType, string> = {
  cottage: cottageUrl,
  sawmill: sawmillUrl,
  quarry: quarryUrl,
  market: marketUrl,
  library: libraryUrl,
  pier: pierUrl,
  townHall: townHallUrl,
  park: parkUrl,
  greenhouse: greenhouseUrl,
  tavern: tavernUrl,
  wizardTower: wizardTowerUrl,
};

interface SpriteInfo {
  file: string;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  baseWidth: number;
  footprint: [number, number];
}
export const SPRITES = spriteMeta.sprites as unknown as Record<BuildingType, SpriteInfo>;

/** Where the chimney top sits in the cottage sprite (fraction of the image), for smoke. */
const COTTAGE_CHIMNEY = { x: 0.48, y: 0.035 };

export interface BuildingLayer {
  container: Container;
  /** Loaded art for a building type (for the placement preview), once loading is done. */
  texture(type: BuildingType): Texture | undefined;
  /** World positions of every real cottage's chimney top (Section 10: chimney smoke). */
  chimneys(): { x: number; y: number }[];
  destroy(): void;
}

/** Position, anchor and scale for one building sprite on its footprint (Section 3). */
export function spritePlacement(type: BuildingType, x: number, y: number, tex: Texture) {
  const def = BUILDINGS[type];
  const info = SPRITES[type];
  const at = footprintAnchor(x, y, def.w, def.h);
  // Grass base width (in texture pixels) -> footprint diamond width (in world pixels).
  const scale = at.width / ((info.baseWidth * tex.width) / info.width);
  return { x: at.x, y: at.y, anchorX: info.anchorX, anchorY: info.anchorY, scale };
}

/** Section 13 grounding: a soft earthy tint and a contact shadow under one footprint. */
function drawGrounding(g: Graphics, x: number, y: number, w: number, h: number): void {
  const [top, right, bottom, left] = footprintDiamond(x, y, w, h);
  const cx = (left.x + right.x) / 2;
  const cy = (top.y + bottom.y) / 2;
  const ring = (k: number, dy: number) => [top, right, bottom, left].flatMap((p) => [cx + (p.x - cx) * k, cy + (p.y - cy) * k + dy]);
  // Ground tint: worn earth around the base, fading out over a few steps (soft, no filter).
  for (const [k, a] of [[1.32, 0.05], [1.22, 0.07], [1.12, 0.09]] as const) g.beginFill(0x6b5a3a, a).drawPolygon(ring(k, 0)).endFill();
  // Contact shadow: darker, nudged toward the viewer, tight under the footprint.
  for (const [k, a] of [[1.06, 0.1], [0.96, 0.12], [0.84, 0.14]] as const) g.beginFill(0x1f2a1c, a).drawPolygon(ring(k, 3)).endFill();
}

export function createBuildingLayer(parent: Container, onError: (err: unknown) => void): BuildingLayer {
  const grounding = new Graphics();
  grounding.eventMode = 'none';
  parent.addChild(grounding);
  const container = new Container();
  container.sortableChildren = true;
  parent.addChild(container);

  const textures = new Map<BuildingType, Texture>();
  const sprites = new Map<number, Sprite>();
  let destroyed = false;

  const sync = () => {
    if (destroyed) return;
    grounding.clear();
    for (const b of store.state.buildings) {
      const d = BUILDINGS[b.type];
      if (b.type !== 'pier') drawGrounding(grounding, b.x, b.y, d.w, d.h);
    }
    const live = new Set<number>();
    for (const b of store.state.buildings) {
      const tex = textures.get(b.type);
      if (!tex) continue;
      live.add(b.id);
      let s = sprites.get(b.id);
      if (!s) {
        s = new Sprite(tex);
        s.eventMode = 'none';
        sprites.set(b.id, s);
        container.addChild(s);
      }
      const def = BUILDINGS[b.type];
      const at = spritePlacement(b.type, b.x, b.y, tex);
      s.texture = tex;
      s.anchor.set(at.anchorX, at.anchorY);
      s.scale.set(at.scale);
      s.position.set(at.x, at.y);
      s.zIndex = depthKey(b.x, b.y, def.w, def.h);
    }
    for (const [id, s] of sprites) {
      if (!live.has(id)) {
        s.destroy();
        sprites.delete(id);
      }
    }
  };

  const unsubscribe = store.subscribe('buildings', sync);

  // Load every building PNG once, then draw.
  (async () => {
    const entries = Object.entries(ART) as [BuildingType, string][];
    for (const [type, url] of entries) {
      const key = `building-${type}`;
      if (!Assets.resolver.hasKey(key)) Assets.add({ alias: key, src: url }); // object form: no v7.2 deprecation warning
    }
    const loaded = (await Assets.load(entries.map(([type]) => `building-${type}`))) as Record<string, Texture>;
    for (const [type] of entries) {
      const tex = loaded[`building-${type}`];
      if (!tex || !tex.valid || tex.width <= 0 || tex.height <= 0) {
        throw new Error(`Building art for ${type} did not load as a valid texture.`);
      }
      textures.set(type, tex);
    }
    sync();
  })().catch((err) => {
    if (!destroyed) onError(err);
  });

  return {
    container,
    texture: (type) => textures.get(type),
    chimneys() {
      const tex = textures.get('cottage');
      if (!tex) return [];
      return store.state.buildings
        .filter((b) => b.type === 'cottage' && !b.preview)
        .map((b) => {
          const at = spritePlacement('cottage', b.x, b.y, tex);
          return {
            x: at.x + (COTTAGE_CHIMNEY.x - at.anchorX) * tex.width * at.scale,
            y: at.y + (COTTAGE_CHIMNEY.y - at.anchorY) * tex.height * at.scale,
          };
        });
    },
    destroy() {
      destroyed = true;
      unsubscribe();
      sprites.clear();
      // Keep the textures: they live in the Assets cache and are reused if the map reloads.
      container.destroy({ children: true, texture: false, baseTexture: false });
      grounding.destroy();
    },
  };
}
