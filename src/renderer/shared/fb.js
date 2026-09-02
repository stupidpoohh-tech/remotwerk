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

  // 테스트/재초기화용
  function reset() { readyPromise = null; storagePromise = null; }

  RW.fb = { init, storage, reset };
})(typeof window !== 'undefined' ? window : globalThis);
