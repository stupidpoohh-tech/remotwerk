'use strict';
/* 애니메이션 데이터 — 골격별 키프레임 시퀀스.
 *
 * 이 값들은 각 동작의 "키 자세" 설명을 바탕으로 만든 저프레임 안무다. 코드가 생성하는 것이
 * 아니라 콘텐츠로 다듬어 넣는 데이터이며, 아트에 맞춰 계속 다듬는다.
 *
 * 다듬기 원칙(이번 개선 반영):
 *  - 예비동작(anticipation): 큰 자세 전에 반대 방향으로 살짝 준비.
 *  - 보조동작(secondary): 걷기엔 팔 스윙 + 몸통 바운스, 트월킹엔 머리 반동 등.
 *  - 마무리(settle): 도착/착지 후 작은 되돌림으로 뚝 끊기지 않게.
 *
 * 프레임 표기:
 *   { t:<ms>, root:{x,y,rot,vis,flip,aura}, <bone>:{rot,x,y,vis} }  // 값은 뉴트럴(0) 기준 델타
 *   - vis/flip 은 계단 보간, 나머지는 선형 보간. 언급 없는 본/속성은 뉴트럴로 채워진다(희소 허용).
 *   - 5조각 골격은 어깨/골반 트랙(*_upper)만 읽어 근사 재생한다(engine.animSource).
 */

(function (root) {
  const RW = (root.RW = root.RW || {});

  const anims = {
    // 1) 지루해서 늘어졌다가 그대로 뒹굴기
    g1_slump_roll: {
      loop: false,
      frames: [
        { t: 0 },
        { t: 220, root: { y: -3 }, head: { rot: -5 } },                                                  // 한숨 예비
        { t: 520, torso: { rot: 22 }, head: { rot: 18 }, armR_upper: { rot: 14 }, armL_upper: { rot: -14 }, legR_upper: { rot: 6 }, legL_upper: { rot: 6 } },
        { t: 1000, torso: { rot: 46 }, head: { rot: 33 }, armR_upper: { rot: 22 }, armL_upper: { rot: -22 }, legR_lower: { rot: -26 }, legL_lower: { rot: -26 }, root: { y: 8 } },
        { t: 1350, torso: { rot: 46 }, head: { rot: 33 }, root: { y: 8 } },                               // 한 박자 정지
        { t: 1520, root: { rot: 14, y: 14 }, torso: { rot: 44 } },                                        // 옆으로 기우는 예비
        { t: 1960, root: { rot: 72, y: 48 }, torso: { rot: 38 }, head: { rot: 22 }, armR_upper: { rot: 40 }, armL_upper: { rot: -40 }, legR_upper: { rot: 46 }, legL_upper: { rot: 46 }, legR_lower: { rot: -40 }, legL_lower: { rot: -40 } },
        { t: 2360, root: { rot: 90, y: 55 }, torso: { rot: 30 }, legR_upper: { rot: 55 }, legL_upper: { rot: 55 } },
        { t: 2560, root: { rot: 88, y: 52 } }                                                             // 착지 반동
      ]
    },

    // 2) 슬쩍 눈치보다가 둠칫둠칫 엉덩이 트월킹
    g2_twerk: {
      loop: false,
      frames: [
        { t: 0 },
        { t: 280, head: { rot: -26 }, torso: { rot: -3 } },                                              // 좌 살핌
        { t: 560, head: { rot: 26 }, torso: { rot: 3 } },                                                // 우 살핌
        { t: 780, head: { rot: 0 }, torso: { rot: 30 }, legR_upper: { rot: 14 }, legL_upper: { rot: 14 }, legR_lower: { rot: -22 }, legL_lower: { rot: -22 }, armR_upper: { rot: -18 }, armL_upper: { rot: 18 }, root: { y: 12 } },
        // 둠칫둠칫 루프 — 엉덩이 좌우 + 머리 반동
        { t: 920,  root: { y: 12, rot: -8, x: -6 }, head: { rot: 6 },  armR_upper: { rot: -14 }, armL_upper: { rot: 14 } },
        { t: 1055, root: { y: 5,  rot: 8,  x: 6 },  head: { rot: -6 }, armR_upper: { rot: -22 }, armL_upper: { rot: 22 } },
        { t: 1190, root: { y: 12, rot: -8, x: -6 }, head: { rot: 6 } },
        { t: 1325, root: { y: 5,  rot: 8,  x: 6 },  head: { rot: -6 } },
        { t: 1460, root: { y: 12, rot: -8, x: -6 }, head: { rot: 6 } },
        { t: 1595, root: { y: 5,  rot: 8,  x: 6 },  head: { rot: -6 } },
        { t: 1740, root: { y: 10, rot: -5, x: -4 } },
        { t: 1960, root: { y: 0,  rot: 0,  x: 0 }, torso: { rot: 0 }, armR_upper: { rot: 0 }, armL_upper: { rot: 0 } }
      ]
    },

    // 3) 무릎 꿇으며 하늘로 양팔 벌리며 좌절하기
    g3_despair: {
      loop: false,
      frames: [
        { t: 0 },
        { t: 240, root: { y: -6 }, torso: { rot: -6 }, head: { rot: -8 }, armR_upper: { rot: -20 }, armL_upper: { rot: 20 } }, // 숨 들이켜는 예비
        { t: 650, legR_upper: { rot: 68 }, legL_upper: { rot: 68 }, legR_lower: { rot: -78 }, legL_lower: { rot: -78 }, root: { y: 34 }, torso: { rot: 0 }, armR_upper: { rot: -95 }, armL_upper: { rot: 95 }, head: { rot: -6 } },
        { t: 1050, root: { y: 36 }, legR_upper: { rot: 70 }, legL_upper: { rot: 70 }, legR_lower: { rot: -80 }, legL_lower: { rot: -80 }, armR_upper: { rot: -168 }, armL_upper: { rot: 168 }, head: { rot: -16 }, torso: { rot: -8 } },
        { t: 1250, root: { y: 36, x: 2 }, head: { rot: -18 } },                                           // 절정에서 미세한 떨림
        { t: 1470, root: { y: 36, x: -2 }, head: { rot: -13 } },
        { t: 2350, root: { y: 36, x: 0 }, legR_upper: { rot: 70 }, legL_upper: { rot: 70 }, legR_lower: { rot: -80 }, legL_lower: { rot: -80 }, armR_upper: { rot: -168 }, armL_upper: { rot: 168 }, head: { rot: -15 }, torso: { rot: -8 } } // 길게 정지
      ]
    },

    // 4) 피겨 턴하고 발레 점프하기
    g4_ballet: {
      loop: false,
      frames: [
        { t: 0 },
        { t: 150, root: { y: 14 }, legR_upper: { rot: 10 }, legL_upper: { rot: 10 }, legR_lower: { rot: -20 }, legL_lower: { rot: -20 }, armR_upper: { rot: -40 }, armL_upper: { rot: 40 } }, // 플리에 예비
        { t: 300, root: { flip: true, y: 4 }, armR_upper: { rot: -72 }, armL_upper: { rot: 72 } },
        { t: 420, root: { flip: false, y: 4 }, armR_upper: { rot: -72 }, armL_upper: { rot: 72 } },
        { t: 540, root: { flip: true, y: 4 }, armR_upper: { rot: -72 }, armL_upper: { rot: 72 } },        // 도는 인상
        { t: 660, root: { flip: false, y: 16 }, legR_upper: { rot: 12 }, legL_upper: { rot: 12 }, legR_lower: { rot: -24 }, legL_lower: { rot: -24 }, armR_upper: { rot: -30 }, armL_upper: { rot: 30 } }, // 웅크림
        { t: 860, root: { y: -66 }, legR_upper: { rot: -4 }, legL_upper: { rot: 4 }, legR_lower: { rot: -6 }, legL_lower: { rot: -6 }, armR_upper: { rot: -150 }, armL_upper: { rot: 150 } }, // 체공
        { t: 1020, root: { y: -70 } },                                                                    // 정점
        { t: 1200, root: { y: 16 }, legR_upper: { rot: 14 }, legL_upper: { rot: 14 }, legR_lower: { rot: -26 }, legL_lower: { rot: -26 }, armR_upper: { rot: -50 }, armL_upper: { rot: 50 } }, // 착지
        { t: 1380, root: { y: 3 }, armR_upper: { rot: -20 }, armL_upper: { rot: 20 } },                   // 마무리 되돌림
        { t: 1560 }
      ]
    },

    // 5) 자리비우기(사라지기) — 팔 스윙 + 몸통 바운스로 걸어 나가 사라짐
    g5_leave: {
      loop: false,
      frames: [
        { t: 0 },
        { t: 180, root: { x: 30, y: -2 }, legR_upper: { rot: 24 }, legL_upper: { rot: -24 }, armR_upper: { rot: -12 }, armL_upper: { rot: 12 } },
        { t: 360, root: { x: 68, y: 0 },  legR_upper: { rot: -24 }, legL_upper: { rot: 24 }, armR_upper: { rot: 12 }, armL_upper: { rot: -12 } },
        { t: 540, root: { x: 112, y: -2 }, legR_upper: { rot: 24 }, legL_upper: { rot: -24 }, armR_upper: { rot: -12 }, armL_upper: { rot: 12 } },
        { t: 720, root: { x: 162, y: 0 }, legR_upper: { rot: -24 }, legL_upper: { rot: 24 }, armR_upper: { rot: 12 }, armL_upper: { rot: -12 } },
        { t: 900, root: { x: 216, y: -2 }, legR_upper: { rot: 24 }, legL_upper: { rot: -24 } },
        { t: 1050, root: { x: 272 } },
        { t: 1160, root: { x: 320, vis: false } }
      ]
    },

    // 6) 화면으로 다가와 얼굴 부비기 (복귀에도 재사용)
    g6_nuzzle: {
      loop: false,
      frames: [
        { t: 0, root: { x: 190 }, legR_upper: { rot: -24 }, legL_upper: { rot: 24 }, armR_upper: { rot: 12 }, armL_upper: { rot: -12 } },
        { t: 200, root: { x: 130, y: -2 }, legR_upper: { rot: 24 }, legL_upper: { rot: -24 }, armR_upper: { rot: -12 }, armL_upper: { rot: 12 } },
        { t: 400, root: { x: 70 }, legR_upper: { rot: -24 }, legL_upper: { rot: 24 }, armR_upper: { rot: 12 }, armL_upper: { rot: -12 } },
        { t: 600, root: { x: 12 } },                                                                      // 도착
        { t: 780, root: { x: 8 }, torso: { rot: 16 }, head: { rot: -12 }, armR_upper: { rot: 8 }, armL_upper: { rot: -8 } },
        { t: 900, root: { x: 2 }, torso: { rot: 16 }, head: { rot: 12 } },
        { t: 1020, root: { x: 8 }, torso: { rot: 16 }, head: { rot: -12 } },
        { t: 1140, root: { x: 2 }, torso: { rot: 16 }, head: { rot: 12 } },
        { t: 1270, root: { x: 6 }, torso: { rot: 12 }, head: { rot: -6 } },
        { t: 1460, root: { x: 0 }, torso: { rot: 0 }, head: { rot: 0 } }                                  // 마무리
      ]
    },

    // 7) 가만히 분노하며 오오라를 내뿜기 (몸통 미세 진동 + 오오라 오버레이)
    g7_rage_aura: {
      loop: false,
      frames: [
        { t: 0, head: { rot: 10 }, torso: { rot: 4 }, armR_upper: { rot: 8 }, armR_lower: { rot: 30 }, armL_upper: { rot: -8 }, armL_lower: { rot: -30 } },
        { t: 180, root: { x: 1, aura: 0.5 }, head: { rot: 12 } },                                         // 긴장 고조
        { t: 300, root: { x: -1.5, aura: 0.9 } },
        { t: 420, root: { x: 1.5, aura: 0.7 } },
        { t: 540, root: { x: -1.5, aura: 1.5 } },                                                         // 크게 부풀었다
        { t: 680, root: { x: 1.5, aura: 0.8 } },                                                          // 줄어드는 강조
        { t: 800, root: { x: -1.5, aura: 1.0 }, head: { rot: 13 } },
        { t: 940, root: { x: 1.5, aura: 0.7 } },
        { t: 1060, root: { x: -1.5, aura: 1.6 } },                                                        // 두 번째 강조
        { t: 1200, root: { x: 1.5, aura: 0.9 } },
        { t: 1340, root: { x: -1.5, aura: 1.1 } },
        { t: 1500, root: { x: 1, aura: 0.7 } },
        { t: 1700, root: { x: 0, aura: 0.5 }, head: { rot: 11 } },
        { t: 1950, root: { x: 0, aura: 0 }, head: { rot: 10 }, torso: { rot: 4 } }
      ]
    },

    // 8) W 모양으로 팔을 들고 어깨 으쓱하기 (더블 으쓱 + 마무리)
    g8_w_shrug: {
      loop: false,
      frames: [
        { t: 0 },
        { t: 250, armR_upper: { rot: -140 }, armR_lower: { rot: 85 }, armL_upper: { rot: 140 }, armL_lower: { rot: -85 } },
        { t: 500, root: { y: -8 }, head: { rot: 5 }, armR_upper: { rot: -148 }, armR_lower: { rot: 85 }, armL_upper: { rot: 148 }, armL_lower: { rot: -85 } }, // 으쓱 1
        { t: 680, root: { y: 0 }, head: { rot: 0 }, armR_upper: { rot: -140 }, armR_lower: { rot: 85 }, armL_upper: { rot: 140 }, armL_lower: { rot: -85 } },
        { t: 860, root: { y: -8 }, head: { rot: 5 }, armR_upper: { rot: -148 }, armL_upper: { rot: 148 } }, // 으쓱 2
        { t: 1040, root: { y: 0 }, head: { rot: 0 }, armR_upper: { rot: -140 }, armR_lower: { rot: 85 }, armL_upper: { rot: 140 }, armL_lower: { rot: -85 } },
        { t: 1250, armR_upper: { rot: -140 }, armR_lower: { rot: 85 }, armL_upper: { rot: 140 }, armL_lower: { rot: -85 } }, // 짧게 유지
        { t: 1500 }
      ]
    },

    // --- 자율 생활 2종 (전송/히스토리 없음, 로컬 반복) ---

    // 멍때리기 — 숨쉬기 + 무게중심 이동 + 팔 미세 스윙
    idle: {
      loop: true,
      frames: [
        { t: 0 },
        { t: 1200, root: { y: -2 }, torso: { rot: -1 }, head: { rot: 2 }, armR_upper: { rot: 3 }, armL_upper: { rot: -3 } },
        { t: 2400, root: { y: 2 }, torso: { rot: 2 }, head: { rot: -1 } },
        { t: 3200, root: { x: 3 }, head: { rot: 3 } },                                                    // 무게중심 이동
        { t: 4000, root: { x: -3 }, head: { rot: -2 } },
        { t: 4800, root: { x: 0, y: 0 }, torso: { rot: 0 }, head: { rot: 0 } }
      ]
    },

    // 돌아다니기 — 좌우로 천천히 걸음 (팔 스윙 + 몸통 바운스, 되돌아와 매끄럽게 루프)
    wander: {
      loop: true,
      frames: [
        { t: 0, root: { x: 0 } },
        { t: 300, root: { x: 12, y: -2 }, legR_upper: { rot: 20 }, legL_upper: { rot: -20 }, armR_upper: { rot: -10 }, armL_upper: { rot: 10 } },
        { t: 600, root: { x: 26, y: 0 },  legR_upper: { rot: -20 }, legL_upper: { rot: 20 }, armR_upper: { rot: 10 }, armL_upper: { rot: -10 } },
        { t: 900, root: { x: 40, y: -2 }, legR_upper: { rot: 20 }, legL_upper: { rot: -20 }, armR_upper: { rot: -10 }, armL_upper: { rot: 10 } },
        { t: 1200, root: { x: 54, y: 0 }, legR_upper: { rot: -20 }, legL_upper: { rot: 20 }, armR_upper: { rot: 10 }, armL_upper: { rot: -10 } },
        { t: 1500, root: { x: 62, flip: true } },
        { t: 1800, root: { x: 50, y: -2, flip: true }, legR_upper: { rot: 20 }, legL_upper: { rot: -20 }, armR_upper: { rot: -10 }, armL_upper: { rot: 10 } },
        { t: 2100, root: { x: 36, y: 0, flip: true }, legR_upper: { rot: -20 }, legL_upper: { rot: 20 }, armR_upper: { rot: 10 }, armL_upper: { rot: -10 } },
        { t: 2400, root: { x: 20, y: -2, flip: true }, legR_upper: { rot: 20 }, legL_upper: { rot: -20 } },
        { t: 2700, root: { x: 6, flip: true }, legR_upper: { rot: -20 }, legL_upper: { rot: 20 } },
        { t: 3000, root: { x: 0, flip: false } }
      ]
    },

    // 복귀 보조 — 화면 밖에서 걸어 들어옴 (자리비운 뒤 다른 신호가 오면 앞에 붙인다)
    walk_in: {
      loop: false,
      frames: [
        { t: 0, root: { x: 210, vis: true }, legR_upper: { rot: -24 }, legL_upper: { rot: 24 }, armR_upper: { rot: 12 }, armL_upper: { rot: -12 } },
        { t: 260, root: { x: 150, y: -2 }, legR_upper: { rot: 24 }, legL_upper: { rot: -24 }, armR_upper: { rot: -12 }, armL_upper: { rot: 12 } },
        { t: 520, root: { x: 90 }, legR_upper: { rot: -24 }, legL_upper: { rot: 24 }, armR_upper: { rot: 12 }, armL_upper: { rot: -12 } },
        { t: 780, root: { x: 40, y: -2 }, legR_upper: { rot: 24 }, legL_upper: { rot: -24 }, armR_upper: { rot: -12 }, armL_upper: { rot: 12 } },
        { t: 1000, root: { x: 0 }, legR_upper: { rot: 0 }, legL_upper: { rot: 0 }, armR_upper: { rot: 0 }, armL_upper: { rot: 0 } }
      ]
    }
  };

  function get(id) {
    return anims[id] || null;
  }

  RW.animations = { anims, get };
})(typeof window !== 'undefined' ? window : globalThis);
