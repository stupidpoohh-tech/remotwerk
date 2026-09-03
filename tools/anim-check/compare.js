'use strict';
/* 전후 비교 — 애니메이션 데이터·엔진의 **이음매 불연속**을 숫자로 잰다.
 *
 * DOM 없이 포즈 값만 비교하므로 어느 커밋에서든 바로 돌릴 수 있다.
 * 재는 것
 *   A. 루프 경계   : 마지막 순간의 자세 vs 다시 처음 자세
 *   B. 동작 종료   : 신호가 끝난 자세 vs 대기(idle) 시작 자세
 * 둘 다 값이 클수록 재생 중에 몸이 홱 튄다.
 *
 * 실행: node tools/anim-check/compare.js [shared 디렉터리]
 *   기본값은 이 저장소의 src/renderer/shared.
 *   예) 예전 커밋과 비교
 *       git worktree add /tmp/old <커밋>
 *       node tools/anim-check/compare.js /tmp/old/src/renderer/shared
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SHARED = process.argv[2] || path.join(__dirname, '..', '..', 'src', 'renderer', 'shared');

function load(dir) {
  const sb = { console };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  for (const f of ['skeleton.js', 'gestures.js', 'animations.js', 'engine.js']) {
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), sb, { filename: f });
  }
  return sb.RW;
}

function flat(p) {
  const o = {};
  for (const k in p.root) o['root.' + k] = p.root[k];
  for (const b in p.bones) for (const k in p.bones[b]) o[b + '.' + k] = p.bones[b][k];
  return o;
}


// 트랙이 한쪽에만 있으면 없는 쪽은 **뉴트럴 값**으로 본다.
// (예전 g_cheer 는 팔 트랙이 -20° 로 남은 채 끝나는데, idle 에는 팔 트랙이 아예 없다.
//  없는 것을 건너뛰면 "차이 0" 이라는 잘못된 결론이 나온다.)
function neutralOf(key) {
  const p = key.split('.').pop();
  if (p === 'sx' || p === 'sy') return 1;
  return 0;
}

// 두 자세의 차이 중 가장 큰 것(수치 트랙만).
function gap(a, b) {
  const A = flat(a), B = flat(b);
  let worst = 0, key = null;
  for (const k of new Set(Object.keys(A).concat(Object.keys(B)))) {
    let x = A[k], y = B[k];
    if (typeof x !== 'number' && x !== undefined) continue;   // vis/flip/back 은 제외
    if (typeof y !== 'number' && y !== undefined) continue;
    if (x === undefined) x = neutralOf(k);
    if (y === undefined) y = neutralOf(k);
    const d = Math.abs(x - y);
    if (d > worst) { worst = d; key = k; }
  }
  return { worst: Math.round(worst * 10) / 10, key };
}

const RW = load(SHARED);
const B = (id) => RW.engine.buildTracks(RW.animations.get(id));
const idle0 = RW.engine.poseAt(B('idle'), 0);

console.log(`대상: ${SHARED}\n`);
console.log('A. 루프 경계 불연속 (0 이면 매끄럽게 이어짐)');
for (const id of ['idle', 'wander']) {
  const b = B(id);
  const g = gap(RW.engine.poseAt(b, b.duration), RW.engine.poseAt(b, 0));
  console.log(`   ${id.padEnd(8)} ${String(b.duration).padStart(5)}ms  최대 ${String(g.worst).padStart(6)}  (${g.key || '-'})`);
}
console.log('\nB. 동작이 끝난 자세 vs 대기 시작 자세 (0 이면 튀지 않음)');
for (const id of ['g_heart', 'g_cheer', 'g_droop', 'g_twerk']) {
  const b = B(id);
  const g = gap(RW.engine.poseAt(b, b.duration), idle0);
  console.log(`   ${id.padEnd(8)} ${String(b.duration).padStart(5)}ms  최대 ${String(g.worst).padStart(6)}  (${g.key || '-'})`);
}
console.log('\nC. 걷기 클립이 스스로 이동하는가 (코드 이동과 겹치면 중복)');
{
  const b = B('wander');
  let minX = 0, maxX = 0;
  for (let t = 0; t <= b.duration; t += 20) {
    const x = RW.engine.poseAt(b, t).root.x;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }
  console.log(`   wander 의 root.x 이동폭: ${Math.round(maxX - minX)}px  (0 이면 제자리걸음)`);
}
