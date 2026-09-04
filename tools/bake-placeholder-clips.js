'use strict';
/* 임시 스프라이트 굽기 — 원본 5조각을 자세만 잡아 512×512 PNG 로 뽑는다.
 *
 * ⚠ 이건 **아트 제작이 아니다.** 새로 그린 연기 자세가 아니라, 있는 조각을 배치한 것이다.
 *   목적은 재생 구조·타이밍·접지·전환을 실물로 검증하는 것.
 *   결과 clip.json 에는 placeholder: true 가 박히고 검사 도구가 경고한다.
 *   진짜 아트 발주서는 docs/art-orders.md.
 *
 * 실행: node tools/bake-placeholder-clips.js [캐릭터id]
 *   출력: art/clips/<캐릭터>/<클립>/frame-NN.png + clip.json
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { CLIPS } = require('./clip-poses');

const ROOT = path.join(__dirname, '..');
// 캐릭터 id 는 **옵션이 아닌 첫 인자**다. 예전엔 argv[2] 를 그냥 썼기 때문에
// `node tools/bake-placeholder-clips.js --force` 가 '--force' 라는 이름의 캐릭터로 해석돼
// art/clips/--force/ 에 조용히 구워졌다. 덮어쓰기 방지가 도는 것처럼 보이지만 실은
// 아무 일도 안 하고 있었다.
const CHAR = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'char_seal';
const OUT = path.join(ROOT, 'art', 'clips', CHAR);
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

// Animation Bible 2절 규격
const CANVAS = { w: 512, h: 512 };
const ANCHOR = { x: 256, y: 470 };
const CHAR_HEIGHT = 340;          // 캔버스 안에서의 캐릭터 높이(px). 위쪽에 점프 여유를 남긴다
// 캔버스 픽셀 → 논리 픽셀 배율.
// 리그로 그리던 것과 **같은 크기**로 보여야 스프라이트/리그를 오가도 캐릭터가 안 커진다.
// 이 값은 굽는 시점의 배율의 역수다(리그 유닛 × scale = 캔버스 px 로 그렸으므로).

const PAGE = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="file://${path.join(ROOT, 'src/renderer/shared/character.css')}">
<style>
  html,body{margin:0;background:transparent}
  #stage{position:relative;width:${CANVAS.w}px;height:${CANVAS.h}px;overflow:hidden}
  #anchor{position:absolute;left:${ANCHOR.x}px}
  .rw-fx{display:none}
</style>
<div id="stage"><div id="anchor"></div></div>
${['skeleton', 'gestures', 'animations', 'engine', 'preset-art', 'presets', 'characters']
  .map((f) => `<script src="file://${path.join(ROOT, 'src/renderer/shared', f + '.js')}"></script>`).join('\n')}
<script>
window.SETUP = function (charId, charHeight, anchorY) {
  const anchor = document.getElementById('anchor');
  anchor.innerHTML = '';
  const spec = RW.characters.rigFor(charId, { customCharacters: [] });
  // 굽는 동안에는 관절 감쇠를 끈다 — 자세 값이 곧 최종 각도가 되게.
  const sk = Object.assign({}, spec.skeleton, {
    bones: spec.skeleton.bones.map((b) => Object.assign({}, b, { animScale: 1 }))
  });
  const box = sk.box;
  const scale = charHeight / box.h;
  anchor.style.transformOrigin = '0 0';
  anchor.style.transform = 'scale(' + scale + ')';
  anchor.style.top = (anchorY - box.groundY * scale) + 'px';
  window.__ctrl = RW.engine.mount(anchor, { skeleton: sk, rig: spec.rig });
  return { box: box, scale: scale };
};
// 찍은 PNG 를 다시 읽어 알파 경계를 잰다. 바닥선 보정에 쓴다.
window.MEASURE = function (dataUrl) {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = function () {
      const cv = document.createElement('canvas');
      cv.width = im.width; cv.height = im.height;
      const ctx = cv.getContext('2d');
      ctx.drawImage(im, 0, 0);
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
      for (let y = 0; y < cv.height; y++) {
        for (let x = 0; x < cv.width; x++) {
          if (d[(y * cv.width + x) * 4 + 3] > 16) {
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
          }
        }
      }
      resolve({ minX, minY, maxX, maxY });
    };
    im.src = dataUrl;
  });
};
window.POSE = function (pose) {
  const full = { root: {}, bones: {} };
  const R = ['x','y','rot','vis','flip','fx','sx','sy','back'];
  const B = ['rot','x','y','vis'];
  const nd = (p) => (p==='vis'?true:(p==='flip'||p==='back')?false:(p==='sx'||p==='sy')?1:0);
  for (const p of R) full.root[p] = (pose.root && pose.root[p] != null) ? pose.root[p] : nd(p);
  for (const bn of Object.keys(pose.bones || {})) {
    full.bones[bn] = {};
    for (const p of B) full.bones[bn][p] = (pose.bones[bn][p] != null) ? pose.bones[bn][p] : nd(p);
  }
  window.__ctrl.applyPose(full);
};
</script>`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = path.join(OUT, '_bake.html');
  fs.writeFileSync(tmp, PAGE);

  const browser = await chromium.launch({
    executablePath: CHROME, args: ['--allow-file-access-from-files', '--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: CANVAS.w, height: CANVAS.h }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('[err]', e.message));
  await page.goto('file://' + tmp);
  const info = await page.evaluate(([c, h, ay]) => window.SETUP(c, h, ay), [CHAR, CHAR_HEIGHT, ANCHOR.y]);
  console.log(`[${CHAR}] 콘텐츠 상자 ${info.box.w}×${info.box.h}, 배율 ${info.scale.toFixed(3)}`);

  const manifest = {};
  // ★ 승인된 원화 보호 — 이 도구는 **임시 굽기** 도구다.
  // clip.json 에 placeholder 표시가 없으면 사람이 검수해 통과시킨 원화라는 뜻이다.
  // 그런 클립은 건너뛴다. 문서 경고만으로는 사고를 막지 못한다(--force 로만 덮어쓴다).
  const FORCE = process.argv.includes('--force');
  const skipped = [];

  for (const clipId of Object.keys(CLIPS)) {
    if (!FORCE) {
      let approved = false;
      try {
        const j = JSON.parse(fs.readFileSync(path.join(OUT, clipId, 'clip.json'), 'utf8'));
        // 두 가지를 다 지킨다.
        //   placeholder 없음 → 눈 검수를 통과한 원화
        //   source==='import' → import-clip.py 로 **밖에서 그린 그림을 넣은** 클립.
        //     아직 검수 전이라 placeholder 가 남아 있어도, 자세만 잡아 구운 임시 그림으로
        //     되돌리면 원화가 사라진다. (실제로 트월킹 원화가 이 조건에 걸려 있었다.)
        approved = j.placeholder !== true || j.source === 'import';
      } catch (_) { approved = false; }   // clip.json 이 없으면 아직 아무것도 없는 것
      if (approved) { skipped.push(clipId); continue; }
    }
    const clip = CLIPS[clipId];
    const dir = path.join(OUT, clipId);
    fs.mkdirSync(dir, { recursive: true });

    const frames = [];
    for (let i = 0; i < clip.frames.length; i++) {
      const f = clip.frames[i];
      const file = `frame-${String(i).padStart(2, '0')}.png`;
      // 공중 프레임(air)만 빼고 전부 바닥선에 맞춘다.
      // 접합 자세가 클립마다 몇 px 씩 달라지면, 동작이 끝날 때마다 캐릭터가 툭 움직인다.
      const grounded = !f.air;

      // 바닥선 보정 — 자세를 잡으면 넓적한 발지느러미가 바닥을 파고들거나 뜬다.
      // 찍고 → 재고 → root.y 를 고쳐 다시 찍는다. 최대 3회면 1px 안으로 들어온다.
      let pose = JSON.parse(JSON.stringify(f.pose));
      let buf = null, m = null;
      for (let it = 0; it < (grounded ? 4 : 1); it++) {
        await page.evaluate((p) => window.POSE(p), pose);
        buf = await page.locator('#stage').screenshot({ omitBackground: true });
        m = await page.evaluate((u) => window.MEASURE(u), 'data:image/png;base64,' + buf.toString('base64'));
        if (!grounded) break;
        const off = ANCHOR.y - m.maxY;                 // +면 발이 떠 있다
        if (Math.abs(off) <= 1) break;
        pose.root = pose.root || {};
        pose.root.y = (pose.root.y || 0) + off / info.scale;
      }
      fs.writeFileSync(path.join(dir, file), buf);

      const rec = { file, dur: f.dur };
      if (f.ground) rec.ground = f.ground;
      frames.push(rec);
      if (grounded && Math.abs(ANCHOR.y - m.maxY) > 1) {
        console.log(`    ⚠ ${clipId}/${file}: 바닥선 ${m.maxY} (목표 ${ANCHOR.y})`);
      }
    }

    const meta = {
      id: clipId,
      character: CHAR,
      canvas: CANVAS,
      anchor: ANCHOR,
      displayScale: Math.round((1 / info.scale) * 10000) / 10000,
      charHeight: CHAR_HEIGHT,
      loop: !!clip.loop,
      loopFrom: 0,
      cancelFrom: clip.cancelFrom == null ? 0 : clip.cancelFrom,
      frames,
      placeholder: true,
      note: '임시 에셋 — 원본 5조각을 자세만 잡아 구운 것. 새로 그린 연기 자세가 아니다. docs/art-orders.md 참고.'
    };
    if (clip.stepAdvance) meta.stepAdvance = clip.stepAdvance;
    if (clip.sequence) meta.sequence = clip.sequence;
    if (clip.fx) meta.fx = clip.fx;
    if (clip.needsArt) meta.needsArt = clip.needsArt;
    fs.writeFileSync(path.join(dir, 'clip.json'), JSON.stringify(meta, null, 2));
    manifest[clipId] = frames.length;
    console.log(`  ${clipId.padEnd(11)} ${frames.length}장  ${frames.reduce((a, b) => a + b.dur, 0)}ms` +
      (clip.needsArt ? `  ⚠ 실제 아트 필요: ${clip.needsArt.join(', ')}` : ''));
  }

  await browser.close();
  fs.unlinkSync(tmp);
  if (skipped.length) {
    console.log(`\n  ⛔ 원화(가져온 그림)라 건너뜀: ${skipped.join(', ')}`);
    console.log('     (정말 임시본으로 되돌리려면 --force)');
  }
  console.log(`\n→ ${OUT}`);
  console.log('다음: node tools/build-clip-art.js');
})();
