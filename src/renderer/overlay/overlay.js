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
  let ctrl = null;              // 재생기(스프라이트 또는 리그)
  let actor = null;             // 상태 제어 + 이동

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
      applyCharDef({ kind: 'local', id: cfg.partnerCharacterId || 'char_ribbon' });
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
    // 번들(사용자 업로드)은 클립이 없으므로 항상 리그로 간다.
    buildFromRig(rigInput, def.kind === 'bundle' ? null : def.id);
  }

  // 캐릭터 상자 — 리그마다 다르다(몸통·다리 길이가 제각각).
  // 드래그 히트박스(#char)와 골반 위치, 발밑 기준점을 전부 이 값으로 맞춘다.
  // 예전엔 120×210 에 골반 (60,120) 으로 고정돼 있어서, 다른 체형을 올리면
  // 캐릭터가 히트박스 밖으로 삐져나가 클릭·드래그가 빗나갔다.
  const DEFAULT_BOX = { w: 120, h: 210, originX: 60, originY: 120, groundY: 86 };
  let charBox = DEFAULT_BOX;

  const FALLBACK_CHAR = 'char_seal';

  function buildFromRig(spec, charId) {
    if (actor) actor.stop();
    if (ctrl && ctrl.destroy) ctrl.destroy();
    anchorEl.innerHTML = '';
    // 스프라이트 클립이 있으면 클립으로, 없으면 기존 5조각 리그로 자동 폴백된다.
    ctrl = RW.player.create(anchorEl, charId, spec);

    // **아무것도 안 그려졌으면 기본 캐릭터로 되돌린다.**
    // 슬롯이 비었거나 깨진 번들이면 조각이 0개가 되어 화면에 아무것도 안 남는다.
    // 사용자에게는 "앱이 안 켜졌다" 와 구분이 안 되므로, 빈 화면을 두지 않는다.
    if (!anchorEl.querySelector('.rw-part, .rw-sprite') && charId !== FALLBACK_CHAR) {
      console.warn('[overlay] 캐릭터가 비어 있어 기본 캐릭터로 대체합니다:', charId);
      if (ctrl && ctrl.destroy) ctrl.destroy();
      anchorEl.innerHTML = '';
      spec = RW.characters.rigFor(FALLBACK_CHAR, cfg);
      charId = FALLBACK_CHAR;
      ctrl = RW.player.create(anchorEl, charId, spec);
    }

    const b = ctrl.box || (spec.skeleton && spec.skeleton.box) || {};
    charBox = {
      w: b.w != null ? b.w : DEFAULT_BOX.w,
      h: b.h != null ? b.h : DEFAULT_BOX.h,
      originX: b.originX != null ? b.originX : DEFAULT_BOX.originX,
      originY: b.originY != null ? b.originY : DEFAULT_BOX.originY,
      groundY: b.groundY != null ? b.groundY : DEFAULT_BOX.groundY
    };
    charEl.style.width = charBox.w + 'px';
    charEl.style.height = charBox.h + 'px';
    anchorEl.style.left = charBox.originX + 'px';
    anchorEl.style.top = charBox.originY + 'px';
    positionChar();

    // 상태 제어와 이동은 배우가 맡는다. 여기(화면)는 좌표를 받아 놓기만 한다.
    actor = RW.actor.create({
      player: ctrl,
      isPaused: () => !!(cfg && cfg.focusMode),
      onMove(ox, oy) { roamX = ox; roamY = oy; positionChar(); }
    });
    actor.start();
  }

  // ---- 위치 · 크기 ----
  // overlayPos 는 "골반이 놓일 화면 비율" 이다(예전 저장값과 그대로 호환된다).
  // 배율(transform: scale)의 기준점은 applyScale() 이 정한 (originX, originY+groundY) 다.
  // 그래서 **화면에 실제로 그려지는 상자**는 style.left/top 과 다르다.
  //   그려진 좌표 = left + originPoint * (1 - s),  그려진 크기 = 상자 * s
  // 이 관계를 무시하고 계산하면 배율을 키울수록 캐릭터가 저장한 자리에서 밀려난다.
  function renderGeom(x, y, s) {
    const ox = charBox.originX, oy = charBox.originY + charBox.groundY;
    return {
      left: x + ox * (1 - s), top: y + oy * (1 - s),
      w: charBox.w * s, h: charBox.h * s
    };
  }

  function positionChar() {
    const pos = (cfg && cfg.overlayPos) || { x: 0.82, y: 0.72 };
    const W = window.innerWidth, H = window.innerHeight;
    const s = charScale();

    // 저장된 위치는 "골반이 놓일 자리" 다. 가로 기준점은 originX 라 배율과 무관하고,
    // 세로는 기준점이 발밑(originY+groundY)이라 배율에 따라 groundY 만큼 보정된다.
    let x = clamp01(pos.x) * W - charBox.originX + Math.round(roamX);
    let y = clamp01(pos.y) * H - charBox.originY - charBox.groundY * (1 - s) + Math.round(roamY);

    // **캐릭터가 화면 밖으로 나가지 않게 붙잡는다.**
    // 비율(0~1)만 제한하면 부족하다 — 0,0 이어도 기준점이 발밑·골반이라 캐릭터 몸은
    // 화면 위/왼쪽으로 밀려 나간다. 실제로 overlayPos 가 0,0 이면 (-100,-192) 에 그려져
    // 사용자는 "캐릭터가 사라졌다"고 느낀다. 모니터 구성이 바뀌어도 마찬가지다.
    // 붙잡을 대상은 style 값이 아니라 **그려진 상자**여야 한다.
    const M = 4;
    const g = renderGeom(x, y, s);
    const dx = Math.max(M, Math.min(g.left, Math.max(M, W - g.w - M))) - g.left;
    const dy = Math.max(M, Math.min(g.top, Math.max(M, H - g.h - M))) - g.top;

    charEl.style.left = Math.round(x + dx) + 'px';
    charEl.style.top = Math.round(y + dy) + 'px';
    applyScale();
  }

  // 크기 배율. 발밑을 기준으로 키워 바닥에 선 채로 커지게 한다.
  // #char 자체에 transform 을 걸면 getBoundingClientRect 도 같이 커져 드래그 히트박스가 맞는다.
  function applyScale() {
    const s = charScale();
    charEl.style.transformOrigin = `${charBox.originX}px ${charBox.originY + charBox.groundY}px`;
    charEl.style.transform = `scale(${s})`;
  }
  function charScale() {
    const s = Number(cfg && cfg.overlayScale);
    return isFinite(s) && s > 0 ? Math.max(0.4, Math.min(2.5, s)) : 1;
  }
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  // ---- 자율 생활 · 배회 ----
  // 상태 전환(대기↔걷기)과 좌표 이동은 actor.js 가 담당한다.
  // 여기서는 actor 가 알려 준 오프셋을 화면 위치에 반영만 한다.
  //
  // 예전에는 wander 클립이 스스로 좌우로 왕복하고 roam() 이 기준 위치를 순간이동시켜,
  // 두 이동이 겹쳐 있었다. 지금은 클립이 제자리걸음이고 좌표는 한 곳에서만 바뀐다.
  let roamX = 0, roamY = 0;

  // ---- 신호 처리 ----
  function onSignal(sig) {
    if (!sig || sig.mine) return;            // 내가 보낸 건 여기서 재생 안 함
    if (!sig.live) return;                   // 과거 신호는 히스토리에서만
    if (cfg.focusMode) return;               // 집중 모드: 라이브 재생 안 함
    if (!RW.gestures.isActive(sig.gestureId)) return;
    playGesture(sig.gestureId);
  }

  function playGesture(gid) {
    if (actor) actor.playGesture(gid);
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
        applyCharDef({ kind: 'local', id: next.partnerCharacterId || 'char_ribbon' });
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
      // 직접 옮긴 자리가 새 "집"이 된다. 배회 누적분은 0으로 되돌린다.
      //
      // positionChar() 의 역산이어야 한다. 예전엔 60/120 이 박혀 있어서, 캐릭터 상자가
      // 다른 체형(그리고 배율)이면 저장값이 원래 자리와 어긋났다 — 끌어다 놓을 때마다
      // 캐릭터가 왼쪽 위로 조금씩 튀었고, 반복하면 화면 밖으로 나갔다.
      const s = charScale();
      const x = (charEl.offsetLeft + charBox.originX) / window.innerWidth;
      const y = (charEl.offsetTop + charBox.originY + charBox.groundY * (1 - s)) / window.innerHeight;
      roamX = 0; roamY = 0;
      if (actor) actor.resetPosition();
      host.setConfig({ overlayPos: { x: clamp01(x), y: clamp01(y) } });
    });
  }

  main();
})();
