#!/usr/bin/env python3
"""제공 캐릭터(프리셋) 5조각 자르기.

리깅 도구와 같은 규칙을 파이썬으로 옮긴 것이다.
  - 좌표는 "이미지를 폭 400 으로 줄인 공간"에서 잡는다(사람이 눈으로 찍기 편해서).
  - 각 조각은 회전 없는(rot=0) 월드 사각형이라, 그려진 포즈가 곧 기본 자세가 된다.
  - fit 은 관절(pivot) 기준 상대 좌표: x = (cx-Px) - w/2, y = (cy-Py) - h/2.
  - 뒷모습은 알파 바운딩박스를 앞모습에 맞춰 정렬한 뒤 같은 상자로 자른다.
"""
import base64, io, json, os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
IMG = os.path.join(ROOT, 'art', 'presets')                       # 원본 그림(앱에는 안 들어간다)
OUT = os.path.join(ROOT, 'src', 'renderer', 'shared', 'preset-art.js')

PX_PER_UNIT = 2.2          # 조각 해상도(스켈레톤 1유닛당 픽셀)
TARGET_H = 220             # 캐릭터 전체 높이(스켈레톤 유닛) — 두 캐릭터를 같은 키로

CHARS = {
    'seal': {
        'name': '물개',
        'id': 'char_seal',
        'front': 'seal-front.png',
        'back': 'seal-back.png',
        'root': (200, 315),
        'feetY': 358,
        'pivots': {'armL': (108, 145), 'armR': (292, 145), 'legL': (160, 315), 'legR': (240, 315)},
        # slot: (x0, y0, x1, y1)  — 폭 400 공간의 월드 사각형
        'boxes': {
            'torso': (93, 5, 307, 330),
            'armL':  (2, 116, 120, 234),
            'armR':  (280, 116, 398, 234),
            'legL':  (52, 294, 192, 362),
            'legR':  (208, 294, 348, 362),
        },
        'torsoW': 214, 'armW': 118, 'legW': 140,
        'swatch': '#9aa0a6',
    },
    'girl': {
        'name': '리본',
        'id': 'char_ribbon',
        'front': 'ribbon-front.png',
        'back': 'ribbon-back.png',
        'root': (200, 400),
        'feetY': 478,
        'pivots': {'armL': (110, 258), 'armR': (290, 258), 'legL': (142, 400), 'legR': (258, 400)},
        'boxes': {
            'torso': (55, 2, 350, 408),
            'armL':  (2, 198, 118, 288),
            'armR':  (282, 198, 398, 288),
            'legL':  (96, 396, 188, 480),
            'legR':  (212, 396, 304, 480),
        },
        'torsoW': 295, 'armW': 116, 'legW': 92,
        'swatch': '#3355cc',
    },
}
SLOTS = ['torso', 'armL', 'armR', 'legL', 'legR']


def load400(path):
    """이미지를 폭 400 공간의 좌표로 다룰 수 있게, 원본과 배율을 함께 돌려준다."""
    im = Image.open(path).convert('RGBA')
    return im, im.width / 400.0


def alpha_bbox400(im, s):
    bb = im.split()[3].getbbox()
    return tuple(v / s for v in bb)   # (x0,y0,x1,y1) in 400-space


def crop(im, s, box400, out_px):
    x0, y0, x1, y1 = [v * s for v in box400]
    piece = im.crop((round(x0), round(y0), round(x1), round(y1)))
    return piece.resize(out_px, Image.LANCZOS)


def to_data_url(im):
    buf = io.BytesIO()
    # 픽셀아트라 색 수가 적다 → 팔레트 양자화로 크게 줄어든다(알파 보존).
    q = im.quantize(colors=200, method=Image.FASTOCTREE, dither=Image.NONE)
    q.save(buf, format='PNG', optimize=True)
    small = buf.getvalue()
    buf2 = io.BytesIO()
    im.save(buf2, format='PNG', optimize=True)
    full = buf2.getvalue()
    data = small if len(small) < len(full) else full
    return 'data:image/png;base64,' + base64.b64encode(data).decode('ascii'), len(data)


def build(key, cfg):
    front, sf = load400(os.path.join(IMG, cfg['front']))
    back, sb = load400(os.path.join(IMG, cfg['back']))

    rootx, rooty = cfg['root']
    torso_top = cfg['boxes']['torso'][1]
    torso_len = rooty - torso_top
    leg_len = cfg['feetY'] - rooty
    k = TARGET_H / (torso_len + leg_len)          # 400-space → 스켈레톤 유닛

    sh = cfg['pivots']['armL']
    proportions = {
        'torsoLen': round(torso_len * k),
        'torsoW': round(cfg['torsoW'] * k),
        'shoulderRatio': round((rooty - sh[1]) / torso_len, 3),
        'shoulderX': round((rootx - sh[0]) * k),
        'hipX': round((rootx - cfg['pivots']['legL'][0]) * k),
        'armLen': round((cfg['boxes']['armL'][3] - sh[1]) * k),
        'armW': round(cfg['armW'] * k),
        'legLen': round(leg_len * k),
        'legW': round(cfg['legW'] * k),
    }

    # 뒷모습 정렬: 알파 바운딩박스를 앞모습 것에 맞추는 상사변환(scale+offset)
    fb = alpha_bbox400(front, sf)
    bb = alpha_bbox400(back, sb)
    ax = (bb[2] - bb[0]) / (fb[2] - fb[0])
    ay = (bb[3] - bb[1]) / (fb[3] - fb[1])

    def f2b(x, y):
        return (bb[0] + (x - fb[0]) * ax, bb[1] + (y - fb[1]) * ay)

    slots, slots_back, total = {}, {}, 0
    for slot in SLOTS:
        x0, y0, x1, y1 = cfg['boxes'][slot]
        w400, h400 = x1 - x0, y1 - y0
        out_px = (max(1, round(w400 * k * PX_PER_UNIT)), max(1, round(h400 * k * PX_PER_UNIT)))

        px, py = cfg['pivots'].get(slot, (rootx, rooty))
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        fit = {
            'x': round(((cx - px) - w400 / 2) * k, 1),
            'y': round(((cy - py) - h400 / 2) * k, 1),
            'w': round(w400 * k, 1),
            'h': round(h400 * k, 1),
            'rot': 0,
        }

        url, n = to_data_url(crop(front, sf, (x0, y0, x1, y1), out_px))
        slots[slot] = {'image': url, 'fit': fit}
        total += n

        bx0, by0 = f2b(x0, y0)
        bx1, by1 = f2b(x1, y1)
        burl, bn = to_data_url(crop(back, sb, (bx0, by0, bx1, by1), out_px))
        slots_back[slot] = {'image': burl}
        total += bn
        print(f'  {slot:6s} {out_px[0]:4d}x{out_px[1]:4d}px  front {n//1024:4d}KB  back {bn//1024:4d}KB  fit {fit}')

    print(f'  proportions {proportions}')
    print(f'  합계 {total//1024} KB')
    return {'skeletonId': 'bipedal5', 'proportions': proportions,
            'slots': slots, 'slotsBack': slots_back}, total


bundles = {}
for key, cfg in CHARS.items():
    print(f'[{key}] {cfg["name"]}')
    bundles[cfg['id']], _ = build(key, cfg)

HEADER = """\
'use strict';
/* 제공 캐릭터 아트 — 5조각 번들(앞모습 + 뒷모습).
 *
 * 자동 생성 파일이다. 손으로 고치지 말 것.
 *   art/presets/*.png  →  tools/cut-preset-art.py  →  이 파일
 *
 * 왜 data URI 인가: 렌더러는 file:// 로 열리고 CSP 가 img-src 'self' data: 라서,
 * 파일 경로 이미지는 창마다 상대경로가 달라지고 CSP 에도 걸릴 수 있다. data URI 면
 * 어느 창에서든 똑같이 뜨고, 상대에게는 프리셋 id 만 보내면 되므로 전송량도 0 이다.
 *
 * 조각은 회전 없는(rot=0) 사각형으로 잘랐다 → 그림에 그려진 大자 포즈가 곧 기본 자세다.
 * slotsBack 은 🍑 트월킹에서 등을 보일 때만 쓰인다.
 */

(function (root) {
  const RW = (root.RW = root.RW || {});
  RW.presetArt = """

with open(OUT, 'w') as f:
    f.write(HEADER)
    json.dump(bundles, f, ensure_ascii=False, separators=(',', ':'))
    f.write(";\n})(typeof window !== 'undefined' ? window : globalThis);\n")
print('→', OUT, os.path.getsize(OUT) // 1024, 'KB')
