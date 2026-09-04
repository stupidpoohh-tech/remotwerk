'use strict';
/* 신호 트랜스포트 — 신호 송수신/히스토리/캐릭터 공유.
 *
 * 두 백엔드:
 *   - FirebaseTransport: cfg.firebase + cfg.roomId 가 있으면 사용(실제 커플 사용).
 *     접근 주체는 익명 인증 uid 이며, 보안 규칙이 "그 방의 멤버인가"로 권한을 판단한다.
 *     rooms/{roomId}/members, rooms/{roomId}/signals
 *   - LocalTransport: 페어링 전/설정 없음이면 같은 PC 안에서 BroadcastChannel 루프백(데모).
 *
 * 공통 규칙:
 *   - 신호 = { from, gestureId, ts } 로 매우 가볍다.
 *   - live 판별: **도착 순서**로 본다. 처음 붙을 때 딸려 오는 오늘치는 히스토리,
 *     그 뒤에 오는 것은 라이브. 두 PC 시계가 어긋나도 영향받지 않는다.
 *   - 히스토리: 상대가 보낸(from != 내 uid) 오늘(KST) 신호만.
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
    const roomId = cfg.roomId;
    const listeners = [];
    let fb = null, mod = null, refs = null, uid = null;

    function findMyBundle(characterId) {
      const c = (cfg.customCharacters || []).find((x) => x.id === characterId);
      return c ? c.bundle : null;
    }

    // 커스텀 캐릭터 번들 → Storage. 경로에 uid 가 들어가 본인만 쓸 수 있다(규칙).
    async function uploadBundle(bundle) {
      const { mod: sMod, storage } = await RW.fb.storage();
      const path = `rooms/${roomId}/characters/${uid}/bundle.json`;
      await sMod.uploadString(sMod.ref(storage, path), JSON.stringify(bundle), 'raw',
        { contentType: 'application/json' });
      return path;
    }

    async function downloadBundle(path) {
      const { mod: sMod, storage } = await RW.fb.storage();
      const bytes = await sMod.getBytes(sMod.ref(storage, path));
      return JSON.parse(new TextDecoder().decode(bytes));
    }

    // 캐릭터 종류에 따라 전달 방식이 다르다.
    //   개인(custom)  : 번들을 방 Storage 에 올리고 characterRef 로 가리킨다.
    //   공용(catalog) : 서버에 이미 있으니 id 만 알려준다(업로드 없음).
    //   프리셋(preset): 앱에 내장돼 있으니 id 만.
    async function writeMyCharacter(characterId) {
      const src = RW.characters ? RW.characters.sourceOf(characterId, cfg) : 'preset';
      if (src === 'custom') {
        const bundle = findMyBundle(characterId);
        const characterRef = bundle ? await uploadBundle(bundle) : null;
        await mod.update(refs.me, { characterId, characterSource: 'custom', characterRef: characterRef || null });
      } else {
        await mod.update(refs.me, { characterId, characterSource: src, characterRef: null });
      }
    }

    async function resolvePartner(val) {
      if (!val) return null;
      if (val.characterSource === 'catalog' && RW.catalog) {
        const entry = await RW.catalog.get(cfg, val.characterId).catch(() => null);
        if (entry && entry.bundle) return { kind: 'bundle', id: entry.id, bundle: entry.bundle };
      }
      if (val.characterRef) {
        const bundle = await downloadBundle(val.characterRef).catch(() => null);
        if (bundle) return { kind: 'bundle', id: val.characterId || 'custom', bundle };
      }
      return { kind: 'preset', id: val.characterId || 'char_dada' };
    }
    function partnerValFrom(snap) {
      let v = null;
      snap.forEach((c) => { if (c.key !== uid) v = c.val(); });
      return v;
    }

    async function init() {
      fb = await RW.fb.init(cfg.firebase);
      mod = fb.dbMod;
      uid = fb.uid;
      const db = fb.db;

      refs = {
        members: mod.ref(db, `rooms/${roomId}/members`),
        me: mod.ref(db, `rooms/${roomId}/members/${uid}`),
        signals: mod.ref(db, `rooms/${roomId}/signals`)
      };

      // ★ 신호 구독을 **가장 먼저** 건다.
      // 예전에는 멤버십 갱신(await update)을 먼저 하고 그다음에 구독했다. 그러면
      // 그 쓰기 하나가 늦거나 실패하는 순간 **구독 자체가 등록되지 않아** 신호가
      // 영영 안 온다. 증상은 "연결도 됐고 히스토리도 쌓이는데 캐릭터만 반응 없음"
      // 이라 원인을 찾기 어렵다(히스토리는 get 으로 따로 읽기 때문).
      // 구독은 네트워크를 기다리지 않는 등록 작업이라 먼저 해도 안전하다.
      const q = mod.query(refs.signals, mod.orderByChild('ts'), mod.startAt(startOfTodayKST()));

      // ★ '지금 온 신호인가'를 **시계로 판단하지 않는다.**
      // 예전에는 보낸 쪽의 ts(그 PC 의 Date.now())를 받는 쪽의 시작 시각과 비교했다.
      // 두 PC 시계가 몇 분만 어긋나도 상대가 보낸 신호가 전부 '과거'로 분류돼
      // **히스토리에는 남는데 캐릭터는 반응하지 않는다.** 원인이 시계라서 더 안 보인다.
      //
      // 대신 **도착 순서**로 판단한다. RTDB 는 한 쿼리에 대해 기존 자식들의
      // child_added 를 먼저 모두 보내고 그다음 value 를 보낸다. 그래서 value 가
      // 오기 전 = 오늘치 기존 신호, 그 뒤 = 방금 도착한 신호다. 시계와 무관하다.
      let initialLoaded = false;
      mod.onChildAdded(q, (snap) => {
        const v = snap.val() || {};
        emit({
          id: snap.key,
          from: v.from,
          gestureId: v.gestureId,
          ts: v.ts || 0,
          mine: v.from === uid,
          live: initialLoaded
        });
      });
      mod.onValue(q, () => { initialLoaded = true; }, { onlyOnce: true });

      // 멤버십 갱신(이미 페어링 시 등록됨). 커스텀 캐릭터면 번들 업로드 후 참조 기록.
      // 실패해도 신호 수신은 이미 살아 있다.
      await mod.update(refs.me, { characterId: cfg.characterId, lastSeen: mod.serverTimestamp() });
      writeMyCharacter(cfg.characterId).catch((e) => console.error('[transport] 캐릭터 등록', e));

      pruneOld().catch(() => {});
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
      get uid() { return uid; },
      onSignal(cb) { listeners.push(cb); return () => listeners.splice(listeners.indexOf(cb), 1); },

      async send(gestureId) {
        if (refs) await mod.push(refs.signals, { from: uid, gestureId, ts: Date.now() });
      },

      async loadTodayHistory() {
        const q = mod.query(refs.signals, mod.orderByChild('ts'), mod.startAt(startOfTodayKST()));
        const snap = await mod.get(q);
        const out = [];
        snap.forEach((c) => {
          const v = c.val() || {};
          if (v.from !== uid) out.push({ id: c.key, from: v.from, gestureId: v.gestureId, ts: v.ts || 0 });
        });
        return out.sort((a, b) => a.ts - b.ts);
      },

      async getPartnerCharacter() {
        const snap = await mod.get(refs.members);
        return resolvePartner(partnerValFrom(snap));
      },

      onPartnerCharacter(cb) {
        return mod.onValue(refs.members, async (snap) => {
          const def = await resolvePartner(partnerValFrom(snap));
          if (def) cb(def);
        });
      },

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
  // 페어링 전 / Firebase 미설정 시 같은 PC 루프백(데모·검증용).
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
      if (sig.from === userId) return;
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
      get uid() { return userId; },
      onSignal(cb) { listeners.push(cb); return () => listeners.splice(listeners.indexOf(cb), 1); },
      async send(gestureId) {
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
      async getPartnerCharacter() {
        return { kind: 'local', id: cfg.partnerCharacterId || 'char_dada' };
      },
      onPartnerCharacter() { return () => {}; },
      async setMyCharacter() { /* 로컬 데모: 공유 저장소 업로드 없음 */ },
      destroy() { listeners.length = 0; if (chan) chan.close(); }
    };
  }

  // roomId 가 있어야 Firebase 모드. (페어링 전이면 로컬 데모로 안전하게 동작)
  function createTransport(cfg) {
    const useFirebase = !!(cfg && cfg.firebase && cfg.roomId);
    return useFirebase ? FirebaseTransport(cfg) : LocalTransport(cfg);
  }

  RW.transport = { createTransport, startOfTodayKST };
})(typeof window !== 'undefined' ? window : globalThis);
