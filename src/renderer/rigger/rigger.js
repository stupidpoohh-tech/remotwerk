'use strict';
/* 리깅·업로드 도구 (Prompt B).
 *  - 大자(spread) 가이드에 맞춰 부위별 투명 PNG 5장을 정합(크기·위치·회전·z).
 *  - 가이드 비율(몸통 길이/너비, 어깨 높이/너비, 골반 너비, 팔·다리 길이/두께)을 조절 가능.
 *    비율은 번들에 저장되어 상대 화면·애니메이션에도 동일하게 적용된다.
 *  - 코어 애니메이션(능동8+자율2)을 그대로 재생해 검증(5절 근사 처리 반영).
 *  - 저장: 프리셋과 동일 포맷(부위 이미지 + 리그 JSON + proportions) → config + (Firebase면) Storage 공유.
 */

(function () {
  const RW = window.RW;
  const host = window.rwHost;

  const S = 2;                       // 스테이지 확대 배율(#scaled 의 scale 과 동일)
  const MAX_SIDE = 512;
  const MAX_TOTAL = 2 * 1024 * 1024;

  const LABELS = { torso: '몸통+머리', armL: '좌팔', armR: '우팔', legL: '좌다리', legR: '우다리' };
  const SLOTS = ['torso', 'armL', 'armR', 'legL', 'legR'];

  // 조절 가능한 가이드 비율 슬라이더(값은 정수 슬라이더 → proportions 로 변환)
  const PROP_FIELDS = [
    { key: 'torsoLen', label: '몸통 길이', min: 60, max: 175 },
    { key: 'torsoW',   label: '몸통 너비', min: 40, max: 110 },
    { key: 'shoulderRatio', label: '어깨 높이', min: 45, max: 95, ratio: true },  // %
    { key: 'shoulderX', label: '어깨 너비', min: 8,  max: 60 },
    { key: 'hipX',     label: '골반 너비', min: 3,  max: 42 },
    { key: 'armLen',   label: '팔 길이',   min: 40, max: 135 },
    { key: 'armW',     label: '팔 두께',   min: 10, max: 52 },
    { key: 'legLen',   label: '다리 길이', min: 40, max: 145 },
    { key: 'legW',     label: '다리 두께', min: 10, max: 58 }
  ];

  let cfg = null;
  let ctrl = null;
  let selected = 'torso';
  let proportions = Object.assign({}, RW.skeleton.BIPEDAL5_DEFAULT);
  const state = {};                  // slot → { image, natW, natH, scale, offx, offy, rot, z, base }

  function workingSkeleton() { return RW.skeleton.buildBipedal5(proportions); }
  function boneOf(sk, slot) { return sk.bones.find((b) => b.part && b.part.slot === slot); }

  // 슬롯 상태 초기화(기본 골격 기준)
  (function initState() {
    const sk = workingSkeleton();
    for (const slot of SLOTS) {
      const b = boneOf(sk, slot);
      state[slot] = {
        image: null, natW: 0, natH: 0,
        scale: 1, offx: 0, offy: 0,
        rot: b.guideRot || 0, z: b.z,
        base: { x: b.part.x, y: b.part.y, w: b.part.w, h: b.part.h }
      };
    }
  })();

  async function main() {
    cfg = await host.getConfig();
    buildProps();
    buildPanel();
    redraw();
    document.getElementById('previewBtn').addEventListener('click', preview);
    document.getElementById('saveBtn').addEventListener('click', save);
    document.getElementById('resetProps').addEventListener('click', resetProps);
    setupDrag();
  }

  // ---- 가이드 비율 슬라이더 ----
  function buildProps() {
    const host = document.getElementById('proportions');
    host.innerHTML = '';
    for (const f of PROP_FIELDS) {
      const val = f.ratio ? Math.round(proportions[f.key] * 100) : proportions[f.key];
      const row = document.createElement('div');
      row.className = 'ctl';
      row.innerHTML = `<label>${f.label}</label><input type="range" min="${f.min}" max="${f.max}" value="${val}"><span class="val">${val}</span>`;
      const input = row.querySelector('input');
      const out = row.querySelector('.val');
      input.addEventListener('input', () => {
        out.textContent = input.value;
        proportions[f.key] = f.ratio ? (+input.value / 100) : +input.value;
        redraw();
      });
      host.appendChild(row);
    }
  }

  function resetProps() {
    proportions = Object.assign({}, RW.skeleton.BIPEDAL5_DEFAULT);
    buildProps();
    redraw();
  }

  // ---- 大자 가이드(SVG) ----
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

  function drawGuide() {
    const sk = workingSkeleton();
    const abs = computeAbsPivots(sk);
    const svg = document.getElementById('guide');
    const NS = 'http://www.w3.org/2000/svg';
    svg.innerHTML = '';
    for (const slot of SLOTS) {
      const b = boneOf(sk, slot);
      const pv = abs[b.name];
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

  // ---- 슬롯 카드 ----
  function buildPanel() {
    const panel = document.getElementById('slots');
    panel.innerHTML = '';
    const sk = workingSkeleton();
    for (const slot of SLOTS) {
      const b = boneOf(sk, slot);
      const card = document.createElement('div');
      card.className = 'slot' + (state[slot].image ? ' filled' : '');
      card.dataset.slot = slot;
      card.innerHTML = `
        <div class="slot-head">
          <span class="slot-name ${state[slot].image ? 'filled' : 'empty'}">${LABELS[slot]}</span>
          <label class="upload">이미지 올리기<input type="file" accept="image/png,image/*"></label>
        </div>
        <div class="controls">
          <div class="ctl"><label>크기</label><input type="range" class="scale" min="30" max="250" value="${Math.round(state[slot].scale * 100)}"></div>
          <div class="ctl"><label>회전</label><input type="range" class="rot" min="-180" max="180" value="${state[slot].rot}"></div>
          <div class="zbtns"><button class="zup">앞으로</button><button class="zdown">뒤로</button></div>
        </div>`;
      card.addEventListener('click', () => selectSlot(slot));
      card.querySelector('input[type=file]').addEventListener('change', (e) => onUpload(slot, e.target.files[0]));
      card.querySelector('.scale').addEventListener('input', (e) => { state[slot].scale = +e.target.value / 100; render(); });
      card.querySelector('.rot').addEventListener('input', (e) => { state[slot].rot = +e.target.value; render(); });
      card.querySelector('.zup').addEventListener('click', (e) => { e.stopPropagation(); state[slot].z += 1; render(); });
      card.querySelector('.zdown').addEventListener('click', (e) => { e.stopPropagation(); state[slot].z -= 1; render(); });
      panel.appendChild(card);
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
      const b = boneOf(workingSkeleton(), slot);
      const s = state[slot];
      s.image = dataUrl; s.natW = w; s.natH = h;
      // 새 이미지: 현재 비율의 가이드 상자를 base 로 스냅샷(이후 비율을 바꿔도 이 조각은 안정)
      s.base = { x: b.part.x, y: b.part.y, w: b.part.w, h: b.part.h };
      s.scale = 1; s.offx = 0; s.offy = 0; s.rot = b.guideRot || 0; s.z = b.z;
      buildPanel();
      selectSlot(slot);
      render();
    }).catch((e) => setStatus('이미지를 불러오지 못했어요: ' + e.message));
  }

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
    for (const slot of SLOTS) {
      const s = state[slot];
      if (s.image) slots[slot] = { image: s.image, fit: fitOf(s), z: s.z };
    }
    return { skeletonId: 'bipedal5', proportions: Object.assign({}, proportions), slots };
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
      ctrl = RW.engine.mount(anchor, { skeleton: workingSkeleton(), rig: { skeletonId: 'bipedal5', slots: buildBundle().slots } });
      updateSize();
    });
  }
  // 비율/가이드 변경 시: 가이드도 다시 그리고 캐릭터도 다시 렌더
  function redraw() { drawGuide(); render(); }

  function updateSize() {
    let bytes = 0;
    for (const slot of SLOTS) { const im = state[slot].image; if (im) bytes += Math.floor(im.length * 0.75); }
    const info = document.getElementById('sizeInfo');
    info.textContent = `번들 크기 ≈ ${Math.round(bytes / 1024)} KB`;
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
      const dx = (e.clientX - lastX) / S;
      const dy = (e.clientY - lastY) / S;
      lastX = e.clientX; lastY = e.clientY;
      const r = -s.rot * Math.PI / 180;   // 화면 이동 → 로컬(파트는 pivot 기준 rot 회전)
      s.offx += dx * Math.cos(r) - dy * Math.sin(r);
      s.offy += dx * Math.sin(r) + dy * Math.cos(r);
      render();
    });
    window.addEventListener('mouseup', () => { dragging = false; });
  }

  // ---- 미리보기 ----
  function preview() {
    if (!ctrl) return;
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
    await host.setConfig({ customCharacters: nextCustoms, characterId: id, partnerCharacterId: id });
    cfg = await host.getConfig();

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
    if (filled < 5) document.getElementById('status').textContent += `  (${filled}/5 조각)`;
  }

  function setStatus(msg) { document.getElementById('status').textContent = msg; }

  main();
})();
