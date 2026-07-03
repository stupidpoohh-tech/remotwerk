'use strict';
/* 신호 트랜스포트 — 페어링/신호 송수신/히스토리 조회.
 *
 * 두 백엔드:
 *   - FirebaseTransport: cfg.firebase 설정 + pairCode 가 있으면 사용(실제 커플 사용).
 *     rooms/{code}/members, rooms/{code}/signals 구조.
 *   - LocalTransport: 설정이 없으면 같은 PC 안에서 BroadcastChannel 로 루프백(데모/검증용).
 *     리모컨에서 보낸 신호가 '상대'로서 내 오버레이에 돌아와 끝-끝 동작을 확인할 수 있다.
 *
 * 공통 규칙:
 *   - 신호 = { from, gestureId, ts } 로 매우 가볍다.
 *   - live 판별: 클라이언트 시작 시각(sessionStartTs) 이후 ts 면 라이브 재생, 이전이면 히스토리만.
 *   - 히스토리: 상대가 보낸(from != 내 userId) 오늘(KST) 신호만.
 */

(function (root) {
  const RW = (root.RW = root.RW || {});

  const DAY_MS = 24 * 60 * 60 * 1000;

  // KST(UTC+9) 기준 오늘 자정의 타임스탬프
  function startOfTodayKST() {
    const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
    return Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate()) - 9 * 3600 * 1000;
  }

  function makeId() {
    return 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ------------------------------------------------------------------ Firebase
  function FirebaseTransport(cfg) {
    const userId = cfg.userId;
    const code = cfg.pairCode;
    const sessionStartTs = Date.now();
    const listeners = [];
    let db = null, refs = null, mod = null;

    async function init() {
      const appMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
      const dbMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');
      mod = dbMod;
      const app = appMod.initializeApp(cfg.firebase);
      db = dbMod.getDatabase(app);
      refs = {
        members: dbMod.ref(db, `rooms/${code}/members`),
        me: dbMod.ref(db, `rooms/${code}/members/${userId}`),
        signals: dbMod.ref(db, `rooms/${code}/signals`)
      };
      // 내 멤버십 등록(캐릭터 포함)
      await dbMod.set(refs.me, { characterId: cfg.characterId, joinedAt: dbMod.serverTimestamp() });
      // 오래된 신호(하루 이상) 정리 — 베스트 에포트
      pruneOld().catch(() => {});
      // 오늘 신호 실시간 수신
      const q = dbMod.query(refs.signals, dbMod.orderByChild('ts'), dbMod.startAt(startOfTodayKST()));
      dbMod.onChildAdded(q, (snap) => {
        const v = snap.val() || {};
        emit({
          id: snap.key,
          from: v.from,
          gestureId: v.gestureId,
          ts: v.ts || 0,
          mine: v.from === userId,
          live: (v.ts || 0) >= sessionStartTs
        });
      });
    }

    async function pruneOld() {
      const cutoff = Date.now() - DAY_MS;
      const q = mod.query(refs.signals, mod.orderByChild('ts'), mod.endAt(cutoff));
      const snap = await mod.get(q);
      const updates = {};
      snap.forEach((child) => { updates[child.key] = null; });
      if (Object.keys(updates).length) await mod.update(refs.signals, updates);
    }

    function emit(sig) { for (const cb of listeners) cb(sig); }

    return {
      mode: 'firebase',
      ready: init(),
      onSignal(cb) { listeners.push(cb); return () => listeners.splice(listeners.indexOf(cb), 1); },
      async send(gestureId) {
        if (refs) await mod.push(refs.signals, { from: userId, gestureId, ts: Date.now() });
      },
      async loadTodayHistory() {
        const q = mod.query(refs.signals, mod.orderByChild('ts'), mod.startAt(startOfTodayKST()));
        const snap = await mod.get(q);
        const out = [];
        snap.forEach((c) => {
          const v = c.val() || {};
          if (v.from !== userId) out.push({ id: c.key, from: v.from, gestureId: v.gestureId, ts: v.ts || 0 });
        });
        return out.sort((a, b) => a.ts - b.ts);
      },
      async getPartnerCharacterId() {
        const snap = await mod.get(refs.members);
        let cid = null;
        snap.forEach((c) => { if (c.key !== userId) cid = (c.val() || {}).characterId || cid; });
        return cid;
      },
      async setMyCharacter(characterId) {
        if (refs) await mod.update(refs.me, { characterId });
      },
      destroy() { listeners.length = 0; }
    };
  }

  // --------------------------------------------------------------------- Local
  // 같은 PC 루프백(데모/검증). 보낸 신호를 '상대(local-partner)'로 되돌려 오버레이에서 확인.
  function LocalTransport(cfg) {
    const userId = cfg.userId;
    const PARTNER = 'local-partner';
    const sessionStartTs = Date.now();
    const listeners = [];
    const HKEY = 'rw-history';
    const chan = ('BroadcastChannel' in root) ? new BroadcastChannel('rw-signals') : null;

    function readHistory() {
      try { return JSON.parse(localStorage.getItem(HKEY) || '[]'); } catch (_) { return []; }
    }
    function writeHistory(list) {
      const today = startOfTodayKST();
      const pruned = list.filter((s) => s.ts >= today);
      localStorage.setItem(HKEY, JSON.stringify(pruned));
      return pruned;
    }
    function record(sig) {
      if (sig.from === userId) return;           // 받은 신호만 기록
      const list = readHistory();
      if (list.some((s) => s.id === sig.id)) return;
      list.push({ id: sig.id, from: sig.from, gestureId: sig.gestureId, ts: sig.ts });
      writeHistory(list);
    }
    function emit(sig) { record(sig); for (const cb of listeners) cb(sig); }

    if (chan) {
      chan.onmessage = (e) => {
        const v = e.data || {};
        emit({ id: v.id, from: v.from, gestureId: v.gestureId, ts: v.ts,
               mine: v.from === userId, live: v.ts >= sessionStartTs });
      };
    }

    return {
      mode: 'local',
      ready: Promise.resolve(),
      onSignal(cb) { listeners.push(cb); return () => listeners.splice(listeners.indexOf(cb), 1); },
      async send(gestureId) {
        // 루프백: 상대가 보낸 것처럼 되돌려 준다.
        const sig = { id: makeId(), from: PARTNER, gestureId, ts: Date.now() };
        if (chan) chan.postMessage(sig);
        else emit(Object.assign({}, sig, { mine: false, live: true }));
      },
      async loadTodayHistory() {
        const today = startOfTodayKST();
        return readHistory()
          .filter((s) => s.from !== userId && s.ts >= today)
          .sort((a, b) => a.ts - b.ts);
      },
      async getPartnerCharacterId() { return cfg.partnerCharacterId || null; },
      async setMyCharacter() { /* 로컬 데모에선 no-op */ },
      destroy() { listeners.length = 0; if (chan) chan.close(); }
    };
  }

  function createTransport(cfg) {
    const useFirebase = cfg && cfg.firebase && cfg.pairCode;
    return useFirebase ? FirebaseTransport(cfg) : LocalTransport(cfg);
  }

  RW.transport = { createTransport, startOfTodayKST };
})(typeof window !== 'undefined' ? window : globalThis);
