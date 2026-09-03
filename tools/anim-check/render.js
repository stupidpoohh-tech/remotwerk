// 애니메이션 프레임 렌더러 (검사·눈으로 보기용).
//
// 앱과 똑같은 엔진으로 각 동작을 프레임 단위로 그려 PNG 로 남긴다. 프레임마다 두 장:
//   ...__NNN.png    실제 모습 (contact sheet 로 묶어 눈으로 본다)
//   ...__NNN_c.png  조각별 단색 (check.py 가 어느 조각이 어디 있는지 보는 용도)
//
// 실행:  node tools/anim-check/render.js
//   환경변수 CHARS / ANIMS / FPS / OUT 으로 범위를 좁힐 수 있다.
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const CHARS = process.env.CHARS ? process.env.CHARS.split(',') : ['char_seal', 'char_ribbon'];
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ANIMS = process.env.ANIMS ? process.env.ANIMS.split(',')
  : ['g_heart', 'g_cheer', 'g_droop', 'g_twerk', 'idle', 'wander'];
const FPS = Number(process.env.FPS || 20);
const OUT = process.env.OUT || path.join(__dirname, 'frames');

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--allow-file-access-from-files', '--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 420, height: 420 } });
  page.on('pageerror', (e) => console.log('[err]', e.message));
  await page.goto('file://' + path.resolve(__dirname, 'render.html'));

  const index = [];
  for (const char of CHARS) {
    await page.evaluate((c) => window.SETUP(c), char);
    for (const anim of ANIMS) {
      const dur = await page.evaluate((a) => window.DURATION(a), anim);
      const n = Math.max(2, Math.round((dur / 1000) * FPS));
      for (let i = 0; i <= n; i++) {
        const t = (dur * i) / n;
        await page.evaluate(([a, tt]) => window.POSE(a, tt), [anim, t]);
        for (const tint of [true, false]) {
          await page.evaluate((v) => window.SET_TINT(v), tint);
          const name = `${char}__${anim}__${String(i).padStart(3, '0')}${tint ? '_c' : ''}.png`;
          await page.locator('#stage').screenshot({ path: path.join(OUT, name), omitBackground: true });
        }
        index.push({ char, anim, i, t: Math.round(t) });
      }
    }
  }
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));
  await browser.close();
  console.log('frames:', index.length);
})();
