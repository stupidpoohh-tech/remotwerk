'use strict';
/* 애니메이션 데이터 — 골격별 키프레임 시퀀스 (플레이스홀더).
 *
 * 중요: 여기 값들은 각 동작의 "키 자세" 설명을 바탕으로 만든 저프레임 플레이스홀더다.
 * 코드가 생성하는 것이 아니라 콘텐츠로 다듬어 넣는 데이터이며, 이후 아트/안무에 맞춰 교체한다.
 *
 * 프레임 표기:
 *   { t: <ms>, root: { x, y, rot, vis, flip, aura }, <boneName>: { rot, x, y, vis } }
 *   - 값은 뉴트럴(0) 기준 델타. bone.rot = 관절 회전각(deg).
 *   - 프레임에 언급되지 않은 본/속성은 엔진이 뉴트럴(0)로 트랙을 채운다(희소 프레임 허용).
 *   - vis/flip 은 계단(step) 보간, 나머지는 선형 보간.
 *   - root.aura: 오오라 강도(0=없음). root.flip: 좌우 반전(피겨 턴 인상).
 */

(function (root) {
  const RW = (root.RW = root.RW || {});

  const anims = {
    // 1) 지루해서 늘어졌다가 그대로 뒹굴기
    g1_slump_roll: {
      loop: false,
      frames: [
        { t: 0 },
        { t: 450, torso: { rot: 22 }, head: { rot: 18 }, armR_upper: { rot: 15 }, armL_upper: { rot: -15 } },
        { t: 950, torso: { rot: 46 }, head: { rot: 34 }, legR_upper: { rot: 18 }, legR_lower: { rot: -28 }, legL_upper: { rot: 18 }, legL_lower: { rot: -28 }, root: { y: 8 } },
        { t: 1300, torso: { rot: 46 }, head: { rot: 34 }, root: { y: 8 } },                          // 한 박자 정지
        { t: 1900, root: { rot: 78, y: 46 }, torso: { rot: 40 }, head: { rot: 20 }, legR_upper: { rot: 40 }, legL_upper: { rot: 40 } },
        { t: 2400, root: { rot: 90, y: 52 }, torso: { rot: 35 }, legR_upper: { rot: 50 }, legL_upper: { rot: 50 } }
      ]
    },

    // 2) 슬쩍 눈치보다가 둠칫둠칫 엉덩이 트월킹
    g2_twerk: {
      loop: false,
      frames: [
        { t: 0 },
        { t: 300, head: { rot: -26 } },                                                              // 좌 살핌
        { t: 600, head: { rot: 26 } },                                                               // 우 살핌
        { t: 820, head: { rot: 0 }, torso: { rot: 30 }, legR_upper: { rot: 14 }, legL_upper: { rot: 14 }, legR_lower: { rot: -22 }, legL_lower: { rot: -22 }, root: { y: 12 } },
        // 트월킹 루프(둠칫둠칫)
        { t: 980, root: { y: 12, rot: -7, x: -6 }, torso: { rot: 30 } },
        { t: 1120, root: { y: 6, rot: 7, x: 6 }, torso: { rot: 30 } },
        { t: 1260, root: { y: 12, rot: -7, x: -6 }, torso: { rot: 30 } },
        { t: 1400, root: { y: 6, rot: 7, x: 6 }, torso: { rot: 30 } },
        { t: 1540, root: { y: 12, rot: -7, x: -6 }, torso: { rot: 30 } },
        { t: 1680, root: { y: 6, rot: 7, x: 6 }, torso: { rot: 30 } },
        { t: 1900, root: { y: 0, rot: 0, x: 0 } }
      ]
    },

    // 3) 무릎 꿇으며 하늘로 양팔 벌리며 좌절하기
    g3_despair: {
      loop: false,
      frames: [
        { t: 0 },
        { t: 500, legR_upper: { rot: 70 }, legL_upper: { rot: 70 }, legR_lower: { rot: -80 }, legL_lower: { rot: -80 }, root: { y: 34 }, torso: { rot: -4 } },
        { t: 1000, root: { y: 34 }, legR_upper: { rot: 70 }, legL_upper: { rot: 70 }, legR_lower: { rot: -80 }, legL_lower: { rot: -80 }, armR_upper: { rot: -165 }, armL_upper: { rot: 165 }, head: { rot: -14 }, torso: { rot: -6 } },
        { t: 2200, root: { y: 34 }, legR_upper: { rot: 70 }, legL_upper: { rot: 70 }, legR_lower: { rot: -80 }, legL_lower: { rot: -80 }, armR_upper: { rot: -165 }, armL_upper: { rot: 165 }, head: { rot: -14 }, torso: { rot: -6 } } // 절정에서 길게 정지
      ]
    },

    // 4) 피겨 턴하고 발레 점프하기
    g4_ballet: {
      loop: false,
      frames: [
        { t: 0 },
        { t: 150, root: { flip: true }, armR_upper: { rot: -70 }, armL_upper: { rot: 70 } },
        { t: 300, root: { flip: false }, armR_upper: { rot: -70 }, armL_upper: { rot: 70 } },
        { t: 450, root: { flip: true }, armR_upper: { rot: -70 }, armL_upper: { rot: 70 } },
        { t: 600, root: { flip: false, y: 16 }, legR_upper: { rot: 12 }, legL_upper: { rot: 12 }, legR_lower: { rot: -24 }, legL_lower: { rot: -24 } }, // 웅크림
        { t: 820, root: { y: -62 }, armR_upper: { rot: -150 }, armL_upper: { rot: 150 }, legR_upper: { rot: -6 }, legL_upper: { rot: 6 } },              // 체공
        { t: 1020, root: { y: 12 }, legR_upper: { rot: 14 }, legL_upper: { rot: 14 }, legR_lower: { rot: -26 }, legL_lower: { rot: -26 } },              // 착지
        { t: 1250 }
      ]
    },

    // 5) 자리비우기(사라지기) — 화면 밖으로 걸어 나가 사라짐
    g5_leave: {
      loop: false,
      frames: [
        { t: 0 },
        { t: 200, root: { x: 34 }, legR_upper: { rot: 24 }, legL_upper: { rot: -24 } },
        { t: 400, root: { x: 74 }, legR_upper: { rot: -24 }, legL_upper: { rot: 24 } },
        { t: 600, root: { x: 122 }, legR_upper: { rot: 24 }, legL_upper: { rot: -24 } },
        { t: 800, root: { x: 182 }, legR_upper: { rot: -24 }, legL_upper: { rot: 24 } },
        { t: 1000, root: { x: 246 }, legR_upper: { rot: 24 }, legL_upper: { rot: -24 } },
        { t: 1120, root: { x: 300, vis: false } }
      ]
    },

    // 6) 화면으로 다가와 얼굴 부비기 (복귀에도 재사용)
    g6_nuzzle: {
      loop: false,
      frames: [
        { t: 0, root: { x: 190 }, legR_upper: { rot: -24 }, legL_upper: { rot: 24 } },
        { t: 220, root: { x: 128 }, legR_upper: { rot: 24 }, legL_upper: { rot: -24 } },
        { t: 440, root: { x: 64 }, legR_upper: { rot: -24 }, legL_upper: { rot: 24 } },
        { t: 640, root: { x: 8 } },
        { t: 820, root: { x: 8 }, torso: { rot: 14 }, head: { rot: -12 } },
        { t: 940, root: { x: 2 }, torso: { rot: 14 }, head: { rot: 12 } },
        { t: 1060, root: { x: 8 }, torso: { rot: 14 }, head: { rot: -12 } },
        { t: 1180, root: { x: 2 }, torso: { rot: 14 }, head: { rot: 12 } },
        { t: 1400, root: { x: 0 } }
      ]
    },

    // 7) 가만히 분노하며 오오라를 내뿜기
    g7_rage_aura: {
      loop: false,
      frames: [
        { t: 0, head: { rot: 10 }, armR_upper: { rot: 8 }, armR_lower: { rot: 28 }, armL_upper: { rot: -8 }, armL_lower: { rot: -28 } },
        { t: 200, root: { x: 1.5, aura: 0.7 } },
        { t: 320, root: { x: -1.5, aura: 1.0 } },
        { t: 440, root: { x: 1.5, aura: 0.7 } },
        { t: 560, root: { x: -1.5, aura: 1.5 } },   // 크게 부풀었다
        { t: 700, root: { x: 1.5, aura: 0.8 } },    // 줄어드는 강조
        { t: 820, root: { x: -1.5, aura: 1.0 } },
        { t: 940, root: { x: 1.5, aura: 0.7 } },
        { t: 1060, root: { x: -1.5, aura: 1.5 } },
        { t: 1200, root: { x: 1.5, aura: 0.8 } },
        { t: 1400, root: { x: -1.5, aura: 1.0 } },
        { t: 1600, root: { x: 0, aura: 0.6 } },
        { t: 1900, root: { x: 0, aura: 0 }, head: { rot: 10 } }
      ]
    },

    // 8) W 모양으로 팔을 들고 어깨 으쓱하기
    g8_w_shrug: {
      loop: false,
      frames: [
        { t: 0 },
        { t: 300, armR_upper: { rot: -140 }, armR_lower: { rot: 85 }, armL_upper: { rot: 140 }, armL_lower: { rot: -85 } },
        { t: 600, root: { y: -7 }, head: { rot: 4 }, armR_upper: { rot: -148 }, armR_lower: { rot: 85 }, armL_upper: { rot: 148 }, armL_lower: { rot: -85 } }, // 으쓱 올림
        { t: 820, root: { y: 0 }, head: { rot: 0 }, armR_upper: { rot: -140 }, armR_lower: { rot: 85 }, armL_upper: { rot: 140 }, armL_lower: { rot: -85 } },
        { t: 1050, armR_upper: { rot: -140 }, armR_lower: { rot: 85 }, armL_upper: { rot: 140 }, armL_lower: { rot: -85 } },
        { t: 1350 }
      ]
    },

    // --- 자율 생활 2종 (전송/히스토리 없음, 로컬 반복) ---

    // 멍때리기 — 숨쉬듯 미세한 흔들림
    idle: {
      loop: true,
      frames: [
        { t: 0 },
        { t: 1500, root: { y: 2 }, torso: { rot: 2 }, head: { rot: 3 } },
        { t: 3000, head: { rot: -2 } },
        { t: 4500, root: { y: 0 }, torso: { rot: 0 }, head: { rot: 0 } }
      ]
    },

    // 돌아다니기 — 좌우로 천천히 걸음 (되돌아와 매끄럽게 루프)
    wander: {
      loop: true,
      frames: [
        { t: 0, root: { x: 0 } },
        { t: 400, root: { x: 16 }, legR_upper: { rot: 20 }, legL_upper: { rot: -20 } },
        { t: 800, root: { x: 32 }, legR_upper: { rot: -20 }, legL_upper: { rot: 20 } },
        { t: 1200, root: { x: 48 }, legR_upper: { rot: 20 }, legL_upper: { rot: -20 } },
        { t: 1600, root: { x: 60, flip: true } },
        { t: 2000, root: { x: 44, flip: true }, legR_upper: { rot: 20 }, legL_upper: { rot: -20 } },
        { t: 2400, root: { x: 28, flip: true }, legR_upper: { rot: -20 }, legL_upper: { rot: 20 } },
        { t: 2800, root: { x: 12, flip: true }, legR_upper: { rot: 20 }, legL_upper: { rot: -20 } },
        { t: 3200, root: { x: 0, flip: false } }
      ]
    },

    // 복귀 보조 — 화면 밖에서 걸어 들어옴 (자리비운 뒤 다른 신호가 오면 앞에 붙인다)
    walk_in: {
      loop: false,
      frames: [
        { t: 0, root: { x: 210, vis: true }, legR_upper: { rot: -24 }, legL_upper: { rot: 24 } },
        { t: 260, root: { x: 150 }, legR_upper: { rot: 24 }, legL_upper: { rot: -24 } },
        { t: 520, root: { x: 90 }, legR_upper: { rot: -24 }, legL_upper: { rot: 24 } },
        { t: 780, root: { x: 40 }, legR_upper: { rot: 24 }, legL_upper: { rot: -24 } },
        { t: 1000, root: { x: 0 } }
      ]
    }
  };

  function get(id) {
    return anims[id] || null;
  }

  RW.animations = { anims, get };
})(typeof window !== 'undefined' ? window : globalThis);
