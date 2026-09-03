#!/usr/bin/env python3
"""클립 아트 빌드 — art/clips/** → 앱이 읽는 형태로.

하는 일
  1) Animation Bible 규격 검사(캔버스·기준점·바닥선·접합 자세·루프 접합)
  2) PNG 최적화(픽셀아트라 팔레트 양자화가 아주 잘 듣는다)
  3) src/renderer/assets/clips/** 로 복사 (패키징에 포함되는 경로)
  4) src/renderer/shared/clip-art.js 생성 — **경로와 메타데이터만** 담는다

왜 data URI 가 아닌가: 프레임이 45장이라 base64 로 넣으면 4MB 짜리 JS 가 되어
창을 열 때마다 통째로 파싱된다. 파일 경로는 CSP img-src 'self' 로 file:// 에서도
읽히는 것을 실제 크로미움으로 확인했다.

실행: python3 tools/build-clip-art.py
"""
import hashlib, json, os, shutil, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'art', 'clips')
DEST = os.path.join(ROOT, 'src', 'renderer', 'assets', 'clips')
OUT_JS = os.path.join(ROOT, 'src', 'renderer', 'shared', 'clip-art.js')

GROUND_TOL = 1          # 바닥선 허용 오차(px)
# 이웃한 두 프레임의 자세 차이 한도(논리픽셀).
#
# 스프라이트는 프레임 사이를 보간하지 않는다. 차이가 크면 그 자체가 순간이동으로 보인다.
# (리그는 보간되니 이 문제가 안 보였다 → 스프라이트로 옮기며 새로 생긴 검사 항목)
# 발밑은 점프에서 크게 변하는 게 정상이라 따로 둔다.
MAX_STEP_CX = 22
MAX_STEP_BOTTOM = 34
problems = []
warnings = []


def optimize(src_path, dst_path):
    im = Image.open(src_path).convert('RGBA')
    buf_full = im.copy()
    try:
        q = im.quantize(colors=200, method=Image.FASTOCTREE, dither=Image.NONE)
        q.save(dst_path, format='PNG', optimize=True)
        small = os.path.getsize(dst_path)
        buf_full.save(dst_path + '.tmp', format='PNG', optimize=True)
        full = os.path.getsize(dst_path + '.tmp')
        if full < small:
            shutil.move(dst_path + '.tmp', dst_path)
        else:
            os.remove(dst_path + '.tmp')
    except Exception:
        im.save(dst_path, format='PNG', optimize=True)
    return im


def check_frame(clip_id, meta, frame, im, neutral_bbox):
    """Animation Bible 9절 체크리스트 중 기계로 잴 수 있는 것들."""
    w, h = im.size
    if (w, h) != (meta['canvas']['w'], meta['canvas']['h']):
        problems.append(f"{clip_id}/{frame['file']}: 캔버스 {w}x{h} ≠ 규격 {meta['canvas']}")
    a = im.split()[3]
    bb = a.getbbox()
    if bb is None:
        problems.append(f"{clip_id}/{frame['file']}: 빈 프레임")
        return None
    x0, y0, x1, y1 = bb
    if x0 <= 1 or y0 <= 1 or x1 >= w - 1 or y1 >= h - 1:
        problems.append(f"{clip_id}/{frame['file']}: 그림이 캔버스에 닿음 {bb}")
    # 접지 프레임(ground 가 있거나 루프 클립)은 발바닥이 기준선에 있어야 한다
    if frame.get('ground') or meta.get('loop'):
        if abs((y1 - 1) - meta['anchor']['y']) > GROUND_TOL:
            problems.append(
                f"{clip_id}/{frame['file']}: 발바닥 y={y1-1}, 기준선 {meta['anchor']['y']}")
    return bb


def main():
    if not os.path.isdir(SRC):
        print('art/clips 가 없습니다.'); return 1
    shutil.rmtree(DEST, ignore_errors=True)
    os.makedirs(DEST, exist_ok=True)

    registry = {}
    total_bytes = 0
    # 같은 그림은 한 파일만 남긴다.
    #
    # 접합 자세(idle 0번)는 모든 클립의 시작·끝에 나온다. 클립마다 따로 두면 용량도
    # 낭비지만, 나중에 한쪽만 다시 그리면 이음매가 어긋난다. 내용 해시로 묶어
    # **같은 그림은 같은 파일을 가리키게** 해서 규칙이 구조적으로 지켜지게 한다.
    seen = {}
    for char in sorted(os.listdir(SRC)):
        cdir = os.path.join(SRC, char)
        if not os.path.isdir(cdir):
            continue
        clips, canvas, anchor, dscale, placeholder_ids, needs_art = {}, None, None, None, [], {}
        neutral_bbox = None

        # idle 을 가장 먼저 — 접합 자세가 idle/frame-00 으로 모이게 한다.
        order = sorted(os.listdir(cdir), key=lambda n: (n != 'idle', n))
        for clip_id in order:
            d = os.path.join(cdir, clip_id)
            meta_path = os.path.join(d, 'clip.json')
            if not os.path.isfile(meta_path):
                continue
            meta = json.load(open(meta_path))
            canvas = canvas or meta['canvas']
            anchor = anchor or meta['anchor']
            dscale = dscale or meta.get('displayScale') or (meta['displayHeight'] / meta['canvas']['h'])
            if meta['canvas'] != canvas or meta['anchor'] != anchor:
                problems.append(f'{char}/{clip_id}: 캔버스·기준점이 다른 클립과 다르다')

            out_dir = os.path.join(DEST, char, clip_id)
            os.makedirs(out_dir, exist_ok=True)
            frames = []
            for fr in meta['frames']:
                src_p = os.path.join(d, fr['file'])
                dst_p = os.path.join(out_dir, fr['file'])
                im = optimize(src_p, dst_p)
                bb = check_frame(f'{char}/{clip_id}', meta, fr, im, neutral_bbox)
                if clip_id == 'idle' and fr is meta['frames'][0]:
                    neutral_bbox = bb

                digest = hashlib.sha1(open(dst_p, 'rb').read()).hexdigest()
                rel = f'{char}/{clip_id}/{fr["file"]}'
                if digest in seen:
                    os.remove(dst_p)                 # 같은 그림 → 먼저 있는 파일을 쓴다
                    rel = seen[digest]
                else:
                    seen[digest] = rel
                    total_bytes += os.path.getsize(dst_p)
                rec = {'image': rel, 'dur': fr['dur']}
                # 그림이 실제로 차지하는 영역(캔버스 좌표). 재생기·검사 도구가
                # "화면에서 캐릭터가 어디에 있는지"를 알기 위해 필요하다.
                # (스프라이트는 캔버스가 고정이라 엘리먼트 크기만으로는 알 수 없다.)
                if bb:
                    rec['bbox'] = [bb[0], bb[1], bb[2] - 1, bb[3] - 1]
                if fr.get('ground'):
                    rec['ground'] = fr['ground']
                frames.append(rec)

            # sequence 가 있으면 그 순서로 펼친다(같은 그림 재사용)
            if meta.get('sequence'):
                frames = [dict(frames[i]) for i in meta['sequence']]

            # 이웃 프레임 간 도약 검사(루프는 마지막→처음도 본다)
            sc = meta.get('displayScale') or 1
            seq = frames + ([frames[0]] if meta.get('loop') and len(frames) > 1 else [])
            for a, b in zip(seq, seq[1:]):
                if not (a.get('bbox') and b.get('bbox')):
                    continue
                cxa = (a['bbox'][0] + a['bbox'][2]) / 2 * sc
                cxb = (b['bbox'][0] + b['bbox'][2]) / 2 * sc
                dcx, dbot = abs(cxb - cxa), abs(b['bbox'][3] - a['bbox'][3]) * sc
                if dcx > MAX_STEP_CX or dbot > MAX_STEP_BOTTOM:
                    warnings.append(
                        f"{char}/{clip_id}: {os.path.basename(a['image'])} → "
                        f"{os.path.basename(b['image'])} 자세 도약 가로 {dcx:.0f}px, 발밑 {dbot:.0f}px "
                        f"(중간 자세가 필요할 수 있다)")

            clip = {
                'id': clip_id, 'loop': bool(meta.get('loop')),
                'loopFrom': meta.get('loopFrom', 0),
                'cancelFrom': meta.get('cancelFrom', 0),
                'frames': frames
            }
            if meta.get('stepAdvance'):
                clip['stepAdvance'] = meta['stepAdvance']
            if meta.get('fx'):
                clip['fx'] = meta['fx']
            if meta.get('placeholder'):
                clip['placeholder'] = True
                placeholder_ids.append(clip_id)
            if meta.get('needsArt'):
                needs_art[clip_id] = meta['needsArt']
            clips[clip_id] = clip

        if clips:
            registry[char] = {'canvas': canvas, 'anchor': anchor,
                              'displayScale': dscale, 'clips': clips}
            print(f'[{char}] 클립 {len(clips)}개, 프레임 {sum(len(c["frames"]) for c in clips.values())}장')
            if placeholder_ids:
                print(f'   ⚠ 임시 에셋: {", ".join(placeholder_ids)}')
            for k, v in needs_art.items():
                print(f'   ⚠ 실제 아트 필요 — {k}: {", ".join(v)}')

    header = '''\
'use strict';
/* 클립 아트 등록부 — **자동 생성 파일이다. 손으로 고치지 말 것.**
 *
 *   art/clips/**  →  python3 tools/build-clip-art.py  →  이 파일 + src/renderer/assets/clips/**
 *
 * 여기에는 경로와 타이밍만 있고, 그림은 assets/clips 에 파일로 들어 있다.
 * (프레임이 많아 data URI 로 넣으면 창마다 수 MB 를 파싱하게 된다. 파일 경로는
 *  CSP img-src 'self' 로 file:// 에서도 읽히는 것을 실제 크로미움에서 확인했다.)
 *
 * 이미지 경로는 **이 스크립트 위치를 기준으로** 절대화한다. 화면마다 상대경로가
 * 달라지는 문제(그리고 검사 도구에서 경로가 어긋나는 문제)를 없애기 위해서다.
 */

(function (root) {
  const RW = (root.RW = root.RW || {});
  const here = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '';
  const BASE = here ? here.replace(/shared\\/clip-art\\.js.*$/, 'assets/clips/') : 'assets/clips/';
  const DATA = '''
    with open(OUT_JS, 'w') as f:
        f.write(header)
        json.dump(registry, f, ensure_ascii=False, separators=(',', ':'))
        f.write(""";
  // 상대 경로 → 절대 경로
  for (const ch of Object.keys(DATA)) {
    const clips = DATA[ch].clips;
    for (const id of Object.keys(clips)) {
      for (const fr of clips[id].frames) fr.image = BASE + fr.image;
    }
  }
  RW.clipArt = DATA;
})(typeof window !== 'undefined' ? window : globalThis);
""")

    print(f'\n→ {OUT_JS} ({os.path.getsize(OUT_JS)//1024} KB)')
    print(f'→ {DEST} (PNG 합계 {total_bytes//1024} KB)')
    if warnings:
        print(f'\n⚠ 자세 도약 경고 {len(warnings)}건 (중간 프레임을 검토하세요)')
        for w in warnings:
            print('   -', w)
    if problems:
        print(f'\n✗ 규격 위반 {len(problems)}건')
        for p in problems:
            print('   -', p)
        return 1
    print('\n✓ 규격 검사 통과')
    return 0


if __name__ == '__main__':
    sys.exit(main())
