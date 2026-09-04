'use strict';
/* 기능 플래그 검사 — **진짜 앱에서** 업로드 진입점이 막혔는지,
 * 그리고 기존 개인 캐릭터가 그대로 남아 있는지 확인한다.
 * 화면에서 버튼만 숨기는 것과 기능을 끄는 것은 다르다. IPC 로 강제로 열어 본다.
 *
 *   실행: node tools/flag-check.js
 */

// 실제 앱에서 (1) 만들기 타일이 없고 (2) IPC 로도 리깅 창이 안 열리며
// (3) 기존 개인 캐릭터는 목록에 그대로 있는지 확인한다.
const { spawn } = require('child_process');
const fs=require('fs'), path=require('path'), os=require('os');
const { chromium } = require('playwright-core');
const ROOT=path.join(__dirname,'..');
const UD=path.join(os.tmpdir(),'rw-flag');
fs.rmSync(UD,{recursive:true,force:true}); fs.mkdirSync(UD,{recursive:true});
// 개인 캐릭터가 있는 상태 — 숨긴다고 사라지면 안 된다
// 개인 캐릭터 하나를 심어 둔다 — 업로드를 숨긴다고 이게 사라지면 안 된다.
const vm = require('vm');
const sb = { console }; sb.window = sb; sb.globalThis = sb; vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(ROOT,'src/renderer/shared/preset-art.js'),'utf8'), sb);
fs.writeFileSync(path.join(UD,'config.json'), JSON.stringify({
  characterId:'mine1', partnerCharacterId:'mine1',
  customCharacters:[{ id:'mine1', name:'내캐릭터', swatch:'#f0f', bundle: sb.RW.presetArt.char_seal }]
}));
const c=spawn('xvfb-run',['-a','--server-args=-screen 0 1600x900x24',
  ROOT+'/node_modules/electron/dist/electron',ROOT,
  '--remote-debugging-port=9412','--no-sandbox',`--user-data-dir=${UD}`],{cwd:ROOT,detached:true});
(async()=>{
  let b=null;
  for(let i=0;i<40&&!b;i++){await new Promise(r=>setTimeout(r,500));try{b=await chromium.connectOverCDP('http://127.0.0.1:9412');}catch(_){}}
  await new Promise(r=>setTimeout(r,4000));
  const pages=()=>b.contexts().flatMap(x=>x.pages());
  const st=pages().find(p=>/settings/.test(p.url()));
  const before = await st.evaluate(()=>({
    flag: window.rwHost.features,
    addTile: document.querySelectorAll('.tile.add').length,
    editBtn: document.querySelectorAll('.tt.edit').length,
    delBtn: document.querySelectorAll('.tt.del').length,
    tiles: [...document.querySelectorAll('#myGrid .tile')].map(t=>t.querySelector('.cap')?.textContent),
    errors: 0
  }));
  console.log('설정창:', JSON.stringify(before,null,1));
  // IPC 로 직접 열기 시도
  await st.evaluate(()=>{ window.rwHost.openRigger(); window.rwHost.openRigger('mine1'); });
  await new Promise(r=>setTimeout(r,2500));
  const urls = pages().map(p=>p.url()).filter(u=>/rigger/.test(u));
  const bad=[];
  if (before.flag.characterUpload !== false) bad.push('플래그가 켜져 있다');
  if (before.addTile !== 0) bad.push('만들기 타일이 남아 있다');
  if (before.editBtn !== 0) bad.push('편집 버튼이 남아 있다');
  if (!before.tiles.includes('내캐릭터')) bad.push('개인 캐릭터가 목록에서 사라졌다');
  if (before.delBtn === 0) bad.push('삭제 버튼까지 없어졌다(정리는 가능해야 한다)');
  if (urls.length) bad.push('IPC 로 리깅 창이 열렸다');
  console.log('IPC 로 강제 요청 후 리깅 창:', urls.length ? urls : '열리지 않음');
  console.log(bad.length ? '\n✗ ' + bad.join(' / ') : '\n✓ 업로드 숨김 + 기존 캐릭터 보존 확인');
  await b.close(); try{process.kill(-c.pid,'SIGKILL')}catch(_){}
  process.exit(bad.length?1:0);
})();
