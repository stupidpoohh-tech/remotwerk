'use strict';
/* 동작(gesture) 메타데이터.
 *
 * ▣ 왜 4개인가
 *   8개를 두니 아이콘만으로 외워지지 않았고, 5조각 치비 리그로는 8가지를 시각적으로
 *   구분할 수 없었다(뒹굴기/좌절은 둘 다 아래로, 부비기/으쓱은 둘 다 제자리 상체).
 *   "신호 하나 = 또렷한 동작 하나"라는 원칙을 지키려면 개수를 줄이는 게 맞다.
 *
 * ▣ 무엇을 남겼나 — 감정 스펙트럼의 축들
 *   각 신호는 **움직임 방향**과 **이펙트 색**으로 이중 구분된다. 곁눈질로도 갈린다.
 *     보고싶어 : 위로 살짝 폴짝  + 분홍 하트
 *     신나     : 크게 반복 점프  + 노랑 반짝
 *     지쳤어   : 아래로 푹 눌림  + 파랑 땀방울
 *     트월킹   : 뒤돌아 엉덩이 흔들 (앱 이름값 하는 시그니처 동작)
 *
 *   트월킹은 유일하게 **뒤로 돈다**. 뒷모습 이미지를 등록하면 진짜로 등을 보이고,
 *   없으면 몸을 얇게 눌러 도는 인상만 준 뒤 앞모습으로 흔든다(깨지지 않는다).
 *
 *   자리비우기(사라짐)는 뺐다. 캐릭터가 없어지면 상대는 "앱이 꺼졌나"로 읽어서
 *   신호가 아니라 오작동처럼 보였고, 복귀 규칙도 복잡했다.
 */

(function (root) {
  const RW = (root.RW = root.RW || {});

  // 능동 동작 — 리모컨 버튼 순서(왼→오른쪽)
  const ACTIVE = [
    { id: 'g_heart', name: '보고싶어', icon: '💗', hint: '살짝 폴짝 + 하트' },
    { id: 'g_cheer', name: '신나',     icon: '✨', hint: '방방 뛰기 + 반짝' },
    { id: 'g_droop', name: '지쳤어',   icon: '🫠', hint: '축 처져 흔들' },
    { id: 'g_twerk', name: '트월킹',   icon: '🍑', hint: '뒤돌아 엉덩이 흔들' }
  ];

  // 자율 생활 — 전송되지 않고 히스토리에도 남지 않는다. 로컬에서만 재생.
  const AMBIENT = [
    { id: 'idle',   name: '멍때리기',   icon: '😐' },
    { id: 'wander', name: '돌아다니기', icon: '🚶' }
  ];

  const ALL = [...ACTIVE, ...AMBIENT];
  const byId = {};
  for (const g of ALL) byId[g.id] = g;

  // 예전 버전에서 보낸 신호가 히스토리에 남아 있을 수 있어, 이름만이라도 보여준다.
  const RETIRED = {
    g1_slump_roll: '지루해 뒹굴기', g2_twerk: '엉덩이 트월킹', g3_despair: '무릎 꿇고 좌절',
    g4_ballet: '피겨 턴·발레 점프', g5_leave: '자리비우기', g6_nuzzle: '얼굴 부비기',
    g7_rage_aura: '분노 오오라', g8_w_shrug: 'W 팔 으쓱', walk_in: '걸어 들어오기'
  };

  function get(id) {
    if (byId[id]) return byId[id];
    if (RETIRED[id]) return { id, name: RETIRED[id], icon: '🕘', retired: true };
    return { id, name: id, icon: '❔' };
  }

  RW.gestures = {
    ACTIVE,
    AMBIENT,
    get,
    isActive: (id) => ACTIVE.some((g) => g.id === id)
  };
})(typeof window !== 'undefined' ? window : globalThis);
