#!/usr/bin/env python3
"""뒤돌기 이음매 맞추기 — 뒤돌기가 **춤의 첫 자세로 끝나게** 만든다.

왜 필요한가: 뒤돌기(turn_back)는 5조각 리그로 구운 임시 뒷모습에서 끝나는데
궁디댄스는 새로 그린 원화로 시작한다. 그 이음매에서 팔·머리·명암이 통째로 바뀌어
크게 튄다. 뒤돌기의 마지막 장과 정면 복귀의 첫 장을 **춤 원화의 첫 장과 같은 그림**
으로 바꾸면 그 튐이 사라진다.

가운데 장(3/4 측면)은 **그림이 아니다.** 진짜 측면을 그릴 방법이 없어서 뒷모습을
가로로 눌러 흉내 낸 것이다. 그래도 여기에 두는 이유는, 스타일이 바뀌는 순간을
가장 알아보기 어려운 프레임(가장 얇은 프레임)에 몰아넣기 위해서다.
진짜 측면 그림이 오면 이 장만 갈아 끼우면 된다 — docs/art-orders.md 참고.

  실행: python3 tools/turn-frames.py char_dada
        → art/staging/<char>/turn_back·turn_front 에 3장씩 쓴다
        → 그다음 tools/import-clip.py 로 넣는다
"""
import os, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SQUEEZE = 0.42           # 가운데 장의 가로 압축률
CX = 256                 # 캔버스 가로 중심


def squeeze(im, sx, cx=CX):
    """가로로만 누른다. 세로를 건드리지 않으므로 발바닥(접지)이 그대로 유지된다."""
    w, h = im.size
    nw = max(2, round(w * sx))
    small = im.resize((nw, h), Image.LANCZOS)
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    out.paste(small, (round(cx - nw / 2), 0))
    return out


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    char = sys.argv[1]
    clips = os.path.join(ROOT, 'art', 'clips', char)
    staging = os.path.join(ROOT, 'art', 'staging', char)

    dance = os.path.join(clips, 'twerk_loop', 'frame-00.png')
    if not os.path.exists(dance):
        print(f'✗ 춤 클립이 먼저 있어야 한다: {os.path.relpath(dance, ROOT)}')
        sys.exit(1)
    back = Image.open(dance).convert('RGBA')     # 뒤돌아 선 준비 자세(원화)
    mid = squeeze(back, SQUEEZE)                 # ⚠ 그린 그림이 아니다

    # 정면 접합 자세는 기존 클립에서 그대로 가져온다(대기 자세와 이어져야 한다).
    front_b = Image.open(os.path.join(clips, 'turn_back', 'frame-00.png')).convert('RGBA')
    front_f = Image.open(os.path.join(clips, 'turn_front', 'frame-02.png')).convert('RGBA')

    for clip, frames in (
        ('turn_back',  [front_b, mid, back]),
        ('turn_front', [back, mid, front_f]),
    ):
        d = os.path.join(staging, clip)
        os.makedirs(d, exist_ok=True)
        for i, im in enumerate(frames):
            im.save(os.path.join(d, f'frame-{i:02d}.png'))
        print(f'{clip}: 3장  (frame-01 은 눌러서 흉내 낸 가짜다)')

    print(f'→ {os.path.relpath(staging, ROOT)}')
    print(f'  다음: python3 tools/import-clip.py {char} turn_back --write')
    print(f'        python3 tools/import-clip.py {char} turn_front --write')


if __name__ == '__main__':
    main()
