'use strict';
/* 오버레이 로직.
 *  - 상대 캐릭터를 상주시키고, 신호가 오면 라이브 재생한다.
 *  - 신호가 없을 땐 자율 생활(멍때리기/돌아다니기)을 로컬에서 반복한다.
 *  - 캐릭터 위에서만 클릭을 받는다(그 외 영역은 클릭 통과).
 *    클릭=리모컨 / 드래그=이동 / 모서리 핸들·휠=크기 / 우클릭=메뉴.
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

  // 상태: 'ambient' | 'gesture'
  let state = 'ambient';
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
    startAmbient();
  }

  // ---- 위치 · 크기 ----
  function positionChar() {
    const pos = (cfg && cfg.overlayPos) || { x: 0.82, y: 0.72 };
    charEl.style.left = `calc(${clamp01(pos.x) * 100}% - 60px)`;
    charEl.style.top = `calc(${clamp01(pos.y) * 100}% - 120px)`;
    applyScale();
  }

  // 크기 배율. 발밑(#char 기준 60,206)을 기준으로 키워 바닥에 선 채로 커지게 한다.
  // #char 자체에 transform 을 걸면 getBoundingClientRect 도 같이 커져 드래그 히트박스가 맞는다.
  function applyScale() {
    const s = charScale();
    charEl.style.transformOrigin = '60px 206px';
    charEl.style.transform = `scale(${s})`;
  }
  function charScale() {
    const s = Number(cfg && cfg.overlayScale);
    return isFinite(s) && s > 0 ? Math.max(0.4, Math.min(2.5, s)) : 1;
  }
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  // ---- 자율 생활 ----
  function startAmbient() {
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
    ctrl.play(gid, { onDone: startAmbient });
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

  // ---- 캐릭터 조작 ----
  //   짧게 클릭        → 리모컨 열기
  //   드래그           → 위치 이동
  //   모서리 핸들 드래그 → 크기 조절   (마우스를 올리면 나타난다)
  //   휠 스크롤        → 크기 조절   (더 빠른 길)
  //   우클릭           → 메뉴(리모컨·설정·숨기기·종료)
  //
  // 예전엔 "꾹 누르면 크기 조절"이었는데, 눌러 보기 전에는 알 수 없어서 발견이 불가능했다.
  // 보이는 핸들과 휠로 바꿨다.
  let wheelSaveTimer = null;
  const CLICK_SLOP = 5;      // 이 거리 이내로 움직였다 떼면 "클릭"
  const RESIZE_RANGE = 160;  // 핸들을 이만큼 끌면 배율이 약 2배/절반

  function setupDrag() {
    let hovering = false;
    let dragging = false;
    let moved = false;
    let resizing = false;
    let startScale = 1;
    let startX = 0, startY = 0, baseLeft = 0, baseTop = 0;

    // 크기 조절 핸들 — hover 시에만 보인다.
    const handle = document.createElement('div');
    handle.id = 'sizeHandle';
    handle.title = '드래그해서 크기 조절 (휠로도 가능)';
    charEl.appendChild(handle);

    handle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      dragging = true; resizing = true; moved = true;
      host.setOverlayInteractive(true);
      startX = e.clientX; startY = e.clientY;
      startScale = charScale();
      charEl.classList.add('resizing');
    });

    // 휠로도 크기 조절
    charEl.addEventListener('wheel', (e) => {
      e.preventDefault();
      const next = Math.max(0.4, Math.min(2.5, charScale() * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
      cfg.overlayScale = next;
      applyScale();
      clearTimeout(wheelSaveTimer);
      wheelSaveTimer = setTimeout(() => host.setConfig({ overlayScale: charScale() }), 400);
    }, { passive: false });

    // 우클릭 메뉴
    charEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      host.setOverlayInteractive(true);
      host.overlayContextMenu();
    });

    function charRect() { return charEl.getBoundingClientRect(); }
    function inside(x, y) {
      const r = charRect();
      // 실제 그림 영역에 가깝게 살짝 안쪽으로. 크기 배율에 비례해 인셋도 커진다.
      const s = charScale();
      const ix = 20 * s, iy = 10 * s;
      return x >= r.left + ix && x <= r.right - ix && y >= r.top + iy && y <= r.bottom - iy;
    }

    document.addEventListener('mousemove', (e) => {
      if (dragging) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (resizing) {
          // 핸들을 아래/오른쪽으로 끌면 커진다(창 크기 조절과 같은 감각).
          const k = 1 + ((e.clientY - startY) + (e.clientX - startX)) / (RESIZE_RANGE * 2);
          cfg.overlayScale = Math.max(0.4, Math.min(2.5, startScale * k));
          applyScale();
          return;
        }

        if (Math.abs(dx) > CLICK_SLOP || Math.abs(dy) > CLICK_SLOP) {
          moved = true;
          charEl.classList.add('grabbing');
        }
        // 레이아웃 좌표(offset)에 더한다. transform(scale) 이 걸려 있어도 정확하다.
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
      if (e.button !== 0) return;              // 좌클릭만
      dragging = true;
      moved = false;
      resizing = false;
      host.setOverlayInteractive(true);
      startX = e.clientX; startY = e.clientY;
      baseLeft = charEl.offsetLeft; baseTop = charEl.offsetTop;
      startScale = charScale();
      e.preventDefault();
    });

    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      charEl.classList.remove('grabbing', 'resizing');

      if (resizing) {
        resizing = false;
        host.setConfig({ overlayScale: charScale() });
        return;
      }
      if (!moved) {
        // 끌지 않고 톡 눌렀다 뗀 것 → 리모컨 열기
        host.openRemote();
        return;
      }
      // 위치를 화면 비율로 저장(펠비스 기준점, 레이아웃 좌표 기준)
      const x = (charEl.offsetLeft + 60) / window.innerWidth;
      const y = (charEl.offsetTop + 120) / window.innerHeight;
      host.setConfig({ overlayPos: { x: clamp01(x), y: clamp01(y) } });
    });
  }

  main();
})();
