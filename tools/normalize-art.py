#!/usr/bin/env python3
"""원화 정규화 — 밖에서 받은 그림 여러 장을 클립 규격 캔버스에 **같은 기준**으로 얹는다.

받은 그림은 장마다 캔버스 크기도, 캐릭터가 놓인 위치도 다르다. 그대로 이어 붙이면
캐릭터가 프레임마다 커졌다 작아졌다 하고 발이 미끄러진다. 여기서 맞추는 것은 셋이다.

  1) **배율은 전부 같다.** 기준 장 하나의 키를 charHeight 에 맞추고, 그 배율을
     나머지 장에도 그대로 쓴다. 장마다 키에 맞춰 따로 재면 몸을 굽힌 프레임이
     억지로 늘어나 동작이 사라진다.
  2) **세로는 발바닥으로 맞춘다.** 그림 맨 아래를 바닥선(y=470)에 둔다.
  3) **가로는 발로 맞춘다(몸 중심이 아니다).** 궁디댄스처럼 발은 두고 골반만 옮기는
     동작에서, 몸 전체 중심으로 맞추면 옮긴 골반만큼 그림이 반대로 밀려
     **골반 이동이 통째로 지워진다.** 발 밑동 띠의 중심을 캔버스 중앙에 둔다.

출력은 art/staging/<characterId>/<clipId>/frame-NN.png 이고, 그다음은
tools/import-clip.py 가 규격을 검사해서 클립으로 넣는다(여기서는 검사하지 않는다).

  실행:
    python3 tools/normalize-art.py char_dada twerk_loop \\
        --match art/clips/char_dada/idle/frame-00.png \\
        /tmp/chz/dada3.png /tmp/chz/dada5.png /tmp/chz/dada6.png /tmp/chz/dada4.png

  --match 를 주면 규격 키(340) 대신 **그 그림과 같은 키**로 맞춘다. 대기 자세와
  키가 다르면 뒤도는 순간 캐릭터가 커졌다 작아진다 — 대기 그림을 넘기면 그 튐이 없다.
  (dada 는 --match 없이 넣었을 때 314 → 343, 9% 커졌다.)
"""
import os, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

CANVAS = (512, 512)
ANCHOR = (256, 470)      # 발바닥 기준점
CHAR_HEIGHT = 340        # 캔버스 안에서의 캐릭터 키
ALPHA_BG = 8             # 발 중심을 잴 때만 쓴다(희미한 픽셀은 중심을 흐린다)
FOOT_BAND = 0.05         # 아래에서 이 비율만큼이 '발' 이다


def dehalo(im):
    """거의 안 보이는 가장자리(알파 ALPHA_BG 이하)를 **완전 투명으로 만든다.**

    받은 원화에는 눈에 안 보이는 옅은 후광이 붙어 있다(물개 원화는 위아래로
    200px 이나 됐다). 규격 검사는 알파>0 을 그림으로 보므로, 그대로 두면
    후광의 맨 아랫줄이 바닥선에 놓이고 **정작 발은 공중에 뜬다.** 키도 후광까지
    포함해 재어져서 캐릭터가 실제보다 작게 들어간다.
    여기서 한 번 잘라 내면 이후 모든 도구가 같은 것을 '그림' 으로 보게 된다.
    """
    a = im.split()[3].point(lambda v: v if v > ALPHA_BG else 0)
    out = im.copy()
    out.putalpha(a)
    return out


def bbox(im):
    """그림 영역. **알파가 0보다 크면 그림**으로 본다.

    임계값을 8 로 두면 안티에일리어싱된 가장자리 2~3px 이 빠져서, 발을 바닥선에
    맞춰 놓고도 규격 검사(build-clip-art.py 는 Pillow getbbox = 알파>0)에서
    "발바닥 y=472" 로 걸린다. 세 도구가 같은 자를 써야 한다.
    """
    bb = im.split()[3].getbbox()
    if not bb:
        raise SystemExit('✗ 전부 투명한 그림이 있다')
    x0, y0, x1, y1 = bb
    return x0, y0, x1 - 1, y1 - 1      # getbbox 는 오른쪽·아래가 열린 구간이다


def foot_center(im, box):
    """발 밑동 띠의 가로 중심. 발이 기준이라 골반 이동이 보존된다."""
    px = im.load()
    x0, y0, x1, y1 = box
    band = max(1, int((y1 - y0) * FOOT_BAND))
    xs = [x for y in range(y1 - band, y1 + 1) for x in range(x0, x1 + 1)
          if px[x, y][3] > ALPHA_BG]
    return sum(xs) / len(xs) if xs else (x0 + x1) / 2


def main():
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(2)
    args = sys.argv[1:]
    target = CHAR_HEIGHT
    if '--match' in args:
        i = args.index('--match')
        ref = dehalo(Image.open(args[i + 1]).convert('RGBA'))
        rb = bbox(ref)
        target = rb[3] - rb[1]
        del args[i:i + 2]
    char, clip, srcs = args[0], args[1], args[2:]

    ims = [dehalo(Image.open(p).convert('RGBA')) for p in srcs]
    boxes = [bbox(im) for im in ims]

    # 배율은 **첫 장** 기준으로 한 번만 정하고 전부에 같이 쓴다.
    base_h = boxes[0][3] - boxes[0][1]
    scale = target / base_h
    print(f'기준 {os.path.basename(srcs[0])} 키 {base_h}px → {target}px, 배율 {scale:.4f}')

    dst = os.path.join(ROOT, 'art', 'staging', char, clip)
    os.makedirs(dst, exist_ok=True)

    for i, (im, box) in enumerate(zip(ims, boxes)):
        x0, y0, x1, y1 = box
        fx = foot_center(im, box)
        nw, nh = max(1, round(im.width * scale)), max(1, round(im.height * scale))
        # 줄이면 가장자리가 다시 옅게 번지므로 한 번 더 잘라 낸다.
        small = dehalo(im.resize((nw, nh), Image.LANCZOS))

        # 놓을 자리는 **줄인 그림을 다시 재서** 정한다.
        # 원본 좌표에 배율만 곱하면, 줄이는 과정에서 번진 반투명 가장자리만큼
        # 어긋나 발바닥이 바닥선에서 몇 px 씩 벗어난다(실제로 466~472 로 흩어졌다).
        sb = bbox(small)
        sfx = foot_center(small, sb)
        out = Image.new('RGBA', CANVAS, (0, 0, 0, 0))
        # 발바닥 → 바닥선, 발 중심 → 캔버스 중앙
        left = round(ANCHOR[0] - sfx)
        top = ANCHOR[1] - sb[3]
        out.paste(small, (left, top))
        name = f'frame-{i:02d}.png'
        out.save(os.path.join(dst, name))
        nb = bbox(out)
        print(f'  {name} ← {os.path.basename(srcs[i]):14s} '
              f'키 {nb[3]-nb[1]:3d}  발바닥 y={nb[3]}  좌우 {nb[0]}~{nb[2]}')

    print(f'→ {os.path.relpath(dst, ROOT)}')
    print(f'  다음: python3 tools/import-clip.py {char} {clip} --write')


if __name__ == '__main__':
    main()
