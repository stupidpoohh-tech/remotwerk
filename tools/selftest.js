'use strict';
/* 렌더러 공유 모듈 회귀 테스트 (Node 전용, 의존성 없음).
 *
 * 렌더러는 번들러 없이 `window.RW` 네임스페이스에 얹히는 클래식 스크립트라서,
 * 여기서는 가짜 global 을 하나 만들고 파일을 순서대로 실행해 같은 상태를 재현한다.
 * DOM 이 필요한 부분(engine.mount)은 건드리지 않고, 순수 로직만 검증한다.
 *
 *   실행: node tools/selftest.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SHARED = path.join(__dirname, '..', 'src', 'renderer', 'shared');
const sandbox = { console };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const f of ['skeleton.js', 'gestures.js', 'animations.js', 'engine.js',
                 'preset-art.js', 'presets.js', 'characters.js',
                 'clip-art.js', 'clips.js']) {
  vm.runInContext(fs.readFileSync(path.join(SHARED, f), 'utf8'), sandbox, { filename: f });
}
const RW = sandbox.RW;

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; return; }
  fails.push(name + (detail ? ' — ' + detail : ''));
}
function near(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 1e-9 : eps); }
const SLOT5 = ['torso', 'armL', 'armR', 'legL', 'legR'];

// --- 1. 제스처 ↔ 애니메이션 대응 -------------------------------------------
const allGestures = RW.gestures.ACTIVE.concat(RW.gestures.AMBIENT);
for (const g of allGestures) {
  ok(`애니메이션 존재: ${g.id}`, !!RW.animations.get(g.id));
}
ok('능동 신호 4개', RW.gestures.ACTIVE.length === 4, String(RW.gestures.ACTIVE.length));
ok('은퇴 신호는 이름으로 복구된다', RW.gestures.get('g5_leave').retired === true);

// --- 2. 애니메이션 데이터 위생 ----------------------------------------------
// 엔진은 모르는 키를 조용히 무시한다 → 오타가 런타임에 드러나지 않는다. 여기서 잡는다.
const ROOT_PROPS = ['x', 'y', 'rot', 'vis', 'flip', 'fx', 'sx', 'sy', 'back'];
const BONE_PROPS = ['rot', 'x', 'y', 'vis'];
const boneNames = new Set();
for (const skId of ['bipedal', 'bipedal5']) {
  for (const b of RW.skeleton.getSkeleton(skId).bones) {
    boneNames.add(b.name);
    if (b.animSource) boneNames.add(b.animSource);
  }
}
for (const g of allGestures) {
  const anim = RW.animations.get(g.id);
  let lastT = -1;
  for (const fr of anim.frames) {
    ok(`${g.id}: t 는 오름차순`, fr.t > lastT || lastT === -1, `t=${fr.t}`);
    lastT = fr.t;
    for (const key of Object.keys(fr)) {
      if (key === 't' || key === 'ease') continue;      // ease 는 구간 이징 지정
      if (key === 'root') {
        for (const p of Object.keys(fr.root)) {
          ok(`${g.id}: root 속성 '${p}' 은 알려진 것`, ROOT_PROPS.includes(p));
        }
      } else {
        ok(`${g.id}: '${key}' 는 알려진 본 트랙`, boneNames.has(key));
        for (const p of Object.keys(fr[key])) {
          ok(`${g.id}.${key}: 속성 '${p}' 은 알려진 것`, BONE_PROPS.includes(p));
        }
      }
    }
  }
}

// --- 2.5 클립 접합 규칙 (Animation Bible 4절) --------------------------------
// 루프는 끝→처음이 이어져야 하고, 일회 클립은 접합 자세(idle 0번)로 끝나야 한다.
// 이게 깨지면 동작이 끝나거나 반복될 때마다 몸이 홱 튄다.
{
  const flat = (p) => {
    const o = {};
    for (const k in p.root) o['root.' + k] = p.root[k];
    for (const b in p.bones) for (const k in p.bones[b]) o[b + '.' + k] = p.bones[b][k];
    return o;
  };
  // 트랙이 한쪽에만 있으면 없는 쪽은 뉴트럴 값으로 본다.
  // (건너뛰면 "팔이 20° 든 채로 끝났는데 차이 0" 같은 잘못된 통과가 나온다.)
  const neutralOf = (key) => {
    const p = key.split('.').pop();
    return (p === 'sx' || p === 'sy') ? 1 : 0;
  };
  const maxGap = (a, b) => {
    const A = flat(a), B = flat(b);
    let worst = 0, key = null;
    for (const k of new Set(Object.keys(A).concat(Object.keys(B)))) {
      let x = A[k], y = B[k];
      if ((typeof x !== 'number' && x !== undefined) || (typeof y !== 'number' && y !== undefined)) {
        if (x !== y && x !== undefined && y !== undefined) { worst = Math.max(worst, 99); key = k; }
        continue;
      }
      if (x === undefined) x = neutralOf(k);
      if (y === undefined) y = neutralOf(k);
      const d = Math.abs(x - y);
      if (d > worst) { worst = d; key = k; }
    }
    return { worst, key };
  };
  const idle0 = RW.engine.poseAt(RW.engine.buildTracks(RW.animations.get('idle')), 0);
  for (const g of allGestures) {
    const anim = RW.animations.get(g.id);
    const b = RW.engine.buildTracks(anim);
    if (anim.loop) {
      const r = maxGap(RW.engine.poseAt(b, b.duration), RW.engine.poseAt(b, 0));
      ok(`${g.id}: 루프 경계가 이어진다`, r.worst < 0.5, `${r.key} 차이 ${r.worst}`);
    } else {
      const r = maxGap(RW.engine.poseAt(b, b.duration), idle0);
      ok(`${g.id}: 접합 자세로 끝난다`, r.worst < 0.5, `${r.key} 차이 ${r.worst}`);
    }
  }
}

// --- 3. 트랙 보간 ------------------------------------------------------------
const built = RW.engine.buildTracks({
  frames: [{ t: 0 }, { t: 100, root: { y: -10, back: true } }, { t: 200, root: { y: 0, back: false } }]
});
ok('duration = 마지막 프레임', built.duration === 200, String(built.duration));
ok('중간점은 정확히 절반', near(RW.engine.poseAt(built, 50).root.y, -5));
// 이징 — 기본은 easeInOut(가속·감속), ease:'linear' 로 뺄 수 있다.
{
  const eased = RW.engine.buildTracks({ frames: [{ t: 0 }, { t: 100, root: { y: -10 } }] });
  const lin = RW.engine.buildTracks({ frames: [{ t: 0 }, { t: 100, ease: 'linear', root: { y: -10 } }] });
  ok('기본 이징은 선형이 아니다', Math.abs(RW.engine.poseAt(eased, 25).root.y + 2.5) > 0.3,
     String(RW.engine.poseAt(eased, 25).root.y));
  ok("ease:'linear' 는 선형", near(RW.engine.poseAt(lin, 25).root.y, -2.5, 1e-9));
  ok('이징은 양 끝값을 바꾸지 않는다',
     near(RW.engine.poseAt(eased, 0).root.y, 0) && near(RW.engine.poseAt(eased, 100).root.y, -10));
}
// 포즈 블렌딩 — 새 동작을 현재 자세에서 이어받는다.
{
  const a = { root: { y: 10, sx: 1, flip: false }, bones: { head: { rot: 20 } } };
  const b = { root: { y: 0, sx: 1, flip: true }, bones: { head: { rot: 0 } } };
  const m = RW.engine.blendPose(a, b, 0.5);
  ok('블렌딩: 수치는 중간값', near(m.root.y, 5) && near(m.bones.head.rot, 10));
  ok('블렌딩: 계단 속성은 절반에서 전환', m.root.flip === true);
  ok('블렌딩 k=0 은 원래 자세', near(RW.engine.blendPose(a, b, 0).root.y, 10));
}
ok('back 은 계단 보간(중간에 아직 false)', RW.engine.poseAt(built, 50).root.back === false);
ok('back 은 계단 보간(100 이후 true)', RW.engine.poseAt(built, 150).root.back === true);
ok('sx/sy 뉴트럴은 1', RW.engine.poseAt(built, 50).root.sx === 1 && RW.engine.poseAt(built, 50).root.sy === 1);

// --- 4. 트월킹은 뒤로 돌았다 돌아온다 ---------------------------------------
const twerk = RW.engine.buildTracks(RW.animations.get('g_twerk'));
const twerkPose = (t) => RW.engine.poseAt(twerk, t).root;
ok('트월킹: 중간엔 등을 보인다', twerkPose(twerk.duration * 0.45).back === true);
ok('트월킹: 끝나면 앞을 본다', twerkPose(twerk.duration).back === false);
ok('트월킹: 시작은 앞모습', twerkPose(0).back === false);

// --- 5. 5조각 골격 비율 ------------------------------------------------------
const sk5 = RW.skeleton.buildBipedal5({ legLen: 120, torsoLen: 100, shoulderX: 30, hipX: 10 });
ok('groundY = 다리 길이', sk5.box.groundY === 120, String(sk5.box.groundY));
const armL = sk5.bones.find((b) => b.name === 'armL');
const armR = sk5.bones.find((b) => b.name === 'armR');
ok('좌팔 어깨는 -x', armL.pivotOffset[0] === -30);
ok('우팔 어깨는 +x', armR.pivotOffset[0] === 30);
ok('어깨 높이는 몸통 위쪽', armL.pivotOffset[1] < 0 && armL.pivotOffset[1] > -100);
ok('5조각은 어깨/골반 트랙을 읽는다', armL.animSource === 'armL_upper');

// --- 6. 번들 → 리그 (뒷모습 통과) -------------------------------------------
const rigNoBack = RW.characters.bundleToRig({ skeletonId: 'bipedal5', slots: { torso: { image: 'a' } } });
ok('뒷모습 없으면 slotsBack = null', rigNoBack.rig.slotsBack === null);
const rigBack = RW.characters.bundleToRig({
  skeletonId: 'bipedal5', slots: { torso: { image: 'a' } }, slotsBack: { torso: { image: 'b' } }
});
ok('뒷모습이 리그로 전달된다', rigBack.rig.slotsBack.torso.image === 'b');
const rigProp = RW.characters.bundleToRig({ skeletonId: 'bipedal5', proportions: { legLen: 70 }, slots: {} });
ok('번들 비율이 골격에 반영된다', rigProp.skeleton.box.groundY === 70);

// --- 7. 자르기 fit 역회전 (rigger.js fitForCut 과 같은 수식) ------------------
// 관절 P 기준으로 fit.rot 만큼 회전시키면 상자가 원래 자리로 돌아와야 한다.
function fitForCut(box, P) {
  const dx = box.cx - P.x, dy = box.cy - P.y;
  const th = -box.rot * Math.PI / 180;
  return {
    x: (dx * Math.cos(th) - dy * Math.sin(th)) - box.w / 2,
    y: (dx * Math.sin(th) + dy * Math.cos(th)) - box.h / 2,
    w: box.w, h: box.h, rot: box.rot
  };
}
for (const rot of [-90, -28, 0, 14, 137]) {
  const box = { cx: 42, cy: -31, w: 40, h: 90, rot };
  const P = { x: -13, y: 0 };
  const fit = fitForCut(box, P);
  // fit 중심을 관절 기준으로 rot 만큼 되돌린다
  const lx = fit.x + fit.w / 2, ly = fit.y + fit.h / 2;
  const th = fit.rot * Math.PI / 180;
  const bx = P.x + lx * Math.cos(th) - ly * Math.sin(th);
  const by = P.y + lx * Math.sin(th) + ly * Math.cos(th);
  ok(`fit 역회전 왕복 (rot=${rot})`, near(bx, box.cx, 1e-9) && near(by, box.cy, 1e-9), `${bx}, ${by}`);
}

// --- 8. 미리보기 배치 (engine.fitAnchor) --------------------------------------
// 발이 바닥선에 놓이고 머리가 잘리지 않아야 한다. 예전엔 CSS 로 박아 둔 top/배율
// 때문에 다리 긴 캐릭터의 발이, 짧은 캐릭터의 머리가 잘렸다.
// (DOM 없이 검증하려고 style 만 있는 가짜 엘리먼트를 넘긴다.)
function placed(skeleton, opts) {
  const el = { style: {} };
  const scale = RW.engine.fitAnchor(el, skeleton, opts);
  const top = parseFloat(el.style.top);
  const box = skeleton.box;
  return { scale, top, feet: top + box.groundY * scale, head: top - (box.h - box.groundY) * scale };
}
const STAGES = [
  { name: '리모컨', feetY: 104, height: 98, maxScale: 0.62, stageH: 132 },
  { name: '캐릭터 타일', feetY: 114, height: 86, maxScale: 0.6, stageH: 120 },
  { name: '동작 뷰어', feetY: 250, height: 240, maxScale: 1, stageH: 300 }
];
for (const st of STAGES) {
  for (const legLen of [27, 40, 92, 180]) {
    for (const torsoLen of [60, 122, 200]) {
      const sk = RW.skeleton.buildBipedal5({ legLen, torsoLen });
      const p = placed(sk, st);
      const tag = `${st.name}: legLen=${legLen}, torsoLen=${torsoLen}`;
      ok(`${tag} — 발이 바닥선에`, near(p.feet, st.feetY, 0.2), String(p.feet));
      ok(`${tag} — 발이 무대 안`, p.feet <= st.stageH);
      ok(`${tag} — 머리가 잘리지 않음`, p.head >= -0.2, String(p.head));
    }
  }
}
// 배율을 직접 준 경우(설정창 미리보기)는 그 배율을 그대로 쓰되 발만 맞춘다.
{
  const sk = RW.skeleton.buildBipedal5({ legLen: 92 });
  const p = placed(sk, { feetY: 240, scale: 2.5 });
  ok('설정 미리보기: 지정 배율을 그대로 쓴다', p.scale === 2.5);
  ok('설정 미리보기: 발은 바닥선에', near(p.feet, 240, 0.2), String(p.feet));
}

// --- 9. 제공 캐릭터(그림 프리셋) ---------------------------------------------
const ART_IDS = ['char_seal', 'char_ribbon'];
const presetIds = RW.presets.PRESETS.map((p) => p.id);
ok('제공 캐릭터가 목록 맨 앞에', presetIds[0] === ART_IDS[0] && presetIds[1] === ART_IDS[1], presetIds.join(','));
// 색 프리셋(preset1~3)은 뺐다. 목록에는 없어야 하지만, 예전에 그걸 고른 설정이
// 깨지면 안 되므로 get() 은 여전히 그릴 수 있는 캐릭터를 돌려줘야 한다.
ok('색 프리셋은 목록에서 빠졌다', ['preset1', 'preset2', 'preset3'].every((id) => !presetIds.includes(id)));
for (const id of ['preset1', 'preset2', 'preset3']) {
  const p = RW.presets.get(id);
  ok(`없어진 ${id} 도 그릴 수 있는 캐릭터로 대체된다`, !!(p && p.bundle), p && p.id);
}
ok('모르는 id 도 대체된다', !!RW.presets.get('없는캐릭터').bundle);
for (const id of ART_IDS) {
  const spec = RW.presets.rigFor(id);
  ok(`${id}: 5조각이 모두 있다`, SLOT5.every((s) => spec.rig.slots[s] && spec.rig.slots[s].image));
  ok(`${id}: 뒷모습 5조각이 모두 있다`, SLOT5.every((s) => spec.rig.slotsBack[s] && spec.rig.slotsBack[s].image));
  ok(`${id}: 5조각 골격을 쓴다`, spec.skeleton.id === 'bipedal5');
  ok(`${id}: groundY = 다리 길이`, spec.skeleton.box.groundY === spec.skeleton.proportions.legLen);
  for (const s of SLOT5) {
    const sl = spec.rig.slots[s];
    ok(`${id}.${s}: PNG data URI`, /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sl.image));
    ok(`${id}.${s}: fit 크기가 양수`, sl.fit.w > 0 && sl.fit.h > 0);
    ok(`${id}.${s}: 뒷모습도 PNG data URI`, /^data:image\/png;base64,/.test(spec.rig.slotsBack[s].image));
  }
  // 두 캐릭터가 같은 키로 보여야 한다(한쪽만 커 보이면 어색하다).
  ok(`${id}: 전체 높이 200~240`, spec.skeleton.box.h >= 200 && spec.skeleton.box.h <= 240, String(spec.skeleton.box.h));
}
// 기본 설정이 가리키는 캐릭터가 실제로 존재해야 한다.
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'config.js'), 'utf8');
  for (const key of ['characterId', 'partnerCharacterId']) {
    const m = src.match(new RegExp(key + ":\\s*'([^']+)'"));
    ok(`config 기본 ${key} 가 실존하는 캐릭터`, !!m && presetIds.includes(m[1]), m && m[1]);
  }
}

// --- 10. 5조각 리그가 찢어지지 않기 위한 구조 조건 ---------------------------
// v0.6.0 에서 캐릭터가 움직이면 몸이 잘려 나갔다. 원인이 됐던 조건들을 못으로 박아 둔다.
{
  const sk5 = RW.skeleton.buildBipedal5({});
  const byName = {};
  sk5.bones.forEach((b) => (byName[b.name] = b));

  // (1) 다리가 root 에 붙어 있으면 몸통이 기울 때 허리가 찢어진다.
  ok('다리는 몸통의 자식', byName.legL.parent === 'torso' && byName.legR.parent === 'torso',
     byName.legL.parent);
  ok('팔은 몸통의 자식', byName.armL.parent === 'torso' && byName.armR.parent === 'torso');

  // (2) 상세 골격 기준으로 만든 회전각을 그대로 받으면 몸이 반으로 접힌다.
  for (const n of ['torso', 'armL', 'armR', 'legL', 'legR']) {
    ok(`${n}: 회전 감쇠(animScale)가 있다`, byName[n].animScale > 0 && byName[n].animScale < 1,
       String(byName[n].animScale));
  }
  ok('몸통이 가장 크게 감쇠된다',
     byName.torso.animScale <= byName.armL.animScale && byName.torso.animScale <= byName.legL.animScale);

  // (3) 엔진이 animScale 을 실제로 적용하는지 — 몸통 20° 는 절반 이하로 줄어야 한다.
  const built = RW.engine.buildTracks({ frames: [{ t: 0 }, { t: 100, torso: { rot: 20 } }] });
  ok('트랙에는 원래 각도가 들어 있다', near(RW.engine.poseAt(built, 100).bones.torso.rot, 20));
}

// --- 11. 제공 캐릭터 조각은 몸통 뒤에 그려진다 -------------------------------
// 관절을 가리려고 조각을 몸통 쪽으로 물려 두는데, 앞에 그리면 그 물린 부분이 몸 위에 겹친다.
for (const id of ART_IDS) {
  const slots = RW.presets.rigFor(id).rig.slots;
  const tz = slots.torso.z;
  for (const s of ['armL', 'armR', 'legL', 'legR']) {
    ok(`${id}.${s}: 몸통보다 뒤(z)`, slots[s].z < tz, `${s}=${slots[s].z} torso=${tz}`);
  }
}

// --- 12. 렌더러 CSP 가 Firebase 가 실제로 쓰는 주소를 전부 허용하는가 -----------
//
// v0.6.x 에서 초대 코드 만들기가 "방을 만드는 중…" 에서 멈춘 원인이 여기였다.
// 싱가포르 지역 DB 의 실시간 연결은 wss://*.firebasedatabase.app 인데 CSP 에는
// wss://*.firebaseio.com 만 있었다. RTDB 의 쓰기는 서버가 응답할 때까지 끝나지 않으므로,
// 연결이 막히면 오류도 없이 영영 대기한다 — 화면상으로는 그냥 멈춘 것처럼 보인다.
{
  const RENDERER = path.join(__dirname, '..', 'src', 'renderer');
  const NEEDED = [
    "https://*.firebaseio.com",          // 구형 DB REST/롱폴링
    "https://*.firebasedatabase.app",    // 지역 DB REST/롱폴링
    "wss://*.firebaseio.com",            // 구형 DB 실시간
    "wss://*.firebasedatabase.app",      // 지역 DB 실시간 ← 이게 빠져 있었다
    "https://*.googleapis.com"           // 익명 인증 · Storage
  ];
  const pages = fs.readdirSync(RENDERER, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'shared' && d.name !== 'assets')
    .map((d) => path.join(RENDERER, d.name))
    .flatMap((dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.html')).map((f) => path.join(dir, f)));
  ok('렌더러 화면을 찾았다', pages.length >= 5, String(pages.length));
  for (const p of pages) {
    const html = fs.readFileSync(p, 'utf8');
    const name = path.basename(path.dirname(p));
    const m = html.match(/connect-src([^;"]*)/);
    // Firebase 를 쓰지 않는 화면은 connect-src 가 없어도 된다.
    if (!m) { ok(`${name}: CSP 없음(허용)`, true); continue; }
    for (const host of NEEDED) {
      ok(`${name}: CSP 에 ${host}`, m[1].includes(host));
    }
  }
}

// --- 13. 스프라이트 클립 규격 (Animation Bible 2·4·8절) -----------------------
{
  const CHAR = 'char_seal';
  const meta = RW.clips.forCharacter(CHAR);
  ok('물개 클립 등록부가 있다', !!meta);
  if (meta) {
    ok('캔버스 512×512', meta.canvas.w === 512 && meta.canvas.h === 512, JSON.stringify(meta.canvas));
    ok('기준점 (256,470)', meta.anchor.x === 256 && meta.anchor.y === 470, JSON.stringify(meta.anchor));
    ok('표시 배율이 있다', meta.displayScale > 0.2 && meta.displayScale < 3, String(meta.displayScale));

    // 동작 id 는 그대로 유지되어야 한다(네트워크·히스토리 호환).
    for (const g of RW.player ? [] : []) { /* player 는 DOM 필요, 여기선 계획만 본다 */ }
    for (const g of ['idle', 'wander', 'g_heart', 'g_cheer', 'g_droop', 'g_twerk']) {
      ok(`클립 계획 있음: ${g}`, RW.clips.planFor(CHAR, g) !== null);
    }
    ok('클립 없는 캐릭터는 계획이 없다(리그로 폴백)',
       RW.clips.planFor('char_ribbon', 'idle') === null);

    const idle0 = meta.clips.idle.frames[0].image;
    for (const id of Object.keys(meta.clips)) {
      const c = meta.clips[id];
      ok(`${id}: 프레임이 있다`, c.frames.length > 0);
      for (const f of c.frames) {
        ok(`${id}: 유지 시간 > 0`, f.dur > 0);
        ok(`${id}: 그림 영역(bbox) 기록됨`, Array.isArray(f.bbox) && f.bbox.length === 4);
        // 접지 프레임은 발바닥이 기준선에 있어야 한다(Animation Bible 9절 2번)
        if (f.ground && f.bbox) {
          ok(`${id}: 접지 프레임의 발바닥이 기준선`, Math.abs(f.bbox[3] - meta.anchor.y) <= 1,
             `bottom=${f.bbox[3]}`);
        }
      }
      // 접합 규칙: 일회 클립은 접합 자세로 끝난다(뒤돌기 계열은 예외)
      if (!c.loop && !/^turn_/.test(id)) {
        ok(`${id}: 접합 자세로 끝난다`, c.frames[c.frames.length - 1].image === idle0,
           c.frames[c.frames.length - 1].image);
        ok(`${id}: 접합 자세로 시작한다`, c.frames[0].image === idle0);
      }
    }
    // 걷기는 제자리걸음이고 보폭이 적혀 있어야 한다(이동은 코드가 한다)
    ok('걷기에 보폭(stepAdvance)이 있다', meta.clips.walk.stepAdvance > 0,
       String(meta.clips.walk.stepAdvance));

    // 이펙트는 스프라이트와 리그가 **같아야** 한다.
    // (스프라이트 재생기에 이펙트 레이어를 빼먹어서, 같은 신호인데 리그로 보면 하트가
    //  뜨고 스프라이트로 보면 안 뜨는 상태였다. 곁눈질 가독성이 재생 방식에 따라
    //  달라지면 안 된다.)
    for (const g of ['g_heart', 'g_cheer', 'g_droop', 'g_twerk']) {
      const anim = RW.animations.get(g);
      const clip = RW.clips.get(CHAR, g);
      if (!clip) continue;                      // g_twerk 는 조합이라 단일 클립이 없다
      ok(`${g}: 이펙트가 리그와 같다`, (clip.fx || null) === (anim.fx || null),
         `스프라이트=${clip.fx || '없음'} 리그=${anim.fx || '없음'}`);
    }
  }
}

// --- 14. 연결 진단 (fb.js) ---------------------------------------------------
//
// 페어링이 막혔을 때 "네트워크를 확인하세요" 만 띄우면 사용자가 할 수 있는 일이 없다.
// 주소가 틀린 것과 네트워크가 막힌 것은 증상이 같으므로, 진단이 이 둘을 실제로
// 갈라내는지 가짜 fetch 로 확인한다.
{
  const sb2 = { console };
  sb2.window = sb2; sb2.globalThis = sb2;
  sb2.setTimeout = setTimeout; sb2.clearTimeout = clearTimeout;
  sb2.AbortController = typeof AbortController !== 'undefined' ? AbortController : undefined;
  vm.createContext(sb2);
  vm.runInContext(fs.readFileSync(path.join(SHARED, 'fb.js'), 'utf8'), sb2, { filename: 'fb.js' });
  const fb = sb2.RW.fb;

  // 리전별 후보 주소를 실제로 만들어 내는가
  const cands = fb.candidateURLs('proj-x', 'https://configured.example');
  ok('진단: 설정된 주소를 가장 먼저 본다', cands[0] === 'https://configured.example', cands[0]);
  ok('진단: 미국 기본 주소 후보', cands.indexOf('https://proj-x-default-rtdb.firebaseio.com') > 0);
  ok('진단: 싱가포르 주소 후보',
     cands.indexOf('https://proj-x-default-rtdb.asia-southeast1.firebasedatabase.app') > 0);
  ok('진단: 후보에 중복이 없다', new Set(cands).size === cands.length);

  const run = [];
  const stub = (map) => { sb2.fetch = async (url) => {
    run.push(url);
    const key = Object.keys(map).find((k) => url.indexOf(k) >= 0);
    if (!key) throw new Error('getaddrinfo ENOTFOUND');
    const m = map[key];
    return { status: m.status, text: async () => m.body || '' };
  }; };

  const results = [];
  // (1) 권한 거부(401) 여도 "그 주소에 DB 가 있다" 로 읽어야 한다.
  stub({ 'ok-db': { status: 401, body: '{"error":"Permission denied"}' } });
  results.push(fb.probeDatabase('https://ok-db.firebasedatabase.app'));
  // (2) 인스턴스 없음
  stub({ 'gone': { status: 404, body: 'Firebase error. Database does not exist.' } });
  results.push(fb.probeDatabase('https://gone.firebasedatabase.app'));
  // (3) 아예 응답 없음
  stub({});
  results.push(fb.probeDatabase('https://nope.firebasedatabase.app'));
  // (4) 설정 주소는 죽었지만 다른 리전에 살아 있는 경우를 찾아내는가
  stub({ 'asia-southeast1': { status: 401, body: 'Permission denied' } });
  const found = fb.findDatabaseURL('proj-x', 'https://dead.example');

  Promise.all(results.concat([found])).then(([a, b, c, f]) => {
    ok('진단: 401 은 DB 가 있는 것으로 본다', a.state === 'exists', a.state);
    ok('진단: 404 는 DB 없음', b.state === 'missing', b.state);
    ok('진단: 응답 없음은 unreachable', c.state === 'unreachable', c.state);
    ok('진단: 다른 리전의 살아 있는 주소를 찾아낸다',
       !!f && /asia-southeast1/.test(f.url), f ? f.url : '못 찾음');
    ok('진단: 빈 주소는 찌르지 않는다',
       run.every((u) => u.indexOf('undefined') < 0 && u.indexOf('null') < 0));
    report();
  }).catch((e) => { fails.push('진단 테스트 자체가 실패 — ' + e.message); report(); });
}

// --- 결과 -------------------------------------------------------------------
function report() {
  if (fails.length) {
    console.error(`\n✗ 실패 ${fails.length}건 / 통과 ${pass}건`);
    for (const f of fails) console.error('  - ' + f);
    process.exit(1);
  }
  console.log(`✓ 전부 통과 (${pass}건)`);
}
