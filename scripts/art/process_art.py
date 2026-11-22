"""Lexington art pipeline (Build Spec v2.0, Sections 3, 10 and 13).

Turns the approved Gemini JPGs (white background) into game-ready PNGs with transparency.

Usage:
    python3 -I process_art.py <folder with the 17 approved JPGs> <repo src/assets folder>

Buildings (cottage.jpg ... wizardtower.jpg):
  * Key out the white background, keep the grass base and the soft shadow.
  * Measure the grass base (left, right, bottom) so the game can anchor each sprite
    bottom-centre on its footprint and scale it so the base matches the footprint diamonds.
  * Write src/assets/buildings/<name>.png and src/assets/buildings/sprites.json.

Terrain (terrain-<type>.jpg and terrain-<type>-<n>.jpg; the plain name is variant 1):
each Gemini tile is a thick slab (top face plus brown soil sides).
Tiling the slabs directly would show a grid of soil edges, which Section 3 forbids, so:
  * splat-<type>-<n>.png (meadow, marsh, water): the tile's own top face with a soft
    diamond edge, fitted to the game's 64 x 40 diamond.
  * props-<type>-<n>.png (forest, hill, thicket): the trees / hill mound / brambles cut out
    of the tile, so they stand on the baked ground.
  * terrain-<type>-<n>.png: the keyed full tile, kept as the record of the approved art.
  * terrain.json: per-variant anchors and sizes, plus per-type colours (ground, bank, soil).
  The game's variant manifest (src/pixi/terrainVariants.ts) decides where each variant goes.

Terrain polish pieces (Section 13, v2.0), when Gemini delivers them, named polish-<id>.jpg:
  polish-hill-peak.jpg, polish-forest-canopy-1.jpg, polish-forest-canopy-2.jpg,
  polish-tree-large-1.jpg -> props-<id>.png (keyed, trimmed, 4 px per game pixel)
  polish-edge-marsh-1.jpg, polish-edge-water-1.jpg -> splat-<id>.png (keyed, soft edge)
  Their slots already exist in POLISH_ART (src/pixi/terrainVariants.ts), so the game uses them
  on the next build with no code changes.
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

SRC, OUT = sys.argv[1], sys.argv[2]
BUILD_OUT = os.path.join(OUT, 'buildings')
TERRAIN_OUT = os.path.join(OUT, 'terrain')
os.makedirs(BUILD_OUT, exist_ok=True)
os.makedirs(TERRAIN_OUT, exist_ok=True)

# Game constants (Build Spec v1.5, Section 2): isometric tile 64 x 40.
TILE_W = 64
TILE_H = 40
# Textures are stored at this many pixels per game pixel, so they stay sharp when zoomed in.
TEXTURE_DENSITY = 4

# Building type -> (file stem, footprint w, footprint h, has see-through gaps)
BUILDINGS = {
    'cottage': ('cottage', 1, 1, False),
    'sawmill': ('sawmill', 2, 2, False),
    'quarry': ('quarry', 2, 2, False),
    'market': ('market', 3, 2, True),  # open timber frame: white shows through the gaps
    'library': ('library', 2, 2, False),
    'pier': ('pier', 2, 1, False),
    'townHall': ('townhall', 3, 3, False),
    'park': ('park', 2, 2, False),
    'greenhouse': ('greenhouse', 3, 2, False),
    'tavern': ('tavern', 2, 2, False),
    'wizardTower': ('wizardtower', 2, 2, False),
}


def load(stem):
    return np.asarray(Image.open(os.path.join(SRC, stem + '.jpg')).convert('RGB')).astype(np.float32)


def key_white(rgb, holes=False):
    """Returns (rgba float array, background mask). Keeps soft shadows and soft grass edges.

    1. Background = near-white pixels connected to the image border (plus enclosed white
       gaps when `holes` is set, for see-through structures like the Market frame).
    2. Soft band = light pixels reachable from the background without crossing the art's dark
       outlines: the feathered grass edge and the grey drop shadow. Their alpha comes from
       how far they are from white, and their colour is un-mixed from the white behind them.
    3. Everything else (inside the outlines) stays fully opaque, so light parts of the art,
       like the Town Hall clock face, are never made see-through.
    """
    mn = rgb.min(axis=2)
    mx = rgb.max(axis=2)
    sat = mx - mn
    near_white = (mn >= 236) & (sat <= 16)
    lab, n = ndi.label(near_white)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border))
    if holes:
        sizes = ndi.sum(near_white, lab, range(1, n + 1))
        big = [i + 1 for i, s in enumerate(sizes) if s >= 150]
        bg |= np.isin(lab, big)
    light = mn >= 105
    soft = ndi.binary_dilation(bg, iterations=70, mask=light) & ~bg
    c2a = np.clip((255.0 - mn) / 255.0 / 0.58, 0.0, 1.0)
    alpha = np.ones(mn.shape, np.float32)
    alpha[soft] = c2a[soft]
    alpha[bg] = 0.0
    # One-pixel anti-aliasing where opaque art meets the background.
    edge = ndi.binary_dilation(bg, iterations=1) & ~bg & ~soft
    alpha[edge] = np.maximum(c2a[edge], 0.35)
    a3 = alpha[..., None]
    color = np.where(a3 > 0.02, (rgb - (1.0 - a3) * 255.0) / np.maximum(a3, 0.02), 0.0)
    color = np.clip(color, 0, 255)
    return np.dstack([color, alpha * 255.0]), bg


def to_image(rgba):
    return Image.fromarray(np.clip(rgba + 0.5, 0, 255).astype(np.uint8), 'RGBA')


def resize_rgba(img, size):
    """Resize with premultiplied alpha so transparent edges never get light fringes."""
    return img.convert('RGBa').resize(size, Image.LANCZOS).convert('RGBA')


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- buildings
sprites = {}
for btype, (stem, fw, fh, holes) in BUILDINGS.items():
    rgb = load(stem)
    rgba, bg = key_white(rgb, holes)
    alpha = rgba[..., 3] / 255.0
    # The object without its shadow: the soft shadow and the feathered grass edge were given
    # partial alpha by key_white, so the fully opaque pixels are the building and its base.
    # (Light parts of the art, like the Town Hall's near-white walls, stay fully opaque.)
    obj = alpha >= 0.995
    obj = ndi.binary_opening(obj, iterations=2)
    lab, n = ndi.label(obj)
    sizes = ndi.sum(obj, lab, range(1, n + 1))
    obj = lab == (1 + int(np.argmax(sizes)))
    ys, xs = np.nonzero(obj)
    base_left, base_right, base_bottom = int(xs.min()), int(xs.max()), int(ys.max())
    base_w = base_right - base_left
    # Scale so the base spans the footprint diamond width at TEXTURE_DENSITY.
    diamond_w = (fw + fh) * TILE_W / 2
    scale = diamond_w * TEXTURE_DENSITY / base_w
    # Trim to the visible pixels (with a small margin) before scaling.
    vis_y, vis_x = np.nonzero(alpha > 0.01)
    x0, x1 = max(0, vis_x.min() - 8), min(rgb.shape[1], vis_x.max() + 9)
    y0, y1 = max(0, vis_y.min() - 8), min(rgb.shape[0], vis_y.max() + 9)
    img = to_image(rgba[y0:y1, x0:x1])
    out_w = max(1, round((x1 - x0) * scale))
    out_h = max(1, round((y1 - y0) * scale))
    img = resize_rgba(img, (out_w, out_h))
    img.save(os.path.join(BUILD_OUT, stem + '.png'), optimize=True)
    sprites[btype] = {
        'file': stem + '.png',
        'width': out_w,
        'height': out_h,
        # Bottom-centre of the grass base, as a fraction of the image (Pixi anchor).
        'anchorX': round(((base_left + base_right) / 2 - x0) / (x1 - x0), 5),
        'anchorY': round((base_bottom - y0) / (y1 - y0), 5),
        # Grass base width in this PNG's pixels; the game scales this to the footprint width.
        'baseWidth': round(base_w * scale, 2),
        'footprint': [fw, fh],
    }
    print(f'{btype:12s} {out_w}x{out_h}  base {base_w}px src -> {sprites[btype]["baseWidth"]}px')

with open(os.path.join(BUILD_OUT, 'sprites.json'), 'w') as f:
    json.dump({'textureDensity': TEXTURE_DENSITY, 'sprites': sprites}, f, indent=2)

# ---------------------------------------------------------------- terrain
# Biomes whose ground comes from the tile's own top face, as soft-edged "splats".
SPLAT = {'meadow', 'marsh', 'water'}
# Biomes whose top face is mostly covered by props: their ground is the tile's sampled ground
# colour, and the props (trees, mound, brambles) become stamps.
PROPS = {'forest', 'hill', 'thicket'}
# Clean ground rectangles (source pixels) used only to sample each tile's ground colour.
GROUND_RECT = {
    'meadow': (720, 830, 1330, 1170),
    'water': (700, 820, 1350, 1180),
    'marsh': (640, 860, 1420, 1240),
    'forest': (430, 1150, 760, 1300),
    'hill': (520, 1200, 860, 1330),
    'thicket': (880, 1080, 1180, 1200),
}
# Colour distance from the ground colour above which a pixel counts as part of a prop.
PROP_THRESHOLD = {'forest': 45, 'hill': 30, 'thicket': 30}
# How much of the tile's face each splat keeps (1 = to the face outline). Water keeps only its
# calm centre: the Gemini water tile has a bright rim that would repeat as a scale pattern.
SPLAT_INNER = {'meadow': 0.9, 'marsh': 0.9, 'water': 0.6}
# A splat covers this many tiles' width, so neighbouring splats overlap and hide seams.
SPLAT_SPAN = 1.35

import re
terrain_meta = {'textureDensity': 2, 'types': {}, 'variants': {}}
files = sorted(f for f in os.listdir(SRC) if re.fullmatch(r'terrain-[a-z]+(-\d+)?\.jpg', f))
jobs = []
for f in files:
    m = re.fullmatch(r'terrain-([a-z]+)(?:-(\d+))?\.jpg', f)
    jobs.append((m.group(1), int(m.group(2) or 1), f[:-4]))
jobs.sort(key=lambda j: (j[0], j[1]))  # variant 1 of each type first: it supplies the type's colours

for biome, n, stem in jobs:
    vid = f'{biome}-{n}'
    rgb = load(stem)
    rgba, bg = key_white(rgb)
    alpha = rgba[..., 3] / 255.0

    # Geometry of the slab: widest row gives the left/right corners of the top face.
    solid = alpha > 0.5
    ys, xs = np.nonzero(solid)
    left, right = xs.min(), xs.max()
    face_w = right - left
    cx = (left + right) / 2.0
    left_col = ys[xs <= left + 3]
    right_col = ys[xs >= right - 3]
    corner_y = (left_col.min() + right_col.min()) / 2.0
    thickness = ((left_col.max() - left_col.min()) + (right_col.max() - right_col.min())) / 2.0
    centre_rows = ys[np.abs(xs - (left + right) / 2.0) <= 3]
    face_bottom = centre_rows.max() - thickness
    face_h = 2 * (face_bottom - corner_y)
    cy = corner_y
    if biome == 'thicket' or not 1.45 <= face_w / max(face_h, 1) <= 1.8:
        # Brambles (or tall props) can spill past the slab's corners; measure the face from
        # its own ground colour instead and use the set's typical projection (~1.58 : 1).
        # The brown soil band is never covered: its left and right ends sit under the face's
        # side corners and its lowest point under the face's bottom vertex.
        r_, g_ = rgb[..., 0], rgb[..., 1]
        soil = ndi.binary_opening((r_ > g_ + 8) & (rgb.max(axis=2) < 170) & (alpha > 0.8), iterations=2)
        # Roots can cut the band into pieces, so keep every sizeable piece of it.
        lab, k_ = ndi.label(soil)
        sizes = ndi.sum(soil, lab, range(1, k_ + 1))
        sy_, sx_ = np.nonzero(np.isin(lab, [i + 1 for i, s_ in enumerate(sizes) if s_ >= 0.15 * sizes.max()]))
        left, right = sx_.min(), sx_.max()
        face_w = right - left
        cx = (left + right) / 2.0
        band = ((sy_[sx_ <= left + 6].max() - sy_[sx_ <= left + 6].min())
                + (sy_[sx_ >= right - 6].max() - sy_[sx_ >= right - 6].min())) / 2.0
        face_bottom = sy_[np.abs(sx_ - cx) <= 4].max() - band
        face_h = face_w / 1.58
        cy = face_bottom - face_h / 2
    ratio = face_w / face_h

    # Keyed full tile, kept as the record of the approved art.
    vy, vx = np.nonzero(alpha > 0.01)
    full = to_image(rgba[vy.min():vy.max() + 1, vx.min():vx.max() + 1])
    full = resize_rgba(full, (384, round(384 * full.height / full.width)))
    full.save(os.path.join(TERRAIN_OUT, f'terrain-{vid}.png'), optimize=True)

    density = terrain_meta['textureDensity']
    H, W = alpha.shape
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    q = np.abs(xx - cx) / (face_w / 2) + np.abs(yy - cy) / (face_h / 2)  # 0 centre, 1 face edge

    if n == 1:
        # Type-level colours come from variant 1 (the originally approved tile).
        x0, y0, x1, y1 = GROUND_RECT[biome]
        patch = rgb[y0:y1, x0:x1]
        ground = np.median(patch.reshape(-1, 3), axis=0)
        soil = rgb[int(face_bottom) + 15: int(face_bottom) + 40, int(cx) - 20: int(cx) + 20].reshape(-1, 3)
        tmeta = {
            'groundColor': '#%02x%02x%02x' % tuple(int(v) for v in ground),
            'soilColor': '#%02x%02x%02x' % tuple(int(v) for v in np.median(soil, axis=0)),
        }
        if biome == 'water':
            face = rgb[(q < 0.97) & (alpha > 0.9)]
            watery = face[face[:, 2] > face[:, 0] + 20]
            lum = watery.mean(axis=1)
            bright = watery[lum >= np.percentile(lum, 95)]
            tmeta['bankColor'] = '#%02x%02x%02x' % tuple(int(v) for v in np.median(bright, axis=0))
        terrain_meta['types'][biome] = tmeta
    ground = np.array([int(terrain_meta['types'][biome]['groundColor'][i:i + 2], 16) for i in (1, 3, 5)], np.float32)

    vmeta = {'type': biome, 'variant': n, 'faceWidth': int(face_w), 'faceHeight': int(face_h),
             'projectionRatio': round(float(ratio), 3)}

    if biome in SPLAT:
        # ---- splat: the face itself with a soft diamond-shaped edge, fitted to 64 x 40
        inner = SPLAT_INNER[biome]
        a = smoothstep(inner, inner - 0.35, q)
        sy0, sy1 = int(cy - face_h / 2 * inner), int(cy + face_h / 2 * inner)
        sx0, sx1 = int(cx - face_w / 2 * inner), int(cx + face_w / 2 * inner)
        splat = np.dstack([rgb, a * 255.0])[sy0:sy1, sx0:sx1]
        out_w = round(TILE_W * SPLAT_SPAN * density)
        img = resize_rgba(to_image(splat), (out_w, round(out_w * TILE_H / TILE_W)))
        img.save(os.path.join(TERRAIN_OUT, f'splat-{vid}.png'), optimize=True)
        vmeta['kind'] = 'splat'
        vmeta['file'] = f'splat-{vid}.png'
        vmeta['width'] = img.width
        vmeta['height'] = img.height
        vmeta['span'] = SPLAT_SPAN

    if biome in PROPS:
        rgba, _ = key_white(rgb, holes=(biome != 'hill'))
        alpha = rgba[..., 3] / 255.0
        # Everything inside the art's outline is solid paint. Light grey rock can otherwise be
        # mistaken for the soft white edge, so fill the silhouette back in.
        sil = ndi.binary_fill_holes(ndi.binary_closing(alpha > 0.12, iterations=3))
        if biome == 'hill':
            alpha = np.where(sil, 1.0, alpha)
            rgba[..., :3] = np.where(sil[..., None], rgb, rgba[..., :3])
        dist = np.sqrt(((rgb - ground[None, None, :]) ** 2).sum(axis=2))
        allowed = ~((q > 0.96) & (yy > cy))
        mask = (alpha > 0.5) & (dist > PROP_THRESHOLD[biome]) & allowed
        if biome == 'hill':
            r_, g_, b_ = rgb[..., 0], rgb[..., 1], rgb[..., 2]
            ochre = (r_ > g_ + 15) & (g_ > b_ + 10)
            grey = (rgb.max(axis=2) - rgb.min(axis=2) < 48) & (rgb.min(axis=2) > 150)  # warm stone greys
            tree = (g_ > r_ + 12) & (rgb.max(axis=2) < 110)  # dark pine on hill variants
            core = ndi.binary_opening(ochre | grey | tree, iterations=3) & (alpha > 0.5) & allowed
            lab, k_ = ndi.label(core)
            sizes = ndi.sum(core, lab, range(1, k_ + 1))
            core = np.isin(lab, [i + 1 for i, s_ in enumerate(sizes) if s_ >= 3000])
            mask = ndi.binary_fill_holes(ndi.binary_dilation(core, iterations=5)) & (alpha > 0.5)
        if biome == 'hill':
            # Drop the thin rim outline that runs from the mound to the slab's corner.
            mask = ndi.binary_opening(mask, structure=ndi.generate_binary_structure(2, 2), iterations=10)
        mask = ndi.binary_opening(mask, structure=ndi.generate_binary_structure(2, 1), iterations=6)
        lab, k_ = ndi.label(mask)
        if k_:
            sizes = ndi.sum(mask, lab, range(1, k_ + 1))
            mask = np.isin(lab, [i + 1 for i, s_ in enumerate(sizes) if s_ >= 400])
        vis = ndi.gaussian_filter(mask.astype(np.float32), 2.0)
        if biome == 'thicket':
            front_fade = np.where(yy < cy, 1.0, smoothstep(0.95, 0.75, q))
            vis = np.where(allowed, front_fade, 0.0)
        a = alpha * vis
        a = ndi.gaussian_filter(a, 1.0)
        stamp = rgba.copy()
        stamp[..., 3] = np.clip(a * 255.0, 0, 255)
        vy, vx = np.nonzero(stamp[..., 3] > 3)
        sy0, sy1 = vy.min(), vy.max() + 1
        sx0, sx1 = vx.min(), vx.max() + 1
        crop = to_image(stamp[sy0:sy1, sx0:sx1])
        k = TILE_W * density / face_w
        crop = resize_rgba(crop, (max(1, round(crop.width * k)), max(1, round(crop.height * k))))
        crop.save(os.path.join(TERRAIN_OUT, f'props-{vid}.png'), optimize=True)
        vmeta['kind'] = 'props'
        vmeta['file'] = f'props-{vid}.png'
        vmeta['width'] = crop.width
        vmeta['height'] = crop.height
        vmeta['anchorX'] = round((cx - sx0) / (sx1 - sx0), 5)
        vmeta['anchorY'] = round((cy - sy0) / (sy1 - sy0), 5)

    terrain_meta['variants'][vid] = vmeta
    print(f'{vid:10s} face {face_w}x{face_h:.0f} ratio {ratio:.2f} -> {vmeta["file"]}')

with open(os.path.join(TERRAIN_OUT, 'terrain.json'), 'w') as f:
    json.dump(terrain_meta, f, indent=2)

# ---------------------------------------------------------------- Section 13 polish pieces
# Width in game tiles for each piece (matches POLISH_ART "tiles" in terrainVariants.ts).
POLISH_TILES = {'hill-peak': 2.6, 'forest-canopy-1': 1.9, 'forest-canopy-2': 1.9, 'tree-large-1': 1.2,
                'edge-marsh-1': 1.6, 'edge-water-1': 1.6}
for f in sorted(os.listdir(SRC)):
    m = re.fullmatch(r'polish-([a-z0-9-]+)\.jpg', f)
    if not m:
        continue
    pid = m.group(1)
    rgba, _ = key_white(load(f[:-4]))
    vy, vx = np.nonzero(rgba[..., 3] > 3)
    img = to_image(rgba[vy.min():vy.max() + 1, vx.min():vx.max() + 1])
    out_w = round(TILE_W * POLISH_TILES.get(pid, 1.5) * TEXTURE_DENSITY)
    img = resize_rgba(img, (out_w, round(out_w * img.height / img.width)))
    name = ('splat-' if pid.startswith('edge-') else 'props-') + pid + '.png'
    img.save(os.path.join(TERRAIN_OUT, name), optimize=True)
    print(f'polish {pid:16s} -> {name}')
print('done')
