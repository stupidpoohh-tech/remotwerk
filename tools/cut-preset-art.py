#!/usr/bin/env python3
"""제공 캐릭터(프리셋) 5조각 자르기.

리깅 도구와 같은 규칙을 파이썬으로 옮긴 것이다.
  - 좌표는 "이미지를 폭 400 으로 줄인 공간"에서 잡는다(사람이 눈으로 찍기 편해서).
  - 각 조각은 회전 없는(rot=0) 월드 사각형이라, 그려진 포즈가 곧 기본 자세가 된다.
  - fit 은 관절(pivot) 기준 상대 좌표: x = (cx-Px) - w/2, y = (cy-Py) - h/2.
  - 뒷모습은 알파 바운딩박스를 앞모습에 맞춰 정렬한 뒤 같은 상자로 자른다.
"""
import base64, io, json, math, os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
IMG = os.path.join(ROOT, 'art', 'presets')                       # 원본 그림(앱에는 안 들어간다)
OUT = os.path.join(ROOT, 'src', 'renderer', 'shared', 'preset-art.js')

PX_PER_UNIT = 2.2          # 조각 해상도(스켈레톤 1유닛당 픽셀)
TARGET_H = 220             # 캐릭터 전체 높이(스켈레톤 유닛) — 두 캐릭터를 같은 키로

# ---- 관절 탭(joint tab) ----
#
# 팔다리를 상자 그대로 자르면, 관절이 조금만 돌아도 이음매가 벌어져 몸이 찢어져 보인다.
# 그렇다고 몸통 쪽으로 사각형을 길게 물려 두면 이번엔 그 **모서리가 회전하며 몸 밖으로
# 삐져나온다**(물개 신나에서 반바지 색 띠가 허리 위로 튀어나왔다).
#
# 그래서 물린 부분을 **관절을 중심으로 한 원(반지름 TAB_R)** 으로 깎는다.
#   - 원은 자기 중심으로 아무리 돌아도 같은 원 안에 머문다 → 절대 몸 밖으로 안 나온다.
#   - 관절 둘레가 항상 덮이므로 이음매도 벌어지지 않는다.
# 조건은 하나, 그 원이 몸통 그림 안에 들어가 있어야 한다(그래서 반지름을 부위별로 잡는다).
OVERLAP = 70          # 자를 때 몸통 쪽으로 넓혀 두는 폭(탭을 깎을 재료)

# 탭 반지름(폭 400 공간). 관절 회전이 크지 않으므로(팔 ≤21°, 다리 ≤8°) 이 정도면
# 이음매가 덮이고, 원이라 회전해도 자기 자리를 벗어나지 않는다.
TAB_R = 48

# z-순서: 팔다리를 전부 몸통 **뒤**로 보낸다.
#   앞에 두면 물린 부분(몸통 그림 조각)이 몸 위에 겹쳐 보인다.
Z = {'torso': 5, 'armL': 3, 'armR': 4, 'legL': 1, 'legR': 2}
# 각 조각에서 '몸통 쪽'이 어느 방향인지 — 넓힐 변과 탭을 남길 반쪽을 결정한다.
GROW = {'armL': 'x1', 'armR': 'x0', 'legL': 'y0', 'legR': 'y0'}
INWARD = {'armL': (1, 0), 'armR': (-1, 0), 'legL': (0, -1), 'legR': (0, -1)}

CHARS = {
    'seal': {
        'name': '물개',
        'id': 'char_seal',
        'front': 'seal-front.png',
        'back': 'seal-back.png',
        'root': (200, 315),
        'feetY': 358,
        'pivots': {'armL': (116, 148), 'armR': (284, 148), 'legL': (160, 312), 'legR': (240, 312)},
        # slot: (x0, y0, x1, y1)  — 폭 400 공간의 월드 사각형
        'boxes': {
            'torso': (93, 5, 307, 330),
            'armL':  (2, 112, 120, 222),
            'armR':  (280, 112, 398, 222),
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
        'pivots': {'armL': (116, 258), 'armR': (284, 258), 'legL': (142, 398), 'legR': (258, 398)},
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


def tab_mask(box400, pivot, inward, radius, out_px):
    """관절 탭으로 깎을 알파 마스크.

    몸통 반대쪽(팔다리 본체)은 전부 남기고, 몸통 쪽은 관절 중심 반지름 radius 안만 남긴다.
    """
    x0, y0, x1, y1 = box400
    w, h = out_px
    sx, sy = (x1 - x0) / w, (y1 - y0) / h
    px, py = pivot
    dx_i, dy_i = inward
    mask = Image.new('L', out_px, 0)
    m = mask.load()
    r2 = radius * radius
    for j in range(h):
        wy = y0 + (j + 0.5) * sy - py
        for i in range(w):
            wx = x0 + (i + 0.5) * sx - px
            inner = wx * dx_i + wy * dy_i          # 몸통 쪽으로 얼마나 들어갔는지
            if inner <= 0 or (wx * wx + wy * wy) <= r2:
                m[i, j] = 255
    return mask


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

    slots, slots_back, total, tabR = {}, {}, 0, {}
    for slot in SLOTS:
        x0, y0, x1, y1 = cfg['boxes'][slot]
        # 몸통 쪽으로 물리기
        grow = GROW.get(slot)
        if grow == 'x1':   x1 += OVERLAP
        elif grow == 'x0': x0 -= OVERLAP
        elif grow == 'y0': y0 -= OVERLAP
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

        tab = None
        if slot in INWARD:
            tabR[slot] = TAB_R
            tab = tab_mask((x0, y0, x1, y1), (px, py), INWARD[slot], TAB_R, out_px)

        piece = crop(front, sf, (x0, y0, x1, y1), out_px)
        if tab is not None:
            piece.putalpha(Image.eval(piece.split()[3], lambda v: v).point(lambda v: v))
            a = piece.split()[3]
            piece.putalpha(Image.composite(a, Image.new('L', out_px, 0), tab))
        url, n = to_data_url(piece)
        slots[slot] = {'image': url, 'fit': fit, 'z': Z[slot]}
        total += n

        bx0, by0 = f2b(x0, y0)
        bx1, by1 = f2b(x1, y1)
        bpiece = crop(back, sb, (bx0, by0, bx1, by1), out_px)
        if tab is not None:
            ba = bpiece.split()[3]
            bpiece.putalpha(Image.composite(ba, Image.new('L', out_px, 0), tab))
        burl, bn = to_data_url(bpiece)
        slots_back[slot] = {'image': burl}
        total += bn
        print(f'  {slot:6s} {out_px[0]:4d}x{out_px[1]:4d}px  front {n//1024:4d}KB  back {bn//1024:4d}KB  fit {fit}')

    print(f'  관절 탭 반지름 {TAB_R}')
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
