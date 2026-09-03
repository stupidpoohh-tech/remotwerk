'use strict';
/* 시간축(연속성) 검사 — **움직이는 상태**를 재는 도구.
 *
 * 정지 프레임 검사(check.py)는 "이 한 장이 깨졌는가"만 본다. 여기서는 실제 재생기를
 * 돌려 놓고 일정 간격으로 화면 상태를 기록해서, 프레임과 프레임 **사이**를 본다.
 *
 * 재는 것
 *   1) 루프 경계   — 한 바퀴 도는 순간 위치·크기가 튀는가
 *   2) 동작 전환   — 신호가 끝나고 대기로 돌아갈 때 튀는가
 *   3) 걷는 중 신호 — 걷다가 신호를 받으면 위치가 순간이동하는가
 *   4) 연속 신호   — 동작 중에 또 신호가 와도 처음부터 되감기지 않는가
 *   5) 발 미끄러짐 — 접지 구간에서 발이 바닥선을 벗어나는가
 *
 * 실행: node tools/anim-check/timeline.js [--rig]
 *   --rig 를 주면 스프라이트 대신 기존 5조각 리그로 같은 검사를 한다(호환 경로 확인).
 */

const { chromium } = require('playwright-core');
const path = require('path');

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const USE_SPRITE = !process.argv.includes('--rig');
const CHAR = process.env.CHAR || 'char_seal';
const SAMPLE_MS = 30;

// 판정 기준 — 한 샘플(30ms) 사이에 이보다 크게 변하면 "튀었다"고 본다.
const LIMITS = {
  jumpX: 26,        // 가로 위치(걷기 속도 약 0.08px/ms → 30ms 에 2.4px. 26px 이면 명백한 순간이동)
  jumpBottom: 34,   // 발밑 높이(점프 중에는 크게 변할 수 있어 넉넉히)
  groundDrift: 6    // 서 있는 동안 바닥선 흔들림
};

function fail(list, msg) { list.push(msg); }

async function collect(page, ms) {
  return page.evaluate(async (dur) => {
    const out = [];
    const t0 = performance.now();
    return new Promise((resolve) => {
      const iv = setInterval(() => {
        out.push(window.SAMPLE());
        if (performance.now() - t0 >= dur) { clearInterval(iv); resolve(out); }
      }, 30);
    });
  }, ms);
}

function analyse(samples, label, problems, opts) {
  opts = opts || {};
  let prev = null;
  let worstX = 0, worstB = 0;
  for (const s of samples) {
    if (prev) {
      const dx = Math.abs(s.cx - prev.cx);
      const db = Math.abs(s.bottom - prev.bottom);
      if (dx > worstX) worstX = dx;
      if (db > worstB) worstB = db;
      if (dx > LIMITS.jumpX) {
        fail(problems, `${label}: 가로 위치가 한 샘플에 ${dx}px 튐 (${prev.frame} → ${s.frame})`);
      }
      if (db > LIMITS.jumpBottom) {
        fail(problems, `${label}: 발밑이 한 샘플에 ${db}px 튐 (${prev.frame} → ${s.frame})`);
      }
    }
    prev = s;
  }
  return { worstX, worstB, n: samples.length };
}

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME, args: ['--allow-file-access-from-files', '--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 640, height: 460 } });
  const problems = [];
  page.on('pageerror', (e) => fail(problems, 'JS 오류: ' + e.message));
  await page.goto('file://' + path.resolve(__dirname, 'timeline.html'));

  const info = await page.evaluate(([c, s]) => window.SETUP(c, s), [CHAR, USE_SPRITE]);
  console.log(`대상: ${CHAR} · 재생기 ${info.kind} · 보폭 ${info.stepAdvance}px\n`);

  // 1) 대기 루프 — 두 바퀴 이상 돌려 경계에서 튀는지 본다
  await page.evaluate(() => window.PLAY('idle'));
  let r = analyse(await collect(page, 5200), '대기 루프', problems);
  console.log(`1. 대기 루프      샘플 ${r.n} · 최대 가로변화 ${r.worstX}px · 최대 발밑변화 ${r.worstB}px`);

  // 2) 걷기 루프 — 배우를 켜고 실제로 이동시킨다
  await page.evaluate(() => window.START_ACTOR({ idleMin: 400, idleMax: 600, walkMin: 4000, walkMax: 4200, walkChance: 1 }));
  const walk = await collect(page, 5000);
  r = analyse(walk, '걷기', problems);
  const moved = Math.max(...walk.map((s) => s.offX)) - Math.min(...walk.map((s) => s.offX));
  console.log(`2. 걷기           샘플 ${r.n} · 최대 가로변화 ${r.worstX}px · 실제 이동 ${moved.toFixed(0)}px`);
  if (moved < 20) fail(problems, '걷기: 화면에서 실제로 이동하지 않았다');

  // 3) 걷는 중 신호 — 위치가 튀지 않고 그 자리에서 연기해야 한다
  await page.evaluate(() => window.PLAY('g_cheer'));
  r = analyse(await collect(page, 2400), '걷는 중 신호', problems);
  console.log(`3. 걷는 중 신호   샘플 ${r.n} · 최대 가로변화 ${r.worstX}px · 최대 발밑변화 ${r.worstB}px`);

  // 4) 연속 신호 — 동작 중에 또 보낸다
  await page.evaluate(() => { window.PLAY('g_droop'); setTimeout(() => window.PLAY('g_heart'), 500); });
  r = analyse(await collect(page, 4200), '연속 신호', problems);
  console.log(`4. 연속 신호      샘플 ${r.n} · 최대 가로변화 ${r.worstX}px · 최대 발밑변화 ${r.worstB}px`);

  // 5) 트월킹(뒤돌기 포함) — 방향 전환에서 튀는지
  await page.evaluate(() => window.PLAY('g_twerk'));
  r = analyse(await collect(page, 3200), '트월킹', problems);
  console.log(`5. 트월킹         샘플 ${r.n} · 최대 가로변화 ${r.worstX}px · 최대 발밑변화 ${r.worstB}px`);

  // 6) 서 있는 동안 바닥선이 흔들리지 않는가
  await page.evaluate(() => window.PLAY('idle'));
  const idle = await collect(page, 2600);
  const bottoms = idle.map((s) => s.bottom);
  const drift = Math.max(...bottoms) - Math.min(...bottoms);
  console.log(`6. 대기 중 바닥선 흔들림 ${drift}px`);
  if (drift > LIMITS.groundDrift) fail(problems, `대기: 바닥선이 ${drift}px 흔들린다(서 있는데 발이 뜬다)`);

  await browser.close();

  console.log(`\n${problems.length ? '✗ 문제 ' + problems.length + '건' : '✓ 연속성 문제 없음'}`);
  for (const p of problems) console.log('   -', p);
  process.exit(problems.length ? 1 : 0);
})();
