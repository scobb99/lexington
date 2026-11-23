"""Placeholder art for the v3.0 pieces still being drawn by Gemini (Build Spec v3.0, Section 3).

Until each Gemini piece lands, the build uses a simple plank sign sprite for the Town Center and
the Scribe, and simple stand-ins for the six landmarks, all on the same grass diamond base and in
the same sprite slots the real art will use (src/assets/buildings/ and sprites.json). When the
Gemini art arrives, run process_art.py on it as usual: it overwrites these files and entries.

Run from the project folder:  python3 scripts/art/make_placeholders.py
"""
import json, os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(ROOT, 'src', 'assets', 'buildings')
DENSITY = 4  # texture pixels per world pixel (sprites.json textureDensity)
TILE_W, TILE_H = 64, 40


def base(w, h, extra):
    """An image with a grass diamond base for a w x h footprint and `extra` px of room above."""
    dw = (w + h) * TILE_W // 2 * DENSITY
    dh = (w + h) * TILE_H // 2 * DENSITY
    img = Image.new('RGBA', (dw + 8, dh + extra + 8), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    ox, oy = 4, extra + 4
    # Footprint diamond: top at (h * 32, 0) scaled; the w side runs right-down, the h side left-down.
    top = (ox + h * TILE_W // 2 * DENSITY, oy)
    right = (ox + dw, oy + w * TILE_H // 2 * DENSITY)
    bottom = (ox + w * TILE_W // 2 * DENSITY, oy + dh)
    left = (ox, oy + h * TILE_H // 2 * DENSITY)
    d.polygon([top, right, bottom, left], fill=(132, 170, 96, 255), outline=(96, 128, 70, 255))
    inset = [(top[0], top[1] + 12), (right[0] - 20, right[1]), (bottom[0], bottom[1] - 12), (left[0] + 20, left[1])]
    d.polygon(inset, fill=(150, 186, 110, 255))
    cx = (left[0] + right[0]) // 2
    cy = (top[1] + bottom[1]) // 2
    return img, d, (cx, cy), bottom, dw


def plank_sign(d, cx, cy, width, height, post_h, colour=(176, 128, 78), banner=None):
    """A wooden sign board on two posts, standing at (cx, cy)."""
    pw = max(10, width // 14)
    for px in (cx - width // 3, cx + width // 3):
        d.rectangle([px - pw // 2, cy - post_h, px + pw // 2, cy], fill=(110, 76, 44), outline=(70, 46, 26))
    top = cy - post_h - height // 2
    d.rounded_rectangle([cx - width // 2, top, cx + width // 2, top + height], radius=10, fill=colour, outline=(92, 60, 32), width=5)
    for k in range(1, 3):
        y = top + k * height // 3
        d.line([cx - width // 2 + 8, y, cx + width // 2 - 8, y], fill=(140, 98, 58), width=4)
    if banner:
        d.rectangle([cx - width // 2 + 18, top + 14, cx + width // 2 - 18, top + height - 14], fill=banner, outline=(70, 46, 26), width=3)


def save(name, img, bottom, key, w, h, dw):
    img.save(os.path.join(OUT, name))
    return key, {
        'file': name,
        'width': img.width,
        'height': img.height,
        'anchorX': round(bottom[0] / img.width, 5),
        'anchorY': round(bottom[1] / img.height, 5),
        'baseWidth': float(dw),
        'footprint': [w, h],
        'placeholder': True,
    }


def main():
    meta_path = os.path.join(OUT, 'sprites.json')
    meta = json.load(open(meta_path))
    entries = {}

    # Town Center: a broad plank sign with a red commission banner (2 x 2).
    img, d, (cx, cy), bottom, dw = base(2, 2, 360)
    plank_sign(d, cx, cy, 300, 170, 230, banner=(170, 52, 44))
    d.polygon([(cx, cy - 470), (cx + 40, cy - 420), (cx - 40, cy - 420)], fill=(230, 196, 92), outline=(120, 90, 30))
    entries.update([save('towncenter.png', img, bottom, 'townCenter', 2, 2, dw)])

    # Scribe: a plank sign with a cream page and a quill stroke (2 x 2).
    img, d, (cx, cy), bottom, dw = base(2, 2, 300)
    plank_sign(d, cx, cy, 240, 150, 190, banner=(236, 226, 196))
    d.line([cx - 60, cy - 250, cx + 70, cy - 300], fill=(60, 60, 90), width=8)
    entries.update([save('scribe.png', img, bottom, 'scribe', 2, 2, dw)])

    # Landmarks (1 x 1 each), simple distinct shapes.
    def lm(name, draw):
        img, d, (cx, cy), bottom, dw = base(1, 1, 260)
        draw(d, cx, cy)
        return save(f'landmark-{name}.png', img, bottom, f'landmark-{name}', 1, 1, dw)

    stone, dark = (178, 172, 160), (110, 104, 96)
    entries.update([
        lm('fountain', lambda d, cx, cy: (d.ellipse([cx - 90, cy - 70, cx + 90, cy + 10], fill=stone, outline=dark, width=5),
                                         d.ellipse([cx - 70, cy - 60, cx + 70, cy - 5], fill=(110, 170, 220)),
                                         d.rectangle([cx - 12, cy - 170, cx + 12, cy - 40], fill=stone, outline=dark, width=4),
                                         d.ellipse([cx - 40, cy - 190, cx + 40, cy - 160], fill=(150, 200, 235)))),
        lm('marketCross', lambda d, cx, cy: (d.rectangle([cx - 16, cy - 220, cx + 16, cy - 10], fill=stone, outline=dark, width=4),
                                            d.rectangle([cx - 70, cy - 180, cx + 70, cy - 150], fill=stone, outline=dark, width=4),
                                            d.rectangle([cx - 50, cy - 20, cx + 50, cy + 5], fill=dark))),
        lm('lanternPost', lambda d, cx, cy: (d.rectangle([cx - 9, cy - 230, cx + 9, cy], fill=(50, 50, 56)),
                                            d.rounded_rectangle([cx - 34, cy - 260, cx + 34, cy - 190], radius=12, fill=(242, 193, 78), outline=(50, 50, 56), width=5))),
        lm('oakArch', lambda d, cx, cy: (d.arc([cx - 110, cy - 250, cx + 110, cy + 40], 180, 360, fill=(120, 86, 50), width=26),
                                        d.ellipse([cx - 120, cy - 270, cx - 30, cy - 180], fill=(70, 120, 60)),
                                        d.ellipse([cx + 30, cy - 270, cx + 120, cy - 180], fill=(70, 120, 60)))),
        lm('riverBell', lambda d, cx, cy: (d.rectangle([cx - 80, cy - 230, cx - 64, cy], fill=(110, 76, 44)),
                                          d.rectangle([cx + 64, cy - 230, cx + 80, cy], fill=(110, 76, 44)),
                                          d.rectangle([cx - 90, cy - 240, cx + 90, cy - 222], fill=(110, 76, 44)),
                                          d.polygon([(cx, cy - 215), (cx + 50, cy - 90), (cx - 50, cy - 90)], fill=(196, 150, 60), outline=(120, 90, 30)))),
        lm('foundersSpire', lambda d, cx, cy: (d.rectangle([cx - 40, cy - 120, cx + 40, cy], fill=(230, 226, 214), outline=dark, width=4),
                                              d.polygon([(cx, cy - 300), (cx + 46, cy - 120), (cx - 46, cy - 120)], fill=(124, 40, 52), outline=(70, 20, 30)))),
    ])
    meta['sprites'].update(entries)
    meta['placeholders'] = sorted(k for k, v in meta['sprites'].items() if v.get('placeholder'))
    json.dump(meta, open(meta_path, 'w'), indent=2)
    print('placeholders written:', ', '.join(meta['placeholders']))


if __name__ == '__main__':
    main()
