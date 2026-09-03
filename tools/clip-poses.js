'use strict';
/* 임시 스프라이트를 구울 때 쓰는 **연기 자세 정의**.
 *
 * ⚠ 이건 그림이 아니다. 원본 5조각을 자세만 잡아 굽기 위한 좌표다.
 *   진짜 아트는 docs/art-orders.md 대로 새로 그려서 같은 경로에 넣는다.
 *
 * 자세는 Animation Bible 6절의 프레임 예산과 연기 규칙(준비→주요→반동→안정)을 따른다.
 * 값은 리그의 **최종 각도**다(굽는 쪽에서 animScale 을 1 로 두고 그대로 적용한다).
 *
 *   root: x, y(위가 음수), rot, sx, sy, back(뒷모습), flip
 *   bones: torso / armL_upper / armR_upper / legL_upper / legR_upper 의 rot
 */

const P = (root, bones) => ({ root: root || {}, bones: bones || {} });

// 접합 자세 — 모든 클립이 여기서 시작해 여기로 끝난다.
const NEUTRAL = P({}, {});

const CLIPS = {
  // ── 대기: 숨쉬기 4장 ────────────────────────────────────────────────
  idle: {
    loop: true, cancelFrom: 0,
    frames: [
      { dur: 700, pose: NEUTRAL },
      { dur: 500, pose: P({ sy: 1.03, sx: 0.98 }, { armL_upper: { rot: 3 }, armR_upper: { rot: -3 } }) },
      { dur: 500, pose: P({ sy: 1.05, sx: 0.97 }, { armL_upper: { rot: 5 }, armR_upper: { rot: -5 }, torso: { rot: 0 } }) },
      { dur: 700, pose: P({ sy: 0.97, sx: 1.02 }, { armL_upper: { rot: 1 }, armR_upper: { rot: -1 } }) }
    ]
  },

  // ── 걷기: 제자리걸음 8장(2걸음) ─────────────────────────────────────
  // 화면 이동은 코드가 한다. stepAdvance = 한 걸음이 나아가는 논리픽셀.
  walk: {
    loop: true, cancelFrom: 0, stepAdvance: 26,
    frames: [
      { dur: 160, ground: ['L'],      pose: P({ sy: 0.98, sx: 1.02 }, { legL_upper: { rot: -9 }, legR_upper: { rot: 9 }, armL_upper: { rot: 11 }, armR_upper: { rot: -11 } }) },
      { dur: 160, ground: ['L', 'R'], pose: P({ y: -5, sy: 1.04, sx: 0.97, rot: -1.5 }, { legL_upper: { rot: -6 }, legR_upper: { rot: 8 }, armL_upper: { rot: 6 }, armR_upper: { rot: -6 } }) },
      { dur: 160, ground: ['L'],      pose: P({ sy: 0.99, sx: 1.01 }, { legL_upper: { rot: 3 }, legR_upper: { rot: -3 }, armL_upper: { rot: -2 }, armR_upper: { rot: 2 } }) },
      { dur: 160, ground: ['L'],      pose: P({}, { legL_upper: { rot: 7 }, legR_upper: { rot: -7 }, armL_upper: { rot: -7 }, armR_upper: { rot: 7 } }) },
      { dur: 160, ground: ['R'],      pose: P({ sy: 0.98, sx: 1.02 }, { legL_upper: { rot: 9 }, legR_upper: { rot: -9 }, armL_upper: { rot: -11 }, armR_upper: { rot: 11 } }) },
      { dur: 160, ground: ['L', 'R'], pose: P({ y: -5, sy: 1.04, sx: 0.97, rot: 1.5 }, { legL_upper: { rot: 8 }, legR_upper: { rot: -6 }, armL_upper: { rot: -6 }, armR_upper: { rot: 6 } }) },
      { dur: 160, ground: ['R'],      pose: P({ sy: 0.99, sx: 1.01 }, { legL_upper: { rot: -3 }, legR_upper: { rot: 3 }, armL_upper: { rot: 2 }, armR_upper: { rot: -2 } }) },
      { dur: 160, ground: ['R'],      pose: P({}, { legL_upper: { rot: -7 }, legR_upper: { rot: 7 }, armL_upper: { rot: 7 }, armR_upper: { rot: -7 } }) }
    ]
  },

  // ── 💗 보고싶어: 준비 → 작은 폴짝 → 정점 → 착지 → 안정 ─────────────
  g_heart: {
    loop: false, cancelFrom: 4, fx: 'heart',
    frames: [
      { dur: 120, pose: NEUTRAL },
      { dur: 200, pose: P({ sy: 0.90, sx: 1.06 }, { armL_upper: { rot: -8 }, armR_upper: { rot: 8 }, legL_upper: { rot: 4 }, legR_upper: { rot: -4 } }) },   // 준비(반대 방향)
      { dur: 200, air: true, pose: P({ y: -12, sy: 1.05, sx: 0.96 }, { armL_upper: { rot: 26 }, armR_upper: { rot: -26 } }) },
      { dur: 280, air: true, pose: P({ y: -17, sy: 1.07, sx: 0.95, rot: -3 }, { armL_upper: { rot: 34 }, armR_upper: { rot: -34 }, torso: { rot: -2.5 } }) },                    // 정점
      // 정점에서 착지로 바로 넘기면 몸이 왼쪽→오른쪽으로 33px 순간이동한다.
      // 하강하며 가운데를 지나는 중간 자세를 한 장 넣는다.
      { dur: 120, air: true, pose: P({ y: -8, sy: 1.02, sx: 0.98 }, { armL_upper: { rot: 22 }, armR_upper: { rot: -22 } }) },
      { dur: 220, pose: P({ sy: 0.92, sx: 1.05, rot: 1.5 }, { armL_upper: { rot: 12 }, armR_upper: { rot: -12 }, torso: { rot: 1 } }) },                        // 착지 반동
      { dur: 320, pose: NEUTRAL }
    ]
  },

  // ── ✨ 신나: 크게 웅크렸다 도약 → 정점 → 하강 → 착지 → 안정 ─────────
  // 재생 순서에서 02~05 를 3회 반복한다(같은 그림 재사용).
  g_cheer: {
    loop: false, cancelFrom: 6, fx: 'sparkle',
    sequence: [0, 1, 2, 3, 4, 5, 2, 3, 4, 5, 2, 3, 4, 5, 6],
    frames: [
      { dur: 100, pose: NEUTRAL },
      { dur: 220, pose: P({ sy: 0.80, sx: 1.13 }, { armL_upper: { rot: -14 }, armR_upper: { rot: 14 }, legL_upper: { rot: 7 }, legR_upper: { rot: -7 } }) }, // 준비
      { dur: 120, air: true, pose: P({ y: -18, sy: 1.12, sx: 0.92 }, { armL_upper: { rot: 34 }, armR_upper: { rot: -34 } }) },                                                 // 도약
      { dur: 260, air: true, pose: P({ y: -40, sy: 1.16, sx: 0.90 }, { armL_upper: { rot: 58 }, armR_upper: { rot: -58 }, legL_upper: { rot: -5 }, legR_upper: { rot: 5 } }) }, // 정점
      { dur: 120, air: true, pose: P({ y: -16, sy: 1.06, sx: 0.96 }, { armL_upper: { rot: 30 }, armR_upper: { rot: -30 }, legL_upper: { rot: -8 }, legR_upper: { rot: 8 } }) }, // 하강
      { dur: 200, pose: P({ sy: 0.83, sx: 1.11 }, { armL_upper: { rot: -18 }, armR_upper: { rot: 18 }, legL_upper: { rot: 6 }, legR_upper: { rot: -6 } }) },  // 착지
      { dur: 280, pose: NEUTRAL }
    ]
  },

  // ── 🫠 지쳤어: 숨 한 번 → 무너짐 → 좌우로 축 → 느린 안정 ────────────
  g_droop: {
    loop: false, cancelFrom: 4, fx: 'droop',
    frames: [
      { dur: 160, pose: NEUTRAL },
      { dur: 240, pose: P({ sy: 1.04, sx: 0.97 }, { torso: { rot: -2 } }) },                                                                    // 준비
      { dur: 300, pose: P({ sy: 0.82, sx: 1.10 }, { torso: { rot: 7 }, armL_upper: { rot: -16 }, armR_upper: { rot: 16 }, legL_upper: { rot: 4 }, legR_upper: { rot: -4 } }) },
      // 좌우로 축 흔들 — 스프라이트는 프레임 사이를 보간하지 않는다. 자세 차이가 크면
      // 그 자체가 순간이동으로 보이므로, 흔들림의 **중간 자세(in-between)** 를 넣는다.
      // (리그는 보간되니 이 문제가 안 보였다. 검사기가 33px 튐으로 잡아 줬다.)
      { dur: 260, pose: P({ sy: 0.82, sx: 1.10, rot: -5, x: -4 }, { torso: { rot: 9 }, armL_upper: { rot: -20 }, armR_upper: { rot: 12 } }) },
      { dur: 160, pose: P({ sy: 0.82, sx: 1.10, rot: -2.5, x: -2 }, { torso: { rot: 9 }, armL_upper: { rot: -18 }, armR_upper: { rot: 14 } }) },
      { dur: 160, pose: P({ sy: 0.83, sx: 1.09 }, { torso: { rot: 9 }, armL_upper: { rot: -16 }, armR_upper: { rot: 16 } }) },
      { dur: 160, pose: P({ sy: 0.82, sx: 1.10, rot: 2.5, x: 2 }, { torso: { rot: 9 }, armL_upper: { rot: -14 }, armR_upper: { rot: 18 } }) },
      { dur: 260, pose: P({ sy: 0.82, sx: 1.10, rot: 5, x: 4 }, { torso: { rot: 9 }, armL_upper: { rot: -12 }, armR_upper: { rot: 20 } }) },
      // 안정도 한 번에 펴지 않는다 — 절반쯤 회복하는 그림을 거친다.
      { dur: 220, pose: P({ sy: 0.88, sx: 1.06, rot: 2 }, { torso: { rot: 6 }, armL_upper: { rot: -9 }, armR_upper: { rot: 11 } }) },
      { dur: 260, pose: P({ sy: 0.94, sx: 1.03 }, { torso: { rot: 3 }, armL_upper: { rot: -4 }, armR_upper: { rot: 4 } }) },
      { dur: 300, pose: NEUTRAL }
    ]
  },

  // ── 뒤돌기 ───────────────────────────────────────────────────────────
  // ⚠ 가운데(3/4 측면)는 **진짜 그림이 필요하다.** 지금은 몸을 얇게 눌러 흉내만 낸다.
  //   docs/art-orders.md 의 turn_back/frame-01 이 그 발주다.
  turn_back: {
    loop: false, cancelFrom: 99, needsArt: ['frame-01: 3/4 측면'],
    frames: [
      { dur: 100, pose: NEUTRAL },
      { dur: 100, pose: P({ sx: 0.42, sy: 1.02 }, {}) },
      { dur: 100, pose: P({ back: true }, {}) }
    ]
  },
  turn_front: {
    loop: false, cancelFrom: 99, needsArt: ['frame-01: 3/4 측면'],
    frames: [
      { dur: 100, pose: P({ back: true }, {}) },
      { dur: 100, pose: P({ back: true, sx: 0.42, sy: 1.02 }, {}) },
      { dur: 100, pose: NEUTRAL }
    ]
  },

  // ── 🍑 트월킹(뒷모습 루프) 8장 ───────────────────────────────────────
  // 골반이 8자를 그리고 상체는 한 박자 늦게 따라온다. 두 발은 제자리.
  // 5조각 리그에서는 다리가 몸통의 자식이라, 몸통이 돌면 다리도 같이 돈다.
  // 발을 붙여 두려고 다리에 **반대 회전**을 걸어 상쇄한다.
  twerk_loop: (function () {
    // 골반 8자: x 는 좌우, y 는 위아래(위가 음수). 상체는 2프레임 지연.
    const hip = [
      [0, -3], [-6, 2], [-9, 5], [-5, -2],
      [0, -3], [6, 2], [9, 5], [5, -2]
    ];
    const lag = 2;
    const frames = hip.map((h, i) => {
      const prev = hip[(i - lag + hip.length) % hip.length];
      const torsoRot = -prev[0] * 0.55;          // 상체가 늦게 따라오며 반대로 기운다
      return {
        dur: 120,
        ground: ['L', 'R'],
        pose: {
          root: { back: true, x: h[0], y: h[1], sx: 1 + Math.abs(h[0]) * 0.004, sy: 1 - Math.abs(h[1]) * 0.006 },
          bones: {
            torso: { rot: torsoRot },
            // 다리는 몸통 회전을 상쇄해 발을 바닥에 붙여 둔다
            legL_upper: { rot: -torsoRot + h[0] * 0.15 },
            legR_upper: { rot: -torsoRot - h[0] * 0.15 },
            armL_upper: { rot: -h[0] * 0.5 },
            armR_upper: { rot: h[0] * 0.5 }
          }
        }
      };
    });
    return { loop: true, cancelFrom: 0, frames };
  })()
};

module.exports = { CLIPS, NEUTRAL };
