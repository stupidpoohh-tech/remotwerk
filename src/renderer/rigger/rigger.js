'use strict';
/* 리깅·업로드 도구 (Prompt B).
 *  - 大자(spread) 가이드에 맞춰 부위별 투명 PNG 5장을 정합(크기·위치·회전·z).
 *  - 자유 분할/관절 찍기 없음. 관절(어깨·골반)은 가이드에 고정.
 *  - 코어 애니메이션(능동8+자율2)을 그대로 재생해 검증(5절 근사 처리 반영).
 *  - 저장: 프리셋과 동일 포맷(부위 이미지 + 리그 JSON) 번들 → config + (Firebase면) Storage 공유.
 */

(function () {
  const RW = window.RW;
  const host = window.rwHost;

  const S = 2;                       // 스테이지 확대 배율(#scaled 의 scale 과 동일)
  const MAX_SIDE = 512;              // 업로드 이미지 다운스케일 한 변 최대
  const MAX_TOTAL = 2 * 1024 * 1024; // 번들 총용량 상한(약 2MB)

  const LABELS = { torso: '몸통+머리', armL: '좌팔', armR: '우팔', legL: '좌다리', legR: '우다리' };

  const skeleton = RW.skeleton.getSkeleton('bipedal5');
  const slotBones = skeleton.bones.filter((b) => b.part);   // 5조각
  const absPivot = computeAbsPivots(skeleton);

  let cfg = null;
  let ctrl = null;
  let selected = 'torso';
  const state = {};                  // slot → { image, natW, natH, scale, offx, offy, rot, z, base }

  for (const b of slotBones) {
    state[b.part.slot] = {
      image: null, natW: 0, natH: 0,
      scale: 1, offx: 0, offy: 0,
      rot: b.guideRot || 0,
      z: b.z,
      base: { x: b.part.x, y: b.part.y, w: b.part.w, h: b.part.h }
    };
  }

  async function main() {
    cfg = await host.getConfig();
    drawGuide();
    buildPanel();
    render();
    document.getElementById('previewBtn').addEventListener('click', preview);
    document.getElementById('saveBtn').addEventListener('click', save);
    setupDrag();
  }

  // ---- 절대 관절 좌표(펠비스 원점) ----
  function computeAbsPivots(sk) {
    const byName = {}; sk.bones.forEach((b) => (byName[b.name] = b));
    const abs = {};
    function pivot(name) {
      if (abs[name]) return abs[name];
      const b = byName[name];
      if (!b.parent) return (abs[name] = { x: 0, y: 0 });
      const p = pivot(b.parent);
      return (abs[name] = { x: p.x + b.pivotOffset[0], y: p.y + b.pivotOffset[1] });
    }
    sk.bones.forEach((b) => pivot(b.name));
    return abs;
  }

  // ---- 大자 가이드 그리기(SVG) ----
  function drawGuide() {
    const svg = document.getElementById('guide');
    const NS = 'http://www.w3.org/2000/svg';
    svg.innerHTML = '';
    for (const b of slotBones) {
      const slot = b.part.slot;
      const pv = absPivot[b.name];
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('transform', `translate(${pv.x} ${pv.y}) rotate(${b.guideRot || 0})`);

      const rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('x', b.part.x); rect.setAttribute('y', b.part.y);
      rect.setAttribute('width', b.part.w); rect.setAttribute('height', b.part.h);
      rect.setAttribute('rx', '6');
      rect.setAttribute('fill', 'rgba(138,99,255,0.06)');
      rect.setAttribute('stroke', 'rgba(138,99,255,0.55)');
      rect.setAttribute('stroke-width', '1');
      rect.setAttribute('stroke-dasharray', '4 3');
      g.appendChild(rect);

      const dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('r', '3'); dot.setAttribute('fill', '#8a63ff');
      g.appendChild(dot);

      const label = document.createElementNS(NS, 'text');
      label.setAttribute('x', b.part.x + 2); label.setAttribute('y', b.part.y + 12);
      label.setAttribute('font-size', '9'); label.setAttribute('fill', 'rgba(90,70,180,.8)');
      label.textContent = LABELS[slot];
      g.appendChild(label);

      svg.appendChild(g);
    }
  }

  // ---- 오른쪽 패널(슬롯 카드) ----
  function buildPanel() {
    const host = document.getElementById('slots');
    host.innerHTML = '';
    for (const b of slotBones) {
      const slot = b.part.slot;
      const card = document.createElement('div');
      card.className = 'slot';
      card.dataset.slot = slot;
      card.innerHTML = `
        <div class="slot-head">
          <span class="slot-name empty">${LABELS[slot]}</span>
          <label class="upload">이미지 올리기<input type="file" accept="image/png,image/*"></label>
        </div>
        <div class="controls">
          <div class="ctl"><label>크기</label><input type="range" class="scale" min="30" max="250" value="100"></div>
          <div class="ctl"><label>회전</label><input type="range" class="rot" min="-180" max="180" value="${b.guideRot || 0}"></div>
          <div class="zbtns"><button class="zup">앞으로</button><button class="zdown">뒤로</button></div>
        </div>`;
      card.addEventListener('click', () => selectSlot(slot));
      card.querySelector('input[type=file]').addEventListener('change', (e) => onUpload(slot, e.target.files[0]));
      card.querySelector('.scale').addEventListener('input', (e) => { state[slot].scale = +e.target.value / 100; render(); });
      card.querySelector('.rot').addEventListener('input', (e) => { state[slot].rot = +e.target.value; render(); });
      card.querySelector('.zup').addEventListener('click', (e) => { e.stopPropagation(); state[slot].z += 1; render(); });
      card.querySelector('.zdown').addEventListener('click', (e) => { e.stopPropagation(); state[slot].z -= 1; render(); });
      host.appendChild(card);
    }
    selectSlot(selected);
  }

  function selectSlot(slot) {
    selected = slot;
    document.querySelectorAll('.slot').forEach((c) => c.classList.toggle('selected', c.dataset.slot === slot));
  }

  // ---- 업로드 + 다운스케일 ----
  function onUpload(slot, file) {
    if (!file) return;
    loadDownscaled(file, MAX_SIDE).then(({ dataUrl, w, h }) => {
      const s = state[slot];
      s.image = dataUrl; s.natW = w; s.natH = h;
      // 새 이미지: 정합값 초기화(가이드 각도로)
      s.scale = 1; s.offx = 0; s.offy = 0; s.rot = (slotBoneOf(slot).guideRot || 0);
      const card = document.querySelector(`.slot[data-slot="${slot}"]`);
      card.classList.add('filled');
      card.querySelector('.slot-name').className = 'slot-name filled';
      card.querySelector('.scale').value = 100;
      card.querySelector('.rot').value = s.rot;
      selectSlot(slot);
      render();
    }).catch((e) => setStatus('이미지를 불러오지 못했어요: ' + e.message));
  }

  function slotBoneOf(slot) { return slotBones.find((b) => b.part.slot === slot); }

  function loadDownscaled(file, max) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        let { width: w, height: h } = img;
        const k = Math.min(1, max / Math.max(w, h));
        w = Math.round(w * k); h = Math.round(h * k);
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve({ dataUrl: cv.toDataURL('image/png'), w, h });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode 실패')); };
      img.src = url;
    });
  }

  // ---- 상태 → 리그 번들 ----
  function fitOf(s) {
    return {
      x: s.base.x * s.scale + s.offx,
      y: s.base.y * s.scale + s.offy,
      w: s.base.w * s.scale,
      h: s.base.h * s.scale,
      rot: s.rot
    };
  }
  function buildBundle() {
    const slots = {};
    for (const b of slotBones) {
      const slot = b.part.slot;
      const s = state[slot];
      if (s.image) slots[slot] = { image: s.image, fit: fitOf(s), z: s.z };
    }
    return { skeletonId: 'bipedal5', slots };
  }

  // ---- 렌더 ----
  let renderQueued = false;
  function render() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      if (ctrl) ctrl.stop();
      const anchor = document.getElementById('charAnchor');
      anchor.innerHTML = '';
      ctrl = RW.engine.mount(anchor, RW.characters.bundleToRig(buildBundle()));
      updateSize();
    });
  }

  function updateSize() {
    let bytes = 0;
    for (const slot of Object.keys(state)) {
      const im = state[slot].image;
      if (im) bytes += Math.floor(im.length * 0.75);
    }
    const kb = Math.round(bytes / 1024);
    const info = document.getElementById('sizeInfo');
    info.textContent = `번들 크기 ≈ ${kb} KB`;
    info.style.color = bytes > MAX_TOTAL ? '#c0392b' : '';
  }

  // ---- 드래그로 위치 정합 ----
  function setupDrag() {
    const stage = document.getElementById('stage');
    let dragging = false, lastX = 0, lastY = 0;
    stage.addEventListener('mousedown', (e) => {
      const s = state[selected];
      if (!s || !s.image) return;
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const s = state[selected];
      const dx = (e.clientX - lastX) / S;   // 스테이지(스케일) → 스켈레톤 px
      const dy = (e.clientY - lastY) / S;
      lastX = e.clientX; lastY = e.clientY;
      // 파트는 pivot 기준 rot 만큼 회전되어 그려지므로, 화면 이동을 -rot 로 회전해 로컬 이동으로 변환
      const r = -s.rot * Math.PI / 180;
      s.offx += dx * Math.cos(r) - dy * Math.sin(r);
      s.offy += dx * Math.sin(r) + dy * Math.cos(r);
      render();
    });
    window.addEventListener('mouseup', () => { dragging = false; });
  }

  // ---- 미리보기(코어 동작 세트 재생) ----
  function preview() {
    if (!ctrl) return;
    // 자리비우기(g5)→얼굴부비기(g6)로 사라졌다 걸어 들어오는 것까지 보여준다.
    const seq = ['g2_twerk', 'g4_ballet', 'g3_despair', 'g8_w_shrug', 'g7_rage_aura', 'g5_leave', 'g6_nuzzle', 'g1_slump_roll'];
    ctrl.play(seq, { onDone: () => render() });
  }

  // ---- 저장 ----
  async function save() {
    const name = document.getElementById('charName').value.trim();
    if (!name) return setStatus('캐릭터 이름을 입력해 주세요.');
    const bundle = buildBundle();
    const filled = Object.keys(bundle.slots).length;
    if (filled === 0) return setStatus('최소 한 조각 이상 이미지를 올려 주세요.');

    let bytes = 0;
    for (const k of Object.keys(bundle.slots)) bytes += Math.floor(bundle.slots[k].image.length * 0.75);
    if (bytes > MAX_TOTAL) return setStatus('번들이 너무 큽니다. 이미지 크기를 줄여 주세요.');

    const id = 'custom_' + Date.now().toString(36);
    const entry = { id, name, swatch: '#9b7bff', bundle };

    const nextCustoms = (cfg.customCharacters || []).concat([entry]);
    setStatus('저장 중…');
    // config 에 추가 + 내 캐릭터로 선택. 로컬 데모 확인을 위해 상대(오버레이) 캐릭터도 이 캐릭터로.
    await host.setConfig({ customCharacters: nextCustoms, characterId: id, partnerCharacterId: id });
    cfg = await host.getConfig();

    // Firebase 모드면 Storage 로 번들 공유 + members 에 characterRef 기록
    if (cfg.firebase && cfg.pairCode) {
      try {
        const t = RW.transport.createTransport(cfg);
        await t.ready;
        await t.setMyCharacter(id, bundle);
        t.destroy();
        setStatus('저장 완료 · 상대와 공유했어요. 이 창을 닫아도 됩니다.');
      } catch (e) {
        console.error(e);
        setStatus('저장됨(로컬). Firebase 공유는 연결 확인이 필요해요.');
      }
    } else {
      setStatus('저장 완료(로컬 데모). 오버레이에서 새 캐릭터가 보입니다.');
    }
    filledHint(filled);
  }

  function filledHint(filled) {
    if (filled < 5) {
      const s = document.getElementById('status');
      s.textContent += `  (${filled}/5 조각 — 나머지도 채우면 더 온전해요)`;
    }
  }

  function setStatus(msg) { document.getElementById('status').textContent = msg; }

  main();
})();
