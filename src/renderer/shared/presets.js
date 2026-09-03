'use strict';
/* 프리셋(제공) 캐릭터 로더.
 *
 * 두 종류가 섞여 있다.
 *   1) 그림 프리셋 — 5조각 번들이 preset-art.js 에 data URI 로 내장돼 있다.
 *      앱에 들어 있으므로 상대에게는 **id 만** 보내면 된다(업로드·다운로드 없음).
 *   2) 색 프리셋 — 아트가 없던 시절의 도형 플레이스홀더. 지우면 예전에 이걸 고른
 *      사용자의 캐릭터가 사라지므로 남겨 둔다.
 *
 * 리그 설정의 본 계층·회전 중심점·z-순서·골격 종류는 골격(skeleton.js)에 공통으로
 * 정의되어 있고, 여기서는 골격 id 와 슬롯별 표현(색/이미지/테두리)만 채운다.
 */

(function (root) {
  const RW = (root.RW = root.RW || {});

  // 슬롯: head, torso, arm, hand, leg, foot
  function slots(main, accent, skin) {
    return {
      head: { color: skin, border: '2px solid rgba(0,0,0,.15)' },
      torso: { color: main, radius: 14 },
      arm: { color: main, radius: 8 },
      hand: { color: skin },
      leg: { color: accent, radius: 8 },
      foot: { color: '#3a3a3a', radius: 5 }
    };
  }

  // 그림이 있는 제공 캐릭터. preset-art.js 가 없으면(구버전) 조용히 건너뛴다.
  const ART = (root.RW && root.RW.presetArt) || {};
  const ART_PRESETS = [
    { id: 'char_seal',   name: '물개',   swatch: '#9aa0a6' },
    { id: 'char_ribbon', name: '리본',   swatch: '#2f56c9' }
  ].filter((p) => ART[p.id]).map((p) => Object.assign({}, p, { bundle: ART[p.id] }));

  const PRESETS = ART_PRESETS.concat([
    {
      id: 'preset1',
      name: '캐릭터1',
      skeletonId: 'bipedal',
      swatch: '#8a63ff',
      slots: slots('#8a63ff', '#5b3ecc', '#ffd9c0')
    },
    {
      id: 'preset2',
      name: '캐릭터2',
      skeletonId: 'bipedal',
      swatch: '#ff6fa5',
      slots: slots('#ff6fa5', '#d24f84', '#ffe0cf')
    },
    {
      id: 'preset3',
      name: '캐릭터3',
      skeletonId: 'bipedal',
      swatch: '#38c6a0',
      slots: slots('#38c6a0', '#1f9b7c', '#ffe0cf')
    }
  ]);

  const byId = {};
  for (const p of PRESETS) byId[p.id] = p;

  function get(id) {
    return byId[id] || PRESETS[0];
  }

  // 엔진 mount 에 넘길 { skeleton, rig } 구성
  // (characters.bundleToRig 와 같은 일을 하지만, characters.js 가 이 파일보다 나중에
  //  로드되므로 여기서 직접 조립한다.)
  function rigFor(id) {
    const preset = get(id);
    if (preset.bundle) {
      const b = preset.bundle;
      const sk = RW.skeleton.buildBipedal5(b.proportions);
      const rig = { skeletonId: 'bipedal5', slots: b.slots || {}, slotsBack: b.slotsBack || null };
      return { skeleton: RW.skeleton.withContentBox(sk, rig), rig };
    }
    const sk = RW.skeleton.getSkeleton(preset.skeletonId);
    const rig = { skeletonId: preset.skeletonId, slots: preset.slots };
    return { skeleton: RW.skeleton.withContentBox(sk, rig), rig };
  }

  RW.presets = { PRESETS, get, rigFor };
})(typeof window !== 'undefined' ? window : globalThis);
