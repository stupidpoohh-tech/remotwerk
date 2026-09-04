'use strict';
/* 연결 진단 검사 — 페어링이 막히는 상황들을 실제 설정 화면에서 재현한다.
 *
 * 이 저장소에서는 Firebase 로 나갈 수 없다. 그래서 gstatic 의 SDK 를 **가짜 모듈로
 * 가로채고** REST 응답만 상황별로 바꿔 준다. 앱의 CSP·설정 화면·진단 코드·전송 방식
 * 전환은 전부 진짜 그대로 돈다.
 *
 *   실행: node tools/diag-check.js
 */

const path = require('path');
const { chromium } = require('playwright-core');

const R = path.join(__dirname, '..', 'src', 'renderer');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const APP = `
let apps = [];
export function initializeApp(c){ const a = { options:c }; apps.push(a); return a; }
export function getApps(){ return apps; }
export function getApp(){ return apps[0]; }`;

const AUTH = `
export function getAuth(){ return {}; }
export async function signInAnonymously(){
  if(!globalThis.__plan.auth){ const e=new Error('disabled'); e.code='auth/operation-not-allowed'; throw e; }
  return { user:{ uid:'u_test' } }; }`;

// 실시간 연결이 되는지는 전송 방식에 따라 다르다.
//   ws      : 이 망에서 WebSocket 이 되는가
//   longpoll: 롱폴링이 되는가
const DB = `
let forced = false;
export function forceLongPolling(){ forced = true; }
export function getDatabase(){ return { forced }; }
export function ref(_d,p){ return { p }; }
export function onValue(r,cb){
  const p = globalThis.__plan;
  const ok = forced ? p.longpoll === true : p.ws === true;
  setTimeout(()=>cb({ val:()=>ok }), 40);
  return ()=>{};
}
export function push(){ return { key:'r1' }; }
export async function set(){ return true; }
export async function get(){ return { exists:()=>false, val:()=>null }; }
export async function remove(){ return true; }
export function serverTimestamp(){ return 0; }`;

// SDK 가 롱폴링 전환을 아예 지원하지 않는 경우(구버전)
const DB_NO_LONGPOLL = DB.replace('export function forceLongPolling(){ forced = true; }', '');

const OK_DB = 'default-rtdb.example.app';
const CASES = [
  { name: '정상',
    plan: { auth: true, probe: { [OK_DB]: 401 }, ws: true },
    expect: { verdict: /정상입니다/, fix: null } },

  { name: 'DB 가 아예 없음',
    plan: { auth: true, probe: {} },
    expect: { verdict: /Realtime Database\)가 없습니다/, fix: null } },

  { name: '주소가 다른 리전',
    plan: { auth: true, probe: { 'asia-southeast1': 401 } },
    expect: { verdict: /주소가 달랐습니다/, fix: '이 주소로 고치기' } },

  { name: 'WebSocket 만 막힘 → 롱폴링 제안',
    plan: { auth: true, probe: { [OK_DB]: 401 }, ws: false, longpoll: true },
    expect: { verdict: /롱폴링/, fix: '롱폴링으로 바꿔 다시 시도' } },

  { name: '롱폴링으로 바꾼 뒤 연결됨',
    plan: { auth: true, probe: { [OK_DB]: 401 }, ws: false, longpoll: true },
    transport: 'longpoll',
    expect: { verdict: /정상입니다/, fix: null } },

  { name: '롱폴링으로도 안 됨',
    plan: { auth: true, probe: { [OK_DB]: 401 }, ws: false, longpoll: false },
    transport: 'longpoll',
    expect: { verdict: /다른 네트워크/, fix: null } },

  { name: '구버전 SDK 라 롱폴링 전환 불가',
    plan: { auth: true, probe: { [OK_DB]: 401 }, ws: false },
    noLongPoll: true,
    expect: { verdict: /다른 네트워크/, fix: null } },

  { name: '익명 로그인 꺼짐',
    plan: { auth: false, probe: {} },
    expect: { verdict: /익명\(Anonymous\)/, fix: null } }
];

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME, args: ['--allow-file-access-from-files', '--no-sandbox']
  });
  let fail = 0;

  for (const c of CASES) {
    const page = await browser.newPage({ viewport: { width: 560, height: 900 } });
    const csp = [];
    page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) csp.push(m.text()); });
    await page.route('https://www.gstatic.com/firebasejs/**', (route) => {
      const u = route.request().url();
      const body = u.includes('auth') ? AUTH
        : u.includes('database') ? (c.noLongPoll ? DB_NO_LONGPOLL : DB) : APP;
      route.fulfill({ status: 200, contentType: 'text/javascript', body });
    });
    await page.addInitScript(([plan, transport]) => {
      globalThis.__plan = plan;
      const fbCfg = { projectId: 'proj-x', databaseURL: 'https://proj-x-default-rtdb.example.app' };
      if (transport) fbCfg.rwTransport = transport;
      window.__cfg = { characterId: 'char_seal', customCharacters: [], overlayScale: 1, firebase: fbCfg };
      window.rwHost = {
        getConfig: async () => window.__cfg,
        setConfig: async (n) => { Object.assign(window.__cfg, n); window.__saved = n; },
        openLogs() {}, openRigger() {}, setAutoLaunch: async () => false,
        onConfig() {}, sendGesture() {}
      };
      const realFetch = window.fetch;
      window.fetch = async (url, o) => {
        if (String(url).includes('gstatic')) return realFetch(url, o);
        const k = Object.keys(plan.probe || {}).find((k) => String(url).includes(k));
        if (!k) throw new TypeError('Failed to fetch');
        return { status: plan.probe[k], text: async () => 'Permission denied' };
      };
    }, [c.plan, c.transport || null]);

    await page.goto('file://' + path.join(R, 'settings', 'settings.html'));
    await page.waitForTimeout(400);
    await page.click('#diagnose');
    await page.waitForFunction(
      () => !/확인하는 중/.test(document.getElementById('diagSteps').textContent)
            && document.getElementById('diagVerdict').textContent,
      null, { timeout: 30000 }).catch(() => {});

    const out = await page.evaluate(() => {
      const row = document.getElementById('diagFixRow');
      return {
        steps: [...document.querySelectorAll('#diagSteps li')].map((e) => e.textContent),
        verdict: document.getElementById('diagVerdict').textContent,
        // 화면에서 실제로 보이는지로 판단한다(hidden 속성이 CSS 에 지는 버그가 있었다)
        fixVisible: !!row.offsetParent,
        fixLabel: document.getElementById('diagFix').textContent
      };
    });

    const wantFix = c.expect.fix;
    const problems = [];
    if (!c.expect.verdict.test(out.verdict)) problems.push('판정이 다름');
    if (wantFix && (!out.fixVisible || out.fixLabel !== wantFix)) problems.push(`버튼 "${wantFix}" 가 안 보임`);
    if (!wantFix && out.fixVisible) problems.push(`버튼이 보이면 안 되는데 보임 ("${out.fixLabel}")`);
    if (csp.length) problems.push(`CSP 위반 ${csp.length}건`);

    console.log(`\n${problems.length ? '✗' : '✓'} ${c.name}`);
    out.steps.forEach((s) => console.log('    ' + s));
    console.log('    → ' + out.verdict);
    console.log('    버튼: ' + (out.fixVisible ? `"${out.fixLabel}"` : '없음'));
    if (problems.length) { fail++; problems.forEach((p) => console.log('    ‼ ' + p)); }
    await page.close();
  }

  await browser.close();
  console.log(fail ? `\n✗ ${fail}건 실패 / ${CASES.length}건 중` : `\n✓ ${CASES.length}가지 상황 전부 통과`);
  process.exit(fail ? 1 : 0);
})();
