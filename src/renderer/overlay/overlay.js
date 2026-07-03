'use strict';
/* 오버레이 로직.
 *  - 상대 캐릭터를 상주시키고, 신호가 오면 라이브 재생한다.
 *  - 신호가 없을 땐 자율 생활(멍때리기/돌아다니기)을 로컬에서 반복한다.
 *  - 자리비우기(사라짐) 후 다른 신호가 오면 걸어 들어오며 복귀한다.
 *  - 캐릭터 위에서만 클릭을 받아 드래그로 위치를 옮긴다(그 외 영역은 클릭 통과).
 *  - 집중 모드면 라이브 재생하지 않는다(히스토리는 별도).
 */

(function () {
  const RW = window.RW;
  const host = window.rwHost;

  const charEl = document.getElementById('char');
  const anchorEl = charEl.querySelector('.rw-anchor');

  let cfg = null;
  let transport = null;
  let ctrl = null;              // 엔진 컨트롤러

  // 상태: 'ambient' | 'gesture' | 'away'
  let state = 'ambient';
  let away = false;
  let ambientTimer = null;

  // ---- 초기화 ----
  async function main() {
    cfg = await host.getConfig();
    transport = RW.transport.createTransport(cfg);

    positionChar();
    window.addEventListener('resize', positionChar);

    await transport.ready.catch((e) => console.error('[overlay] transport', e));

    // 상대 캐릭터 결정: 프리셋 id 또는 다운로드한 커스텀 번들
    try {
      applyCharDef(await transport.getPartnerCharacter());
    } catch (_) {
      applyCharDef({ kind: 'local', id: cfg.partnerCharacterId || 'preset2' });
    }
    // 자율 생활은 buildFromRig() 안에서 시작된다.

    transport.onSignal(onSignal);
    // 상대가 캐릭터를 바꾸면 실시간 교체(Firebase)
    if (transport.onPartnerCharacter) transport.onPartnerCharacter(applyCharDef);
    host.onConfigChanged(onConfigChanged);
    setupDrag();
  }

  // 정규화된 캐릭터 정의 → 렌더. kind: 'bundle'(커스텀) | 'preset' | 'local'
  let lastCharSig = null;
  function applyCharDef(def) {
    if (!def) return;
    // 실제로 바뀐 경우에만 다시 그린다(멤버 감시가 자주 울려도 재빌드 방지)
    const sig = def.kind === 'bundle'
      ? 'bundle:' + JSON.stringify(def.bundle).length + ':' + (def.id || '')
      : (def.kind || 'preset') + ':' + def.id;
    if (sig === lastCharSig) return;
    lastCharSig = sig;

    const rigInput = def.kind === 'bundle'
      ? RW.characters.bundleToRig(def.bundle)
      : RW.characters.rigFor(def.id, cfg);
    buildFromRig(rigInput);
  }

  function buildFromRig({ skeleton, rig }) {
    if (ctrl) ctrl.stop();
    anchorEl.innerHTML = '';
    ctrl = RW.engine.mount(anchorEl, { skeleton, rig });
    if (state !== 'away') startAmbient();
  }

  // ---- 위치 ----
  function positionChar() {
    const pos = (cfg && cfg.overlayPos) || { x: 0.82, y: 0.72 };
    charEl.style.left = `calc(${clamp01(pos.x) * 100}% - 60px)`;
    charEl.style.top = `calc(${clamp01(pos.y) * 100}% - 120px)`;
  }
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  // ---- 자율 생활 ----
  function startAmbient() {
    if (state === 'away') return;
    state = 'ambient';
    scheduleAmbient(true);
  }
  function scheduleAmbient(now) {
    clearTimeout(ambientTimer);
    const play = () => {
      if (state !== 'ambient') return;
      const id = Math.random() < 0.55 ? 'idle' : 'wander';
      ctrl.play(id);
      ambientTimer = setTimeout(play, 4000 + Math.random() * 8000);
    };
    if (now) play();
    else ambientTimer = setTimeout(play, 2000 + Math.random() * 4000);
  }

  // ---- 신호 처리 ----
  function onSignal(sig) {
    if (!sig || sig.mine) return;            // 내가 보낸 건 여기서 재생 안 함
    if (!sig.live) return;                   // 과거 신호는 히스토리에서만
    if (cfg.focusMode) return;               // 집중 모드: 라이브 재생 안 함
    if (!RW.gestures.isActive(sig.gestureId)) return;
    playGesture(sig.gestureId);
  }

  function playGesture(gid) {
    clearTimeout(ambientTimer);
    state = 'gesture';

    const isLeave = gid === 'g5_leave';
    const seq = (away && !isLeave) ? ['walk_in', gid] : [gid];

    ctrl.play(seq, {
      onDone: () => {
        if (isLeave) {
          away = true;
          state = 'away';           // 사라진 채 대기 (복귀는 다음 신호가 트리거)
          return;
        }
        away = false;
        startAmbient();
      }
    });
    if (!isLeave) away = false;
  }

  // ---- 설정 변경 반영 ----
  async function onConfigChanged(next) {
    const prevPartner = cfg.partnerCharacterId;
    const prevCustoms = JSON.stringify(cfg.customCharacters || []);
    cfg = next;
    positionChar();
    // 로컬 데모에서만: 상대 캐릭터는 config 로 지정되므로 변경 시 다시 그림.
    // (Firebase 모드의 상대 캐릭터는 members 감시(onPartnerCharacter)로 반영된다.)
    if (transport.mode === 'local') {
      const customsChanged = JSON.stringify(next.customCharacters || []) !== prevCustoms;
      if ((next.partnerCharacterId && next.partnerCharacterId !== prevPartner) || customsChanged) {
        lastCharSig = null; // 번들 편집 등으로 같은 id라도 강제 재빌드
        applyCharDef({ kind: 'local', id: next.partnerCharacterId || 'preset2' });
      }
    }
  }

  // ---- 드래그 이동 (+ 캐릭터 위에서만 클릭 받기) ----
  function setupDrag() {
    let hovering = false;
    let dragging = false;
    let startX = 0, startY = 0, baseLeft = 0, baseTop = 0;

    function charRect() { return charEl.getBoundingClientRect(); }
    function inside(x, y) {
      const r = charRect();
      // 실제 그림 영역에 가깝게 살짝 안쪽으로 히트박스
      return x >= r.left + 20 && x <= r.right - 20 && y >= r.top + 10 && y <= r.bottom - 10;
    }

    document.addEventListener('mousemove', (e) => {
      if (dragging) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        charEl.style.left = (baseLeft + dx) + 'px';
        charEl.style.top = (baseTop + dy) + 'px';
        return;
      }
      const nowInside = inside(e.clientX, e.clientY);
      if (nowInside !== hovering) {
        hovering = nowInside;
        charEl.classList.toggle('grabbable', hovering);
        host.setOverlayInteractive(hovering);   // 캐릭터 밖은 다시 클릭 통과
      }
    });

    charEl.addEventListener('mousedown', (e) => {
      dragging = true;
      charEl.classList.add('grabbing');
      host.setOverlayInteractive(true);
      const r = charRect();
      startX = e.clientX; startY = e.clientY;
      baseLeft = r.left; baseTop = r.top;
      e.preventDefault();
    });

    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      charEl.classList.remove('grabbing');
      // 위치를 화면 비율로 저장(펠비스 기준점)
      const r = charRect();
      const x = (r.left + 60) / window.innerWidth;
      const y = (r.top + 120) / window.innerHeight;
      host.setConfig({ overlayPos: { x: clamp01(x), y: clamp01(y) } });
    });
  }

  main();
})();
