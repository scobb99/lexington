"""Lexington UI art (Build Spec v2.0, Sections 3 and 16).

Keys the white background out of the Gemini UI art and writes PNGs with transparency:
  game-icon.jpg               -> src/assets/ui/game-icon.png (title screen art, 512 px wide)
  ui-letter-tile.jpg          -> src/assets/ui/letter-tile.png (rack tile face, 160 px)
  ui-letter-tile-selected.jpg -> src/assets/ui/letter-tile-selected.png (Swap selection, 160 px)
  icon-coin.jpg, icon-lumber.jpg, icon-stone.jpg, icon-knowledge.jpg, icon-magic.jpg
                              -> src/assets/ui/icon-<name>.png (resource icons, 96 px)

Usage: python3 -I process_ui.py <folder with the JPGs> <repo src/assets/ui folder>
"""
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)


def key(stem, width, glow=False):
    rgb = np.asarray(Image.open(os.path.join(SRC, stem + '.jpg')).convert('RGB')).astype(np.float32)
    mn = rgb.min(axis=2)
    sat = rgb.max(axis=2) - mn
    near_white = (mn >= 232) & (sat <= 20)
    lab, _ = ndi.label(near_white)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border))
    # Soft edge: alpha from how far a pixel is from white (keeps the drop shadow and any glow).
    whiteness = np.clip((255.0 - mn) / (70.0 if glow else 45.0), 0, 1)
    dist = ndi.distance_transform_edt(bg)
    near_edge = dist < 40
    alpha = np.where(bg, 0.0, 1.0)
    soft = ~bg & (mn > 150) & (sat < (120 if glow else 40))
    reach = ndi.binary_dilation(bg, iterations=60) & soft
    alpha = np.where(reach, whiteness, alpha)
    alpha = np.where(bg & near_edge, 0.0, alpha)
    # Grey drop shadow: black at the strength the white was darkened by (it reads right on the
    # dark panels). Coloured glow (the selected tile): un-mixed from the white behind it.
    shadow = reach & (sat < 25)
    alpha = np.where(shadow, np.clip((255.0 - mn) / 255.0 * 1.6, 0, 0.55), alpha)
    a = alpha[..., None]
    col = np.where(a > 0.02, (rgb - 255.0 * (1 - a)) / np.maximum(a, 0.02), rgb)
    col = np.where(shadow[..., None], 30.0, col)
    rgba = np.dstack([np.clip(col, 0, 255), np.clip(alpha * 255, 0, 255)]).astype(np.uint8)
    ys, xs = np.nonzero(rgba[..., 3] > 4)
    img = Image.fromarray(rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1], 'RGBA')
    img = img.resize((width, round(width * img.height / img.width)), Image.LANCZOS)
    return img


key('game-icon', 512).save(os.path.join(OUT, 'game-icon.png'), optimize=True)
key('ui-letter-tile', 160).save(os.path.join(OUT, 'letter-tile.png'), optimize=True)
key('ui-letter-tile-selected', 160, glow=True).save(os.path.join(OUT, 'letter-tile-selected.png'), optimize=True)
for name in ['coin', 'lumber', 'stone', 'knowledge', 'magic']:
    key('icon-' + name, 96, glow=(name == 'magic')).save(os.path.join(OUT, f'icon-{name}.png'), optimize=True)
print('done')
