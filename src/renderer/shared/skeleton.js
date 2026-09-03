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

  // 5조각(大자 가이드) 이족 골격 — 인앱 리깅·업로드 도구(Prompt B)용.
  //   조각: 몸통+머리(torso) / 좌팔(armL) / 우팔(armR) / 좌다리(legL) / 우다리(legR)
  //   관절: 어깨·골반뿐(팔꿈치·무릎 없음), 머리는 몸통에 포함.
  //   neutral: 大자(스프레드) 가이드에 맞춘 기본 각도. 애니메이션 회전은 이 위에 델타로 얹힌다.
  //   animSource: 코어 애니메이션의 어깨/골반 트랙(*_upper)을 그대로 읽어 근사 재생.
  //   guideRot: 大자 가이드에서 각 조각이 벌어진 각도. 리깅 도구가 가이드 윤곽을 이 각도로
  //     그리고, 업로드한 조각의 기본 fit.rot 로 쓴다. 관절 회전(어깨/골반)은 이 위에 얹힌다.
  // 5조각 골격은 "비율(proportions)"로 생성한다. 리깅 도구에서 大자 가이드 비율을
  // 조절하면 그 값이 캐릭터 번들에 저장되고, 상대 클라이언트도 같은 비율로 렌더한다.
  const BIPEDAL5_DEFAULT = {
    torsoLen: 122,       // 몸통+머리 길이(세로)
    torsoW: 68,          // 몸통 너비
    shoulderRatio: 0.72, // 어깨 높이(몸통 길이 대비 위쪽 비율)
    shoulderX: 26,       // 어깨 좌우 간격(중심에서)
    hipX: 13,            // 골반 좌우 간격(중심에서)
    armLen: 82,          // 팔 길이
    armW: 24,            // 팔 두께
    legLen: 92,          // 다리 길이
    legW: 28             // 다리 두께
  };

  function buildBipedal5(p) {
    const q = Object.assign({}, BIPEDAL5_DEFAULT, p || {});
    const shoulderY = -Math.round(q.torsoLen * q.shoulderRatio);
    const bones = [
      { name: 'root',  parent: null,    pivotOffset: [0, 0], part: null, z: 5 },
      { name: 'torso', parent: 'root',  pivotOffset: [0, 0], part: rect(-q.torsoW / 2, -q.torsoLen, q.torsoW, q.torsoLen, 'torso'), z: 5, guideRot: 0,   animSource: 'torso' },
      { name: 'armL',  parent: 'torso', pivotOffset: [-q.shoulderX, shoulderY], part: rect(-q.armW / 2, 0, q.armW, q.armLen, 'armL'), z: 4, guideRot: 28,  animSource: 'armL_upper' },
      { name: 'armR',  parent: 'torso', pivotOffset: [q.shoulderX, shoulderY],  part: rect(-q.armW / 2, 0, q.armW, q.armLen, 'armR'), z: 6, guideRot: -28, animSource: 'armR_upper' },
      { name: 'legL',  parent: 'root',  pivotOffset: [-q.hipX, 0], part: rect(-q.legW / 2, 0, q.legW, q.legLen, 'legL'), z: 2, guideRot: 14,  animSource: 'legL_upper' },
      { name: 'legR',  parent: 'root',  pivotOffset: [q.hipX, 0],  part: rect(-q.legW / 2, 0, q.legW, q.legLen, 'legR'), z: 3, guideRot: -14, animSource: 'legR_upper' }
    ];
    // 콘텐츠 상자 — 비율에서 계산한다. 고정값(130×220)을 쓰면 다리를 길게 잡은
    // 캐릭터가 상자를 넘쳐서, 이 상자로 배치를 계산하는 화면(리모컨 미리보기)에서
    // 머리나 발이 잘렸다. 원점은 골반(0,0)이고 originY 는 상자 위에서 골반까지다.
    const M = 4;
    const halfW = Math.max(q.torsoW / 2, q.shoulderX + q.armW / 2, q.hipX + q.legW / 2);
    return {
      id: 'bipedal5',
      bones,
      slots: ['torso', 'armL', 'armR', 'legL', 'legR'],
      box: {
        w: Math.round(halfW * 2 + M * 2),
        h: Math.round(q.torsoLen + q.legLen + M * 2),
        originX: Math.round(halfW + M),
        originY: Math.round(q.torsoLen + M),
        groundY: q.legLen
      },
      spread: true,
      proportions: q
    };
  }

  // 캐릭터 표시 영역(로컬 좌표계 기준). 렌더 시 원점(root=골반)이 어디 놓일지는 엔진이 정한다.
  const SKELETONS = {
    bipedal: {
      id: 'bipedal',
      bones: BIPEDAL_BONES,
      // 슬롯 목록 — 프리셋 rig.json 이 부위별 이미지/색을 채운다.
      slots: ['head', 'torso', 'arm', 'hand', 'leg', 'foot'],
      // 캐릭터 콘텐츠 상자(대략). 오버레이 배치/드래그 히트박스 계산에 쓴다.
      box: { w: 120, h: 210, originX: 60, originY: 150, groundY: 86 }
    },
    bipedal5: buildBipedal5(BIPEDAL5_DEFAULT)
  };

  function getSkeleton(id) {
    return SKELETONS[id] || SKELETONS.bipedal;
  }

  // 각 본의 절대 관절 좌표(골반 원점 기준).
  function absPivots(sk) {
    const byName = {};
    sk.bones.forEach((b) => (byName[b.name] = b));
    const abs = {};
    function pivot(name) {
      if (abs[name]) return abs[name];
      const b = byName[name];
      if (!b || !b.parent) return (abs[name] = { x: 0, y: 0 });
      const p = pivot(b.parent);
      return (abs[name] = { x: p.x + b.pivotOffset[0], y: p.y + b.pivotOffset[1] });
    }
    sk.bones.forEach((b) => pivot(b.name));
    return abs;
  }

  // 실제로 그려지는 조각들을 모두 덮는 상자를 계산한다(골반이 원점).
  //
  // 왜 필요한가: 오버레이는 이 상자를 드래그 히트박스(#char)로 쓰고, 미리보기 화면들은
  // 여기서 배율을 정한다. 골격에 박아 둔 상자는 "대략" 값이라, 팔이 넓게 벌어진
  // 캐릭터는 히트박스 밖으로 삐져나가 클릭이 빗나갔다(색 프리셋은 발이 26px 튀어나와 있었다).
  const BOX_PAD = 8;
  function contentBox(sk, rig) {
    const abs = absPivots(sk);
    const slots = rig && rig.slots;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;

    for (const bone of sk.bones) {
      if (!bone.part) continue;
      const style = slots ? slots[bone.part.slot] : null;
      // 리그가 주어졌는데 그 슬롯이 비어 있으면 화면에 안 그려진다 → 상자에서도 뺀다.
      if (slots && !(style && (style.image || style.color))) continue;
      const box = (style && style.fit) ? style.fit : bone.part;
      const P = abs[bone.name] || { x: 0, y: 0 };
      const th = ((box.rot || 0) + (bone.neutral || 0)) * Math.PI / 180;
      const c = Math.cos(th), s = Math.sin(th);
      for (const [lx, ly] of [[box.x, box.y], [box.x + box.w, box.y],
                              [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]]) {
        const x = P.x + lx * c - ly * s;
        const y = P.y + lx * s + ly * c;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (!isFinite(x0)) return Object.assign({}, sk.box);   // 그릴 게 하나도 없으면 원래 상자

    const groundY = (sk.box && sk.box.groundY != null) ? sk.box.groundY : 0;
    // 발밑 기준선은 상자 안에 있어야 한다(미리보기 배치가 이걸 전제로 계산한다).
    y1 = Math.max(y1, groundY);
    return {
      w: Math.round(x1 - x0) + BOX_PAD * 2,
      h: Math.round(y1 - y0) + BOX_PAD * 2,
      originX: Math.round(-x0) + BOX_PAD,
      originY: Math.round(-y0) + BOX_PAD,
      groundY
    };
  }

  // 골격 + 리그 → 실제 상자를 반영한 골격 사본. 원본(공유 객체)은 건드리지 않는다.
  function withContentBox(sk, rig) {
    return Object.assign({}, sk, { box: contentBox(sk, rig) });
  }

  RW.skeleton = { SKELETONS, getSkeleton, buildBipedal5, BIPEDAL5_DEFAULT, absPivots, contentBox, withContentBox };
})(typeof window !== 'undefined' ? window : globalThis);
