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
  const ROOT_PROPS = ['x', 'y', 'rot', 'vis', 'flip', 'aura', 'sx', 'sy'];

  function neutral(prop) {
    if (prop === 'vis') return true;
    if (prop === 'flip') return false;
    if (prop === 'sx' || prop === 'sy') return 1;   // 스케일 기본값은 1
    return 0; // rot, x, y, aura
  }
  function isStepProp(prop) { return prop === 'vis' || prop === 'flip'; }

  // 애니메이션 → 트랙({t,v} 목록) 으로 변환. 희소 프레임을 허용한다.
  // 트랙은 애니메이션 자체의 본 키로 만든다(골격에 종속되지 않음). 어떤 골격이든
  // 자신이 필요한 트랙만 animSource 로 골라 쓴다 → 5조각 리그가 동일 시퀀스를 근사 재생.
  function buildTracks(anim) {
    const tracks = { root: {}, bones: {} };
    let duration = 0;

    const frames = anim.frames.slice().sort((a, b) => a.t - b.t);
    for (const fr of frames) {
      duration = Math.max(duration, fr.t);
      if (fr.root) {
        for (const p of ROOT_PROPS) {
          if (p in fr.root) push(tracks.root, p, fr.t, fr.root[p]);
        }
      }
      for (const key of Object.keys(fr)) {
        if (key === 't' || key === 'root') continue;
        const b = (tracks.bones[key] = tracks.bones[key] || {});
        for (const p of BONE_PROPS) {
          if (p in fr[key]) push(b, p, fr.t, fr[key][p]);
        }
      }
    }

    // 각 트랙 시작점을 t0 뉴트럴로 보정
    for (const p of Object.keys(tracks.root)) ensureStart(tracks.root[p], p);
    for (const bn of Object.keys(tracks.bones)) {
      for (const p of Object.keys(tracks.bones[bn])) ensureStart(tracks.bones[bn][p], p);
    }
    return { tracks, duration };

    function push(obj, prop, t, v) {
      (obj[prop] = obj[prop] || []).push({ t, v });
    }
    function ensureStart(arr, prop) {
      arr.sort((a, b) => a.t - b.t);
      if (arr.length === 0 || arr[0].t > 0) arr.unshift({ t: 0, v: neutral(prop) });
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
        return a.v + (b.v - a.v) * k;
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

  // ---- DOM 빌드 ----
  function mount(container, opts) {
    const skeleton = opts.skeleton;
    const rig = opts.rig || { slots: {} };

    const stage = document.createElement('div');
    stage.className = 'rw-stage';
    // 변형 기준점을 발밑(groundY)으로 둔다. 스쿼시/바운스/넘어짐이 "바닥에 선 몸"처럼 읽힌다.
    const groundY = (skeleton.box && skeleton.box.groundY != null) ? skeleton.box.groundY : 0;
    stage.style.transformOrigin = `0px ${groundY}px`;

    const auraEl = document.createElement('div');
    auraEl.className = 'rw-aura';
    stage.appendChild(auraEl);

    const elByName = {};
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
        el.appendChild(part);
      }

      elByName[bone.name] = el;
      const parentEl = bone.parent ? elByName[bone.parent] : stage;
      parentEl.appendChild(el);
    }

    container.appendChild(stage);

    function applyPose(pose) {
      const r = pose.root;
      const flip = r.flip ? -1 : 1;
      const sx = (r.sx == null ? 1 : r.sx) * flip;
      const sy = (r.sy == null ? 1 : r.sy);
      stage.style.transform =
        `translate(${r.x || 0}px, ${r.y || 0}px) rotate(${r.rot || 0}deg) scale(${sx}, ${sy})`;
      stage.style.opacity = r.vis === false ? '0' : '1';
      const aura = r.aura || 0;
      auraEl.style.opacity = aura > 0 ? String(Math.min(1, aura)) : '0';
      auraEl.style.transform = `scale(${1 + aura * 0.5})`;

      for (const bone of skeleton.bones) {
        if (bone.name === 'root') continue;
        const el = elByName[bone.name];
        // 이 본이 읽을 애니메이션 트랙(animSource). 5조각 리그는 예: armR→armR_upper.
        const track = bone.animSource || bone.name;
        const b = pose.bones[track];
        const neutral = bone.neutral || 0;   // 大자 가이드 기준 기본 각도
        const rot = neutral + (b ? (b.rot || 0) : 0);
        const tx = b ? (b.x || 0) : 0;
        const ty = b ? (b.y || 0) : 0;
        el.style.transform = `translate(${tx}px, ${ty}px) rotate(${rot}deg)`;
        el.style.opacity = b && b.vis === false ? '0' : '1';
      }
    }

    // 뉴트럴 포즈
    applyPose({ root: { vis: true }, bones: {} });

    // ---- 재생 ----
    let raf = null;
    let cancelled = false;

    function stop() {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      raf = null;
    }

    function playOne(anim, onDone) {
      const built = buildTracks(anim);
      const start = performance.now();
      cancelled = false;

      function tick(now) {
        if (cancelled) return;
        let t = now - start;
        if (anim.loop && built.duration > 0) t = t % built.duration;
        applyPose(poseAt(built, Math.min(t, anim.loop ? t : built.duration)));
        if (!anim.loop && t >= built.duration) {
          raf = null;
          if (onDone) onDone();
          return;
        }
        raf = requestAnimationFrame(tick);
      }
      raf = requestAnimationFrame(tick);
    }

    // 단일/시퀀스 재생. ids: 문자열 또는 배열.
    function play(ids, options) {
      options = options || {};
      stop();
      const list = Array.isArray(ids) ? ids.slice() : [ids];
      const step = () => {
        if (cancelled) return;
        const id = list.shift();
        if (id == null) { if (options.onDone) options.onDone(); return; }
        const anim = RW.animations.get(id);
        if (!anim) { step(); return; }
        // 시퀀스 중간 항목이 loop 이면 무한이므로 마지막에만 허용
        const isLast = list.length === 0;
        const runAnim = anim.loop && !isLast ? Object.assign({}, anim, { loop: false }) : anim;
        playOne(runAnim, isLast ? (options.onDone || null) : step);
        if (!isLast && runAnim.loop) { /* 방어적: 위에서 loop 해제됨 */ }
      };
      cancelled = false;
      step();
    }

    return { stage, applyPose, play, stop, elByName };
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

  RW.engine = { mount, buildTracks, poseAt };
})(typeof window !== 'undefined' ? window : globalThis);
