'use strict';
/* 페어링 — 1회용 초대 코드로 두 사람을 한 방에 묶는다.
 *
 * 이전 모델(취약): rooms/{코드} 를 코드만 알면 누구나 읽고 쓸 수 있었다.
 *   코드가 'BEAR-5607' 형태로 약 7만 가지뿐이라 전수 조사가 가능했다.
 *
 * 새 모델:
 *   - 방 id 는 서버가 만든 추측 불가능한 push key (rooms/{roomId}).
 *   - 초대 코드는 invites/{code} → roomId 매핑일 뿐이며, 1회용 + 24시간 만료.
 *   - 실제 접근 권한은 "내 uid 가 그 방의 좌석(a/b)에 앉아 있는가"로만 판단(보안 규칙).
 *   - 방 정원은 좌석 2개(a·b)로 고정한다. 각 좌석은 비어 있을 때 본인 uid 로만 한 번
 *     쓸 수 있어서, 세 번째 사람은 앉을 자리가 없다.
 *     (RTDB 보안 규칙에는 자식 개수를 세는 numChildren() 이 없어 좌석 방식으로 구현.)
 */

(function (root) {
  const RW = (root.RW = root.RW || {});

  // 혼동되는 글자(I, O, 0, 1) 제외한 32글자. 10자리 → 32^10 ≈ 1.1×10^15 조합.
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const CODE_LEN = 10;
  const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

  function genCode() {
    const bytes = new Uint32Array(CODE_LEN);
    (root.crypto || root.msCrypto).getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < CODE_LEN; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
    return out.slice(0, 5) + '-' + out.slice(5);   // 표시용: XXXXX-XXXXX
  }

  // 입력 정규화: 대문자화 + 구분자 제거 + 허용 문자만 남김
  function normalize(raw) {
    return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
      .split('').filter((c) => ALPHABET.indexOf(c) >= 0).join('');
  }
  function isValidCode(raw) { return normalize(raw).length === CODE_LEN; }

  // RTDB 쓰기는 서버가 응답할 때까지 끝나지 않는다. 연결이 끊겨 있으면 오류도 없이
  // 영영 대기하므로(그래서 "방을 만드는 중…" 에서 멈췄다), 시작 전에 연결부터 확인하고
  // 각 단계에도 상한을 둔다.
  const STEP_TIMEOUT_MS = 15000;
  function withTimeout(promise, what) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        const err = new Error(`${what} 이(가) 응답하지 않아요. 서버 연결을 확인해 주세요.`);
        err.rwTimeout = true;      // 아래에서 다른 메시지로 덮어쓰지 않게 표시
        reject(err);
      }, STEP_TIMEOUT_MS);
      promise.then(
        (v) => { clearTimeout(t); resolve(v); },
        (e) => { clearTimeout(t); reject(e); }
      );
    });
  }

  // 새 방을 만들고 초대 코드를 발급한다(초대하는 쪽).
  async function createRoomAndInvite(cfg) {
    const fb = await RW.fb.init(cfg.firebase);
    await RW.fb.waitConnected(10000);
    const { db, dbMod, uid } = fb;

    // 추측 불가능한 방 id
    const roomId = dbMod.push(dbMod.ref(db, 'rooms')).key;

    // 좌석 a 를 내 uid 로 선점(규칙: 비어 있을 때 본인 uid 로만 1회)
    await withTimeout(dbMod.set(dbMod.ref(db, `rooms/${roomId}/a`), uid), '방 만들기');

    // 좌석에 앉았으니 멤버 정보 기록
    await withTimeout(dbMod.set(dbMod.ref(db, `rooms/${roomId}/members/${uid}`), {
      characterId: cfg.characterId || 'char_seal',
      joinedAt: dbMod.serverTimestamp()
    }), '멤버 등록');

    const code = genCode();
    const expiresAt = Date.now() + INVITE_TTL_MS;
    await withTimeout(dbMod.set(dbMod.ref(db, `invites/${normalize(code)}`), {
      roomId, createdBy: uid, expiresAt
    }), '초대 코드 발급');

    return { code, roomId, expiresAt, uid };
  }

  // 상대가 준 코드로 방에 참여한다(초대받는 쪽).
  async function joinWithCode(cfg, rawCode) {
    const code = normalize(rawCode);
    if (code.length !== CODE_LEN) throw new Error('코드 형식이 올바르지 않아요.');

    const fb = await RW.fb.init(cfg.firebase);
    await RW.fb.waitConnected(10000);
    const { db, dbMod, uid } = fb;

    let snap;
    try {
      snap = await withTimeout(dbMod.get(dbMod.ref(db, `invites/${code}`)), '코드 확인');
    } catch (e) {
      if (e && e.rwTimeout) throw e;      // 연결 문제를 '잘못된 코드'로 오해하게 두지 않는다
      throw new Error('코드를 확인할 수 없어요. (만료되었거나 잘못된 코드)');
    }
    if (!snap.exists()) throw new Error('코드를 찾을 수 없어요. (만료되었거나 이미 사용된 코드)');

    const inv = snap.val() || {};
    if (inv.expiresAt && inv.expiresAt < Date.now()) throw new Error('만료된 코드예요. 새로 발급받아 주세요.');
    const roomId = inv.roomId;
    if (!roomId) throw new Error('초대 정보가 손상되었어요.');

    // 좌석 b 선점 — 이미 차 있으면 보안 규칙이 거부한다(정원 2명).
    try {
      await withTimeout(dbMod.set(dbMod.ref(db, `rooms/${roomId}/b`), uid), '방 참여');
    } catch (e) {
      if (e && e.rwTimeout) throw e;      // 연결 문제를 '정원 초과'로 오해하게 두지 않는다
      // 내가 이미 그 좌석에 앉아 있는 경우(재시도)엔 성공으로 본다.
      const seat = await dbMod.get(dbMod.ref(db, `rooms/${roomId}/b`)).catch(() => null);
      if (!(seat && seat.exists() && seat.val() === uid)) {
        throw new Error('이 방에는 이미 두 명이 있어요.');
      }
    }

    // 좌석에 앉았으니 멤버 정보 기록
    await withTimeout(dbMod.set(dbMod.ref(db, `rooms/${roomId}/members/${uid}`), {
      characterId: cfg.characterId || 'char_ribbon',
      joinedAt: dbMod.serverTimestamp()
    }), '멤버 등록');

    // 1회용: 사용한 초대장은 지운다(규칙상 그 방의 멤버가 삭제 가능)
    await dbMod.remove(dbMod.ref(db, `invites/${code}`)).catch(() => {});

    return { roomId, uid };
  }

  // 상대가 실제로 들어왔는지 지켜본다(좌석 a·b 가 둘 다 차고, 서로 다른 uid 인가).
  // 방을 만들기만 해도 roomId 는 생기므로, 그것만으로 "연결됨" 이라 말하면 안 된다.
  // 해제 함수를 돌려준다.
  function watchPartner(cfg, cb) {
    let off = null, cancelled = false;
    (async () => {
      try {
        const fb = await RW.fb.init(cfg.firebase);
        if (cancelled || !cfg.roomId) return;
        const { db, dbMod } = fb;
        const seats = dbMod.ref(db, `rooms/${cfg.roomId}`);
        off = dbMod.onValue(seats, (snap) => {
          const v = snap.val() || {};
          cb(!!(v.a && v.b && v.a !== v.b));
        }, () => cb(false));
      } catch (_) { cb(false); }
    })();
    return () => { cancelled = true; if (off) off(); };
  }

  RW.pairing = { genCode, normalize, isValidCode, createRoomAndInvite, joinWithCode,
                 watchPartner, CODE_LEN };
})(typeof window !== 'undefined' ? window : globalThis);
