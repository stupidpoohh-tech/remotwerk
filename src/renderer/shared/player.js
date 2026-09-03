'use strict';
/* 재생기 — 스프라이트 클립과 5조각 리그를 **같은 인터페이스**로 다룬다.
 *
 * 화면(오버레이·리모컨·설정·뷰어)은 여기만 쓰고, 그림이 스프라이트인지 리그인지
 * 신경 쓰지 않는다. 클립이 있으면 클립, 없으면 리그로 자동 폴백한다.
 *
 * 공통 인터페이스
 *   create(container, charDef, cfg) → {
 *     play(gestureId, { onDone, blend }),  // 동작 재생
 *     stop(),
 *     kind,            // 'sprite' | 'rig'
 *     box,             // 캐릭터 콘텐츠 상자(배치·히트박스용)
 *     stepAdvance(),   // 걷기 한 걸음이 나아가는 논리픽셀(이동 계산용)
 *     cycleMs(),       // 현재 재생 중인 루프 한 바퀴 길이
 *     destroy()
 *   }
 *
 * 재생은 전부 **경과 시간** 기준이다. 60Hz 든 120Hz 든 동작 길이가 같다.
 */

(function (root) {
  const RW = (root.RW = root.RW || {});

  // ---------------------------------------------------------------- 스프라이트
  //
  // 프레임 전환은 **교체**다. 서로 다른 자세를 crossfade 하면 두 그림이 겹쳐 보여
  // 잔상이 된다. 자세를 잇는 일은 그림(중간 프레임)이 담당한다(Animation Bible 4절).
  function createSprite(container, charId) {
    const meta = RW.clips.forCharacter(charId);
    const el = document.createElement('div');
    el.className = 'rw-sprite';
    container.appendChild(el);

    // 프레임 이미지를 미리 로드해 둔다. 준비되기 전에 재생하면 한 프레임이 빈다.
    const preloaded = Object.create(null);
    function preload(clip) {
      for (const f of clip.frames) {
        if (preloaded[f.image]) continue;
        const im = new Image();
        im.src = f.image;
        preloaded[f.image] = im;
      }
    }
    for (const id of Object.keys(meta.clips)) preload(meta.clips[id]);

    // 캔버스 기준점을 화면 기준점(골반이 아니라 **발밑**)에 맞춰 배치한다.
    // 캔버스 픽셀 → 논리 픽셀. 리그로 그리던 크기와 맞춘 값이라, 스프라이트가 있든
    // 없든 캐릭터가 같은 크기로 보인다(예전엔 캔버스 높이로 나눠서 절반 크기가 됐다).
    const canvas = meta.canvas, anchor = meta.anchor;
    const scale = meta.displayScale || (meta.displayHeight / canvas.h);
    el.style.position = 'absolute';
    el.style.width = canvas.w + 'px';
    el.style.height = canvas.h + 'px';
    el.style.left = -anchor.x + 'px';
    el.style.top = -anchor.y + 'px';
    el.style.transformOrigin = `${anchor.x}px ${anchor.y}px`;
    el.style.backgroundRepeat = 'no-repeat';
    el.style.backgroundSize = '100% 100%';
    el.style.imageRendering = 'pixelated';

    let flip = false;
    function applyTransform() {
      el.style.transform = `scale(${flip ? -scale : scale}, ${scale})`;
    }
    applyTransform();

    // 콘텐츠 상자 — 리그의 box 와 **같은 의미**여야 한다(배치·히트박스가 이걸로 계산된다).
    //
    // 캔버스(512×512) 를 그대로 쓰면 대부분이 빈 공간이라, 상자 높이로 배율을 정하는
    // 화면들이 스프라이트만 절반 크기로 줄여 버린다. 그래서 **서 있는 자세(idle)가
    // 실제로 차지하는 영역**을 상자로 삼는다. 원점은 발밑이므로 groundY = 0.
    const box = (function () {
      const idle = RW.clips.get(charId, 'idle');
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const f of (idle ? idle.frames : [])) {
        if (!f.bbox) continue;
        x0 = Math.min(x0, f.bbox[0]); y0 = Math.min(y0, f.bbox[1]);
        x1 = Math.max(x1, f.bbox[2]); y1 = Math.max(y1, f.bbox[3]);
      }
      if (!isFinite(x0)) { x0 = 0; y0 = 0; x1 = canvas.w - 1; y1 = canvas.h - 1; }
      const PAD = 8;   // 리그 상자와 같은 여유
      return {
        w: Math.round((x1 - x0 + 1) * scale) + PAD * 2,
        h: Math.round((y1 - y0 + 1) * scale) + PAD * 2,
        originX: Math.round((anchor.x - x0) * scale) + PAD,
        originY: Math.round((anchor.y - y0) * scale) + PAD,
        groundY: 0
      };
    })();

    let raf = null, cancelled = false;
    let cur = null;              // { seq:[{image,dur}], total, loop, startedAt }
    let curClipId = null;

    function buildSeq(plan) {
      const seq = [];
      for (const part of plan.parts) {
        const clip = RW.clips.get(charId, part.clip);
        for (let r = 0; r < (part.repeat || 1); r++) {
          for (const f of clip.frames) seq.push({ image: f.image, dur: f.dur, bbox: f.bbox, clip: part.clip });
        }
      }
      let total = 0;
      for (const f of seq) total += f.dur;
      return { seq, total };
    }

    let curFrame = null;
    function show(frame) {
      curFrame = frame;
      if (el.dataset.img === frame.image) return;
      el.dataset.img = frame.image;
      el.style.backgroundImage = `url("${frame.image}")`;
    }

    // 지금 그려진 **그림**의 화면 좌표 상자.
    //
    // 스프라이트는 캔버스가 고정이라 엘리먼트 크기만 보면 캐릭터가 어디 있는지 알 수 없다
    // (점프해도 엘리먼트는 그대로다). 프레임마다 저장해 둔 bbox 를 화면 좌표로 옮긴다.
    function contentRect() {
      const r = el.getBoundingClientRect();
      const bb = curFrame && curFrame.bbox;
      if (!bb || !r.width) return r;
      const fx = r.width / canvas.w, fy = r.height / canvas.h;
      const left = flip ? r.right - (bb[2] + 1) * fx : r.left + bb[0] * fx;
      const right = flip ? r.right - bb[0] * fx : r.left + (bb[2] + 1) * fx;
      return { left, right, top: r.top + bb[1] * fy, bottom: r.top + (bb[3] + 1) * fy,
               width: right - left, height: (bb[3] + 1 - bb[1]) * fy };
    }

    function stop() {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      raf = null;
    }

    function play(gestureId, options) {
      options = options || {};
      const plan = RW.clips.planFor(charId, gestureId);
      if (!plan) return false;
      stop();
      cancelled = false;
      curClipId = gestureId;
      const built = buildSeq(plan);
      cur = built;
      const loop = plan.loop;
      const start = performance.now();

      function tick(now) {
        if (cancelled) return;
        const elapsed = now - start;
        let t = elapsed;
        if (loop && built.total > 0) t = elapsed % built.total;

        // 경과 시간 → 프레임. 프레임마다 유지 시간이 다르다.
        let acc = 0, frame = built.seq[built.seq.length - 1];
        for (const f of built.seq) {
          if (t < acc + f.dur) { frame = f; break; }
          acc += f.dur;
        }
        show(frame);

        if (!loop && elapsed >= built.total) {
          raf = null;
          if (options.onDone) options.onDone();
          return;
        }
        raf = requestAnimationFrame(tick);
      }
      raf = requestAnimationFrame(tick);
      return true;
    }

    return {
      kind: 'sprite',
      box,
      play,
      stop,
      setFlip(v) { if (flip !== !!v) { flip = !!v; applyTransform(); } },
      stepAdvance() {
        const w = RW.clips.get(charId, 'walk');
        return (w && w.stepAdvance) || 0;
      },
      cycleMs() { return cur ? cur.total : 0; },
      currentGesture() { return curClipId; },
      contentRect,
      placeholder: RW.clips.placeholders(charId).length > 0,
      destroy() { stop(); el.remove(); }
    };
  }

  // ---------------------------------------------------------------------- 리그
  // 기존 5조각 경로. 사용자 업로드 캐릭터와 아직 클립이 없는 캐릭터가 쓴다.
  function createRig(container, spec) {
    const ctrl = RW.engine.mount(container, spec);
    let curId = null;
    return {
      kind: 'rig',
      box: spec.skeleton.box,
      play(gestureId, options) {
        if (!RW.animations.get(gestureId)) return false;
        curId = gestureId;
        ctrl.play(gestureId, options || {});
        return true;
      },
      stop() { ctrl.stop(); },
      setFlip() { /* 리그는 클립 안에서 flip 을 다룬다 */ },
      stepAdvance() {
        const a = RW.animations.get('wander');
        return (a && a.stepAdvance) || 0;
      },
      cycleMs() {
        const a = RW.animations.get(curId);
        return a ? RW.engine.buildTracks(a).duration : 0;
      },
      currentGesture() { return curId; },
      contentRect() {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const e of container.querySelectorAll('.rw-part')) {
          const r = e.getBoundingClientRect();
          if (!r.width) continue;
          x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top);
          x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
        }
        if (!isFinite(x0)) return container.getBoundingClientRect();
        return { left: x0, top: y0, right: x1, bottom: y1, width: x1 - x0, height: y1 - y0 };
      },
      placeholder: false,
      destroy() { ctrl.stop(); container.innerHTML = ''; },
      ctrl
    };
  }

  // ------------------------------------------------------------------- 팩토리
  //
  // charDef 는 characters.rigFor 가 주는 { skeleton, rig } 이고, charId 는 클립을
  // 찾기 위한 캐릭터 id 다. 클립이 **모든 동작**에 대해 준비된 경우에만 스프라이트를
  // 쓴다(일부만 있으면 동작마다 화풍이 튀어서 더 어색하다).
  const REQUIRED = ['idle', 'wander', 'g_heart', 'g_cheer', 'g_droop', 'g_twerk'];

  function canUseSprite(charId) {
    if (!RW.clips || !charId) return false;
    return REQUIRED.every((g) => RW.clips.planFor(charId, g) !== null);
  }

  function create(container, charId, spec) {
    if (canUseSprite(charId)) return createSprite(container, charId);
    return createRig(container, spec);
  }

  RW.player = { create, canUseSprite, createRig, createSprite, REQUIRED };
})(typeof window !== 'undefined' ? window : globalThis);
