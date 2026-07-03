'use strict';
/* 골격(skeleton) 정의.
 *
 * 골격은 이족(bipedal)으로 고정한다. 각 골격은 "고정된 관절 슬롯"을 가지며,
 * 애니메이션은 캐릭터가 아니라 이 골격에 대해 미리 만들어 둔 키프레임 시퀀스다.
 * 어떤 캐릭터(프리셋/업로드)를 올리든 같은 골격이면 같은 시퀀스가 그대로 적용된다.
 *
 * 좌표계:
 *   - 한 본(bone)의 로컬 원점(0,0)은 그 본의 회전 중심(관절, pivot)이다.
 *   - 자식 본은 부모 로컬 좌표에서 pivotOffset 만큼 떨어진 곳에 붙는다.
 *   - part 는 그 본의 로컬 좌표에서 그려질 사각/타원 영역이다(원점=관절).
 *   - 각도(deg)는 CSS rotate 규칙(시계방향 +). 뉴트럴(0)에서 팔·다리는 아래로 향한다.
 */

(function (root) {
  const RW = (root.RW = root.RW || {});

  // 이족 골격의 본 목록. 순서는 부모가 자식보다 먼저 오도록 정렬되어 있다.
  // 좌/우는 캐릭터 기준(뷰어 입장에서 R=오른쪽 +x).
  const BIPEDAL_BONES = [
    // name          parent        pivotOffset      part(관절 원점 기준)                 z
    { name: 'root',        parent: null,        pivotOffset: [0, 0],    part: null,                                       z: 5 },
    { name: 'legL_upper',  parent: 'root',      pivotOffset: [-9, 0],   part: rect(-8, 0, 16, 42, 'leg'),                 z: 2 },
    { name: 'legL_lower',  parent: 'legL_upper',pivotOffset: [0, 42],   part: rect(-7, 0, 14, 38, 'leg'),                 z: 2 },
    { name: 'footL',       parent: 'legL_lower',pivotOffset: [0, 38],   part: rect(-6, -4, 22, 10, 'foot'),               z: 2 },
    { name: 'legR_upper',  parent: 'root',      pivotOffset: [9, 0],    part: rect(-8, 0, 16, 42, 'leg'),                 z: 3 },
    { name: 'legR_lower',  parent: 'legR_upper',pivotOffset: [0, 42],   part: rect(-7, 0, 14, 38, 'leg'),                 z: 3 },
    { name: 'footR',       parent: 'legR_lower',pivotOffset: [0, 38],   part: rect(-6, -4, 22, 10, 'foot'),               z: 3 },
    { name: 'torso',       parent: 'root',      pivotOffset: [0, 0],    part: rect(-18, -70, 36, 70, 'torso'),            z: 4 },
    { name: 'armL_upper',  parent: 'torso',     pivotOffset: [-18, -62],part: rect(-7, 0, 14, 34, 'arm'),                 z: 1 },
    { name: 'armL_lower',  parent: 'armL_upper',pivotOffset: [0, 34],   part: rect(-6, 0, 12, 30, 'arm'),                 z: 1 },
    { name: 'handL',       parent: 'armL_lower',pivotOffset: [0, 30],   part: ellipse(-9, -2, 18, 18, 'hand'),            z: 1 },
    { name: 'armR_upper',  parent: 'torso',     pivotOffset: [18, -62], part: rect(-7, 0, 14, 34, 'arm'),                 z: 6 },
    { name: 'armR_lower',  parent: 'armR_upper',pivotOffset: [0, 34],   part: rect(-6, 0, 12, 30, 'arm'),                 z: 6 },
    { name: 'handR',       parent: 'armR_lower',pivotOffset: [0, 30],   part: ellipse(-9, -2, 18, 18, 'hand'),            z: 6 },
    { name: 'head',        parent: 'torso',     pivotOffset: [0, -70],  part: ellipse(-22, -46, 44, 46, 'head'),          z: 7 }
  ];

  function rect(x, y, w, h, slot)    { return { shape: 'rect', x, y, w, h, slot }; }
  function ellipse(x, y, w, h, slot) { return { shape: 'ellipse', x, y, w, h, slot }; }

  // 캐릭터 표시 영역(로컬 좌표계 기준 대략 -30..30 x, -120..90 y).
  // 렌더 시 이 원점(root=골반)이 어디에 놓일지는 엔진이 정한다.
  const SKELETONS = {
    bipedal: {
      id: 'bipedal',
      bones: BIPEDAL_BONES,
      // 슬롯 목록 — 프리셋 rig.json 이 부위별 이미지/색을 채운다.
      slots: ['head', 'torso', 'arm', 'hand', 'leg', 'foot'],
      // 캐릭터 콘텐츠 상자(대략). 오버레이 배치/드래그 히트박스 계산에 쓴다.
      box: { w: 120, h: 210, originX: 60, originY: 150 }
    }
  };

  function getSkeleton(id) {
    return SKELETONS[id] || SKELETONS.bipedal;
  }

  RW.skeleton = { SKELETONS, getSkeleton };
})(typeof window !== 'undefined' ? window : globalThis);
