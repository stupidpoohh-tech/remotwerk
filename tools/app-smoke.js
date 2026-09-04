'use strict';
/* 앱 스모크 테스트 — **진짜 Electron 앱을 띄워서** 화면에 무엇이 있는지 확인한다.
 *
 * 왜 필요한가: 렌더러만 따로 열어 보는 검사는 통과하는데 실제 앱에서는 캐릭터가
 * 안 보이는 일이 있었다. 창이 실제로 만들어지는지, 그 창에 캐릭터가 그려지는지,
 * 그리고 **사용자가 만들 수 있는 설정 상태**에서도 그런지는 앱을 띄워야만 알 수 있다.
 * 깨끗한 설치만 검사하면 "제 PC 에서는 되는데요" 가 된다.
 *
 * 방법: Xvfb(가상 화면) 위에서 Electron 을 --remote-debugging-port 로 띄우고,
 *       CDP 로 붙어 창 목록과 각 창의 DOM·스크린샷을 확인한다.
 *       앱 코드에는 손대지 않는다(테스트용 분기를 제품에 넣지 않는다).
 *
 *   실행: node tools/app-smoke.js            # 전체
 *         node tools/app-smoke.js 기본        # 이름이 일치하는 것만
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(os.tmpdir(), 'rw-smoke');

const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron');
const only = process.argv[2];

// 검사할 설정 상태들. 사용자가 실제로 만들 수 있는 상태여야 의미가 있다.
const CASES = {
  '기본':                 {},
  '작게 줄임':             { overlayScale: 0.5 },
  '크게 키움':             { overlayScale: 2 },
  '왼쪽 위 끝':            { overlayPos: { x: 0, y: 0 } },
  '오른쪽 아래 끝':         { overlayPos: { x: 1, y: 1 } },
  '집중 모드':             { focusMode: true },
  '크게 + 위쪽 끝':         { overlayScale: 2.5, overlayPos: { x: 0.5, y: 0.02 } },
  '크게 + 왼쪽 끝':         { overlayScale: 2.5, overlayPos: { x: 0, y: 0.5 } },
  '크게 + 오른쪽 아래':      { overlayScale: 2.5, overlayPos: { x: 1, y: 1 } },
  '작게 + 왼쪽 위':         { overlayScale: 0.5, overlayPos: { x: 0, y: 0 } },
  '없는 캐릭터 선택':       { characterId: '없는id', partnerCharacterId: '없는id2' },
  '없어진 색 프리셋':       { characterId: 'preset1', partnerCharacterId: 'preset3' },
  '깨진 커스텀(슬롯 비어)':  { characterId: 'c1', partnerCharacterId: 'c1',
                            customCharacters: [{ id: 'c1', name: '깨진것', bundle: { slots: {} } }] },
  '커스텀에 bundle 없음':   { characterId: 'c2', partnerCharacterId: 'c2',
                            customCharacters: [{ id: 'c2', name: '빈것' }] },
  '설정이 아예 깨짐':       null,  // config.json 에 잘못된 JSON 을 넣는다

  // ★ Firebase 경로. 페어링이 되어 있으면(roomId) 오버레이가 네트워크를 탄다.
  //   이 컨테이너는 바깥으로 못 나가므로 transport.ready 가 지연·실패하는 상황이
  //   그대로 재현된다 — 사용자 PC 에서 캐릭터가 안 보이던 바로 그 경로다.
  //   여기에 케이스가 없어서 15/15 통과인데도 실제로는 안 보였다.
  //   단, 이 환경에서는 SDK 를 아예 못 받아와 ready 가 **즉시 거부**된다.
  //   사용자 PC 처럼 ready 가 **끝나지 않고 대기**하는 조건은 여기서 재현되지 않으므로
  //   tools/overlay-startup-test.js(pending 케이스)가 그쪽을 맡는다. 둘 다 돌려야 한다.
  '페어링됨 + 서버 안 됨':   { roomId: 'r_smoke_test' },
  '페어링됨 + 큰 배율':     { roomId: 'r_smoke_test', overlayScale: 2.5 },
  '페어링됨 + 화면 끝':     { roomId: 'r_smoke_test', overlayPos: { x: 0, y: 0 } },

  // 저장값이 깨진 경우 — 진단 보고서 P1. NaN 이 CSS 좌표로 들어가면 캐릭터가 사라진다.
  '좌표가 NaN':           { overlayPos: { x: null, y: 'abc' } },
  '좌표 키가 없음':         { overlayPos: {} },
  '배율이 이상함':          { overlayScale: 'x' },
  '좌표가 범위 밖':         { overlayPos: { x: 9, y: -3 } }
};

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// 남은 프로세스를 **정확히** 죽인다.
// 이전에는 xvfb-run 만 죽여서 그 아래 Electron 이 살아남았고, 다음 케이스가 그 포트에
// 붙어 **엉뚱한 인스턴스를 검사**했다(라벨과 결과가 어긋났다). 검사 도구가 거짓말을 하면
// 검사가 없는 것만 못하다. 그래서 케이스마다 고유한 표식(userdata 경로)을 주고,
// /proc 에서 그 표식을 가진 프로세스만 골라 죽인다.
function killByMark(mark) {
  let killed = 0;
  for (const pid of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    let cmd = '';
    try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); } catch (_) { continue; }
    if (cmd.includes(mark) && Number(pid) !== process.pid) {
      try { process.kill(Number(pid), 'SIGKILL'); killed++; } catch (_) {}
    }
  }
  return killed;
}

async function runCase(label, cfg, port, mark) {
  const USERDATA = mark;
  fs.rmSync(USERDATA, { recursive: true, force: true });
  fs.mkdirSync(USERDATA, { recursive: true });
  fs.writeFileSync(path.join(USERDATA, 'config.json'),
    cfg === null ? '{ 이건 JSON 이 아니다' : JSON.stringify(cfg, null, 2));

  const child = spawn('xvfb-run', [
    '-a', '--server-args=-screen 0 1600x900x24',
    ELECTRON, ROOT,
    `--remote-debugging-port=${port}`, '--no-sandbox',
    `--user-data-dir=${USERDATA}`
  // detached: 프로세스 그룹째 죽여야 한다. xvfb-run 만 죽이면 그 아래 Electron 이
  // 살아남아 다음 케이스의 결과를 오염시킨다(실제로 없는 실패가 두 건 잡혔었다).
  ], { cwd: ROOT, detached: true, env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' } });

  const logs = [];
  child.stdout.on('data', (d) => logs.push(String(d)));
  child.stderr.on('data', (d) => logs.push(String(d)));

  const problems = [];
  let browser = null;
  try {
    for (let i = 0; i < 40 && !browser; i++) {
      await sleep(500);
      try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); } catch (_) {}
    }
    if (!browser) {
      problems.push('앱이 뜨지 않았다(CDP 연결 실패)');
      return { problems, logs };
    }
    await sleep(4000);   // 창이 다 뜨고 캐릭터가 그려질 시간

    const pages = browser.contexts().flatMap((c) => c.pages());
    const seen = {};
    for (const p of pages) {
      const name = (p.url().match(/renderer\/(\w+)\//) || [, '?'])[1];
      let info;
      try {
        info = await p.evaluate(() => ({
          parts: document.querySelectorAll('.rw-part').length,
          sprites: document.querySelectorAll('.rw-sprite').length,
          rect: (() => {
            const el = document.getElementById('char') || document.querySelector('.rw-stage, .rw-sprite');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
          })(),
          vw: innerWidth, vh: innerHeight
        }));
      } catch (e) { info = { error: String(e.message).slice(0, 90) }; }
      seen[name] = info;
      try { await p.screenshot({ path: path.join(OUT, `${label}-${name}.png`) }); } catch (_) {}
    }

    // 설정 창은 이 앱의 작업표시줄 대표 창이다. 실행했는데 안 뜨면 사용자는
    // 앱이 켜졌는지조차 알 수 없다(예전에 페어링 후 아무 창도 안 떴다).
    if (!seen.settings) problems.push('설정 창이 뜨지 않았다');

    const o = seen.overlay;
    if (!o) {
      problems.push('오버레이 창이 없다');
    } else if (o.error) {
      problems.push('오버레이 조회 실패: ' + o.error);
    } else {
      if (!(o.parts + o.sprites)) problems.push('캐릭터가 하나도 그려지지 않았다');
      const r = o.rect;
      if (!r) problems.push('캐릭터 엘리먼트가 없다');
      else {
        if (r.w === 0 || r.h === 0) problems.push('캐릭터 상자가 0 크기');
        // **거의 전부 보여야 통과.** 예전엔 50% 만 보이면 통과여서, 배율을 키웠을 때
        // 머리가 잘려 나가도 검사가 초록불이었다.
        const visX = Math.min(r.x + r.w, o.vw) - Math.max(r.x, 0);
        const visY = Math.min(r.y + r.h, o.vh) - Math.max(r.y, 0);
        const vis = (visX / r.w) * (visY / r.h);
        if (vis < 0.97) {
          problems.push(`캐릭터가 잘렸다 (보이는 비율 ${Math.round(vis * 100)}%, ` +
                        `상자 ${JSON.stringify(r)}, 창 ${o.vw}x${o.vh})`);
        }
      }
    }

    // 이 컨테이너는 바깥 네트워크가 막혀 있어 Firebase SDK 를 못 받아온다.
    // 그건 앱 결함이 아니므로 걸러낸다.
    const NOISE = /카탈로그 로드 실패|Failed to fetch dynamically imported|dbus|transport/i;
    const rendererErrors = logs.join('\n').split('\n')
      .filter((l) => /Uncaught|TypeError|ReferenceError/.test(l) && !NOISE.test(l)).slice(0, 3);
    if (rendererErrors.length) problems.push('렌더러 오류: ' + rendererErrors[0].slice(0, 100));

    return { problems, seen, logs };
  } finally {
    if (browser) await browser.close().catch(() => {});
    try { process.kill(-child.pid, 'SIGKILL'); } catch (_) {}
    try { child.kill('SIGKILL'); } catch (_) {}
    killByMark(USERDATA);
    await sleep(400);
    killByMark(USERDATA);      // 종료 중 새로 뜬 자식까지
    await sleep(600);
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let fail = 0, n = 0;
  for (const [label, cfg] of Object.entries(CASES)) {
    if (only && !label.includes(only)) continue;
    // 포트도 실행마다 다르게 — 남은 프로세스의 포트에 잘못 붙는 일을 막는다.
    const port = 9300 + ((process.pid + n * 7) % 400);
    const mark = path.join(OUT, `ud-${process.pid}-${n}`);
    n++;
    const { problems, seen } = await runCase(label, cfg, port, mark);
    const o = (seen && seen.overlay) || {};
    const detail = o.rect ? `조각 ${o.parts} 스프라이트 ${o.sprites} 상자 ${JSON.stringify(o.rect)}` : '';
    if (problems.length) {
      fail++;
      console.log(`✗ ${label}  ${detail}`);
      problems.forEach((p) => console.log('    ‼ ' + p));
    } else {
      console.log(`✓ ${label.padEnd(22)} ${detail}`);
    }
  }
  console.log(fail ? `\n✗ ${fail}개 상태에서 캐릭터를 볼 수 없다 (스크린샷: ${OUT})`
                   : `\n✓ 모든 설정 상태에서 캐릭터가 보인다 (스크린샷: ${OUT})`);
  process.exit(fail ? 1 : 0);
})();
