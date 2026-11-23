"""Lexington v3 art (Build Spec v3.0; integrated in v3.0.2).

Turns the v3 Gemini set (white background, delivered Nov 22, 2026) into game-ready PNGs with
transparency, cut the same way the existing pipeline (process_art.py) cuts its sheets:

  town-center.jpg       -> src/assets/buildings/towncenter.png      (2 by 2 building)
  scribe.jpg            -> src/assets/buildings/scribe.png          (2 by 2 building)
  landmarks-sheet.jpg   -> src/assets/buildings/landmark-<id>.png   (six 1 by 1 landmarks)
      3 by 2 grid, in order: fountain, marketCross, lanternPost (top row);
                             oakArch, riverBell, foundersSpire (bottom row).
      Each landmark stands on a raised square slab in the sheet. The slab's soil sides (and the
      drop shadow below them) are cut away along the top face's front edges, so the landmark
      sits on the map on its own grass face, like the other buildings' grass bases.
  overlays-sheet.jpg    -> src/assets/ui/stamp-oak.png, stamp-granite.png, stamp-gilded.png,
                           rune-tile.png, lantern.png
      3 by 2 grid: oak stamp, granite stamp, gilded tile (top row); rune tile (two variants) and
      the lantern (bottom row). The second rune variant (the R rune with sparkles) is used: it
      reads as the rune letter at tile size and matches the game's R-rune glyph. The lantern is
      cut off its grass slab so it reads as an icon.
  terrain-foothills.jpg -> src/assets/terrain/props-hill-1..4.png (+ terrain-hill-1..4.png record)
      2 by 2 grid of hill forms on raised slabs: the hill forms are cut out (not the slabs) and
      anchored at the face centre, the same way the existing terrain props are grounded; the
      hill type's ground and soil colours are re-sampled from the sheet. Order: top-left -> 1
      (mound with rocks), top-right -> 2 (ledge), bottom-left -> 3 (two mounds),
      bottom-right -> 4 (rockiest dome, used for hill patch interiors).

Usage:
    python3 -I process_v3_art.py <folder with the 5 JPGs> <repo src/assets folder>

The sprite manifest (buildings/sprites.json) and terrain manifest (terrain/terrain.json) are
updated in place: only the entries named above change, and their placeholder flags are cleared.
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
UI_OUT = os.path.join(OUT, 'ui')

TILE_W = 64
TILE_H = 40
TEXTURE_DENSITY = 4  # buildings (process_art.py)
TERRAIN_DENSITY = 2  # terrain props (process_art.py)


def load(stem):
    return np.asarray(Image.open(os.path.join(SRC, stem + '.jpg')).convert('RGB')).astype(np.float32)


def key_white(rgb, holes=False):
    """process_art.py's keying: background = near-white connected to the border; a soft band for
    shadows and feathered grass; everything inside the outlines stays opaque."""
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
    edge = ndi.binary_dilation(bg, iterations=1) & ~bg & ~soft
    alpha[edge] = np.maximum(c2a[edge], 0.35)
    a3 = alpha[..., None]
    color = np.where(a3 > 0.02, (rgb - (1.0 - a3) * 255.0) / np.maximum(a3, 0.02), 0.0)
    color = np.clip(color, 0, 255)
    return np.dstack([color, alpha * 255.0]), bg


def to_image(rgba):
    return Image.fromarray(np.clip(rgba + 0.5, 0, 255).astype(np.uint8), 'RGBA')


def resize_rgba(img, size):
    return img.convert('RGBa').resize(size, Image.LANCZOS).convert('RGBA')


def cells(rgb, count):
    """The sheet's pieces: the `count` largest non-white blobs, sorted top row first, then left
    to right. Returns (y0, y1, x0, x1) crops with a margin."""
    mn = rgb.min(axis=2)
    ink = ~((mn >= 236) & ((rgb.max(axis=2) - mn) <= 16))
    ink = ndi.binary_closing(ink, iterations=6)
    lab, n = ndi.label(ink)
    sizes = ndi.sum(ink, lab, range(1, n + 1))
    keep = sorted(range(n), key=lambda i: -sizes[i])[:count]
    boxes = []
    for i in keep:
        ys, xs = np.nonzero(lab == i + 1)
        boxes.append((ys.min(), ys.max() + 1, xs.min(), xs.max() + 1))
    rows = sorted(boxes, key=lambda b: (b[0] + b[1]) / 2)
    # group into rows by vertical centre
    out, row = [], []
    for b in rows:
        if row and abs((b[0] + b[1]) / 2 - (row[0][0] + row[0][1]) / 2) > rgb.shape[0] / 6:
            out += sorted(row, key=lambda r: r[2])
            row = []
        row.append(b)
    out += sorted(row, key=lambda r: r[2])
    H, W = mn.shape
    m = 40
    return [(max(0, y0 - m), min(H, y1 + m), max(0, x0 - m), min(W, x1 + m)) for y0, y1, x0, x1 in out]


def slab_geometry(rgb, alpha):
    """For art on a raised slab: the top face's left and right corners, its front (bottom) vertex
    and the face size, measured from the brown soil band (process_art.py's thicket method)."""
    r_, g_ = rgb[..., 0], rgb[..., 1]
    soil = ndi.binary_opening((r_ > g_ + 8) & (rgb.max(axis=2) < 170) & (alpha > 0.8), iterations=2)
    lab, k_ = ndi.label(soil)
    sizes = ndi.sum(soil, lab, range(1, k_ + 1))
    sy_, sx_ = np.nonzero(np.isin(lab, [i + 1 for i, s_ in enumerate(sizes) if s_ >= 0.15 * sizes.max()]))
    left, right = sx_.min(), sx_.max()
    cx = (left + right) / 2.0
    lband = sy_[sx_ <= left + 6]
    rband = sy_[sx_ >= right - 6]
    band = ((lband.max() - lband.min()) + (rband.max() - rband.min())) / 2.0
    corner_y = (lband.min() + rband.min()) / 2.0
    face_bottom = sy_[np.abs(sx_ - cx) <= 4].max() - band
    return {'left': float(left), 'right': float(right), 'cx': cx, 'corner_y': corner_y, 'bottom': float(face_bottom),
            'face_w': float(right - left), 'face_h': 2 * float(face_bottom - corner_y), 'band': band}


def below_front_edges(shape, g, pad=0.0):
    """True for pixels below the face's two front edges (left corner -> front vertex -> right
    corner): the slab's soil sides and the drop shadow under them."""
    H, W = shape
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    lx, ly = g['left'], g['corner_y']
    bx, by = g['cx'], g['bottom']
    rx, ry = g['right'], g['corner_y']
    yl = ly + (xx - lx) * (by - ly) / max(bx - lx, 1)
    yr = by + (xx - bx) * (ry - by) / max(rx - bx, 1)
    edge_y = np.where(xx <= bx, yl, yr)
    return yy > edge_y + pad


manifest_path = os.path.join(BUILD_OUT, 'sprites.json')
manifest = json.load(open(manifest_path))
sprites = manifest['sprites']
placeholders = set(manifest.get('placeholders', []))


def write_building(key, file, rgba, base_left, base_right, base_bottom, fw, fh, note):
    alpha = rgba[..., 3] / 255.0
    base_w = base_right - base_left
    scale = (fw + fh) * TILE_W / 2 * TEXTURE_DENSITY / base_w
    vis_y, vis_x = np.nonzero(alpha > 0.01)
    x0, x1 = max(0, vis_x.min() - 8), min(alpha.shape[1], vis_x.max() + 9)
    y0, y1 = max(0, vis_y.min() - 8), min(alpha.shape[0], vis_y.max() + 9)
    img = to_image(rgba[y0:y1, x0:x1])
    out_w = max(1, round((x1 - x0) * scale))
    out_h = max(1, round((y1 - y0) * scale))
    img = resize_rgba(img, (out_w, out_h))
    img.save(os.path.join(BUILD_OUT, file), optimize=True)
    sprites[key] = {
        'file': file,
        'width': out_w,
        'height': out_h,
        'anchorX': round(((base_left + base_right) / 2 - x0) / (x1 - x0), 5),
        'anchorY': round((base_bottom - y0) / (y1 - y0), 5),
        'baseWidth': round(base_w * scale, 2),
        'footprint': [fw, fh],
    }
    placeholders.discard(key)
    print(f'{key:24s} {out_w}x{out_h}  base {base_w:.0f}px  {note}')


# ---------------------------------------------------------------- the two buildings
for key, stem, file in (('townCenter', 'town-center', 'towncenter.png'), ('scribe', 'scribe', 'scribe.png')):
    rgb = load(stem)
    rgba, _ = key_white(rgb)
    alpha = rgba[..., 3] / 255.0
    obj = ndi.binary_opening(alpha >= 0.995, iterations=2)
    lab, n = ndi.label(obj)
    sizes = ndi.sum(obj, lab, range(1, n + 1))
    obj = lab == (1 + int(np.argmax(sizes)))
    ys, xs = np.nonzero(obj)
    write_building(key, file, rgba, int(xs.min()), int(xs.max()), int(ys.max()), 2, 2, 'grass island base')

# ---------------------------------------------------------------- the six landmarks
LANDMARKS = ['fountain', 'marketCross', 'lanternPost', 'oakArch', 'riverBell', 'foundersSpire']
sheet = load('landmarks-sheet')
for lid, (y0, y1, x0, x1) in zip(LANDMARKS, cells(sheet, 6)):
    rgb = sheet[y0:y1, x0:x1]
    # The Old Oak Arch is see-through under the arch: key its enclosed white too.
    rgba, _ = key_white(rgb, holes=(lid == 'oakArch'))
    alpha = rgba[..., 3] / 255.0
    g = slab_geometry(rgb, alpha)
    cut = below_front_edges(alpha.shape, g, pad=1.5)
    a = np.where(cut, 0.0, alpha)
    # A soft one-pixel edge along the cut.
    a = np.minimum(a, np.clip(1.0 - ndi.gaussian_filter(cut.astype(np.float32), 0.8), 0, 1) + (~cut) * 0.0)
    rgba[..., 3] = a * 255.0
    write_building(f'landmark-{lid}', f'landmark-{lid}.png', rgba, g['left'], g['right'], g['bottom'], 1, 1,
                   f'slab face {g["face_w"]:.0f}x{g["face_h"]:.0f} (ratio {g["face_w"] / max(g["face_h"], 1):.2f}), soil cut')

manifest['sprites'] = sprites
manifest['placeholders'] = sorted(placeholders)
with open(manifest_path, 'w') as f:
    json.dump(manifest, f, indent=2)

# ---------------------------------------------------------------- overlays (UI)
os.makedirs(UI_OUT, exist_ok=True)
sheet = load('overlays-sheet')
boxes = cells(sheet, 6)
names = ['stamp-oak', 'stamp-granite', 'stamp-gilded', None, 'rune-tile', 'lantern']
SIZES = {'stamp-oak': 96, 'stamp-granite': 96, 'stamp-gilded': 96, 'rune-tile': 160, 'lantern': 96}
for name, (y0, y1, x0, x1) in zip(names, boxes):
    if not name:
        continue  # the first rune variant (not used)
    rgb = sheet[y0:y1, x0:x1]
    rgba, _ = key_white(rgb)
    alpha = rgba[..., 3] / 255.0
    if name == 'lantern':
        # Cut the lantern off its grass slab and cobbles: the lantern is the dark-framed body
        # standing on the slab; keep its frame's bounding box (with a little of the glow).
        g = slab_geometry(rgb, alpha)
        dark = (rgb.max(axis=2) < 120) & (alpha > 0.5)
        green = (rgb[..., 1] > rgb[..., 0] + 6) & (rgb[..., 1] > rgb[..., 2] + 6)
        cols = np.abs(np.arange(alpha.shape[1]) - g['cx']) < g['face_w'] * 0.3
        frame_ = dark & ~green & cols[None, :]
        frame_[int(g['corner_y']):] = False  # nothing from the slab's front half
        lab, n = ndi.label(ndi.binary_closing(frame_, iterations=4))
        sizes = ndi.sum(frame_, lab, range(1, n + 1))
        body = lab == (1 + int(np.argmax(sizes)))
        ys, xs = np.nonzero(body)
        by0, by1, bx0, bx1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        pad = int((bx1 - bx0) * 0.18)
        box = np.zeros_like(alpha)
        box[max(0, by0 - pad):by1 + 2, max(0, bx0 - pad):bx1 + pad] = 1.0
        rgba[..., 3] = alpha * ndi.gaussian_filter(box, 2) * 255.0
        vy, vx = np.nonzero(rgba[..., 3] > 6)
        crop = rgba[vy.min():vy.max() + 1, vx.min():vx.max() + 1]
        print(f'lantern: body {bx1 - bx0}x{by1 - by0}')
    else:
        vy, vx = np.nonzero(alpha > 0.02)
        crop = rgba[vy.min():vy.max() + 1, vx.min():vx.max() + 1]
    img = to_image(crop)
    size = SIZES[name]
    k = size / max(img.width, img.height)
    img = resize_rgba(img, (max(1, round(img.width * k)), max(1, round(img.height * k))))
    img.save(os.path.join(UI_OUT, name + '.png'), optimize=True)
    print(f'{name:14s} {img.width}x{img.height}')

# ---------------------------------------------------------------- foothills (terrain props)
tmeta_path = os.path.join(TERRAIN_OUT, 'terrain.json')
tmeta = json.load(open(tmeta_path))
sheet = load('terrain-foothills')
for n, (y0, y1, x0, x1) in enumerate(cells(sheet, 4), start=1):
    vid = f'hill-{n}'
    rgb = sheet[y0:y1, x0:x1]
    rgba, _ = key_white(rgb)
    alpha = rgba[..., 3] / 255.0
    g = slab_geometry(rgb, alpha)
    cx, face_w, face_h = g['cx'], g['face_w'], g['face_h']
    cy = g['corner_y']
    H, W = alpha.shape
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    # The face's back half, measured from the painted back edges near each side corner (the hill
    # never reaches that far out): the top of the art 15 percent in from each corner.
    solid = alpha > 0.5
    tops = []
    for xs_ in (int(g['left'] + 0.15 * face_w), int(g['right'] - 0.15 * face_w)):
        col = np.nonzero(solid[:, xs_])[0]
        tops.append((cy - col.min()) / (0.15 * face_w))  # rise per pixel along the back edge
    half_top = float(np.mean(tops)) * face_w / 2
    half_bot = face_h / 2
    dy = np.where(yy < cy, (cy - yy) / half_top, (yy - cy) / half_bot)
    q_painted = np.abs(xx - cx) / (face_w / 2) + dy
    # The fill runs inside the face measured from the soil band (a little inside the paint),
    # which keeps the hills' grass tops apart from the ground; the thin strip between that and
    # the painted back edges is dropped afterwards, except where rock overlaps it.
    q = np.abs(xx - cx) / (face_w / 2) + np.abs(yy - cy) / (face_h / 2)
    on_face = (q <= 1.0) & solid
    strip = (q_painted <= 1.04) & (q > 1.0) & (yy < cy) & solid
    # The ground: the face's plain grass, flood-filled from the face's corners and front through
    # grass-coloured pixels; the outlines stop it, so the hills' grass tops are not ground.
    lum = rgb.mean(axis=2)
    greenish = (rgb[..., 1] >= rgb[..., 0] - 2) & (rgb[..., 1] >= rgb[..., 2]) & (lum > 120)
    seeds = on_face & greenish & (q > 0.86)
    ground = ndi.binary_propagation(seeds, mask=on_face & greenish)
    ground = ndi.binary_closing(ground, iterations=2) & on_face
    gcol = np.median(rgb[ground & (q < 0.9)].reshape(-1, 3), axis=0)
    # The hill form: everything solid that is not plain ground, standing on or above the face.
    mx_, mn_ = rgb.max(axis=2), rgb.min(axis=2)
    rock = (mx_ - mn_ < 50) & (lum > 90) & (lum < 235) & (rgb[..., 1] <= rgb[..., 0] + 6)
    form = (alpha > 0.5) & ~ground & ~below_front_edges(alpha.shape, g, pad=-2.0) & ~(strip & ~rock)
    # Drop the slab's thin outline lines (the face edges): an opening wider than a line.
    form = ndi.binary_opening(form, structure=ndi.generate_binary_structure(2, 2), iterations=7)
    lab, k_ = ndi.label(form)
    sizes = ndi.sum(form, lab, range(1, k_ + 1))
    form = np.isin(lab, [i + 1 for i, s_ in enumerate(sizes) if s_ >= 0.08 * sizes.max()])
    form = ndi.binary_fill_holes(ndi.binary_closing(form, iterations=4))
    vis = ndi.gaussian_filter(form.astype(np.float32), 1.6)
    a = alpha * vis
    stamp = rgba.copy()
    stamp[..., 3] = np.clip(a * 255.0, 0, 255)
    vy, vx = np.nonzero(stamp[..., 3] > 3)
    sy0, sy1, sx0, sx1 = vy.min(), vy.max() + 1, vx.min(), vx.max() + 1
    crop = to_image(stamp[sy0:sy1, sx0:sx1])
    k = TILE_W * TERRAIN_DENSITY / face_w
    crop = resize_rgba(crop, (max(1, round(crop.width * k)), max(1, round(crop.height * k))))
    crop.save(os.path.join(TERRAIN_OUT, f'props-{vid}.png'), optimize=True)
    # The keyed full tile, kept as the record of the approved art.
    vy2, vx2 = np.nonzero(alpha > 0.01)
    full = to_image(rgba[vy2.min():vy2.max() + 1, vx2.min():vx2.max() + 1])
    full = resize_rgba(full, (384, round(384 * full.height / full.width)))
    full.save(os.path.join(TERRAIN_OUT, f'terrain-{vid}.png'), optimize=True)
    v = tmeta['variants'][vid]
    v.update({'faceWidth': int(face_w), 'faceHeight': int(face_h), 'projectionRatio': round(face_w / face_h, 3),
              'file': f'props-{vid}.png', 'width': crop.width, 'height': crop.height,
              'anchorX': round((cx - sx0) / (sx1 - sx0), 5), 'anchorY': round((cy - sy0) / (sy1 - sy0), 5),
              'source': 'terrain-foothills.jpg (v3.0.2)'})
    if n == 1:
        soil = rgb[int(g['bottom']) + 10: int(g['bottom'] + g['band'] * 0.8), int(cx) - 20: int(cx) + 20].reshape(-1, 3)
        tmeta['types']['hill'] = {
            'groundColor': '#%02x%02x%02x' % tuple(int(c) for c in gcol),
            'soilColor': '#%02x%02x%02x' % tuple(int(c) for c in np.median(soil, axis=0)),
        }
    print(f'{vid}: face {face_w:.0f}x{face_h:.0f} ratio {face_w / face_h:.2f} -> {crop.width}x{crop.height}, ground {gcol.astype(int)}')
with open(tmeta_path, 'w') as f:
    json.dump(tmeta, f, indent=2)
