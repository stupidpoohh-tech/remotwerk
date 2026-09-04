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

  // 전송 방식(transport). 설정의 firebase 객체 안에 `rwTransport` 로 실어 나른다.
  //
  // 왜 여기 넣는가: 이 값은 **getDatabase() 를 부르기 전에** 정해져야 한다(한 번 만들어진
  // DB 인스턴스는 앱 단위로 캐시돼 나중에 바꿀 수 없다). 모든 화면이 이미 cfg.firebase 를
  // 그대로 넘기고 있으므로, 여기 실어 두면 어느 화면에서 먼저 초기화하든 같은 방식이 된다.
  //
  //   'auto'     기본. SDK 가 알아서 고른다(보통 WebSocket).
  //   'longpoll' WebSocket 이 막힌 망에서 쓴다. 평범한 https 요청만으로 붙는다.
  const TRANSPORT_KEY = 'rwTransport';

  function splitTransport(firebaseConfig) {
    const cfg = Object.assign({}, firebaseConfig || {});
    const transport = cfg[TRANSPORT_KEY] || 'auto';
    delete cfg[TRANSPORT_KEY];        // initializeApp 에 넘기면 안 되는 우리 값
    return { cfg, transport };
  }

  // 최초 1회만 초기화. 이후 호출은 같은 Promise 를 돌려준다.
  function init(firebaseConfig) {
    if (readyPromise) return readyPromise;
    const { cfg: appConfig, transport } = splitTransport(firebaseConfig);
    readyPromise = (async () => {
      const [appMod, authMod, dbMod] = await Promise.all([
        import(CDN + 'firebase-app.js'),
        import(CDN + 'firebase-auth.js'),
        import(CDN + 'firebase-database.js')
      ]);
      // 이미 만들어져 있으면 다시 만들지 않는다(재초기화 시 duplicate-app 방지).
      const app = (appMod.getApps && appMod.getApps().length)
        ? appMod.getApp() : appMod.initializeApp(appConfig);
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

      // 반드시 getDatabase() 앞에서 정해야 한다. 연결이 만들어진 뒤에는 못 바꾼다.
      const canLongPoll = typeof dbMod.forceLongPolling === 'function';
      if (transport === 'longpoll' && canLongPoll) dbMod.forceLongPolling();

      const db = dbMod.getDatabase(app);
      return { app, auth, db, dbMod, authMod, uid, transport, canLongPoll };
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

  // ---- 연결 진단 ----------------------------------------------------------
  //
  // "서버에 연결되지 않았어요" 한 줄로는 무엇이 문제인지 알 수 없다. 원인이 최소 네 가지다:
  //   (1) SDK 를 못 받아옴  (2) 익명 로그인 실패  (3) 그 주소에 DB 가 없음
  //   (4) DB 는 있는데 실시간 소켓(wss)만 막힘
  // (3)과 (4)는 증상이 똑같지만 해야 할 일이 완전히 다르다. 그래서 **REST 로 먼저 찔러 본다.**
  // REST 는 평범한 https 요청이라, 이게 되면 주소는 맞고 남은 문제는 소켓뿐이다.

  const DB_PROBE_MS = 8000;

  // 이 주소에 실제로 데이터베이스가 있는가.
  //   exists  : 응답이 왔다(권한 거부여도 DB 는 있는 것이다)
  //   missing : 주소는 살아 있는데 그런 DB 가 없다
  //   unreachable : 응답 자체가 없다(주소가 틀렸거나 네트워크가 막힘)
  async function probeDatabase(url) {
    const base = String(url || '').replace(/\/+$/, '');
    if (!base) return { state: 'unreachable', detail: 'databaseURL 이 비어 있음' };
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctrl && ctrl.abort(), DB_PROBE_MS);
    try {
      const res = await fetch(base + '/.json?shallow=true', ctrl ? { signal: ctrl.signal } : {});
      const body = await res.text().catch(() => '');
      // 404 + "does not exist" 는 프로젝트는 있는데 그 인스턴스가 없는 경우다.
      if (res.status === 404 || /does not exist|not found/i.test(body)) {
        return { state: 'missing', status: res.status, detail: body.slice(0, 200) };
      }
      // 401/403 은 **연결이 됐다는 증거**다. 규칙이 막았을 뿐 주소는 맞다.
      return { state: 'exists', status: res.status, detail: body.slice(0, 200) };
    } catch (e) {
      return { state: 'unreachable', detail: (e && e.name === 'AbortError') ? '시간 초과' : String(e && e.message || e) };
    } finally {
      clearTimeout(timer);
    }
  }

  // 설정된 주소가 죽어 있으면, 리전별 기본 주소를 차례로 찔러 살아 있는 것을 찾는다.
  // (RTDB 를 미국 밖에 만들면 주소 형식 자체가 달라진다. 이 값이 틀리면 인증은 되는데
  //  DB 만 영영 연결되지 않는다 — 지금 증상과 정확히 같다.)
  function candidateURLs(projectId, configured) {
    const pid = String(projectId || '').trim();
    const list = [];
    if (configured) list.push(configured);
    if (pid) {
      for (const u of [
        `https://${pid}-default-rtdb.firebaseio.com`,
        `https://${pid}-default-rtdb.asia-southeast1.firebasedatabase.app`,
        `https://${pid}-default-rtdb.europe-west1.firebasedatabase.app`
      ]) if (list.indexOf(u) < 0) list.push(u);
    }
    return list;
  }

  async function findDatabaseURL(projectId, configured) {
    for (const url of candidateURLs(projectId, configured)) {
      const r = await probeDatabase(url);
      if (r.state === 'exists') return { url, probe: r };
    }
    return null;
  }

  // 순서대로 확인하고, 각 단계의 결과를 그대로 돌려준다.
  // 화면은 이걸 사람이 읽을 문장으로 바꿔 보여 준다.
  async function diagnose(firebaseConfig) {
    const cfg = firebaseConfig || {};
    const steps = [];
    const push = (name, ok, detail) => steps.push({ name, ok, detail });

    let fb = null;
    try {
      fb = await init(cfg);
      push('Firebase SDK · 익명 로그인', true, '사용자 ID ' + fb.uid);
    } catch (e) {
      push('Firebase SDK · 익명 로그인', false, (e && e.message) || String(e));
      return { steps, cause: 'auth', working: null };
    }

    const probe = await probeDatabase(cfg.databaseURL);
    push('데이터베이스 주소 확인', probe.state === 'exists',
         probe.state === 'exists' ? ('응답 ' + probe.status + ' — 이 주소에 DB 가 있습니다')
       : probe.state === 'missing' ? ('응답 ' + probe.status + ' — 이 주소에 DB 가 없습니다')
       : ('응답 없음 — ' + probe.detail));

    if (probe.state !== 'exists') {
      // 다른 리전에 있는지 찾아본다.
      const found = await findDatabaseURL(cfg.projectId, null);
      if (found) {
        push('다른 리전에서 발견', true, found.url);
        return { steps, cause: 'wrong-url', working: found.url };
      }
      push('다른 리전 탐색', false, '어느 리전에서도 찾지 못했습니다');
      return { steps, cause: 'no-database', working: null };
    }

    // 주소는 살아 있다. 남은 것은 실시간 연결뿐이다.
    //
    // 연결하는 동안 **CSP 위반을 같이 듣는다.** 앱 자신의 보안 설정이 막은 것과
    // 바깥 네트워크가 막은 것은 증상이 같은데, 전자는 우리 버그다.
    // (실제로 롱폴링은 <script> 주입으로 동작해서 connect-src 가 아니라 script-src 를
    //  받는데, 그게 빠져 있어서 "망이 막았다"고 잘못 안내한 적이 있다.)
    const violations = [];
    const onCsp = (e) => violations.push(e.violatedDirective + ' ← ' + String(e.blockedURI || '').slice(0, 80));
    const canListen = typeof document !== 'undefined' && document.addEventListener;
    if (canListen) document.addEventListener('securitypolicyviolation', onCsp);

    const now = fb.transport === 'longpoll' ? '롱폴링' : 'WebSocket';
    try {
      await waitConnected(8000);
      push('실시간 연결(' + now + ')', true, '연결됨');
      return { steps, cause: null, working: cfg.databaseURL, transport: fb.transport };
    } catch (e) {
      push('실시간 연결(' + now + ')', false, (e && e.message) || String(e));

      if (violations.length) {
        push('앱의 보안 설정(CSP)', false, violations.join(' / '));
        return { steps, cause: 'csp', working: cfg.databaseURL, violations };
      }
      // REST 는 되는데 소켓만 안 된다 = 이 망이 WebSocket 을 막는다.
      // RTDB 는 롱폴링으로도 붙을 수 있다. 롱폴링은 평범한 https 라 이미 통하는 길이다.
      if (fb.transport !== 'longpoll' && fb.canLongPoll) {
        return { steps, cause: 'socket', working: cfg.databaseURL, canLongPoll: true };
      }
      push('롱폴링 전환 가능 여부', false,
           fb.canLongPoll ? '이미 롱폴링인데도 연결되지 않았습니다' : '이 SDK 버전은 롱폴링 전환을 지원하지 않습니다');
      return { steps, cause: 'socket-final', working: cfg.databaseURL, canLongPoll: false };
    } finally {
      if (canListen) document.removeEventListener('securitypolicyviolation', onCsp);
    }
  }

  // 테스트/재초기화용
  function reset() { readyPromise = null; storagePromise = null; }

  RW.fb = { init, storage, waitConnected, onConnected, reset,
            diagnose, probeDatabase, findDatabaseURL, candidateURLs };
})(typeof window !== 'undefined' ? window : globalThis);
