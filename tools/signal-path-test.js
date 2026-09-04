'use strict';
/* 신호 수신 경로 검사 — "연결도 됐고 히스토리도 쌓이는데 캐릭터만 반응 없음" 재발 방지.
 *
 * 이 증상은 화면을 봐서는 알 수 없다. 창은 멀쩡히 떠 있고, 캐릭터도 보이고,
 * 히스토리 목록에도 상대 신호가 쌓인다. 그런데 캐릭터만 아무 반응이 없다.
 * 원인이 될 수 있는 자리가 셋이고, 셋 다 **조용히** 실패한다.
 *
 *   1) 구독을 거는 순서 — 멤버십 쓰기(await)를 먼저 하고 그 뒤에 구독하면,
 *      그 쓰기 하나가 늦거나 실패할 때 구독이 아예 등록되지 않는다.
 *   2) 라이브 판별 — 보낸 쪽 시계(ts)와 받는 쪽 시계를 비교하면, 두 PC 시계가
 *      어긋날 때 상대 신호가 전부 '과거'로 분류돼 재생되지 않는다.
 *   3) 오버레이가 transport.ready 를 기다린 뒤에 구독 — 연결이 늦으면 구독 자체가 생략된다.
 *
 * 진짜 Firebase 없이, RTDB 의 **이벤트 순서 규칙**만 흉내 내서 검사한다.
 * (한 쿼리에 대해 기존 자식들의 child_added 를 모두 보낸 뒤 value 를 보낸다.)
 *
 *   실행: node tools/signal-path-test.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SHARED = path.join(__dirname, '..', 'src', 'renderer', 'shared');
const fails = [];
let pass = 0;
function ok(name, cond, detail) {
  if (cond) pass++;
  else fails.push(name + (detail ? ` — ${detail}` : ''));
}

// --- RTDB 흉내 --------------------------------------------------------------
// 실제 SDK 와 같은 **순서 보장**만 재현한다: 기존 자식 child_added → value.
function makeFakeDb(existing) {
  const state = { childAdded: null, valueCb: null, updates: [], updateGate: null };
  const snap = (key, val) => ({ key, val: () => val });

  const mod = {
    ref: (_db, p) => ({ path: p }),
    query: (r) => r,
    orderByChild: () => null,
    startAt: () => null,
    endAt: () => null,
    serverTimestamp: () => 0,
    onChildAdded(_q, cb) {
      state.childAdded = cb;
      // 기존 자식들을 먼저 흘려보낸다.
      for (const e of existing) cb(snap(e.id, e));
      return () => {};
    },
    onValue(_q, cb, opts) {
      if (opts && opts.onlyOnce) { state.valueCb = cb; cb(snap('all', {})); }
      return () => {};
    },
    async update(_r, patch) {
      state.updates.push(patch);
      if (state.updateGate) await state.updateGate;   // 멈춰 있는 쓰기를 흉내 낸다
    },
    async get() { return { forEach: () => {} }; },
    async push() {}
  };
  // 나중에 도착하는 신호. 구독이 안 걸려 있으면 **그 사실 자체가 이 검사의 결론**이므로
  // 터뜨리지 않고 조용히 넘긴다(그러면 위 ok() 가 "신호가 안 왔다"로 잡는다).
  state.deliver = (e) => { if (state.childAdded) state.childAdded(snap(e.id, e)); };
  return { mod, state };
}

function loadTransport(fakeDb, uid) {
  const sandbox = { console, setTimeout, clearTimeout, Date, Math, JSON, Promise };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(SHARED, 'transport.js'), 'utf8'), sandbox);
  sandbox.RW.fb = { init: async () => ({ dbMod: fakeDb.mod, db: {}, uid }) };
  sandbox.RW.characters = { sourceOf: () => 'preset' };
  return sandbox.RW.transport;
}

const CFG = { roomId: 'r1', firebase: { apiKey: 'x' }, characterId: 'char_seal', customCharacters: [] };

(async () => {
  // --- 1. 시계가 어긋나도 방금 온 신호는 라이브다 ----------------------------
  {
    // 상대 PC 시계가 1시간 느리다 → ts 가 내 세션 시작보다 한참 과거로 찍힌다.
    const past = Date.now() - 3600 * 1000;
    const fake = makeFakeDb([{ id: 'old1', from: 'partner', gestureId: 'g_cheer', ts: past }]);
    const t = loadTransport(fake, 'me').createTransport(CFG);
    const got = [];
    t.onSignal((s) => got.push(s));
    await t.ready;

    ok('처음 붙을 때 딸려 온 오늘치는 라이브가 아니다',
       got.length === 1 && got[0].live === false, JSON.stringify(got[0]));

    fake.state.deliver({ id: 'new1', from: 'partner', gestureId: 'g_twerk', ts: past + 1000 });
    const live = got[got.length - 1];
    ok('시계가 1시간 느린 상대가 방금 보낸 신호도 라이브다',
       got.length === 2 && live.live === true && live.gestureId === 'g_twerk',
       JSON.stringify(live));
    ok('상대 신호는 mine 이 아니다', live.mine === false);
  }

  // --- 2. 멤버십 쓰기가 멈춰 있어도 신호는 온다 ------------------------------
  {
    const fake = makeFakeDb([]);
    let release;
    fake.state.updateGate = new Promise((r) => { release = r; });   // 영원히 안 끝나는 쓰기
    const t = loadTransport(fake, 'me').createTransport(CFG);
    const got = [];
    t.onSignal((s) => got.push(s));

    // ready 를 기다리지 않는다 — 실제로 멈춰 있는 상황이다.
    await new Promise((r) => setTimeout(r, 30));
    fake.state.deliver({ id: 'n1', from: 'partner', gestureId: 'g_twerk', ts: Date.now() });

    ok('멤버십 쓰기가 멈춰 있어도 신호 구독은 살아 있다',
       got.length === 1 && got[0].gestureId === 'g_twerk', JSON.stringify(got));
    release();
  }

  // --- 3. 오버레이가 ready 보다 먼저 구독한다 --------------------------------
  {
    const ov = fs.readFileSync(path.join(SHARED, '..', 'overlay', 'overlay.js'), 'utf8');
    const iSub = ov.indexOf('transport.onSignal(onSignal)');
    const iReady = ov.indexOf('await transport.ready');
    ok('오버레이가 ready 를 기다리기 전에 신호를 구독한다',
       iSub > 0 && iReady > 0 && iSub < iReady, `onSignal@${iSub} ready@${iReady}`);
  }

  // --- 4. 라이브 판별에 시계 비교가 남아 있지 않다 ---------------------------
  {
    const src = fs.readFileSync(path.join(SHARED, 'transport.js'), 'utf8');
    const fbPart = src.slice(0, src.indexOf('function LocalTransport'));
    ok('Firebase 경로에 ts↔세션시각 비교가 없다', !/live:\s*\(?v\.ts/.test(fbPart));
  }

  if (fails.length) {
    console.error(`\n✗ 실패 ${fails.length}건 / 통과 ${pass}건`);
    for (const f of fails) console.error('  - ' + f);
    process.exit(1);
  }
  console.log(`✓ 신호 수신 경로 ${pass}건 통과`);
})();
