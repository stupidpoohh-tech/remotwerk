'use strict';
/* 스프라이트 클립 — 동작별로 **서로 다른 연기 자세**를 담은 그림 묶음.
 *
 * 리그(5조각)는 한 자세를 회전·압축해 흔드는 방식이라, 아무리 잘 해도
 * "같은 그림이 움직이는" 인상을 벗어나기 어렵다. 클립은 자세마다 다른 그림을
 * 순서대로 보여준다. 대신 그림을 그려야 한다 → docs/animation-bible.md.
 *
 * 데이터는 clip-art.js 가 채운다(art/clips/** → tools/build-clip-art.js 로 생성).
 * 클립이 없는 캐릭터·동작은 리그로 자동 폴백된다(player.js).
 *
 * 클립 규격(요약, 자세한 건 Animation Bible 8절):
 *   { id, character, canvas:{w,h}, anchor:{x,y}, displayHeight,
 *     loop, loopFrom, cancelFrom, stepAdvance,
 *     frames: [{ image, dur, ground:['L','R'] }], placeholder }
 */

(function (root) {
  const RW = (root.RW = root.RW || {});

  function registry() { return (root.RW && root.RW.clipArt) || {}; }

  // 캐릭터가 가진 클립 목록
  function forCharacter(charId) { return registry()[charId] || null; }

  function get(charId, clipId) {
    const c = forCharacter(charId);
    return (c && c.clips && c.clips[clipId]) || null;
  }

  function has(charId, clipId) { return !!get(charId, clipId); }

  // 동작 id → 클립 구성. 트월킹처럼 여러 클립을 이어 붙이는 경우가 있다.
  //   { parts: [{ clip, repeat }], loop }
  // 클립이 하나라도 없으면 null 을 돌려주고, 호출한 쪽이 리그로 폴백한다.
  function planFor(charId, gestureId) {
    const map = {
      idle:    [{ clip: 'idle', repeat: 1 }],
      wander:  [{ clip: 'walk', repeat: 1 }],
      g_heart: [{ clip: 'g_heart', repeat: 1 }],
      g_cheer: [{ clip: 'g_cheer', repeat: 1 }],
      g_droop: [{ clip: 'g_droop', repeat: 1 }],
      // 🍑 트월킹 = 뒤돌기 → 흔들기 3회 → 정면 복귀.
      // 중간 방향(3/4) 프레임이 있어야 뒤돌기가 순간이동으로 안 보인다.
      g_twerk: [
        { clip: 'turn_back', repeat: 1 },
        { clip: 'twerk_loop', repeat: 3 },
        { clip: 'turn_front', repeat: 1 }
      ]
    };
    const parts = map[gestureId];
    if (!parts) return null;
    for (const p of parts) if (!has(charId, p.clip)) return null;
    return { gestureId, parts, loop: gestureId === 'idle' || gestureId === 'wander' };
  }

  // 총 길이(ms). 루프 클립은 한 바퀴 길이.
  function duration(clip) {
    let d = 0;
    for (const f of clip.frames) d += f.dur;
    return d;
  }

  // 임시(placeholder) 에셋이 섞여 있는지 — 검사 도구와 개발 로그에서 쓴다.
  function placeholders(charId) {
    const c = forCharacter(charId);
    if (!c) return [];
    return Object.keys(c.clips || {}).filter((k) => c.clips[k].placeholder);
  }

  RW.clips = { forCharacter, get, has, planFor, duration, placeholders };
})(typeof window !== 'undefined' ? window : globalThis);
