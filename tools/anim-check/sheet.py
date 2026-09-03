#!/usr/bin/env python3
"""프레임을 애니메이션별 한 장으로 묶는다(눈으로 확인하기 위한 것)."""
import json, os, sys
from PIL import Image, ImageDraw
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'frames')
DEST = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, 'sheets')
CROP = (95, 95, 325, 395)      # 캐릭터 주변만
COLS = 10
os.makedirs(DEST, exist_ok=True)
index = json.load(open(os.path.join(OUT, 'index.json')))
groups = {}
for r in index:
    groups.setdefault((r['char'], r['anim']), []).append(r)
for (c, a), lst in sorted(groups.items()):
    lst.sort(key=lambda r: r['i'])
    tw, th = CROP[2]-CROP[0], CROP[3]-CROP[1]
    rows = (len(lst) + COLS - 1) // COLS
    sheet = Image.new('RGB', (tw*COLS, th*rows), (250, 250, 252))
    d = ImageDraw.Draw(sheet)
    for k, r in enumerate(lst):
        p = os.path.join(OUT, f"{c}__{a}__{r['i']:03d}.png")
        im = Image.open(p).convert('RGBA').crop(CROP)
        bg = Image.new('RGBA', im.size, (250, 250, 252, 255)); bg.alpha_composite(im)
        x, y = (k % COLS)*tw, (k//COLS)*th
        sheet.paste(bg.convert('RGB'), (x, y))
        d.rectangle([x, y, x+tw-1, y+th-1], outline=(225, 225, 235))
        d.text((x+3, y+3), f"{r['t']}ms", fill=(150, 150, 165))
    fn = os.path.join(DEST, f'{c}__{a}.png')
    sheet.save(fn)
    print(fn, sheet.size)
