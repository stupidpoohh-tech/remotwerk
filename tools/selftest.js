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
                 'preset-art.js', 'presets.js', 'characters.js']) {
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
      if (key === 't') continue;
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

// --- 3. 트랙 보간 ------------------------------------------------------------
const built = RW.engine.buildTracks({
  frames: [{ t: 0 }, { t: 100, root: { y: -10, back: true } }, { t: 200, root: { y: 0, back: false } }]
});
ok('duration = 마지막 프레임', built.duration === 200, String(built.duration));
ok('수치 트랙은 선형 보간', near(RW.engine.poseAt(built, 50).root.y, -5));
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
ok('색 프리셋도 남아 있다', ['preset1', 'preset2', 'preset3'].every((id) => presetIds.includes(id)));
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

// --- 결과 -------------------------------------------------------------------
if (fails.length) {
  console.error(`\n✗ 실패 ${fails.length}건 / 통과 ${pass}건`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log(`✓ 전부 통과 (${pass}건)`);
