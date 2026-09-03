'use strict';
/* 애니메이션 데이터 — 골격별 키프레임 시퀀스.
 *
 * ▣ 안무 방향: "귀엽고 통통 튀게" · 치비(2~3등신) 체형 기준
 *
 * 첨부 캐릭터처럼 머리가 크고 팔다리가 짧은 체형에서는 관절을 크게 꺾어도 잘 안 읽히고
 * 오히려 부자연스럽다. 그래서 표현의 무게중심을 이렇게 옮겼다:
 *
 *   1) 관절 회전은 작게 (팔 ±40~85°, 다리 ±16~40°). 예전엔 ±140~168° 까지 썼다.
 *   2) 대신 **몸 전체**의 이동(y 바운스) · 기울임(rot) · 스쿼시(sx/sy) 로 표현한다.
 *      - 눌림: sy↓ sx↑   / 늘어남: sy↑ sx↓   (부피 보존처럼 보이게 반대로 움직인다)
 *      - 변형 기준점은 발밑(groundY)이라 "바닥에 선 몸"으로 읽힌다.
 *   3) 예비동작(anticipation) → 본동작 → 오버슈트 → 마무리 반동(settle) 을 넣어
 *      뚝 끊기지 않고 통통 튀게 만든다.
 *
 * 프레임 표기:
 *   { t:<ms>, root:{x,y,rot,sx,sy,vis,flip,aura}, <bone>:{rot,x,y,vis} }  // 뉴트럴 기준 델타
 *   - sx/sy 는 기본값 1, 나머지는 0. vis/flip 은 계단 보간, 나머지는 선형 보간.
 *   - 언급 없는 본/속성은 뉴트럴로 채워진다(희소 프레임 허용).
 *   - 5조각 골격은 어깨/골반 트랙(*_upper)만 읽어 근사 재생한다(engine.animSource).
 */

(function (root) {
  const RW = (root.RW = root.RW || {});

  const anims = {
    // 1) 지루해서 늘어졌다가 그대로 뒹굴기
    //    몸이 점점 눌리다가(sy↓) 옆으로 톡 넘어간다.
    g1_slump_roll: {
      loop: false,
      frames: [
        { t: 0 },
        { t: 200, root: { y: -3, sy: 1.04, sx: 0.97 }, head: { rot: -5 } },                 // 한숨 들이켜기
        { t: 520, root: { y: 5, sy: 0.95, sx: 1.04 }, torso: { rot: 12 }, head: { rot: 10 }, armR_upper: { rot: 10 }, armL_upper: { rot: -10 } },
        { t: 900, root: { y: 12, sy: 0.87, sx: 1.10 }, torso: { rot: 24 }, head: { rot: 18 }, armR_upper: { rot: 18 }, armL_upper: { rot: -18 }, legR_upper: { rot: 10 }, legL_upper: { rot: 10 } },
        { t: 1250, root: { y: 12, sy: 0.87, sx: 1.10 }, torso: { rot: 24 }, head: { rot: 18 } }, // 한 박자 정지
        { t: 1450, root: { y: 10, rot: 10, sy: 0.92, sx: 1.06 } },                          // 기우뚱
        { t: 1850, root: { y: 30, rot: 60, sy: 0.95, sx: 1.04 }, torso: { rot: 18 }, legR_upper: { rot: 26 }, legL_upper: { rot: 26 }, armR_upper: { rot: 26 }, armL_upper: { rot: -26 } },
        { t: 2200, root: { y: 38, rot: 88, sy: 0.90, sx: 1.08 }, legR_upper: { rot: 34 }, legL_upper: { rot: 34 } },
        { t: 2420, root: { y: 36, rot: 85, sy: 0.94, sx: 1.04 } }                           // 착지 반동
      ]
    },

    // 2) 슬쩍 눈치보다가 둠칫둠칫 엉덩이 트월킹
    //    스쿼트 자세에서 좌우로 튕기듯. 머리는 반대로 반동.
    g2_twerk: {
      loop: false,
      frames: [
        { t: 0 },
        { t: 250, head: { rot: -20 }, root: { sx: 1.02, sy: 0.99 } },                       // 좌 살핌
        { t: 500, head: { rot: 20 } },                                                      // 우 살핌
        { t: 700, root: { y: 10, sy: 0.90, sx: 1.08 }, head: { rot: 0 }, torso: { rot: 14 }, legR_upper: { rot: 9 }, legL_upper: { rot: 9 }, armR_upper: { rot: -14 }, armL_upper: { rot: 14 } },
        // 둠칫둠칫
        { t: 840,  root: { y: 13, rot: -7, x: -5, sy: 0.87, sx: 1.11 }, head: { rot: 5 } },
        { t: 965,  root: { y: 5,  rot: 7,  x: 5,  sy: 0.97, sx: 1.02 }, head: { rot: -5 } },
        { t: 1090, root: { y: 13, rot: -7, x: -5, sy: 0.87, sx: 1.11 }, head: { rot: 5 } },
        { t: 1215, root: { y: 5,  rot: 7,  x: 5,  sy: 0.97, sx: 1.02 }, head: { rot: -5 } },
        { t: 1340, root: { y: 13, rot: -7, x: -5, sy: 0.87, sx: 1.11 }, head: { rot: 5 } },
        { t: 1465, root: { y: 5,  rot: 7,  x: 5,  sy: 0.97, sx: 1.02 }, head: { rot: -5 } },
        { t: 1600, root: { y: 10, rot: -4, x: -3, sy: 0.92, sx: 1.06 } },
        { t: 1800 }
      ]
    },

    // 3) 무릎 꿇으며 하늘로 양팔 벌리며 좌절하기
    //    치비는 실제로 못 꿇으므로, 몸을 낮추고(y↓ sy↓) 다리를 벌려 주저앉는 인상으로.
    g3_despair: {
      loop: false,
      frames: [
        { t: 0 },
        { t: 200, root: { y: -6, sy: 1.06, sx: 0.95 }, armR_upper: { rot: -14 }, armL_upper: { rot: 14 }, head: { rot: -6 } }, // 숨 들이켜기
        { t: 560, root: { y: 24, sy: 0.88, sx: 1.10 }, legR_upper: { rot: 34 }, legL_upper: { rot: 34 }, armR_upper: { rot: -55 }, armL_upper: { rot: 55 } },
        { t: 880, root: { y: 27, sy: 0.90, sx: 1.08 }, legR_upper: { rot: 38 }, legL_upper: { rot: 38 }, armR_upper: { rot: -85 }, armL_upper: { rot: 85 }, head: { rot: -12 }, torso: { rot: -6 } },
        { t: 1080, root: { y: 27, x: 2, sy: 0.90, sx: 1.08 }, head: { rot: -14 } },         // 부들부들
        { t: 1280, root: { y: 27, x: -2, sy: 0.90, sx: 1.08 }, head: { rot: -10 } },
        { t: 2050, root: { y: 27, x: 0, sy: 0.90, sx: 1.08 }, legR_upper: { rot: 38 }, legL_upper: { rot: 38 }, armR_upper: { rot: -85 }, armL_upper: { rot: 85 }, head: { rot: -12 }, torso: { rot: -6 } } // 길게 정지
      ]
    },

    // 4) 피겨 턴하고 발레 점프하기
    //    플리에(눌림) → 회전 → 크게 눌렀다 튀어오름(늘어남) → 착지 스쿼시 → 반동
    g4_ballet: {
      loop: false,
      frames: [
        { t: 0 },
        { t: 150, root: { y: 11, sy: 0.89, sx: 1.09 }, legR_upper: { rot: 7 }, legL_upper: { rot: 7 }, armR_upper: { rot: -28 }, armL_upper: { rot: 28 } },
        { t: 320, root: { flip: true, y: 0, sy: 1.04, sx: 0.97 }, armR_upper: { rot: -45 }, armL_upper: { rot: 45 } },
        { t: 440, root: { flip: false, y: 0, sy: 1.04, sx: 0.97 }, armR_upper: { rot: -45 }, armL_upper: { rot: 45 } },
        { t: 560, root: { flip: true, y: 0, sy: 1.04, sx: 0.97 }, armR_upper: { rot: -45 }, armL_upper: { rot: 45 } },
        { t: 700, root: { flip: false, y: 14, sy: 0.84, sx: 1.13 }, legR_upper: { rot: 9 }, legL_upper: { rot: 9 }, armR_upper: { rot: -20 }, armL_upper: { rot: 20 } }, // 웅크림
        { t: 900, root: { y: -52, sy: 1.16, sx: 0.89 }, armR_upper: { rot: -72 }, armL_upper: { rot: 72 }, legR_upper: { rot: -4 }, legL_upper: { rot: 4 } },           // 체공
        { t: 1040, root: { y: -56, sy: 1.12, sx: 0.92 } },                                  // 정점
        { t: 1230, root: { y: 14, sy: 0.82, sx: 1.15 }, legR_upper: { rot: 10 }, legL_upper: { rot: 10 }, armR_upper: { rot: -26 }, armL_upper: { rot: 26 } },          // 착지
        { t: 1400, root: { y: -6, sy: 1.07, sx: 0.96 }, armR_upper: { rot: -12 }, armL_upper: { rot: 12 } },                                                            // 반동
        { t: 1560, root: { y: 2, sy: 0.98, sx: 1.01 } },
        { t: 1700 }
      ]
    },

    // 5) 자리비우기(사라지기) — 통통 튀는 걸음으로 화면 밖으로
    g5_leave: {
      loop: false,
      frames: [
        { t: 0 },
        { t: 160, root: { x: 26, y: -6, sy: 1.05, sx: 0.96 }, legR_upper: { rot: 18 }, legL_upper: { rot: -18 }, armR_upper: { rot: -10 }, armL_upper: { rot: 10 } },
        { t: 320, root: { x: 58, y: 3, sy: 0.95, sx: 1.05 }, legR_upper: { rot: -18 }, legL_upper: { rot: 18 }, armR_upper: { rot: 10 }, armL_upper: { rot: -10 } },
        { t: 480, root: { x: 96, y: -6, sy: 1.05, sx: 0.96 }, legR_upper: { rot: 18 }, legL_upper: { rot: -18 }, armR_upper: { rot: -10 }, armL_upper: { rot: 10 } },
        { t: 640, root: { x: 142, y: 3, sy: 0.95, sx: 1.05 }, legR_upper: { rot: -18 }, legL_upper: { rot: 18 }, armR_upper: { rot: 10 }, armL_upper: { rot: -10 } },
        { t: 800, root: { x: 196, y: -6, sy: 1.05, sx: 0.96 }, legR_upper: { rot: 18 }, legL_upper: { rot: -18 } },
        { t: 960, root: { x: 254, y: 3 } },
        { t: 1100, root: { x: 315, vis: false } }
      ]
    },

    // 6) 화면으로 다가와 얼굴 부비기 (복귀에도 재사용)
    //    치비는 목이 없으니 부비기는 몸 전체를 좌우로 비비는 것으로.
    g6_nuzzle: {
      loop: false,
      frames: [
        { t: 0, root: { x: 175 }, legR_upper: { rot: -18 }, legL_upper: { rot: 18 }, armR_upper: { rot: 10 }, armL_upper: { rot: -10 } },
        { t: 180, root: { x: 120, y: -6, sy: 1.05, sx: 0.96 }, legR_upper: { rot: 18 }, legL_upper: { rot: -18 }, armR_upper: { rot: -10 }, armL_upper: { rot: 10 } },
        { t: 360, root: { x: 65, y: 3, sy: 0.95, sx: 1.05 }, legR_upper: { rot: -18 }, legL_upper: { rot: 18 } },
        { t: 540, root: { x: 14, y: -4, sy: 1.03 } },
        { t: 700, root: { x: 8, y: 4, sy: 0.94, sx: 1.06, rot: -7 }, torso: { rot: 9 }, head: { rot: -8 } },   // 부비기 1
        { t: 830, root: { x: 1, y: 4, sy: 0.94, sx: 1.06, rot: 7 }, torso: { rot: 9 }, head: { rot: 8 } },
        { t: 960, root: { x: 8, y: 4, sy: 0.94, sx: 1.06, rot: -7 }, torso: { rot: 9 }, head: { rot: -8 } },
        { t: 1090, root: { x: 1, y: 4, sy: 0.94, sx: 1.06, rot: 7 }, torso: { rot: 9 }, head: { rot: 8 } },
        { t: 1250, root: { x: 5, y: 2, rot: -3, sy: 0.98 }, torso: { rot: 5 }, head: { rot: -3 } },
        { t: 1450, root: { x: 0 } }
      ]
    },

    // 7) 가만히 분노하며 오오라를 내뿜기
    //    몸을 잔뜩 웅크린 채 미세 진동 + 오오라가 두 번 크게 부푼다.
    g7_rage_aura: {
      loop: false,
      frames: [
        { t: 0, head: { rot: 8 }, torso: { rot: 3 }, armR_upper: { rot: 7 }, armL_upper: { rot: -7 }, armR_lower: { rot: 24 }, armL_lower: { rot: -24 }, root: { sy: 0.98, sx: 1.02 } },
        { t: 160, root: { x: 1, aura: 0.5, sy: 0.96, sx: 1.04 }, head: { rot: 10 } },
        { t: 280, root: { x: -1.5, aura: 0.9, sy: 0.96, sx: 1.04 } },
        { t: 400, root: { x: 1.5, aura: 0.7, sy: 0.97, sx: 1.03 } },
        { t: 520, root: { x: -1.5, aura: 1.5, sy: 0.94, sx: 1.06 } },                       // 크게 부풂
        { t: 660, root: { x: 1.5, aura: 0.8, sy: 0.98, sx: 1.02 } },
        { t: 790, root: { x: -1.5, aura: 1.0, sy: 0.96, sx: 1.04 }, head: { rot: 11 } },
        { t: 920, root: { x: 1.5, aura: 0.7, sy: 0.98, sx: 1.02 } },
        { t: 1050, root: { x: -1.5, aura: 1.6, sy: 0.93, sx: 1.07 } },                      // 두 번째 강조
        { t: 1190, root: { x: 1.5, aura: 0.9, sy: 0.97, sx: 1.03 } },
        { t: 1330, root: { x: -1.5, aura: 1.1, sy: 0.96, sx: 1.04 } },
        { t: 1500, root: { x: 1, aura: 0.7, sy: 0.98, sx: 1.02 } },
        { t: 1700, root: { x: 0, aura: 0.5 }, head: { rot: 9 } },
        { t: 1900, root: { x: 0, aura: 0 }, head: { rot: 8 }, torso: { rot: 3 } }
      ]
    },

    // 8) 팔 들고 어깨 으쓱 (치비는 팔꿈치가 없어 곧게 든 팔 + 통통 튀는 두 번 으쓱)
    g8_w_shrug: {
      loop: false,
      frames: [
        { t: 0 },
        { t: 130, root: { y: 5, sy: 0.94, sx: 1.05 } },                                     // 살짝 눌렀다가
        { t: 300, root: { y: -2, sy: 1.03, sx: 0.98 }, armR_upper: { rot: -60 }, armL_upper: { rot: 60 }, armR_lower: { rot: 45 }, armL_lower: { rot: -45 } },
        { t: 470, root: { y: -11, sy: 1.08, sx: 0.94 }, head: { rot: 4 }, armR_upper: { rot: -74 }, armL_upper: { rot: 74 }, armR_lower: { rot: 45 }, armL_lower: { rot: -45 } }, // 으쓱 1
        { t: 630, root: { y: 3, sy: 0.95, sx: 1.04 }, head: { rot: 0 }, armR_upper: { rot: -60 }, armL_upper: { rot: 60 }, armR_lower: { rot: 45 }, armL_lower: { rot: -45 } },
        { t: 790, root: { y: -11, sy: 1.08, sx: 0.94 }, head: { rot: 4 }, armR_upper: { rot: -74 }, armL_upper: { rot: 74 }, armR_lower: { rot: 45 }, armL_lower: { rot: -45 } }, // 으쓱 2
        { t: 950, root: { y: 3, sy: 0.95, sx: 1.04 }, head: { rot: 0 }, armR_upper: { rot: -60 }, armL_upper: { rot: 60 }, armR_lower: { rot: 45 }, armL_lower: { rot: -45 } },
        { t: 1150, root: { y: 0 }, armR_upper: { rot: -60 }, armL_upper: { rot: 60 }, armR_lower: { rot: 45 }, armL_lower: { rot: -45 } },
        { t: 1400 }
      ]
    },

    // --- 자율 생활 2종 (전송/히스토리 없음, 로컬 반복) ---

    // 멍때리기 — 숨쉬기(스쿼시)로 표현. 가끔 무게중심을 옮긴다.
    idle: {
      loop: true,
      frames: [
        { t: 0 },
        { t: 900, root: { y: -3, sy: 1.035, sx: 0.98 }, head: { rot: 2 } },                 // 들숨
        { t: 1800, root: { y: 2, sy: 0.97, sx: 1.02 }, head: { rot: 0 } },                  // 날숨
        { t: 2700, root: { x: 3, y: -2, sy: 1.02, sx: 0.99 }, head: { rot: 3 } },
        { t: 3600, root: { x: -3, y: 2, sy: 0.98, sx: 1.01 }, head: { rot: -2 } },
        { t: 4500, root: { x: 0, y: 0 } }
      ]
    },

    // 돌아다니기 — 통통 튀는 걸음. 되돌아와 매끄럽게 루프.
    wander: {
      loop: true,
      frames: [
        { t: 0, root: { x: 0 } },
        { t: 250, root: { x: 10, y: -6, sy: 1.05, sx: 0.96 }, legR_upper: { rot: 16 }, legL_upper: { rot: -16 }, armR_upper: { rot: -8 }, armL_upper: { rot: 8 } },
        { t: 500, root: { x: 22, y: 3, sy: 0.95, sx: 1.05 }, legR_upper: { rot: -16 }, legL_upper: { rot: 16 }, armR_upper: { rot: 8 }, armL_upper: { rot: -8 } },
        { t: 750, root: { x: 34, y: -6, sy: 1.05, sx: 0.96 }, legR_upper: { rot: 16 }, legL_upper: { rot: -16 }, armR_upper: { rot: -8 }, armL_upper: { rot: 8 } },
        { t: 1000, root: { x: 46, y: 3, sy: 0.95, sx: 1.05 }, legR_upper: { rot: -16 }, legL_upper: { rot: 16 }, armR_upper: { rot: 8 }, armL_upper: { rot: -8 } },
        { t: 1250, root: { x: 55, y: 0, flip: true } },
        { t: 1500, root: { x: 46, y: -6, flip: true, sy: 1.05, sx: 0.96 }, legR_upper: { rot: 16 }, legL_upper: { rot: -16 }, armR_upper: { rot: -8 }, armL_upper: { rot: 8 } },
        { t: 1750, root: { x: 34, y: 3, flip: true, sy: 0.95, sx: 1.05 }, legR_upper: { rot: -16 }, legL_upper: { rot: 16 }, armR_upper: { rot: 8 }, armL_upper: { rot: -8 } },
        { t: 2000, root: { x: 22, y: -6, flip: true, sy: 1.05, sx: 0.96 }, legR_upper: { rot: 16 }, legL_upper: { rot: -16 } },
        { t: 2250, root: { x: 10, y: 3, flip: true, sy: 0.95, sx: 1.05 }, legR_upper: { rot: -16 }, legL_upper: { rot: 16 } },
        { t: 2500, root: { x: 0, y: 0, flip: false } }
      ]
    },

    // 복귀 보조 — 화면 밖에서 통통 튀며 걸어 들어옴
    walk_in: {
      loop: false,
      frames: [
        { t: 0, root: { x: 190, vis: true }, legR_upper: { rot: -18 }, legL_upper: { rot: 18 }, armR_upper: { rot: 10 }, armL_upper: { rot: -10 } },
        { t: 220, root: { x: 130, y: -6, sy: 1.05, sx: 0.96 }, legR_upper: { rot: 18 }, legL_upper: { rot: -18 }, armR_upper: { rot: -10 }, armL_upper: { rot: 10 } },
        { t: 440, root: { x: 75, y: 3, sy: 0.95, sx: 1.05 }, legR_upper: { rot: -18 }, legL_upper: { rot: 18 }, armR_upper: { rot: 10 }, armL_upper: { rot: -10 } },
        { t: 660, root: { x: 30, y: -6, sy: 1.05, sx: 0.96 }, legR_upper: { rot: 18 }, legL_upper: { rot: -18 } },
        { t: 870, root: { x: 4, y: 3, sy: 0.96, sx: 1.04 } },
        { t: 1000, root: { x: 0, y: 0 } }
      ]
    }
  };

  function get(id) {
    return anims[id] || null;
  }

  RW.animations = { anims, get };
})(typeof window !== 'undefined' ? window : globalThis);
