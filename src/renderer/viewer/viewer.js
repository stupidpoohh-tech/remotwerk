'use strict';
/* 동작 뷰어(디버그).
 *  - 캐릭터(프리셋/커스텀)를 골라 동작을 즉시 재생해 확인한다.
 *  - 능동 신호 + 자율 생활을 버튼으로 제공. 반복 재생 옵션 포함.
 */

(function () {
  const RW = window.RW;
  const host = window.rwHost;

  const anchor = document.getElementById('charAnchor');
  const nowPlaying = document.getElementById('nowPlaying');
  const charSelect = document.getElementById('charSelect');
  const loopChk = document.getElementById('loopChk');

  let cfg = null;
  let ctrl = null;
  let charId = 'preset1';

  async function main() {
    cfg = await host.getConfig();
    charId = cfg.characterId || 'preset1';

    buildCharSelect();
    buildButtons();
    buildChar();

    charSelect.addEventListener('change', () => { charId = charSelect.value; buildChar(); });
    document.getElementById('stopBtn').addEventListener('click', () => { play(null); });

    // 리깅 도구 등에서 캐릭터 목록이 바뀌면 셀렉트 갱신
    host.onConfigChanged((next) => { cfg = next; buildCharSelect(); });
  }

  function buildCharSelect() {
    const prev = charSelect.value;
    charSelect.innerHTML = '';
    for (const c of RW.characters.listAll(cfg)) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name + (c.custom ? ' (내 제작)' : '');
      charSelect.appendChild(opt);
    }
    charSelect.value = RW.characters.listAll(cfg).some((c) => c.id === prev) ? prev : charId;
    charId = charSelect.value;
  }

  function buildChar() {
    if (ctrl) ctrl.stop();
    anchor.innerHTML = '';
    ctrl = RW.engine.mount(anchor, RW.characters.rigFor(charId, cfg));
    clearPlaying();
    nowPlaying.textContent = '현재: —';
  }

  function buildButtons() {
    const active = document.getElementById('activeBtns');
    const ambient = document.getElementById('ambientBtns');
    RW.gestures.ACTIVE.forEach((g) => active.appendChild(makeBtn(g)));
    RW.gestures.AMBIENT.forEach((g) => ambient.appendChild(makeBtn(g)));
  }

  function makeBtn(g) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.dataset.gid = g.id;
    b.innerHTML = `<span class="ic">${g.icon}</span><span>${g.name}</span>`;
    b.addEventListener('click', () => play(g));
    return b;
  }

  let loopTimer = null;

  function play(g) {
    clearPlaying();
    if (!g) { buildChar(); return; }               // 정지 → 뉴트럴 재마운트
    nowPlaying.textContent = `현재: ${g.icon} ${g.name}` + (loopChk.checked ? ' (반복)' : '');
    const btn = document.querySelector(`.btn[data-gid="${g.id}"]`);
    if (btn) btn.classList.add('playing');

    const anim = RW.animations.get(g.id);
    if (anim.loop) {
      ctrl.play(g.id);                             // idle/wander: 엔진이 무한 반복
    } else if (loopChk.checked) {
      const dur = anim.frames.reduce((m, f) => Math.max(m, f.t), 0);
      const cycle = () => { ctrl.play(g.id); loopTimer = setTimeout(cycle, Math.max(300, dur)); };
      cycle();
    } else {
      ctrl.play(g.id, { onDone: () => clearPlaying() });
    }
  }

  function clearPlaying() {
    clearTimeout(loopTimer);
    document.querySelectorAll('.btn.playing').forEach((b) => b.classList.remove('playing'));
  }

  main();
})();
