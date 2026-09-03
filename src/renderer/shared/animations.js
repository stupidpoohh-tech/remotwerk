'use strict';
/* 애니메이션 데이터 — 골격별 키프레임 시퀀스.
 *
 * ▣ 설계 원칙: "네 신호가 곁눈질 0.5초에 갈릴 것"
 *
 * 치비(2~3등신) 체형은 관절을 꺾어도 잘 안 읽힌다. 그래서 구분은 관절이 아니라
 * **움직임의 방향**과 **이펙트**로 만든다. 네 신호가 서로 다른 축을 쓴다:
 *
 *   💗 보고싶어 : 위로 살짝 폴짝 + 몸 살랑    + 분홍 하트     (부드럽고 작게)
 *   ✨ 신나     : 크게 3연속 점프             + 노랑 반짝     (빠르고 크게)
 *   🫠 지쳤어   : 아래로 푹 눌려 좌우로 흔들   + 파랑 땀방울   (느리고 무겁게)
 *   🍑 트월킹   : 뒤로 돌아 좌우로 둠칫둠칫   + 이펙트 없음   (유일하게 등을 보인다)
 *
 * 방향(위/반복/아래/뒤) · 속도 · 색이 서로 달라 하나만 봐도 구분된다.
 * 트월킹만 이펙트가 없는데, "돌아선다"는 것 자체가 다른 셋과 겹치지 않는 신호라서다.
 *
 * 표기:
 *   { t:<ms>, root:{x,y,rot,sx,sy,fx,vis,flip}, <bone>:{rot,x,y,vis} }   // 뉴트럴 기준 델타
 *   - sx/sy = 스쿼시&스트레치(기본 1). 눌림 sy↓ sx↑ / 늘어남 sy↑ sx↓.
 *   - fx = 이펙트 세기(0~1.x). 이펙트 종류는 anim.fx 가 정한다.
 *   - 변형 기준점은 발밑이라 "바닥에 선 몸"으로 읽힌다.
 *   - 5조각 골격은 어깨/골반 트랙(*_upper)만 읽어 근사 재생한다.
 */

(function (root) {
  const RW = (root.RW = root.RW || {});

  const anims = {
    // 💗 보고싶어 — 작게 두 번 폴짝, 몸을 좌우로 살랑. 하트가 위로 떠오른다.
    //    "신나"보다 훨씬 작게 뛰고, 대신 몸 기울임(애교)이 들어간다.
    g_heart: {
      loop: false,
      fx: 'heart',
      frames: [
        { t: 0 },
        { t: 180, root: { y: 6, sy: 0.93, sx: 1.06 } },                                    // 예비로 살짝 눌림
        { t: 380, root: { y: -16, sy: 1.08, sx: 0.95, rot: -6, fx: 0.7 }, armR_upper: { rot: -38 }, armL_upper: { rot: 38 }, head: { rot: -5 } },
        { t: 600, root: { y: 5, sy: 0.94, sx: 1.05, rot: 4 }, armR_upper: { rot: -20 }, armL_upper: { rot: 20 } },
        { t: 800, root: { y: -13, sy: 1.07, sx: 0.96, rot: 6, fx: 1 }, armR_upper: { rot: -38 }, armL_upper: { rot: 38 }, head: { rot: 5 } },
        { t: 1020, root: { y: 4, sy: 0.95, sx: 1.04, rot: -4 } },
        { t: 1260, root: { y: 0, rot: -6, fx: 0.9 }, head: { rot: -6 }, armR_upper: { rot: -24 }, armL_upper: { rot: 24 } }, // 살랑
        { t: 1520, root: { rot: 6, fx: 0.7 }, head: { rot: 6 }, armR_upper: { rot: -24 }, armL_upper: { rot: 24 } },
        { t: 1760, root: { rot: -3, fx: 0.4 }, head: { rot: -3 } },
        { t: 2000, root: { rot: 0, fx: 0 } }
      ]
    },

    // ✨ 신나 — 크게 세 번 연속 점프. 셋 중 가장 빠르고 진폭이 크다.
    g_cheer: {
      loop: false,
      fx: 'sparkle',
      frames: [
        { t: 0 },
        { t: 120, root: { y: 13, sy: 0.84, sx: 1.13 }, legR_upper: { rot: 8 }, legL_upper: { rot: 8 } }, // 잔뜩 웅크림
        { t: 300, root: { y: -46, sy: 1.16, sx: 0.90, fx: 0.9 }, armR_upper: { rot: -72 }, armL_upper: { rot: 72 }, legR_upper: { rot: -5 }, legL_upper: { rot: 5 } },
        { t: 450, root: { y: 11, sy: 0.87, sx: 1.11 }, armR_upper: { rot: -30 }, armL_upper: { rot: 30 } },
        { t: 620, root: { y: -52, sy: 1.18, sx: 0.89, fx: 1.2 }, armR_upper: { rot: -80 }, armL_upper: { rot: 80 }, legR_upper: { rot: -5 }, legL_upper: { rot: 5 } },
        { t: 770, root: { y: 11, sy: 0.87, sx: 1.11 }, armR_upper: { rot: -30 }, armL_upper: { rot: 30 } },
        { t: 930, root: { y: -44, sy: 1.15, sx: 0.91, fx: 1 }, armR_upper: { rot: -72 }, armL_upper: { rot: 72 } },
        { t: 1090, root: { y: 13, sy: 0.84, sx: 1.13 }, armR_upper: { rot: -20 }, armL_upper: { rot: 20 } },
        { t: 1270, root: { y: -9, sy: 1.06, sx: 0.97, fx: 0.5 } },                        // 마무리 반동
        { t: 1450, root: { y: 2, sy: 0.98, fx: 0.2 } },
        { t: 1620, root: { y: 0, fx: 0 } }
      ]
    },

    // 🫠 지쳤어 — 푹 눌린 채 좌우로 축 흔들. 셋 중 가장 느리고 아래로 향한다.
    g_droop: {
      loop: false,
      fx: 'droop',
      frames: [
        { t: 0 },
        { t: 260, root: { y: -5, sy: 1.05, sx: 0.97 }, head: { rot: -6 } },               // 숨 한 번 들이켜고
        { t: 700, root: { y: 16, sy: 0.85, sx: 1.11, fx: 0.7 }, torso: { rot: 20 }, head: { rot: 16 }, armR_upper: { rot: 22 }, armL_upper: { rot: -22 }, legR_upper: { rot: 6 }, legL_upper: { rot: 6 } },
        { t: 1050, root: { y: 16, sy: 0.85, sx: 1.11, rot: -7, x: -4, fx: 1 }, torso: { rot: 20 }, head: { rot: 18 } },
        { t: 1420, root: { y: 16, sy: 0.85, sx: 1.11, rot: 7, x: 4, fx: 0.85 }, torso: { rot: 20 }, head: { rot: 14 } },
        { t: 1790, root: { y: 16, sy: 0.85, sx: 1.11, rot: -5, x: -3, fx: 0.9 }, torso: { rot: 20 }, head: { rot: 18 } },
        { t: 2100, root: { y: 15, sy: 0.87, sx: 1.09, rot: 0, x: 0, fx: 0.5 }, torso: { rot: 18 }, head: { rot: 15 } },
        { t: 2400, root: { y: 8, sy: 0.93, sx: 1.05, fx: 0 }, torso: { rot: 9 }, head: { rot: 7 } } // 살짝만 회복(곧 멍때리기로 이어짐)
      ]
    },

    // 🍑 트월킹 — 앱 이름값 하는 시그니처. 유일하게 **뒤로 돈다**.
    //    도는 인상은 sx 를 얇게 눌렀다 펴서 만든다(옆모습을 지나가는 느낌).
    //    뒷모습 이미지를 등록해 두면 그때 등이 보이고, 없으면 앞모습 그대로 흔든다.
    g_twerk: {
      loop: false,
      frames: [
        { t: 0 },
        { t: 180, root: { y: 7, sy: 0.93, sx: 1.06 } },                                   // 준비로 살짝 눌림
        { t: 330, root: { sx: 0.28, sy: 1.02, y: 2 } },                                   // 몸이 얇아짐 = 도는 중
        { t: 430, root: { back: true, sx: 0.28, sy: 1.02, y: 2 } },                       // 뒷모습으로 교체
        { t: 560, root: { back: true, sx: 1, sy: 0.92, y: 11 }, legR_upper: { rot: 7 }, legL_upper: { rot: 7 }, torso: { rot: 10 } }, // 자세 잡기
        // 둠칫둠칫 — 좌우 + 위아래를 엇갈리게 해서 엉덩이가 튕기는 인상
        { t: 690,  root: { back: true, y: 14, rot: -8, x: -7, sy: 0.86, sx: 1.10 }, torso: { rot: 12 } },
        { t: 810,  root: { back: true, y: 5,  rot: 8,  x: 7,  sy: 0.98, sx: 1.01 }, torso: { rot: 8 } },
        { t: 930,  root: { back: true, y: 14, rot: -8, x: -7, sy: 0.86, sx: 1.10 }, torso: { rot: 12 } },
        { t: 1050, root: { back: true, y: 5,  rot: 8,  x: 7,  sy: 0.98, sx: 1.01 }, torso: { rot: 8 } },
        { t: 1170, root: { back: true, y: 14, rot: -8, x: -7, sy: 0.86, sx: 1.10 }, torso: { rot: 12 } },
        { t: 1290, root: { back: true, y: 5,  rot: 8,  x: 7,  sy: 0.98, sx: 1.01 }, torso: { rot: 8 } },
        { t: 1410, root: { back: true, y: 14, rot: -8, x: -7, sy: 0.86, sx: 1.10 }, torso: { rot: 12 } },
        { t: 1530, root: { back: true, y: 7,  rot: 0,  x: 0,  sy: 0.94, sx: 1.05 }, torso: { rot: 8 } },
        // 다시 앞으로
        { t: 1680, root: { back: true, sx: 0.28, sy: 1.0, y: 3 } },
        { t: 1780, root: { back: false, sx: 0.28, sy: 1.0, y: 3 } },
        { t: 1920, root: { sx: 1, sy: 0.96, y: 4 } },
        { t: 2080, root: { y: 0 } }
      ]
    },

    // --- 자율 생활 2종 (전송/히스토리 없음, 로컬 반복) ---
    // 신호와 헷갈리면 안 되므로 아주 작게(멍때리기) 또는 수평 이동(돌아다니기)만 쓴다.

    idle: {
      loop: true,
      frames: [
        { t: 0 },
        { t: 900, root: { y: -3, sy: 1.035, sx: 0.98 }, head: { rot: 2 } },               // 들숨
        { t: 1800, root: { y: 2, sy: 0.97, sx: 1.02 }, head: { rot: 0 } },                // 날숨
        { t: 2700, root: { x: 3, y: -2, sy: 1.02, sx: 0.99 }, head: { rot: 3 } },
        { t: 3600, root: { x: -3, y: 2, sy: 0.98, sx: 1.01 }, head: { rot: -2 } },
        { t: 4500, root: { x: 0, y: 0 } }
      ]
    },

    wander: {
      loop: true,
      frames: [
        { t: 0, root: { x: 0 } },
        { t: 260, root: { x: 14, y: -6, sy: 1.05, sx: 0.96 }, legR_upper: { rot: 17 }, legL_upper: { rot: -17 }, armR_upper: { rot: -9 }, armL_upper: { rot: 9 } },
        { t: 520, root: { x: 30, y: 3, sy: 0.95, sx: 1.05 }, legR_upper: { rot: -17 }, legL_upper: { rot: 17 }, armR_upper: { rot: 9 }, armL_upper: { rot: -9 } },
        { t: 780, root: { x: 48, y: -6, sy: 1.05, sx: 0.96 }, legR_upper: { rot: 17 }, legL_upper: { rot: -17 }, armR_upper: { rot: -9 }, armL_upper: { rot: 9 } },
        { t: 1040, root: { x: 68, y: 3, sy: 0.95, sx: 1.05 }, legR_upper: { rot: -17 }, legL_upper: { rot: 17 }, armR_upper: { rot: 9 }, armL_upper: { rot: -9 } },
        { t: 1300, root: { x: 88, y: -6, sy: 1.05, sx: 0.96 }, legR_upper: { rot: 17 }, legL_upper: { rot: -17 } },
        { t: 1560, root: { x: 104, y: 2 } },
        { t: 1800, root: { x: 108, y: 0, flip: true } },
        { t: 2060, root: { x: 92, y: -6, flip: true, sy: 1.05, sx: 0.96 }, legR_upper: { rot: 17 }, legL_upper: { rot: -17 }, armR_upper: { rot: -9 }, armL_upper: { rot: 9 } },
        { t: 2320, root: { x: 72, y: 3, flip: true, sy: 0.95, sx: 1.05 }, legR_upper: { rot: -17 }, legL_upper: { rot: 17 }, armR_upper: { rot: 9 }, armL_upper: { rot: -9 } },
        { t: 2580, root: { x: 52, y: -6, flip: true, sy: 1.05, sx: 0.96 }, legR_upper: { rot: 17 }, legL_upper: { rot: -17 } },
        { t: 2840, root: { x: 32, y: 3, flip: true, sy: 0.95, sx: 1.05 }, legR_upper: { rot: -17 }, legL_upper: { rot: 17 } },
        { t: 3100, root: { x: 14, y: -6, flip: true, sy: 1.05, sx: 0.96 }, legR_upper: { rot: 17 }, legL_upper: { rot: -17 } },
        { t: 3360, root: { x: 0, y: 0, flip: false } }
      ]
    }
  };

  function get(id) {
    return anims[id] || null;
  }

  RW.animations = { anims, get };
})(typeof window !== 'undefined' ? window : globalThis);
