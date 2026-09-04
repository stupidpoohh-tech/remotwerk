#!/usr/bin/env python3
"""원화 가져오기 — 받은 그림을 **검사한 뒤에만** 클립 폴더에 넣는다.

원화 제작은 바깥에서 하고, 여기서는 가져오기·분할·검사·메타데이터만 한다.

  입력:  art/staging/<characterId>/<clipId>/   ← 여기에 그림을 놓는다
           - frame-00.png … frame-NN.png   (낱장으로 받은 경우)
           - sheet.png                     (4열×2행 등 시트로 받은 경우)
           - sheet.json                    (시트 분할 정보: {"cols":4,"rows":2})
  출력:  art/clips/<characterId>/<clipId>/frame-NN.png + clip.json

원칙
  * **원본은 건드리지 않는다.** staging 은 그대로 남는다.
  * 규격을 통과하지 못하면 **아무것도 쓰지 않는다.** 기존 정상 에셋을 훼손하지 않기 위해서다.
  * RGB→RGBA 변환만으로 "투명 배경" 이라고 하지 않는다. 실제 알파를 검사한다.
  * placeholder 표시는 여기서 지우지 않는다. 사람이 눈으로 검수한 뒤 --approve 로만 지운다.

  실행:
    python3 tools/import-clip.py char_seal twerk_loop            # 검사만(모의 실행)
    python3 tools/import-clip.py char_seal twerk_loop --write    # 통과하면 반영
    python3 tools/import-clip.py char_seal twerk_loop --write --approve
                                                                 # 눈 검수까지 끝났을 때만
"""
import json, os, sys, shutil
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# 규격 — docs/animation-bible.md 2절과 같아야 한다.
CANVAS = (512, 512)
ANCHOR = (256, 470)
GROUND_TOL = 1          # 접지 프레임 발바닥 허용 오차(px)
ALPHA_BG = 8            # 이 값 이하면 배경으로 본다
EDGE_PAD = 2            # 캔버스 가장자리 이 안쪽에 그림이 닿으면 잘린 것으로 본다


def fail(msgs):
    for m in msgs:
        print('   ✗ ' + m)


def load_frames(src):
    """낱장 또는 시트에서 프레임 목록을 만든다. (원본은 수정하지 않는다)"""
    singles = sorted(f for f in os.listdir(src) if f.startswith('frame-') and f.endswith('.png'))
    if singles:
        return [(f, Image.open(os.path.join(src, f)).convert('RGBA')) for f in singles], 'singles'

    sheet_path = os.path.join(src, 'sheet.png')
    if not os.path.exists(sheet_path):
        return None, '입력 없음'
    meta = {'cols': 4, 'rows': 2}
    mp = os.path.join(src, 'sheet.json')
    if os.path.exists(mp):
        meta.update(json.load(open(mp)))
    sheet = Image.open(sheet_path).convert('RGBA')
    cols, rows = int(meta['cols']), int(meta['rows'])
    cw, ch = sheet.width / cols, sheet.height / rows
    if abs(cw - round(cw)) > 0.01 or abs(ch - round(ch)) > 0.01:
        print(f'   ⚠ 셀 크기가 정수가 아니다: {cw}×{ch} — 반올림해서 자른다(경계가 밀릴 수 있음)')
    out = []
    for r in range(rows):
        for c in range(cols):
            box = (round(c * cw), round(r * ch), round((c + 1) * cw), round((r + 1) * ch))
            out.append((f'frame-{len(out):02d}.png', sheet.crop(box)))
    return out, f'시트 {cols}×{rows}'


def check(name, im):
    """한 프레임의 규격 검사. 문제 목록을 돌려준다."""
    bad = []
    if im.size != CANVAS:
        bad.append(f'{name}: 캔버스가 {im.size} — {CANVAS[0]}×{CANVAS[1]} 이어야 한다')
        return bad, None

    px = im.load()
    w, h = im.size
    # 배경이 진짜 투명한가 — 네 모서리와 테두리 한 줄을 본다.
    opaque_edge = 0
    for x in range(w):
        for y in (0, h - 1):
            if px[x, y][3] > ALPHA_BG:
                opaque_edge += 1
    for y in range(h):
        for x in (0, w - 1):
            if px[x, y][3] > ALPHA_BG:
                opaque_edge += 1
    if opaque_edge > 0:
        bad.append(f'{name}: 테두리에 불투명 픽셀 {opaque_edge}개 — 배경이 남아 있다'
                   f'(체크무늬를 투명으로 착각했을 수 있다)')

    # 그림 영역 — **알파가 0보다 크면 그림**으로 본다.
    # 규격 검사(build-clip-art.py)가 Pillow getbbox 를 쓰므로 같은 자를 써야 한다.
    # 8 로 두면 안티에일리어싱된 가장자리가 빠져, 여기서는 접지가 맞는데
    # 다음 단계에서 "발바닥 y=472" 로 걸린다.
    bb = im.split()[3].getbbox()
    if not bb:
        bad.append(f'{name}: 그림이 없다(전부 투명)')
        return bad, None
    box = (bb[0], bb[1], bb[2] - 1, bb[3] - 1)

    xs0, ys0, xs1, ys1 = box
    if xs0 < EDGE_PAD or ys0 < EDGE_PAD or xs1 > w - 1 - EDGE_PAD or ys1 > h - 1 - EDGE_PAD:
        bad.append(f'{name}: 그림이 캔버스 끝에 닿는다 {box} — 잘렸을 수 있다')
    return bad, box


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    char, clip = sys.argv[1], sys.argv[2]
    write = '--write' in sys.argv
    approve = '--approve' in sys.argv

    src = os.path.join(ROOT, 'art', 'staging', char, clip)
    dst = os.path.join(ROOT, 'art', 'clips', char, clip)
    if not os.path.isdir(src):
        print(f'✗ 입력 폴더가 없다: {os.path.relpath(src, ROOT)}')
        print('  원화 제작자가 여기에 frame-00.png… 또는 sheet.png 를 넣으면 된다.')
        sys.exit(1)

    frames, how = load_frames(src)
    if not frames:
        print(f'✗ {os.path.relpath(src, ROOT)} 에 frame-NN.png 도 sheet.png 도 없다')
        sys.exit(1)
    print(f'{char}/{clip} — {how}, 프레임 {len(frames)}장')

    problems, boxes = [], []
    for name, im in frames:
        bad, box = check(name, im)
        problems += bad
        boxes.append((name, box))

    # 접지: 기존 clip.json 이 있으면 그 ground 정보를 존중한다(없으면 검사 생략)
    old = None
    op = os.path.join(dst, 'clip.json')
    if os.path.exists(op):
        old = json.load(open(op))
        for i, (name, box) in enumerate(boxes):
            if box is None or i >= len(old.get('frames', [])):
                continue
            if old['frames'][i].get('ground'):
                if abs(box[3] - ANCHOR[1]) > GROUND_TOL:
                    problems.append(f'{name}: 접지 프레임인데 발바닥이 y={box[3]} '
                                    f'(기준 {ANCHOR[1]}±{GROUND_TOL})')

    if problems:
        print(f'\n✗ 규격 문제 {len(problems)}건 — 아무것도 쓰지 않았다')
        fail(problems)
        print('\n  → 이 프레임들을 원화 제작 환경에 그대로 알려 재작업을 요청한다.')
        sys.exit(1)

    hs = [b[3] - b[1] for _, b in boxes if b]
    print(f'✓ 규격 통과 — 그림 높이 {min(hs)}~{max(hs)}px, 발바닥 기준 {ANCHOR[1]}')

    if not write:
        print('\n(모의 실행이다. 반영하려면 --write)')
        return

    os.makedirs(dst, exist_ok=True)
    for name, im in frames:
        im.save(os.path.join(dst, name))
    meta = dict(old) if old else {
        'id': clip, 'character': char,
        'canvas': {'w': CANVAS[0], 'h': CANVAS[1]},
        'anchor': {'x': ANCHOR[0], 'y': ANCHOR[1]},
        'displayScale': 0.7059, 'charHeight': 340
    }
    # 프레임 수가 달라졌으면 목록을 다시 만든다. 예전 목록을 그대로 두면 없는 파일을
    # 가리키거나(8장 → 4장) 새 프레임이 등록되지 않는다.
    oldf = (old or {}).get('frames', [])
    meta['frames'] = []
    for i, (n, _) in enumerate(frames):
        e = {'file': n, 'dur': (oldf[i].get('dur') if i < len(oldf) else None) or 120}
        g = oldf[i].get('ground') if i < len(oldf) else None
        if g: e['ground'] = g
        meta['frames'].append(e)
    if len(oldf) != len(frames):
        print(f'· 프레임 수가 {len(oldf)} → {len(frames)} 로 바뀌어 목록을 다시 만들었다')
    # 이 표시는 placeholder 와 별개다. placeholder 는 "눈 검수를 했는가",
    # source 는 "이 프레임이 어디서 왔는가" 다. 가져온 그림은 아직 검수 전이어도
    # 임시 굽기 도구(bake-placeholder-clips.js)가 덮어쓰면 안 된다.
    meta['source'] = 'import'
    if approve:
        meta.pop('placeholder', None)
        meta.pop('note', None)
        meta.pop('needsArt', None)
        meta['reviewed'] = True
        print('✓ 검수 통과로 표시했다(placeholder 해제)')
    else:
        meta['placeholder'] = True
        meta['note'] = '가져오기는 됐지만 아직 눈 검수 전이다. --approve 로만 해제한다.'
        print('· placeholder 는 그대로 둔다. 눈으로 확인한 뒤 --approve 로 해제한다.')
    json.dump(meta, open(os.path.join(dst, 'clip.json'), 'w'), ensure_ascii=False, indent=2)
    print(f'→ {os.path.relpath(dst, ROOT)}  (원본 staging 은 그대로 남는다)')
    print('  다음: python3 tools/build-clip-art.py')


if __name__ == '__main__':
    main()
