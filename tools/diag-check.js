'use strict';
/* 연결 진단 검사 — 페어링이 막히는 5가지 상황을 실제 화면에서 재현한다.
 *
 * Firebase 로 나갈 수 없는 환경이라, gstatic 의 SDK 를 가짜 모듈로 가로채고
 * REST 응답만 상황별로 바꿔 준다. 앱의 CSP·설정 화면·진단 코드는 진짜 그대로 돈다.
 *
 *   실행: node tools/diag-check.js
 */
const { chromium } = require('playwright-core');
const R = require('path').join(__dirname, '..', 'src', 'renderer');

const APP  = `export function initializeApp(c){ return { options:c }; }`;
const AUTH = `export function getAuth(){ return {}; }
export async function signInAnonymously(){
  if(!globalThis.__plan.auth){ const e=new Error('disabled'); e.code='auth/operation-not-allowed'; throw e; }
  return { user:{ uid:'u_test' } }; }`;
const DB   = `export function getDatabase(){ return {}; }
export function ref(_d,p){ return { p }; }
export function onValue(r,cb){ setTimeout(()=>cb({ val:()=>globalThis.__plan.socket===true }),40); return ()=>{}; }
export function push(){ return { key:'r1' }; }
export async function set(){ return true; }
export async function get(){ return { exists:()=>false, val:()=>null }; }
export async function remove(){ return true; }
export function serverTimestamp(){ return 0; }`;

const CASES = {
  '정상':              { auth:true,  probe:{ 'default-rtdb.example.app':401 }, socket:true  },
  'DB 가 아예 없음':    { auth:true,  probe:{}, socket:false },
  '주소가 틀림':        { auth:true,  probe:{ 'asia-southeast1':401 }, socket:false },
  '소켓만 막힘':        { auth:true,  probe:{ 'default-rtdb.example.app':401 }, socket:false },
  '익명 로그인 꺼짐':    { auth:false, probe:{}, socket:false }
};

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--allow-file-access-from-files','--no-sandbox'] });
  for (const [label, plan] of Object.entries(CASES)) {
    const p = await b.newPage({ viewport: { width: 560, height: 900 } });
    const csp = [];
    p.on('console', m => { if (/Content Security Policy/i.test(m.text())) csp.push(m.text()); });
    await p.route('https://www.gstatic.com/firebasejs/**', (route) => {
      const u = route.request().url();
      const body = u.includes('auth') ? AUTH : u.includes('database') ? DB : APP;
      route.fulfill({ status:200, contentType:'text/javascript', body });
    });
    await p.addInitScript((plan) => {
      globalThis.__plan = plan;
      window.rwHost = {
        getConfig: async () => (window.__cfg = window.__cfg || { characterId:'char_seal', customCharacters:[],
          overlayScale:1, firebase:{ projectId:'proj-x', databaseURL:'https://proj-x-default-rtdb.example.app' } }),
        setConfig: async (n) => { Object.assign(window.__cfg, n); },
        openLogs(){}, openRigger(){}, setAutoLaunch: async()=>false, onConfig(){}, sendGesture(){}
      };
      const realFetch = window.fetch;
      window.fetch = async (url, o) => {
        if (String(url).includes('gstatic')) return realFetch(url, o);
        const k = Object.keys(plan.probe||{}).find(k => String(url).includes(k));
        if (!k) throw new TypeError('Failed to fetch');
        return { status: plan.probe[k], text: async () => 'Permission denied' };
      };
    }, plan);
    await p.goto('file://' + R + '/settings/settings.html');
    await p.waitForTimeout(400);
    await p.click('#diagnose');
    await p.waitForFunction(() => {
      const v = document.getElementById('diagVerdict');
      return v && v.textContent && !/확인하는 중/.test(document.getElementById('diagSteps').textContent);
    }, null, { timeout: 30000 }).catch(()=>{});
    const out = await p.evaluate(() => ({
      steps: [...document.querySelectorAll('#diagSteps li')].map(e => e.textContent),
      verdict: document.getElementById('diagVerdict').textContent,
      fix: !document.getElementById('diagFixRow').hidden
    }));
    console.log('\n### ' + label);
    out.steps.forEach(s => console.log('   ' + s));
    console.log('   → ' + out.verdict);
    console.log('   [고치기 버튼 ' + (out.fix ? '표시' : '없음') + ' · CSP 위반 ' + csp.length + '건]');
    await p.close();
  }
  await b.close();
})();
