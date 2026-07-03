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
    let app = null, db = null, refs = null, mod = null;
    let storage = null, storageMod = null;

    // 내 로컬 커스텀 캐릭터 번들 찾기(있으면 커스텀, 없으면 프리셋)
    function findMyBundle(characterId) {
      const c = (cfg.customCharacters || []).find((x) => x.id === characterId);
      return c ? c.bundle : null;
    }

    async function ensureStorage() {
      if (storage) return;
      storageMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js');
      storage = storageMod.getStorage(app);
    }

    // 커스텀 캐릭터 번들을 Storage 에 업로드하고 경로(characterRef)를 돌려준다.
    async function uploadBundle(bundle) {
      await ensureStorage();
      const path = `rooms/${code}/characters/${userId}.json`;
      const sref = storageMod.ref(storage, path);
      await storageMod.uploadString(sref, JSON.stringify(bundle), 'raw', { contentType: 'application/json' });
      return path;
    }

    async function downloadBundle(path) {
      await ensureStorage();
      const bytes = await storageMod.getBytes(storageMod.ref(storage, path));
      return JSON.parse(new TextDecoder().decode(bytes));
    }

    // members 레코드에 내 캐릭터(참조 포함)를 기록
    async function writeMyCharacter(characterId) {
      const bundle = findMyBundle(characterId);
      let characterRef = null;
      if (bundle) characterRef = await uploadBundle(bundle);
      await mod.update(refs.me, { characterId, characterRef: characterRef || null });
    }

    // 상대 멤버 레코드 → 정규화된 캐릭터 정의
    async function resolvePartner(val) {
      if (!val) return null;
      if (val.characterRef) {
        const bundle = await downloadBundle(val.characterRef).catch(() => null);
        if (bundle) return { kind: 'bundle', id: val.characterId || 'custom', bundle };
      }
      return { kind: 'preset', id: val.characterId || 'preset2' };
    }
    function partnerValFrom(snap) {
      let v = null;
      snap.forEach((c) => { if (c.key !== userId) v = c.val(); });
      return v;
    }

    async function init() {
      const appMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
      const dbMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');
      mod = dbMod;
      app = appMod.initializeApp(cfg.firebase);
      db = dbMod.getDatabase(app);
      refs = {
        members: dbMod.ref(db, `rooms/${code}/members`),
        me: dbMod.ref(db, `rooms/${code}/members/${userId}`),
        signals: dbMod.ref(db, `rooms/${code}/signals`)
      };
      // 내 멤버십 등록(캐릭터 포함). 커스텀이면 번들 업로드 후 참조 기록.
      await dbMod.set(refs.me, { characterId: cfg.characterId, joinedAt: dbMod.serverTimestamp() });
      writeMyCharacter(cfg.characterId).catch((e) => console.error('[transport] 캐릭터 등록', e));
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
      // 상대 캐릭터(정규화): 프리셋 id 또는 다운로드한 커스텀 번들
      async getPartnerCharacter() {
        const snap = await mod.get(refs.members);
        return resolvePartner(partnerValFrom(snap));
      },
      // 상대가 캐릭터를 바꾸면 실시간으로 알림(오버레이가 캐릭터 교체)
      onPartnerCharacter(cb) {
        const off = mod.onValue(refs.members, async (snap) => {
          const def = await resolvePartner(partnerValFrom(snap));
          if (def) cb(def);
        });
        return off;
      },
      // 내 캐릭터 설정/공유. bundle 이 넘어오면 그 자리에서, 아니면 로컬 커스텀에서 찾아 업로드.
      async setMyCharacter(characterId, bundle) {
        if (!refs) return;
        if (bundle) {
          const ref = await uploadBundle(bundle);
          await mod.update(refs.me, { characterId, characterRef: ref });
        } else {
          await writeMyCharacter(characterId);
        }
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
      // 로컬 데모: 상대 캐릭터는 partnerCharacterId(오버레이가 config 에서 프리셋/커스텀 해석)
      async getPartnerCharacter() {
        return { kind: 'local', id: cfg.partnerCharacterId || 'preset2' };
      },
      onPartnerCharacter() { return () => {}; },  // 로컬은 config 변경으로 반영(오버레이가 감시)
      async setMyCharacter() { /* 로컬 데모에선 공유 저장소 업로드 없음(번들은 config 에 있음) */ },
      destroy() { listeners.length = 0; if (chan) chan.close(); }
    };
  }

  function createTransport(cfg) {
    const useFirebase = cfg && cfg.firebase && cfg.pairCode;
    return useFirebase ? FirebaseTransport(cfg) : LocalTransport(cfg);
  }

  RW.transport = { createTransport, startOfTodayKST };
})(typeof window !== 'undefined' ? window : globalThis);
