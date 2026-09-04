'use strict';
/* CSP 검사 — Firebase 가 **실제로 쓰는 네 가지 통로**가 각 화면의 CSP 를 통과하는지
 * 진짜 브라우저에서 확인한다.
 *
 * 왜 파일을 읽어 문자열로 비교하지 않는가: 통로마다 걸리는 지시어가 다르고, 그게
 * 직관과 어긋난다. RTDB 롱폴링은 fetch 가 아니라 **<script> 주입**이라 connect-src 가
 * 아니라 script-src 를 받는다. 이걸 몰라서 "망이 WebSocket 을 막았다"고 잘못 안내했다.
 * CSP 위반은 네트워크 없이도 발생하므로, 이 검사는 오프라인에서도 정확하다.
 *
 *   실행: node tools/csp-check.js
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const R = path.join(__dirname, '..', 'src', 'renderer');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DB = 'https://remotwerk-aa0d2-default-rtdb.asia-southeast1.firebasedatabase.app';

const SCREENS = ['overlay', 'remote', 'history', 'settings', 'rigger', 'viewer'];
const PROBE = `
window.V = [];
document.addEventListener('securitypolicyviolation',
  (e) => V.push(e.violatedDirective + ' ← ' + String(e.blockedURI || '').slice(0, 60)));
const DB = ${JSON.stringify(DB)};
window.TRY = (kind) => new Promise((res) => {
  if (kind === 'SDK(gstatic)')   { const s=document.createElement('script'); s.src='https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'; document.head.appendChild(s); }
  if (kind === '롱폴링(script)')  { const s=document.createElement('script'); s.src=DB+'/.lp?start=t&ser=1&cb=1'; document.head.appendChild(s); }
  if (kind === 'REST(fetch)')     { fetch(DB+'/.json').catch(()=>{}); }
  if (kind === 'WebSocket')       { try { new WebSocket(DB.replace('https','wss')+'/.ws?v=5'); } catch(e) { V.push('ws throw: '+e.name); } }
  if (kind === '인증(googleapis)'){ fetch('https://identitytoolkit.googleapis.com/v1/x').catch(()=>{}); }
  setTimeout(() => res(V.slice()), 600);
});`;
const KINDS = ['SDK(gstatic)', '롱폴링(script)', 'REST(fetch)', 'WebSocket', '인증(googleapis)'];

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  let fail = 0;

  for (const name of SCREENS) {
    const dir = path.join(R, name);
    const src = fs.readFileSync(path.join(dir, name + '.html'), 'utf8');
    const probeJs = path.join(dir, '_csp_probe.js');
    const probeHtml = path.join(dir, '_csp_probe.html');
    // 같은 폴더에 두어야 'self' 가 실제 앱과 같게 판정된다.
    fs.writeFileSync(probeJs, PROBE);
    fs.writeFileSync(probeHtml, src.replace(/<body[\s\S]*$/i, '<body><script src="_csp_probe.js"></script></body></html>'));
    try {
      const page = await browser.newPage();
      await page.goto('file://' + probeHtml);
      const bad = [];
      for (const k of KINDS) {
        await page.evaluate(() => { window.V = []; });
        const v = await page.evaluate((k) => window.TRY(k), k);
        if (v.length) bad.push(`${k}: ${v.join(' | ')}`);
      }
      await page.close();
      if (bad.length) { fail++; console.log(`✗ ${name}`); bad.forEach((b) => console.log('    ' + b)); }
      else console.log(`✓ ${name.padEnd(9)} 통로 ${KINDS.length}가지 전부 CSP 통과`);
    } finally {
      fs.unlinkSync(probeJs); fs.unlinkSync(probeHtml);
    }
  }

  await browser.close();
  console.log(fail ? `\n✗ ${fail}개 화면의 CSP 가 Firebase 통로를 막습니다` : `\n✓ 화면 ${SCREENS.length}개 전부 통과`);
  process.exit(fail ? 1 : 0);
})();
