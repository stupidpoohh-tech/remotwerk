'use strict';
/* 캐릭터 해석기 — 프리셋 · 공용 카탈로그 · 개인 커스텀을 한 곳에서 다룬다.
 *
 *   프리셋(preset)  : 앱에 내장. 누구나 사용.
 *   공용(catalog)   : 관리자가 서버에 올린 캐릭터. 누구나 사용. (catalog.js)
 *   개인(custom)    : 내가 만든 캐릭터. 내 config 에만 있고 나만 선택 가능.
 *
 * 셋 다 동일한 번들 포맷(부위 이미지 + 리그 JSON)이라 같은 엔진이 구분 없이 로드한다.
 */

(function (root) {
  const RW = (root.RW = root.RW || {});

  // 번들 → 엔진 mount 입력 { skeleton, rig }
  // proportions 가 있으면 그 비율로 골격을 생성(리깅 도구에서 관절 위치를 맞춘 캐릭터).
  function bundleToRig(bundle) {
    const skeletonId = bundle.skeletonId || 'bipedal5';
    const skeleton = (bundle.proportions && skeletonId === 'bipedal5')
      ? RW.skeleton.buildBipedal5(bundle.proportions)
      : RW.skeleton.getSkeleton(skeletonId);
    // slotsBack 은 뒷모습(트월킹에서 등을 보일 때만 쓰인다). 없으면 앞모습으로 재생된다.
    const rig = { skeletonId, slots: bundle.slots || {}, slotsBack: bundle.slotsBack || null };
    return { skeleton: RW.skeleton.withContentBox(skeleton, rig), rig };
  }

  function customList(config) { return (config && config.customCharacters) || []; }
  function catalogList() { return RW.catalog ? RW.catalog.cached() : []; }

  function find(id, config) {
    const c = customList(config).find((x) => x.id === id);
    if (c) return { id: c.id, name: c.name, custom: true, catalog: false, swatch: c.swatch, bundle: c.bundle };
    const k = catalogList().find((x) => x.id === id);
    if (k) return { id: k.id, name: k.name, custom: false, catalog: true, swatch: k.swatch, bundle: k.bundle };
    const p = RW.presets.get(id);
    return { id: p.id, name: p.name, custom: false, catalog: false, swatch: p.swatch };
  }

  // 선택 UI 용 전체 목록(프리셋 → 공용 → 내 제작)
  function listAll(config) {
    const presets = RW.presets.PRESETS.map((p) => ({ id: p.id, name: p.name, swatch: p.swatch, custom: false, catalog: false }));
    const cats = catalogList().map((c) => ({ id: c.id, name: c.name, swatch: c.swatch, custom: false, catalog: true }));
    const customs = customList(config).map((c) => ({ id: c.id, name: c.name, swatch: c.swatch, custom: true, catalog: false }));
    return presets.concat(cats, customs);
  }

  // id(+config) → { skeleton, rig }
  function rigFor(id, config) {
    const c = customList(config).find((x) => x.id === id);
    if (c && c.bundle) return bundleToRig(c.bundle);
    const k = catalogList().find((x) => x.id === id);
    if (k && k.bundle) return bundleToRig(k.bundle);
    return RW.presets.rigFor(id);
  }

  // 이 id 가 어디 소속인지 — 상대에게 어떻게 전달할지 결정하는 데 쓴다.
  function sourceOf(id, config) {
    if (customList(config).some((x) => x.id === id)) return 'custom';
    if (catalogList().some((x) => x.id === id)) return 'catalog';
    return 'preset';
  }

  RW.characters = { bundleToRig, find, listAll, rigFor, customList, catalogList, sourceOf };
})(typeof window !== 'undefined' ? window : globalThis);
