'use strict';
/* 동작(gesture) 메타데이터.
 *
 * 능동 8개(리모컨으로 발사) + 자율 2종(신호 아님, 로컬 배경 동작).
 * 실제 안무 값(키프레임)은 animations.js 에 골격별로 들어 있고,
 * 여기서는 id·이름·아이콘·분류만 정의한다.
 */

(function (root) {
  const RW = (root.RW = root.RW || {});

  // 능동 동작 8개 — 리모컨 라디얼의 시계 12시부터 시계방향 순서.
  const ACTIVE = [
    { id: 'g1_slump_roll',  name: '지루해 뒹굴기',      icon: '🥱' },
    { id: 'g2_twerk',       name: '엉덩이 트월킹',      icon: '🍑' },
    { id: 'g3_despair',     name: '무릎 꿇고 좌절',      icon: '🙌' },
    { id: 'g4_ballet',      name: '피겨 턴·발레 점프',   icon: '🩰' },
    { id: 'g5_leave',       name: '자리비우기',          icon: '🚪' },
    { id: 'g6_nuzzle',      name: '다가와 얼굴 부비기',  icon: '🥰' },
    { id: 'g7_rage_aura',   name: '분노 오오라',        icon: '😤' },
    { id: 'g8_w_shrug',     name: 'W 팔 으쓱',          icon: '🤷' }
  ];

  // 자율 생활 2종 — 전송되지 않고 히스토리에도 남지 않는다. 로컬에서만 재생.
  const AMBIENT = [
    { id: 'idle',   name: '멍때리기',   icon: '😐' },
    { id: 'wander', name: '돌아다니기', icon: '🚶' }
  ];

  // 복귀용 보조 동작 — 화면 밖에서 걸어 들어옴(자리비우기 이후 다른 신호가 오면 앞에 붙인다).
  const WALK_IN = { id: 'walk_in', name: '걸어 들어오기', icon: '🚶' };

  const ALL = [...ACTIVE, ...AMBIENT, WALK_IN];
  const byId = {};
  for (const g of ALL) byId[g.id] = g;

  RW.gestures = {
    ACTIVE,
    AMBIENT,
    WALK_IN,
    get: (id) => byId[id] || { id, name: id, icon: '❔' },
    isActive: (id) => ACTIVE.some((g) => g.id === id)
  };
})(typeof window !== 'undefined' ? window : globalThis);
