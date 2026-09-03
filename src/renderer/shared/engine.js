'use strict';
/* 재생 엔진 — 골격 기반.
 *
 * skeleton(본 계층) + rig(부위 이미지/색) 로 DOM 캐릭터를 만들고,
 * animations.js 의 키프레임 시퀀스를 트랙으로 펼쳐 보간 재생한다.
 * 지금은 프리셋만 다루지만, Prompt B 의 업로드 캐릭터도 같은 rig 포맷이면
 * 이 엔진에 그대로 얹힌다.
 */

(function (root) {
  const RW = (root.RW = root.RW || {});

  const BONE_PROPS = ['rot', 'x', 'y', 'vis'];
  // sx/sy = 스쿼시&스트레치. 치비 체형은 관절 회전보다 몸 전체의 눌림/늘어남이 더 잘 읽힌다.
  const ROOT_PROPS = ['x', 'y', 'rot', 'vis', 'flip', 'fx', 'sx', 'sy', 'back'];

  function neutral(prop) {
    if (prop === 'vis') return true;
    if (prop === 'flip' || prop === 'back') return false;
    if (prop === 'sx' || prop === 'sy') return 1;   // 스케일 기본값은 1
    return 0; // rot, x, y, fx(이펙트 강도)
  }
  function isStepProp(prop) { return prop === 'vis' || prop === 'flip' || prop === 'back'; }

  // 이징 — 구간이 끝나는 키프레임의 ease 값이 그 구간에 적용된다.
  //
  // 선형만 쓰면 점프 정점과 착지에서 속도가 뚝 꺾인다(가속·감속이 없다). 기본값을
  // easeInOut 으로 두고, 일부러 일정한 속도가 필요한 곳(걷기의 전진 등)만 linear 로 뺀다.
  const EASES = {
    linear: (k) => k,
    in: (k) => k * k,                                   // 천천히 시작
    out: (k) => 1 - (1 - k) * (1 - k),                  // 빠르게 시작해 감속(착지·안정)
    inOut: (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2),
    // 반동 — 목표를 살짝 지나쳤다 돌아온다. 준비→주요 동작 전환에 쓴다.
    back: (k) => 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2)
  };
  function easeFn(name) { return EASES[name] || EASES.inOut; }

  function buildTracks(anim) {
    const tracks = { root: {}, bones: {} };
    let duration = 0;

    const frames = anim.frames.slice().sort((a, b) => a.t - b.t);
    for (const fr of frames) {
      duration = Math.max(duration, fr.t);
      const e = fr.ease;                     // 이 키프레임으로 들어오는 구간의 이징
      if (fr.root) {
        for (const p of ROOT_PROPS) {
          if (p in fr.root) push(tracks.root, p, fr.t, fr.root[p], e);
        }
      }
      for (const key of Object.keys(fr)) {
        if (key === 't' || key === 'root' || key === 'ease') continue;
        const b = (tracks.bones[key] = tracks.bones[key] || {});
        for (const p of BONE_PROPS) {
          if (p in fr[key]) push(b, p, fr.t, fr[key][p], e);
        }
      }
    }

    // 각 트랙 시작점을 t0 뉴트럴로 보정
    for (const p of Object.keys(tracks.root)) ensureStart(tracks.root[p], p);
    for (const bn of Object.keys(tracks.bones)) {
      for (const p of Object.keys(tracks.bones[bn])) ensureStart(tracks.bones[bn][p], p);
    }
    // 루프 클립은 끝에서 처음으로 이어져야 한다. 마지막 키가 duration 보다 앞에 있으면
    // 그 값이 끝까지 유지되다가 0 으로 툭 돌아간다(wander 의 다리가 ±17° 에서 0 으로 튀었다).
    // duration 지점에 t=0 값과 같은 키를 넣어 한 바퀴가 닫히게 한다.
    if (anim.loop && duration > 0) {
      for (const p of Object.keys(tracks.root)) closeLoop(tracks.root[p]);
      for (const bn of Object.keys(tracks.bones)) {
        for (const p of Object.keys(tracks.bones[bn])) closeLoop(tracks.bones[bn][p]);
      }
    }
    // 일회 클립의 안정(settle) 구간 — 마지막에 접합 자세로 되돌린다.
    //
    // 희소 키프레임은 마지막 값이 그대로 유지된다. 그래서 지쳤어가 끝나도 몸이 웅크린
    // 채 멈춰 있다가, 다음 동작이 시작되는 순간 홱 펴졌다. Animation Bible 4절의
    // "모든 클립은 접합 자세로 끝난다"를 데이터가 아니라 여기서 보장한다.
    const settle = anim.settle || 0;
    if (!anim.loop && settle > 0) {
      const end = duration + settle;
      for (const p of Object.keys(tracks.root)) settleTo(tracks.root[p], p, end);
      for (const bn of Object.keys(tracks.bones)) {
        for (const p of Object.keys(tracks.bones[bn])) settleTo(tracks.bones[bn][p], p, end);
      }
      duration = end;
    }
    return { tracks, duration, loop: !!anim.loop };

    function push(obj, prop, t, v, e) {
      (obj[prop] = obj[prop] || []).push({ t, v, e });
    }
    function ensureStart(arr, prop) {
      arr.sort((a, b) => a.t - b.t);
      if (arr.length === 0 || arr[0].t > 0) arr.unshift({ t: 0, v: neutral(prop) });
    }
    function closeLoop(arr) {
      const last = arr[arr.length - 1];
      if (last.t < duration) arr.push({ t: duration, v: arr[0].v, e: last.e });
    }
    function settleTo(arr, prop, end) {
      const n = neutral(prop);
      const last = arr[arr.length - 1];
      if (last.v !== n) arr.push({ t: end, v: n, e: 'out' });
    }
  }

  function sample(arr, prop, time) {
    if (!arr || arr.length === 0) return neutral(prop);
    if (time <= arr[0].t) return arr[0].v;
    if (time >= arr[arr.length - 1].t) return arr[arr.length - 1].v;
    for (let i = 0; i < arr.length - 1; i++) {
      const a = arr[i], b = arr[i + 1];
      if (time >= a.t && time <= b.t) {
        if (isStepProp(prop)) return a.v;
        const k = (time - a.t) / (b.t - a.t || 1);
        return a.v + (b.v - a.v) * easeFn(b.e)(k);
      }
    }
    return arr[arr.length - 1].v;
  }

  function poseAt(built, time) {
    const t = built.tracks;
    const pose = { root: {}, bones: {} };
    for (const p of ROOT_PROPS) pose.root[p] = sample(t.root[p], p, time);
    for (const bn of Object.keys(t.bones)) {
      pose.bones[bn] = {};
      for (const p of BONE_PROPS) pose.bones[bn][p] = sample(t.bones[bn][p], p, time);
    }
    return pose;
  }

  // 두 포즈 사이를 섞는다(k=0 → a, k=1 → b). 새 동작을 **현재 자세에서** 시작하기 위한 것.
  // 계단 속성(vis/flip/back)은 중간값이 없으므로 절반을 넘으면 바뀐다.
  function blendPose(a, b, k) {
    const out = { root: {}, bones: {} };
    for (const p of ROOT_PROPS) {
      const va = a.root[p], vb = b.root[p];
      out.root[p] = isStepProp(p) ? (k < 0.5 ? va : vb)
        : (va == null ? vb : va + (vb - va) * k);
    }
    const names = new Set(Object.keys(a.bones).concat(Object.keys(b.bones)));
    for (const bn of names) {
      const ba = a.bones[bn] || {}, bb = b.bones[bn] || {};
      out.bones[bn] = {};
      for (const p of BONE_PROPS) {
        const va = ba[p] == null ? neutral(p) : ba[p];
        const vb = bb[p] == null ? neutral(p) : bb[p];
        out.bones[bn][p] = isStepProp(p) ? (k < 0.5 ? va : vb) : va + (vb - va) * k;
      }
    }
    return out;
  }

  // ---- DOM 빌드 ----
  function mount(container, opts) {
    const skeleton = opts.skeleton;
    const rig = opts.rig || { slots: {} };

    const stage = document.createElement('div');
    stage.className = 'rw-stage';
    // 변형 기준점을 발밑(groundY)으로 둔다. 스쿼시/바운스/넘어짐이 "바닥에 선 몸"처럼 읽힌다.
    const groundY = (skeleton.box && skeleton.box.groundY != null) ? skeleton.box.groundY : 0;
    stage.style.transformOrigin = `0px ${groundY}px`;

    // 이펙트 레이어 — 골격과 무관해서 신호를 구분짓는 가장 확실한 수단이다.
    // 종류는 애니메이션 메타(anim.fx)가 정하고, 세기는 root.fx 트랙이 보간한다.
    const fxEl = document.createElement('div');
    fxEl.className = 'rw-fx';
    for (let i = 0; i < 3; i++) fxEl.appendChild(document.createElement('span'));
    stage.appendChild(fxEl);
    const FX_GLYPH = { heart: '\u{1F495}', sparkle: '\u2728', droop: '\u{1F4A6}' };
    function setFxType(type) {
      fxEl.className = 'rw-fx' + (type ? ' rw-fx-' + type : '');
      const ch = FX_GLYPH[type] || '';
      for (const sp of fxEl.children) sp.textContent = ch;
    }

    const elByName = {};
    const partBySlot = {};   // 슬롯 → { el, front, back } — 뒤돌기용 이미지 교체
    for (const bone of skeleton.bones) {
      const el = document.createElement('div');
      el.className = 'rw-bone rw-bone-' + bone.name;
      el.style.position = 'absolute';
      el.style.left = (bone.name === 'root' ? 0 : bone.pivotOffset[0]) + 'px';
      el.style.top = (bone.name === 'root' ? 0 : bone.pivotOffset[1]) + 'px';
      el.style.transformOrigin = '0 0';

      const slotStyle = bone.part && rig.slots ? rig.slots[bone.part.slot] : null;
      // z-순서: rig 슬롯이 지정하면 우선(템플릿 기본값을 조정 가능)
      const z = slotStyle && slotStyle.z != null ? slotStyle.z : bone.z;
      if (z != null) el.style.zIndex = String(z);

      // 파트 렌더: 이미지(커스텀 업로드) 또는 색(프리셋)이 있을 때만.
      // 빈 슬롯은 크래시 없이 건너뛴다(5조각 중 일부 비어도 OK).
      if (bone.part && slotStyle && (slotStyle.image || slotStyle.color)) {
        const P = bone.part;
        // fit(사용자 정합값)이 있으면 그 상자로, 없으면 골격 기본 상자로.
        const box = slotStyle.fit || P;
        const part = document.createElement('div');
        part.className = 'rw-part rw-slot-' + P.slot;
        part.style.position = 'absolute';
        // 그림 자체에도 z 를 준다.
        //
        // 본 엘리먼트는 부모 본 **안에** 들어 있다. 그래서 본에 준 z-index 는 부모가 만든
        // 쌓임 맥락 안에서만 의미가 있고, 부모의 그림(.rw-part)은 z-index 가 없어서
        // 자식 본들이 무조건 그 위에 그려졌다. 5조각 리그는 팔다리가 전부 몸통의
        // 자식이라, "팔다리를 몸통 뒤로" 라고 지정해도 실제로는 앞에 그려지고 있었다.
        // 부모의 그림에도 같은 z 를 주면 자식 본들과 같은 맥락에서 순서가 정해진다.
        if (z != null) part.style.zIndex = String(z);
        part.style.left = box.x + 'px';
        part.style.top = box.y + 'px';
        part.style.width = box.w + 'px';
        part.style.height = box.h + 'px';
        if (!slotStyle.image && P.shape === 'ellipse') part.style.borderRadius = '50%';
        // fit 회전은 관절(pivot=0,0) 중심으로 정적으로 굽는다(툴과 동일 규칙).
        if (slotStyle.fit && slotStyle.fit.rot) {
          part.style.transformOrigin = `${-box.x}px ${-box.y}px`;
          part.style.transform = `rotate(${slotStyle.fit.rot}deg)`;
        }
        applySlotStyle(part, slotStyle, P);
        const backSlot = rig.slotsBack && rig.slotsBack[P.slot];
        partBySlot[P.slot] = {
          el: part,
          front: slotStyle.image || null,
          back: (backSlot && backSlot.image) || null
        };
        el.appendChild(part);
      }

      elByName[bone.name] = el;
      const parentEl = bone.parent ? elByName[bone.parent] : stage;
      parentEl.appendChild(el);
    }

    container.appendChild(stage);

    let showingBack = false;

    function applyPose(pose) {
      const r = pose.root;
      const flip = r.flip ? -1 : 1;
      const sx = (r.sx == null ? 1 : r.sx) * flip;
      const sy = (r.sy == null ? 1 : r.sy);
      stage.style.transform =
        `translate(${r.x || 0}px, ${r.y || 0}px) rotate(${r.rot || 0}deg) scale(${sx}, ${sy})`;
      stage.style.opacity = r.vis === false ? '0' : '1';
      const fx = r.fx || 0;
      fxEl.style.opacity = fx > 0 ? String(Math.min(1, fx)) : '0';

      // 뒤돌기 — 뒷모습 이미지가 있는 슬롯만 교체한다(없으면 앞모습 그대로, 깨지지 않음).
      const wantBack = !!r.back;
      if (wantBack !== showingBack) {
        showingBack = wantBack;
        for (const slot of Object.keys(partBySlot)) {
          const pb = partBySlot[slot];
          const src = (wantBack && pb.back) ? pb.back : pb.front;
          if (src) pb.el.style.backgroundImage = `url("${src}")`;
        }
      }

      for (const bone of skeleton.bones) {
        if (bone.name === 'root') continue;
        const el = elByName[bone.name];
        // 이 본이 읽을 애니메이션 트랙(animSource). 5조각 리그는 예: armR→armR_upper.
        const track = bone.animSource || bone.name;
        const b = pose.bones[track];
        const neutral = bone.neutral || 0;   // 大자 가이드 기준 기본 각도
        // animScale = 이 골격에서 관절 회전을 얼마나 받아들일지(기본 1).
        // 애니메이션은 팔다리가 가는 상세 골격 기준으로 만들었는데, 5조각 리그의
        // '몸통'은 머리까지 포함한 몸 전체라 같은 각도를 그대로 주면 과하게 꺾인다.
        const k = bone.animScale == null ? 1 : bone.animScale;
        const rot = neutral + (b ? (b.rot || 0) : 0) * k;
        const tx = b ? (b.x || 0) : 0;
        const ty = b ? (b.y || 0) : 0;
        el.style.transform = `translate(${tx}px, ${ty}px) rotate(${rot}deg)`;
        el.style.opacity = b && b.vis === false ? '0' : '1';
      }
    }

    // 뉴트럴 포즈
    setFxType(null);
    const NEUTRAL_POSE = poseAt(buildTracks({ frames: [{ t: 0 }] }), 0);
    let curPose = NEUTRAL_POSE;
    applyPose(curPose);

    // ---- 재생 ----
    // 모든 재생은 **경과 시간**으로 진행한다(주사율이 60Hz 든 120Hz 든 길이가 같다).
    let raf = null;
    let cancelled = false;

    function stop() {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      raf = null;
    }

    // 새 동작은 **지금 자세에서** 이어 시작한다.
    // 예전에는 무조건 클립의 t=0(뉴트럴)로 튀어서, 지쳤어가 끝나며 웅크린 자세였다가
    // 멍때리기가 시작되는 순간 몸이 홱 펴졌다.
    const DEFAULT_BLEND_MS = 180;

    function playOne(anim, onDone, blendMs) {
      setFxType(anim.fx || null);
      const built = buildTracks(anim);
      const from = curPose;
      const blend = Math.max(0, blendMs == null ? DEFAULT_BLEND_MS : blendMs);
      const start = performance.now();
      cancelled = false;

      function tick(now) {
        if (cancelled) return;
        const elapsed = now - start;
        let t = elapsed;
        if (anim.loop && built.duration > 0) t = elapsed % built.duration;
        else t = Math.min(elapsed, built.duration);

        let pose = poseAt(built, t);
        if (blend > 0 && elapsed < blend) {
          pose = blendPose(from, pose, elapsed / blend);
        }
        curPose = pose;
        applyPose(pose);

        if (!anim.loop && elapsed >= built.duration) {
          raf = null;
          if (onDone) onDone();
          return;
        }
        raf = requestAnimationFrame(tick);
      }
      raf = requestAnimationFrame(tick);
    }

    // 단일/시퀀스 재생. ids: 문자열 또는 배열.
    //   options.blend  : 이어받기 시간(ms). 0 이면 즉시 전환.
    //   options.onDone : 마지막 클립이 끝나면 호출(루프면 호출되지 않는다).
    function play(ids, options) {
      options = options || {};
      stop();
      const list = Array.isArray(ids) ? ids.slice() : [ids];
      let first = true;
      const step = () => {
        if (cancelled) return;
        const id = list.shift();
        if (id == null) { if (options.onDone) options.onDone(); return; }
        const anim = RW.animations.get(id);
        if (!anim) { step(); return; }
        // 시퀀스 중간 항목이 loop 이면 무한이므로 마지막에만 허용
        const isLast = list.length === 0;
        const runAnim = anim.loop && !isLast ? Object.assign({}, anim, { loop: false }) : anim;
        // 시퀀스 안에서는 이미 이어진 자세라 추가 블렌딩이 필요 없다.
        playOne(runAnim, isLast ? (options.onDone || null) : step, first ? options.blend : 0);
        first = false;
      };
      cancelled = false;
      step();
    }

    // 지금 자세(다른 재생기로 넘겨줄 때 쓴다)
    function getPose() { return curPose; }

    return { stage, applyPose, play, stop, getPose, elByName };
  }

  function applySlotStyle(el, slot, part) {
    slot = slot || {};
    if (slot.image) {
      el.style.backgroundImage = `url("${slot.image}")`;
      el.style.backgroundSize = 'contain';
      el.style.backgroundRepeat = 'no-repeat';
      el.style.backgroundPosition = 'center';
    } else {
      el.style.background = slot.color || '#c9a1ff';
    }
    if (slot.border) el.style.border = slot.border;
    if (slot.radius != null && part.shape !== 'ellipse') {
      el.style.borderRadius = slot.radius + 'px';
    }
  }

  // 미리보기 배치 — 앵커(캐릭터 원점=골반)를 무대 안에 앉힌다.
  //
  // 캐릭터마다 다리 길이(groundY)와 전체 높이(box.h)가 달라서, CSS 로 top/배율을
  // 박아 두면 어떤 캐릭터는 발이 잘리고 어떤 캐릭터는 머리가 잘렸다. 그래서 발이
  // 바닥선(feetY)에 닿도록 top 을 계산하고, 배율은 머리 끝까지 들어오게 정한다.
  //
  //   opts.feetY   바닥선(무대 좌표, 필수)
  //   opts.height  캐릭터가 쓸 수 있는 세로 공간. 주면 배율을 여기서 계산한다.
  //   opts.scale   배율을 직접 지정(사용자 크기 설정처럼 배율이 이미 정해진 경우)
  //   opts.maxScale 계산된 배율의 상한(작은 캐릭터를 과하게 키우지 않게)
  function fitAnchor(el, skeleton, opts) {
    opts = opts || {};
    const box = (skeleton && skeleton.box) || {};
    const groundY = box.groundY != null ? box.groundY : 86;
    const totalH = Math.max(1, box.h != null ? box.h : 210);
    let scale = opts.scale;
    if (scale == null) {
      scale = (opts.height != null ? opts.height : opts.feetY) / totalH;
      if (opts.maxScale != null) scale = Math.min(opts.maxScale, scale);
    }
    el.style.transformOrigin = '0 0';
    el.style.transform = `scale(${Number(scale.toFixed(4))})`;
    el.style.top = Number((opts.feetY - groundY * scale).toFixed(1)) + 'px';
    return scale;
  }

  RW.engine = { mount, buildTracks, poseAt, blendPose, fitAnchor, EASES };
})(typeof window !== 'undefined' ? window : globalThis);
