'use strict';
/* 전체 변형(deform) — **완성된 캐릭터 하나를 통째로** 눌렀다 펴는 카툰 연출.
 *
 * 왜 별도인가: 기존 애니메이션은 골격의 본을 각각 움직인다. 그건 조각마다 다른 비율로
 * 눌려 이음매가 벌어질 수 있고, 스프라이트(완성 프레임)에는 아예 적용할 수 없다.
 * 여기서 정의하는 변형은 재생기가 **그려 놓은 결과 전체**에 한 번만 곱한다.
 *   - 스프라이트: 기본 자세 완성 프레임에
 *   - 리그: 조립이 끝난 캐릭터 전체에
 * 그래서 조각이 서로 벌어지지 않고, 새 원화도 필요 없다.
 *
 * 기준점은 **캐릭터의 발밑 기준점**이다(이미지 사각형의 맨 아래가 아니다).
 * 재생기가 변형 레이어를 기준점 위치에 두고 transform-origin 을 0 0 으로 잡는다.
 * 화면 배율·좌우 반전·화면 위치는 바깥 레이어가 따로 가지고 있어서 그대로 곱해진다.
 */

(function (root) {
  const RW = (root.RW = root.RW || {});

  // 구간별 이징. 오버슈트(원래 크기를 넘어가는 반동)는 쓰지 않는다 — 젤리가 아니라 피로다.
  const EASE = {
    out: (t) => 1 - Math.pow(1 - t, 3),          // 끝에서 감속 — 힘이 스르르 빠진다
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
  };

  // 40ms 격자(Animation Bible 7절)에 맞춘 실제 사용값. 합계 2080ms.
  const DEFORMS = {
    // 지쳤어 — 기운을 다 써서 납작해졌다가 천천히 회복한다.
    g_droop: {
      id: 'g_droop',
      phases: [
        // 사전 점프·위로 늘어나는 준비 동작 없음. 바로 내려앉는다.
        { ms: 440,  from: { sx: 1,    sy: 1    }, to: { sx: 1.18, sy: 0.78 }, ease: 'out' },
        // "나 이제 못 해…" — 반복 바운스·좌우 흔들림·호흡 없이 그대로 멈춘다.
        { ms: 1000, from: { sx: 1.18, sy: 0.78 }, to: { sx: 1.18, sy: 0.78 }, ease: 'out' },
        // 천천히 원래 비율로. 오버슈트 없이 정확히 1.0 으로 끝난다.
        { ms: 640,  from: { sx: 1.18, sy: 0.78 }, to: { sx: 1,    sy: 1    }, ease: 'inOut' }
      ]
    }
  };

  for (const d of Object.values(DEFORMS)) {
    d.duration = d.phases.reduce((a, p) => a + p.ms, 0);
  }

  function get(gestureId) { return DEFORMS[gestureId] || null; }

  // 경과 시간 → 배율. 프레임 수에 의존하지 않는다.
  function at(def, t) {
    if (!def) return { sx: 1, sy: 1 };
    if (t >= def.duration) {
      const last = def.phases[def.phases.length - 1].to;
      return { sx: last.sx, sy: last.sy };      // 정확히 원래 비율로 끝난다
    }
    let acc = 0;
    for (const p of def.phases) {
      if (t < acc + p.ms) {
        const k = (EASE[p.ease] || EASE.inOut)((t - acc) / p.ms);
        return {
          sx: p.from.sx + (p.to.sx - p.from.sx) * k,
          sy: p.from.sy + (p.to.sy - p.from.sy) * k
        };
      }
      acc += p.ms;
    }
    const last = def.phases[def.phases.length - 1].to;
    return { sx: last.sx, sy: last.sy };
  }

  // 변형 중 캐릭터가 커질 수 있는 최대 배율.
  // 화면 끝 배치를 계산할 때 이만큼 여백을 미리 확보해야 눌렸을 때 잘리지 않는다.
  function maxScale() {
    let sx = 1, sy = 1;
    for (const d of Object.values(DEFORMS)) {
      for (const p of d.phases) {
        sx = Math.max(sx, p.from.sx, p.to.sx);
        sy = Math.max(sy, p.from.sy, p.to.sy);
      }
    }
    return { sx, sy };
  }

  RW.deform = { get, at, maxScale, DEFORMS, EASE };
})(typeof window !== 'undefined' ? window : globalThis);
