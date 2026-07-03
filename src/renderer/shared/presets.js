'use strict';
/* 프리셋 캐릭터 로더.
 *
 * 프리셋 = 부위별 아트(이미지) + 리그 설정. 이번 빌드에서는 아트 대신 색/도형
 * 플레이스홀더로 끝에서 끝까지 동작을 검증한다. 최종 아트는 각 슬롯의 image 필드에
 * 그림을 넣어 교체한다(assets/presets/<id>/rig.json 포맷 참고).
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

  const PRESETS = [
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
  ];

  const byId = {};
  for (const p of PRESETS) byId[p.id] = p;

  function get(id) {
    return byId[id] || PRESETS[0];
  }

  // 엔진 mount 에 넘길 { skeleton, rig } 구성
  function rigFor(id) {
    const preset = get(id);
    return {
      skeleton: RW.skeleton.getSkeleton(preset.skeletonId),
      rig: { skeletonId: preset.skeletonId, slots: preset.slots }
    };
  }

  RW.presets = { PRESETS, get, rigFor };
})(typeof window !== 'undefined' ? window : globalThis);
