'use strict';
/* 리깅·업로드 도구.
 *
 * 흐름: 전체 이미지 1장 업로드 → 관절(어깨·골반) 위치를 비율로 맞춤 →
 *       5개 자르기 상자를 맞추고 잘라냄 → 조각별 미세 조정 → 미리보기 → 저장.
 *
 * 좌표계 정리(중요):
 *   - 스켈레톤 좌표: 골반이 원점(0,0). 스테이지는 이걸 S배 확대해 보여준다.
 *   - 원본 이미지는 스켈레톤 좌표에 (src.x, src.y) 위치, src.scale 배로 깔린다.
 *       skel = src.(x,y) + imgPx * src.scale     →     imgPx = (skel - src.(x,y)) / src.scale
 *   - 자르기 상자는 스켈레톤 좌표의 회전 사각형 { cx, cy, w, h, rot }.
 *   - 잘라낸 조각의 fit 은 "관절(pivot) 기준으로 rot 만큼 회전시키면 원래 자리에 놓이도록"
 *     역회전해 계산한다. 그래서 잘린 그대로의 포즈가 캐릭터의 기본 자세가 된다.
 */

(function () {
  const RW = window.RW;
  const host = window.rwHost;

  const S = 2;                       // 스테이지 확대 배율(#scaled 의 scale 과 동일)
  const MAX_SIDE = 1024;             // 원본 이미지 다운스케일 한 변 최대
  const MAX_TOTAL = 2 * 1024 * 1024; // 번들 총용량 상한

  const LABELS = { torso: '몸통+머리', armL: '좌팔', armR: '우팔', legL: '좌다리', legR: '우다리' };
  const SLOTS = ['torso', 'armL', 'armR', 'legL', 'legR'];

  const PROP_FIELDS = [
    { key: 'torsoLen', label: '몸통 길이', min: 60, max: 220 },
    { key: 'torsoW',   label: '몸통 너비', min: 40, max: 200 },
    { key: 'shoulderRatio', label: '어깨 높이', min: 30, max: 95, ratio: true },
    { key: 'shoulderX', label: '어깨 너비', min: 8,  max: 120 },
    { key: 'hipX',     label: '골반 너비', min: 3,  max: 90 },
    { key: 'armLen',   label: '팔 길이',   min: 20, max: 180 },
    { key: 'armW',     label: '팔 두께',   min: 10, max: 100 },
    { key: 'legLen',   label: '다리 길이', min: 20, max: 180 },
    { key: 'legW',     label: '다리 두께', min: 10, max: 110 }
  ];

  let cfg = null;
  let ctrl = null;
  let selected = 'torso';
  let dragTarget = 'cut';            // 'cut' | 'src' | 'piece'
  let proportions = Object.assign({}, RW.skeleton.BIPEDAL5_DEFAULT);
  let boxesTouched = false;

  // 원본 이미지 상태 (스켈레톤 좌표에 놓인다)
  const source = { img: null, dataUrl: null, natW: 0, natH: 0, x: 0, y: 0, scale: 1 };
  // 뒷모습 원본 — 트월킹에서 등을 보일 때만 쓴다. 없으면 앞모습으로 재생된다.
  const sourceBack = { img: null, dataUrl: null, natW: 0, natH: 0, x: 0, y: 0, scale: 1 };
  // 잘라낸 뒷모습 조각. fit(위치·회전)은 앞모습 것을 그대로 쓴다.
  //   자르기 상자는 "보는 사람 기준" 좌표라, 뒷모습도 같은 상자로 자르면 된다.
  //   (등을 보이면 화면 왼쪽에 오는 팔이 캐릭터의 오른팔로 바뀌지만, 엉덩이를 흔드는
  //    동작에서는 문제가 되지 않는다. 좌우를 뒤집지 않는 게 오히려 자연스럽다.)
  const backImages = {};             // slot → dataUrl

  // 자르기 상자 (스켈레톤 좌표의 회전 사각형)
  const cutBoxes = {};               // slot → { cx, cy, w, h, rot }

  // 잘라낸 조각 상태
  const state = {};                  // slot → { image, scale, offx, offy, rot, z, base }

  function workingSkeleton() { return RW.skeleton.buildBipedal5(proportions); }
  function boneOf(sk, slot) { return sk.bones.find((b) => b.part && b.part.slot === slot); }

  (function initState() {
    const sk = workingSkeleton();
    for (const slot of SLOTS) {
      const b = boneOf(sk, slot);
      state[slot] = {
        image: null, scale: 1, offx: 0, offy: 0,
        rot: b.guideRot || 0, z: b.z,
        base: { x: b.part.x, y: b.part.y, w: b.part.w, h: b.part.h }
      };
    }
    syncBoxesToGuide();
  })();

  // 편집 모드: ?edit=<id> 로 열리면 그 캐릭터를 불러온다.
  const editId = new URLSearchParams(location.search).get('edit');
  let editing = null;

  function loadForEdit() {
    const entry = (cfg.customCharacters || []).find((c) => c.id === editId);
    if (!entry) return false;
    editing = entry;
    const b = entry.bundle || {};
    if (b.proportions) proportions = Object.assign({}, RW.skeleton.BIPEDAL5_DEFAULT, b.proportions);
    for (const slot of SLOTS) {
      const sl = (b.slots || {})[slot];
      const s = state[slot];
      if (!sl) { s.image = null; continue; }
      const f = sl.fit || {};
      s.image = sl.image;
      s.base = { x: f.x || 0, y: f.y || 0, w: f.w || 40, h: f.h || 40 };
      s.rot = f.rot || 0; s.scale = 1; s.offx = 0; s.offy = 0;
      if (sl.z != null) s.z = sl.z;
    }
    for (const slot of SLOTS) {
      const bk = (b.slotsBack || {})[slot];
      if (bk && bk.image) backImages[slot] = bk.image;
    }
    syncBoxesToGuide();
    document.getElementById('charName').value = entry.name || '';
    document.getElementById('showResult').checked = true;
    document.getElementById('showSrc').checked = false;
    dragTarget = 'piece';
    document.getElementById('saveBtn').textContent = '수정 내용 저장';
    // 편집 시엔 원본/자르기 단계는 접어 둔다(다시 자를 수도 있게 남겨는 둔다).
    document.getElementById('srcBox').open = false;
    document.getElementById('cutBox').open = false;
    return true;
  }

  async function main() {
    cfg = await host.getConfig();
    if (editId) loadForEdit();
    buildProps();
    buildPanel();
    redraw();

    document.getElementById('srcFile').addEventListener('change', (e) => onSourceUpload(e.target.files[0]));
    document.getElementById('srcScale').addEventListener('input', (e) => {
      source.scale = Math.max(0.05, +e.target.value / 100);
      document.getElementById('srcScaleVal').textContent = e.target.value;
      redraw();
    });
    document.getElementById('backFile').addEventListener('change', (e) => onBackUpload(e.target.files[0]));
    document.getElementById('backScale').addEventListener('input', (e) => {
      sourceBack.scale = Math.max(0.05, +e.target.value / 100);
      document.getElementById('backScaleVal').textContent = e.target.value;
      redraw();
    });
    document.getElementById('showBack').addEventListener('change', () => {
      // 뒷모습을 맞추는 동안엔 원본 레이어가 보여야 한다.
      if (document.getElementById('showBack').checked) {
        document.getElementById('showSrc').checked = true;
        dragTarget = 'src';
        updateStageHint();
      }
      redraw();
    });
    document.getElementById('cutBackBtn').addEventListener('click', cutBack);
    document.getElementById('clearBackBtn').addEventListener('click', clearBack);
    refreshBackUI();

    document.getElementById('fitToGuide').addEventListener('click', () => { syncBoxesToGuide(); boxesTouched = false; redraw(); });
    document.getElementById('cutBtn').addEventListener('click', cutAll);
    document.getElementById('previewBtn').addEventListener('click', preview);
    document.getElementById('saveBtn').addEventListener('click', save);
    document.getElementById('resetProps').addEventListener('click', resetProps);
    document.getElementById('showSrc').addEventListener('change', redraw);
    document.getElementById('showResult').addEventListener('change', redraw);
    setupDrag();

    // 관리자에게만 "공용 카탈로그에 올리기" 옵션을 보여준다.
    if (cfg.firebase && RW.catalog) {
      RW.catalog.isAdmin(cfg).then((ok) => {
        if (ok) document.getElementById('publishRow').hidden = false;
      }).catch(() => {});
    }
  }

  // ---- 절대 관절 좌표 ----
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

  // 가이드(비율)로부터 자르기 상자를 다시 만든다.
  function syncBoxesToGuide() {
    const sk = workingSkeleton();
    const abs = computeAbsPivots(sk);
    for (const slot of SLOTS) {
      const b = boneOf(sk, slot);
      const P = abs[b.name];
      const th = (b.guideRot || 0) * Math.PI / 180;
      // 본 로컬에서 상자 중심
      const lx = b.part.x + b.part.w / 2;
      const ly = b.part.y + b.part.h / 2;
      // guideRot 만큼 회전해 스켈레톤 좌표 중심으로
      cutBoxes[slot] = {
        cx: P.x + lx * Math.cos(th) - ly * Math.sin(th),
        cy: P.y + lx * Math.sin(th) + ly * Math.cos(th),
        w: b.part.w, h: b.part.h, rot: b.guideRot || 0
      };
    }
  }

  // ---- 가이드 비율 슬라이더 ----
  function buildProps() {
    const el = document.getElementById('proportions');
    el.innerHTML = '';
    for (const f of PROP_FIELDS) {
      const val = f.ratio ? Math.round(proportions[f.key] * 100) : Math.round(proportions[f.key]);
      const row = document.createElement('div');
      row.className = 'ctl';
      row.innerHTML = `<label>${f.label}</label><input type="range" min="${f.min}" max="${f.max}" value="${val}"><span class="val">${val}</span>`;
      const input = row.querySelector('input');
      const out = row.querySelector('.val');
      input.addEventListener('input', () => {
        out.textContent = input.value;
        proportions[f.key] = f.ratio ? (+input.value / 100) : +input.value;
        if (!boxesTouched) syncBoxesToGuide();   // 아직 손대지 않았으면 가이드를 따라간다
        redraw();
      });
      el.appendChild(row);
    }
  }

  function resetProps() {
    proportions = Object.assign({}, RW.skeleton.BIPEDAL5_DEFAULT);
    buildProps();
    syncBoxesToGuide(); boxesTouched = false;
    redraw();
  }

  // 지금 스테이지에서 다루는 원본(앞모습/뒷모습)
  function backMode() {
    const el = document.getElementById('showBack');
    return !!(el && el.checked && sourceBack.dataUrl);
  }
  function activeSource() { return backMode() ? sourceBack : source; }

  // ---- 스테이지 그리기 ----
  function drawSource() {
    const layer = document.getElementById('srcLayer');
    const src = activeSource();
    const show = document.getElementById('showSrc').checked && src.dataUrl;
    if (!show) { layer.style.display = 'none'; return; }
    layer.style.display = 'block';
    layer.style.left = src.x + 'px';
    layer.style.top = src.y + 'px';
    layer.style.width = (src.natW * src.scale) + 'px';
    layer.style.height = (src.natH * src.scale) + 'px';
    layer.style.backgroundImage = `url("${src.dataUrl}")`;
  }

  function drawGuide() {
    const sk = workingSkeleton();
    const abs = computeAbsPivots(sk);
    const svg = document.getElementById('guide');
    const NS = 'http://www.w3.org/2000/svg';
    svg.innerHTML = '';

    for (const slot of SLOTS) {
      const b = boneOf(sk, slot);
      const P = abs[b.name];
      const box = cutBoxes[slot];
      const isSel = slot === selected;

      // 자르기 상자(회전 사각형)
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('transform', `translate(${box.cx} ${box.cy}) rotate(${box.rot})`);
      const rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('x', -box.w / 2); rect.setAttribute('y', -box.h / 2);
      rect.setAttribute('width', box.w); rect.setAttribute('height', box.h);
      rect.setAttribute('rx', '3');
      rect.setAttribute('fill', isSel ? 'rgba(255,140,0,0.13)' : 'rgba(138,99,255,0.05)');
      rect.setAttribute('stroke', isSel ? '#ff8c00' : 'rgba(138,99,255,0.5)');
      rect.setAttribute('stroke-width', isSel ? '1.6' : '1');
      rect.setAttribute('stroke-dasharray', '4 3');
      g.appendChild(rect);
      const label = document.createElementNS(NS, 'text');
      label.setAttribute('x', -box.w / 2 + 2); label.setAttribute('y', -box.h / 2 + 10);
      label.setAttribute('font-size', '9');
      label.setAttribute('fill', isSel ? '#c96a00' : 'rgba(90,70,180,.75)');
      label.textContent = LABELS[slot];
      g.appendChild(label);
      svg.appendChild(g);

      // 관절(회전 중심) 점
      const dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('cx', P.x); dot.setAttribute('cy', P.y);
      dot.setAttribute('r', '3.5'); dot.setAttribute('fill', '#8a63ff');
      dot.setAttribute('stroke', '#fff'); dot.setAttribute('stroke-width', '1');
      svg.appendChild(dot);
    }
  }

  // ---- 슬롯 카드 ----
  function buildPanel() {
    const panel = document.getElementById('slots');
    panel.innerHTML = '';
    for (const slot of SLOTS) {
      const s = state[slot];
      const box = cutBoxes[slot];
      const card = document.createElement('div');
      card.className = 'slot' + (s.image ? ' filled' : '');
      card.dataset.slot = slot;
      card.innerHTML = `
        <div class="slot-head">
          <span class="slot-name ${s.image ? 'filled' : 'empty'}">${LABELS[slot]}</span>
        </div>
        <div class="cutctl">
          <div class="ctl"><label>너비</label><input type="range" class="bw" min="10" max="300" value="${Math.round(box.w)}"></div>
          <div class="ctl"><label>높이</label><input type="range" class="bh" min="10" max="300" value="${Math.round(box.h)}"></div>
          <div class="ctl"><label>기울기</label><input type="range" class="brot" min="-180" max="180" value="${Math.round(box.rot)}"></div>
        </div>
        <div class="controls">
          <div class="ctl"><label>조각크기</label><input type="range" class="scale" min="30" max="250" value="${Math.round(s.scale * 100)}"></div>
          <div class="zbtns"><button class="zup">앞으로</button><button class="zdown">뒤로</button></div>
        </div>`;
      card.addEventListener('click', () => selectSlot(slot));
      const on = (sel, ev, fn) => card.querySelector(sel).addEventListener(ev, fn);
      on('.bw', 'input', (e) => { cutBoxes[slot].w = +e.target.value; boxesTouched = true; redraw(); });
      on('.bh', 'input', (e) => { cutBoxes[slot].h = +e.target.value; boxesTouched = true; redraw(); });
      on('.brot', 'input', (e) => { cutBoxes[slot].rot = +e.target.value; boxesTouched = true; redraw(); });
      on('.scale', 'input', (e) => { state[slot].scale = +e.target.value / 100; render(); });
      on('.zup', 'click', (e) => { e.stopPropagation(); state[slot].z += 1; render(); });
      on('.zdown', 'click', (e) => { e.stopPropagation(); state[slot].z -= 1; render(); });
      panel.appendChild(card);
    }
    selectSlot(selected);
  }

  function selectSlot(slot) {
    selected = slot;
    document.querySelectorAll('.slot').forEach((c) => c.classList.toggle('selected', c.dataset.slot === slot));
    drawGuide();
  }

  // ---- 원본 업로드 ----
  function onSourceUpload(file) {
    if (!file) return;
    loadDownscaled(file, MAX_SIDE).then(({ dataUrl, img, w, h }) => {
      source.dataUrl = dataUrl; source.img = img; source.natW = w; source.natH = h;
      // 캐릭터가 가이드에 대충 맞도록 초기 배치: 높이를 몸통+다리 길이에 맞춘다
      const targetH = proportions.torsoLen + proportions.legLen;
      source.scale = targetH / h;
      source.x = -(w * source.scale) / 2;
      source.y = -proportions.torsoLen;
      const sc = document.getElementById('srcScale');
      sc.value = Math.round(source.scale * 100);
      document.getElementById('srcScaleVal').textContent = sc.value;
      document.getElementById('srcCtl').classList.add('ready');
      dragTarget = 'src';
      setCutMsg('원본을 올렸어요. 스테이지를 드래그해 위치를 맞추세요.');
      redraw();
    }).catch((e) => setCutMsg('이미지를 불러오지 못했어요: ' + e.message));
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
        const ctx = cv.getContext('2d');
        ctx.imageSmoothingEnabled = false;      // 픽셀아트 보존
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        const out = new Image();
        out.onload = () => resolve({ dataUrl: cv.toDataURL('image/png'), img: out, w, h });
        out.src = cv.toDataURL('image/png');
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode 실패')); };
      img.src = url;
    });
  }

  // ---- 자르기 ----
  function cutAll() {
    if (!source.img) return setCutMsg('먼저 전체 이미지를 올려 주세요.');
    const sk = workingSkeleton();
    const abs = computeAbsPivots(sk);
    let n = 0;
    for (const slot of SLOTS) {
      const b = boneOf(sk, slot);
      const box = cutBoxes[slot];
      const dataUrl = cropPiece(box);
      if (!dataUrl) continue;
      const fit = fitForCut(box, abs[b.name]);
      const s = state[slot];
      s.image = dataUrl;
      s.base = { x: fit.x, y: fit.y, w: fit.w, h: fit.h };
      s.rot = fit.rot; s.scale = 1; s.offx = 0; s.offy = 0;
      n++;
    }
    document.getElementById('showResult').checked = true;
    document.getElementById('showSrc').checked = false;
    dragTarget = 'piece';
    buildPanel();
    redraw();
    setCutMsg(`${n}조각을 잘랐어요. 결과를 보고 조각별로 미세 조정하세요.`);
  }

  // 회전 사각형 영역을 원본에서 잘라 축 정렬 이미지로 만든다.
  function cropPiece(box, src) {
    src = src || source;
    const outW = Math.max(1, Math.round(box.w / src.scale));
    const outH = Math.max(1, Math.round(box.h / src.scale));
    if (outW > 2000 || outH > 2000) return null;
    const cxImg = (box.cx - src.x) / src.scale;
    const cyImg = (box.cy - src.y) / src.scale;

    const cv = document.createElement('canvas');
    cv.width = outW; cv.height = outH;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.translate(outW / 2, outH / 2);
    ctx.rotate(-box.rot * Math.PI / 180);
    ctx.translate(-cxImg, -cyImg);
    ctx.drawImage(src.img, 0, 0);
    return cv.toDataURL('image/png');
  }

  // ---- 뒷모습 ----
  function onBackUpload(file) {
    if (!file) return;
    loadDownscaled(file, MAX_SIDE).then(({ dataUrl, img, w, h }) => {
      sourceBack.dataUrl = dataUrl; sourceBack.img = img; sourceBack.natW = w; sourceBack.natH = h;
      // 앞모습이 이미 자리를 잡았으면 같은 배치로 시작한다(같은 크기·자세를 전제).
      if (source.img) {
        sourceBack.scale = source.scale;
        sourceBack.x = source.x; sourceBack.y = source.y;
      } else {
        const targetH = proportions.torsoLen + proportions.legLen;
        sourceBack.scale = targetH / h;
        sourceBack.x = -(w * sourceBack.scale) / 2;
        sourceBack.y = -proportions.torsoLen;
      }
      const sc = document.getElementById('backScale');
      sc.value = Math.round(sourceBack.scale * 100);
      document.getElementById('backScaleVal').textContent = sc.value;
      document.getElementById('showBack').checked = true;
      document.getElementById('showSrc').checked = true;
      dragTarget = 'src';
      updateStageHint();
      refreshBackUI();
      setBackMsg('뒷모습을 올렸어요. 앞모습과 같은 자리에 오도록 맞춘 뒤 잘라내세요.');
      redraw();
    }).catch((e) => setBackMsg('이미지를 불러오지 못했어요: ' + e.message));
  }

  function cutBack() {
    if (!sourceBack.img) return setBackMsg('먼저 뒷모습 이미지를 올려 주세요.');
    let n = 0;
    for (const slot of SLOTS) {
      if (!state[slot].image) continue;        // 앞모습이 없는 조각은 뒷모습도 만들지 않는다
      const url = cropPiece(cutBoxes[slot], sourceBack);
      if (!url) continue;
      backImages[slot] = url;
      n++;
    }
    document.getElementById('showBack').checked = false;
    document.getElementById('showResult').checked = true;
    refreshBackUI();
    redraw();
    setBackMsg(n
      ? `뒷모습 ${n}조각을 잘랐어요. “▶ 동작 미리보기”에서 트월킹으로 확인하세요.`
      : '먼저 앞모습을 잘라 주세요(3단계).');
  }

  function clearBack() {
    for (const slot of SLOTS) delete backImages[slot];
    document.getElementById('showBack').checked = false;
    refreshBackUI();
    redraw();
    setBackMsg('뒷모습을 지웠어요. 트월킹은 앞모습으로 재생됩니다.');
  }

  function refreshBackUI() {
    const has = sourceBack.dataUrl || Object.keys(backImages).length > 0;
    document.getElementById('backCtl').classList.toggle('ready', !!has);
    if (Object.keys(backImages).length > 0) document.getElementById('backBox').open = true;
  }

  function setBackMsg(m) { document.getElementById('backMsg').textContent = m || ''; }

  // 관절 기준으로 rot 만큼 회전시키면 원래 자리에 놓이도록 역회전해 fit 계산
  function fitForCut(box, P) {
    const dx = box.cx - P.x, dy = box.cy - P.y;
    const th = -box.rot * Math.PI / 180;
    const rx = dx * Math.cos(th) - dy * Math.sin(th);
    const ry = dx * Math.sin(th) + dy * Math.cos(th);
    return { x: rx - box.w / 2, y: ry - box.h / 2, w: box.w, h: box.h, rot: box.rot };
  }

  // ---- 상태 → 번들 ----
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
    const slotsBack = {};
    for (const slot of SLOTS) {
      const s = state[slot];
      if (!s.image) continue;
      slots[slot] = { image: s.image, fit: fitOf(s), z: s.z };
      // 뒷모습은 이미지만 담는다. 위치·회전은 앞모습 fit 을 그대로 쓴다(같은 상자에서 잘랐다).
      if (backImages[slot]) slotsBack[slot] = { image: backImages[slot] };
    }
    const bundle = { skeletonId: 'bipedal5', proportions: Object.assign({}, proportions), slots };
    if (Object.keys(slotsBack).length) bundle.slotsBack = slotsBack;
    return bundle;
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
      anchor.style.display = document.getElementById('showResult').checked ? 'block' : 'none';
      const b = buildBundle();
      ctrl = RW.engine.mount(anchor, {
        skeleton: workingSkeleton(),
        rig: { skeletonId: 'bipedal5', slots: b.slots, slotsBack: b.slotsBack || null }
      });
      updateSize();
    });
  }
  function redraw() { drawSource(); drawGuide(); render(); }

  function updateSize() {
    let bytes = 0;
    for (const slot of SLOTS) {
      const im = state[slot].image; if (im) bytes += Math.floor(im.length * 0.75);
      const bk = backImages[slot]; if (bk) bytes += Math.floor(bk.length * 0.75);
    }
    const info = document.getElementById('sizeInfo');
    info.textContent = `번들 ≈ ${Math.round(bytes / 1024)} KB`;
    info.style.color = bytes > MAX_TOTAL ? '#c0392b' : '';
  }

  function setCutMsg(m) { document.getElementById('cutMsg').textContent = m || ''; }

  // ---- 드래그 ----
  function setupDrag() {
    const stage = document.getElementById('stage');
    let dragging = false, lastX = 0, lastY = 0;
    stage.addEventListener('mousedown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; e.preventDefault(); });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = (e.clientX - lastX) / S;
      const dy = (e.clientY - lastY) / S;
      lastX = e.clientX; lastY = e.clientY;

      if (dragTarget === 'src' && activeSource().img) {
        const src = activeSource();
        src.x += dx; src.y += dy;
      } else if (dragTarget === 'piece' && state[selected].image) {
        // 조각은 관절 기준 rot 로 회전돼 그려지므로, 화면 이동을 -rot 로 돌려 로컬 이동으로
        const r = -state[selected].rot * Math.PI / 180;
        state[selected].offx += dx * Math.cos(r) - dy * Math.sin(r);
        state[selected].offy += dx * Math.sin(r) + dy * Math.cos(r);
      } else {
        cutBoxes[selected].cx += dx; cutBoxes[selected].cy += dy;
        boxesTouched = true;
      }
      redraw();
    });
    window.addEventListener('mouseup', () => { dragging = false; });

    // 드래그 대상 전환: 스페이스바로 원본/상자/조각 순환
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || e.target.tagName === 'INPUT') return;
      e.preventDefault();
      dragTarget = dragTarget === 'src' ? 'cut' : (dragTarget === 'cut' ? 'piece' : 'src');
      updateStageHint();
    });
    updateStageHint();
  }

  function updateStageHint() {
    const map = {
      src: backMode() ? '드래그 = 뒷모습 이미지 이동 (스페이스로 전환)'
                      : '드래그 = 원본 이미지 이동 (스페이스로 전환)',
      cut: '드래그 = 선택한 자르기 상자 이동 (스페이스로 전환)',
      piece: '드래그 = 잘라낸 조각 미세 이동 (스페이스로 전환)'
    };
    document.getElementById('stageHint').textContent = map[dragTarget];
  }

  // ---- 미리보기 ----
  function preview() {
    if (!ctrl) return;
    document.getElementById('showResult').checked = true;
    const seq = RW.gestures.ACTIVE.map((g) => g.id);   // 현재 신호 세트를 그대로 재생
    render();
    setTimeout(() => ctrl.play(seq, { onDone: () => render() }), 50);
  }

  // ---- 저장 ----
  async function save() {
    const name = document.getElementById('charName').value.trim();
    if (!name) return setStatus('캐릭터 이름을 입력해 주세요.');
    const bundle = buildBundle();
    const filled = Object.keys(bundle.slots).length;
    if (filled === 0) return setStatus('먼저 이미지를 올리고 조각을 잘라 주세요.');

    let bytes = 0;
    for (const k of Object.keys(bundle.slots)) bytes += Math.floor(bundle.slots[k].image.length * 0.75);
    for (const k of Object.keys(bundle.slotsBack || {})) bytes += Math.floor(bundle.slotsBack[k].image.length * 0.75);
    if (bytes > MAX_TOTAL) return setStatus('번들이 너무 큽니다. 원본 크기를 줄여 주세요.');

    // 편집 모드면 같은 id 를 유지하며 덮어쓰고, 아니면 새로 만든다.
    const id = editing ? editing.id : 'custom_' + Date.now().toString(36);
    const entry = { id, name, swatch: '#9b7bff', bundle };
    const list = (cfg.customCharacters || []);
    const nextCustoms = editing
      ? list.map((c) => (c.id === id ? entry : c))
      : list.concat([entry]);

    setStatus('저장 중…');
    const patch = { customCharacters: nextCustoms };
    if (!editing) { patch.characterId = id; patch.partnerCharacterId = id; }
    await host.setConfig(patch);
    cfg = await host.getConfig();
    editing = entry;

    // 관리자: 공용 카탈로그에도 올리기(모든 사용자가 선택 가능해진다)
    const pub = document.getElementById('publishCatalog');
    if (pub && !pub.parentElement.hidden && pub.checked && RW.catalog) {
      try {
        await RW.catalog.publish(cfg, { name, swatch: '#2a9d5c', bundle });
        setStatus('공용 카탈로그에 올렸어요. 모든 사용자가 쓸 수 있습니다.');
      } catch (e) {
        console.error(e);
        setStatus('개인 캐릭터로는 저장됐지만 카탈로그 업로드는 실패했어요(관리자 권한 확인).');
        return;
      }
    }

    if (cfg.firebase && cfg.roomId) {
      try {
        const t = RW.transport.createTransport(cfg);
        await t.ready;
        await t.setMyCharacter(id, bundle);
        t.destroy();
        setStatus('저장 완료 · 상대와 공유했어요. 창을 닫아도 됩니다.');
      } catch (e) {
        console.error(e);
        setStatus('저장됨(로컬). Firebase 공유는 연결 확인이 필요해요.');
      }
    } else {
      setStatus('저장 완료(로컬). 페어링 후 자동으로 공유됩니다.');
    }
    if (filled < 5) document.getElementById('status').textContent += `  (${filled}/5 조각)`;
  }

  function setStatus(msg) { document.getElementById('status').textContent = msg; }

  main();
})();
