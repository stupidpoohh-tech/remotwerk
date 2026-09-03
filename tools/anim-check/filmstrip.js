'use strict';
/* 필름스트립 — 실제 재생 화면을 시간 순서로 찍어 한 장으로 잇는다.
 *
 * 정지 포즈 한 장으로는 "자연스러운가"를 판단할 수 없다. 같은 동작을 같은 시각에
 * 찍어 나란히 놓으면 이음매가 튀는지, 자세가 실제로 바뀌는지가 눈에 보인다.
 *
 * 실행:
 *   node tools/anim-check/filmstrip.js                 # 지금 코드(스프라이트)
 *   node tools/anim-check/filmstrip.js --rig           # 지금 코드(리그 호환 경로)
 *   node tools/anim-check/filmstrip.js --shared <경로> # 다른 커밋의 shared 로 비교
 *
 * 출력: tools/anim-check/filmstrip/<이름>-<동작>.png
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..', '..');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const argv = process.argv.slice(2);
const idx = argv.indexOf('--shared');
const SHARED = idx >= 0 ? path.resolve(argv[idx + 1]) : path.join(ROOT, 'src/renderer/shared');
const USE_RIG = argv.includes('--rig') || idx >= 0;      // 다른 커밋에는 재생기가 없다
const NAME = argv.includes('--name') ? argv[argv.indexOf('--name') + 1]
  : (idx >= 0 ? 'before' : (USE_RIG ? 'after-rig' : 'after-sprite'));
const CHAR = process.env.CHAR || 'char_seal';
const OUT = path.join(__dirname, 'filmstrip');
const SHOTS = 10;                                        // 동작당 장 수
const W = 260, H = 300;

function has(f) { return fs.existsSync(path.join(SHARED, f)); }

const SCRIPTS = ['skeleton', 'gestures', 'animations', 'engine', 'preset-art', 'presets', 'characters']
  .concat(USE_RIG ? [] : ['clip-art', 'clips', 'player'])
  .filter((f) => has(f + '.js'));

const PAGE = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="file://${path.join(SHARED, '..', 'shared', 'character.css')}">
<style>
 html,body{margin:0;background:#fff}
 #stage{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:#fafaff}
 #anchor{position:absolute;left:50%}
 #ground{position:absolute;left:0;right:0;top:250px;border-top:1px dashed #f7b}
</style>
<div id="stage"><div id="ground"></div><div id="anchor"></div></div>
${SCRIPTS.map((f) => `<script src="file://${path.join(SHARED, f + '.js')}"></script>`).join('\n')}
<script>
window.SETUP = function (charId, useRig) {
  const a = document.getElementById('anchor');
  a.innerHTML = '';
  const spec = RW.characters.rigFor(charId, { customCharacters: [] });
  let p;
  if (!useRig && window.RW.player) p = RW.player.create(a, charId, spec);
  else if (window.RW.player) p = RW.player.createRig(a, spec);
  else { const c = RW.engine.mount(a, spec); p = { kind: 'rig-legacy', box: spec.skeleton.box,
    play: (g, o) => c.play(g, o || {}), stop: () => c.stop() }; }
  const b = p.box;
  const s = Math.min(1, 230 / b.h);
  a.style.transformOrigin = '0 0';
  a.style.transform = 'scale(' + s + ')';
  a.style.top = (250 - b.groundY * s) + 'px';
  window.__p = p;
  return p.kind;
};
window.PLAY = function (g) { window.__p.play(g, {}); };
</script>`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = path.join(OUT, '_strip.html');
  fs.writeFileSync(tmp, PAGE);
  const browser = await chromium.launch({
    executablePath: CHROME, args: ['--allow-file-access-from-files', '--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', (e) => console.log('[err]', e.message));
  await page.goto('file://' + tmp);
  const kind = await page.evaluate(([c, r]) => window.SETUP(c, r), [CHAR, USE_RIG]);
  console.log(`${NAME}: ${SHARED} · ${kind}`);

  const PLAN = [
    { g: 'idle', span: 3000 },
    { g: 'wander', span: 2000 },
    { g: 'g_heart', span: 2300 },
    { g: 'g_cheer', span: 2000 },
    { g: 'g_droop', span: 2900 },
    { g: 'g_twerk', span: 2400 }
  ];
  for (const item of PLAN) {
    await page.evaluate((g) => window.PLAY(g), item.g);
    const shots = [];
    const step = item.span / (SHOTS - 1);
    for (let i = 0; i < SHOTS; i++) {
      if (i) await page.waitForTimeout(step);
      shots.push(await page.locator('#stage').screenshot());
    }
    const file = path.join(OUT, `${NAME}-${item.g}.png`);
    fs.writeFileSync(file, Buffer.concat([]));   // 자리만 잡고 아래 파이썬이 잇는다
    fs.writeFileSync(file.replace('.png', '.json'),
      JSON.stringify({ name: NAME, gesture: item.g, span: item.span, shots: shots.map((b) => b.toString('base64')) }));
    console.log(`  ${item.g.padEnd(9)} ${SHOTS}장 (${item.span}ms)`);
  }
  await browser.close();
  fs.unlinkSync(tmp);
  console.log(`→ ${OUT}  (python3 tools/anim-check/filmstrip.py 로 이어 붙인다)`);
})();
