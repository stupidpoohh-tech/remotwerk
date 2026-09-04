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
    { id: 'char_seal',    name: '물개',   swatch: '#9aa0a6' },
    { id: 'char_dada',    name: '다다',   swatch: '#2f3fa8' },
    { id: 'char_hamster', name: '햄스터', swatch: '#e8b878' },
    { id: 'char_wolf',    name: '늑대',   swatch: '#b08a63' },
    { id: 'char_rabbit',  name: '토끼',   swatch: '#f6dcd8' }
  ].filter((p) => ART[p.id]).map((p) => Object.assign({}, p, { bundle: ART[p.id] }));

  const PRESETS = ART_PRESETS.slice();

  const byId = {};
  for (const p of PRESETS) byId[p.id] = p;

  // 목록에서 빠진 캐릭터. **예전에 이걸 고른 설정이 깨지지 않게** 남아 있는
  // 캐릭터로 대신 보여 준다. (get() 이 빈 값을 돌려주면 오버레이가 아무것도 못 그린다.)
  //   preset1~3 : 아트가 없던 시절의 색 도형 프리셋
  //   char_ribbon(리본)·char_racoon(너구리) : 사용자가 뺀 캐릭터.
  //     그림 데이터도 preset-art.js 에서 빠졌으므로 여기 대체가 **반드시 필요하다.**
  //     리본은 오랫동안 기본 상대 캐릭터였어서, 이 줄이 없으면 예전 사용자 화면이 빈다.
  const RETIRED = {
    preset1: 'char_seal', preset2: 'char_seal', preset3: 'char_seal',
    char_ribbon: 'char_dada', char_racoon: 'char_wolf'
  };

  function get(id) {
    if (byId[id]) return byId[id];
    const alt = RETIRED[id];
    if (alt && byId[alt]) return byId[alt];
    return PRESETS[0];
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
