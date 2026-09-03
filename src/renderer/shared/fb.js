'use strict';
/* Firebase 부트스트랩 — 앱/익명 인증/DB/Storage 를 한 번만 초기화해 공유한다.
 *
 * 보안 모델의 출발점: **익명 인증(signInAnonymously)**.
 * 설치마다 서버가 발급·검증하는 고유 uid 를 받고, 이후 모든 접근 권한은
 * "페어링 코드를 아는가"가 아니라 "이 uid 가 그 방의 멤버인가"로 판단한다.
 * (코드는 방에 들어오기 위한 1회용 초대장일 뿐, 접근 열쇠가 아니다.)
 */

(function (root) {
  const RW = (root.RW = root.RW || {});
  const CDN = 'https://www.gstatic.com/firebasejs/10.12.0/';

  let readyPromise = null;   // { app, auth, db, dbMod, authMod, uid }
  let storagePromise = null;

  // 최초 1회만 초기화. 이후 호출은 같은 Promise 를 돌려준다.
  function init(firebaseConfig) {
    if (readyPromise) return readyPromise;
    readyPromise = (async () => {
      const [appMod, authMod, dbMod] = await Promise.all([
        import(CDN + 'firebase-app.js'),
        import(CDN + 'firebase-auth.js'),
        import(CDN + 'firebase-database.js')
      ]);
      const app = appMod.initializeApp(firebaseConfig);
      const auth = authMod.getAuth(app);

      // 익명 로그인. Firebase 콘솔 → Authentication → 로그인 방법 → '익명' 사용 설정 필요.
      let uid;
      try {
        const cred = await authMod.signInAnonymously(auth);
        uid = cred.user.uid;
      } catch (e) {
        throw new Error(
          'Firebase 익명 로그인 실패: ' + (e && e.code ? e.code : e) +
          ' — 콘솔에서 Authentication → 로그인 방법 → 익명을 켰는지 확인하세요.'
        );
      }

      const db = dbMod.getDatabase(app);
      return { app, auth, db, dbMod, authMod, uid };
    })();
    return readyPromise;
  }

  // Storage 는 실제로 쓸 때만(커스텀 캐릭터 공유) 지연 로드한다.
  async function storage() {
    if (storagePromise) return storagePromise;
    storagePromise = (async () => {
      const fb = await readyPromise;
      if (!fb) throw new Error('fb.init() 이 먼저 호출되어야 합니다.');
      const mod = await import(CDN + 'firebase-storage.js');
      return { mod, storage: mod.getStorage(fb.app) };
    })();
    return storagePromise;
  }

  // 실시간 DB 서버와 실제로 연결됐는지 기다린다.
  //
  // 왜 필요한가: RTDB 의 set()/get() 은 **서버가 응답할 때까지 끝나지 않는다.** 연결이
  // 안 되면 오류도 안 나고 그냥 영영 대기한다. 그래서 페어링이 "방을 만드는 중…" 에서
  // 멈춘 채 아무 말도 못 하는 상태가 됐다(원인은 CSP 가 지역 DB 의 wss 를 막은 것).
  // 쓰기 전에 여기서 먼저 연결을 확인하면, 안 될 때 곧바로 이유를 말해 줄 수 있다.
  async function waitConnected(ms) {
    const fb = await readyPromise;
    if (!fb) throw new Error('fb.init() 이 먼저 호출되어야 합니다.');
    const { db, dbMod } = fb;
    const ref = dbMod.ref(db, '.info/connected');
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (fn, arg) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (off) off();
        fn(arg);
      };
      const timer = setTimeout(() => finish(reject, new Error(
        '서버에 연결하지 못했어요. 네트워크(방화벽·VPN·회사망)를 확인해 주세요.'
      )), ms || 10000);
      let off = null;
      off = dbMod.onValue(ref, (snap) => {
        if (snap.val() === true) finish(resolve, true);
      }, (e) => finish(reject, e));
    });
  }

  // 연결 상태를 계속 지켜본다(설정창 표시용). 해제 함수를 돌려준다.
  function onConnected(cb) {
    let off = null;
    let cancelled = false;
    (async () => {
      try {
        const fb = await readyPromise;
        if (!fb || cancelled) return;
        off = fb.dbMod.onValue(fb.dbMod.ref(fb.db, '.info/connected'),
          (snap) => cb(snap.val() === true),
          () => cb(false));
      } catch (_) { cb(false); }
    })();
    return () => { cancelled = true; if (off) off(); };
  }

  // 테스트/재초기화용
  function reset() { readyPromise = null; storagePromise = null; }

  RW.fb = { init, storage, waitConnected, onConnected, reset };
})(typeof window !== 'undefined' ? window : globalThis);
