#!/usr/bin/env python3
"""렌더된 프레임에서 '찢어짐'을 자동으로 찾아낸다.

  1) 몸이 분리됐는가 — 실루엣의 연결 성분이 2개 이상이면 조각이 떨어져 나간 것.
  2) 몸 안에 구멍이 났는가 — 실루엣 내부의 빈 영역(관절이 벌어지면 여기서 잡힌다).
  3) 관절이 벌어졌는가 — 각 팔다리에서 몸통까지의 **최단 거리**. 붙어 있으면 0 이고,
     이음매가 벌어지면 그 틈이 그대로 픽셀 거리로 나온다. (겹침 픽셀 수로는 못 잡는다:
     팔을 몸통 뒤에 그리니 겹친 부분은 가려져 보이지 않기 때문이다.)
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'frames')
ALPHA = 40
MIN_BLOB = 60      # 이보다 작은 성분은 안티에일리어싱 부스러기로 무시
MIN_HOLE = 150     # 이보다 큰 내부 구멍만 문제로 본다.
                   # (들어올린 지느러미와 뺨 사이처럼, 원래 그림에도 있는 가느다란
                   #  틈이 100px 안팎으로 잡혀서 그 위로 기준을 뒀다.)
MAX_GAP = 2        # 팔다리와 몸통 사이 허용 틈(px). 이보다 벌어지면 찢어져 보인다.

TINT = {'torso': (255, 0, 0), 'armL': (0, 255, 0), 'armR': (0, 0, 255),
        'legL': (255, 255, 0), 'legR': (255, 0, 255)}
STRUCT = ndimage.generate_binary_structure(2, 2)   # 8-이웃


def analyse(path):
    a = np.asarray(Image.open(path).convert('RGBA')).astype(np.int32)
    alpha = a[:, :, 3] >= ALPHA
    problems = []
    if not alpha.any():
        return ['아무것도 안 그려짐']

    rgb = a[:, :, :3]
    d = np.stack([((rgb - np.array(c)) ** 2).sum(2) for c in TINT.values()])
    best, near = d.argmin(0), d.min(0) <= 120 * 120
    masks = {s: (alpha & near & (best == i)) for i, s in enumerate(TINT)}

    lab, n = ndimage.label(alpha, structure=STRUCT)
    if n:
        sizes = ndimage.sum(alpha, lab, range(1, n + 1))
        big = sorted((int(s) for s in sizes if s >= MIN_BLOB), reverse=True)
        if len(big) > 1:
            problems.append(f'몸이 {len(big)}조각으로 분리 {big}')

    holes = ndimage.binary_fill_holes(alpha) & ~alpha
    hl, hn = ndimage.label(holes, structure=STRUCT)
    if hn:
        hs = ndimage.sum(holes, hl, range(1, hn + 1))
        big_holes = sorted((int(s) for s in hs if s >= MIN_HOLE), reverse=True)
        if big_holes:
            problems.append(f'몸 안에 구멍 {big_holes}')

    if masks['torso'].sum() >= MIN_BLOB:
        # 몸통까지의 거리장(distance field). 몸통 픽셀은 0.
        dist = ndimage.distance_transform_edt(~masks['torso'])
        for s in ('armL', 'armR', 'legL', 'legR'):
            m = masks[s]
            if m.sum() < MIN_BLOB:
                continue
            gap = float(dist[m].min())
            if gap > MAX_GAP:
                problems.append(f'{s} 이음매가 {gap:.0f}px 벌어짐')
    return problems


def main():
    index = json.load(open(os.path.join(OUT, 'index.json')))
    bad = []
    for rec in index:
        p = os.path.join(OUT, f"{rec['char']}__{rec['anim']}__{rec['i']:03d}_c.png")
        pr = analyse(p)
        if pr:
            bad.append({**rec, 'problems': pr})
    by = {}
    for b in bad:
        by.setdefault((b['char'], b['anim']), []).append(b)
    print(f"프레임 {len(index)}개 검사 · 문제 {len(bad)}개")
    for (c, a), lst in sorted(by.items()):
        print(f"\n  [{c} · {a}] {len(lst)}프레임")
        for b in lst[:8]:
            print(f"    t={b['t']:5d} (#{b['i']:03d})  " + ' / '.join(b['problems']))
        if len(lst) > 8:
            print(f"    … 외 {len(lst)-8}프레임")
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
