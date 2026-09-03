#!/usr/bin/env python3
"""filmstrip.js 가 찍은 장면들을 한 장으로 잇는다(동작별, 버전별 비교).

실행: python3 tools/anim-check/filmstrip.py [출력파일]
"""
import base64, glob, io, json, os, sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'filmstrip')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(SRC, 'compare.png')

runs, gestures = {}, []
for f in sorted(glob.glob(os.path.join(SRC, '*.json'))):
    d = json.load(open(f))
    runs.setdefault(d['name'], {})[d['gesture']] = d
    if d['gesture'] not in gestures:
        gestures.append(d['gesture'])

if not runs:
    print('찍은 장면이 없습니다. 먼저 node tools/anim-check/filmstrip.js 를 실행하세요.')
    sys.exit(1)

names = list(runs.keys())
sample = next(iter(next(iter(runs.values())).values()))
first = Image.open(io.BytesIO(base64.b64decode(sample['shots'][0])))
W, H = first.size
n = len(sample['shots'])
LABEL = 108
ROW = H + 4

sheet = Image.new('RGB', (LABEL + W * n, ROW * len(gestures) * len(names) + 24), (255, 255, 255))
d = ImageDraw.Draw(sheet)
y = 4
for g in gestures:
    for nm in names:
        rec = runs.get(nm, {}).get(g)
        d.text((6, y + H // 2 - 12), f'{g}', fill=(120, 20, 90))
        d.text((6, y + H // 2 + 2), f'{nm}', fill=(90, 90, 130))
        if rec:
            for i, b64 in enumerate(rec['shots']):
                im = Image.open(io.BytesIO(base64.b64decode(b64))).convert('RGB')
                x = LABEL + i * W
                sheet.paste(im, (x, y))
                d.rectangle([x, y, x + W - 1, y + H - 1], outline=(225, 225, 235))
                d.text((x + 4, y + 3), f'{round(rec["span"] * i / (n - 1))}ms', fill=(150, 150, 170))
        y += ROW
sheet.save(OUT)
print(f'→ {OUT}  ({sheet.size[0]}×{sheet.size[1]}, 버전 {len(names)}개 × 동작 {len(gestures)}개)')
