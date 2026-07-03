'use strict';
/* 캐릭터 해석기 — 프리셋과 커스텀(업로드) 캐릭터를 한 곳에서 다룬다.
 *
 * 커스텀 캐릭터는 프리셋과 완전히 동일한 포맷(부위 이미지 + 리그 JSON)이라
 * 같은 엔진이 구분 없이 로드한다. 커스텀 번들:
 *   { skeletonId: 'bipedal5', slots: { <slot>: { image, fit:{x,y,w,h,rot}, z } } }
 */

(function (root) {
  const RW = (root.RW = root.RW || {});

  // 번들 → 엔진 mount 입력 { skeleton, rig }
  // proportions 가 있으면 그 비율로 골격을 생성(리깅 도구에서 가이드 비율을 조절한 캐릭터).
  function bundleToRig(bundle) {
    const skeletonId = bundle.skeletonId || 'bipedal5';
    const skeleton = (bundle.proportions && skeletonId === 'bipedal5')
      ? RW.skeleton.buildBipedal5(bundle.proportions)
      : RW.skeleton.getSkeleton(skeletonId);
    return { skeleton, rig: { skeletonId, slots: bundle.slots || {} } };
  }

  function customList(config) {
    return (config && config.customCharacters) || [];
  }

  function find(id, config) {
    const c = customList(config).find((x) => x.id === id);
    if (c) return { id: c.id, name: c.name, custom: true, swatch: c.swatch, bundle: c.bundle };
    const p = RW.presets.get(id);
    return { id: p.id, name: p.name, custom: false, swatch: p.swatch };
  }

  // 선택 UI 용 전체 목록(프리셋 + 커스텀)
  function listAll(config) {
    const presets = RW.presets.PRESETS.map((p) => ({ id: p.id, name: p.name, swatch: p.swatch, custom: false }));
    const customs = customList(config).map((c) => ({ id: c.id, name: c.name, swatch: c.swatch, custom: true }));
    return presets.concat(customs);
  }

  // id(+config) → { skeleton, rig }. 커스텀이면 번들에서, 아니면 프리셋에서.
  function rigFor(id, config) {
    const c = customList(config).find((x) => x.id === id);
    if (c && c.bundle) return bundleToRig(c.bundle);
    return RW.presets.rigFor(id);
  }

  RW.characters = { bundleToRig, find, listAll, rigFor, customList };
})(typeof window !== 'undefined' ? window : globalThis);
