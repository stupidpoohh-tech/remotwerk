'use strict';
/* 리모컨 로직.
 *  - 내 캐릭터를 미리보기로 띄운다. 버튼을 누르면 신호를 보내고, 그 동작을 여기서
 *    바로 연기해 준다 → "내가 뭘 보냈는지"가 눈에 보인다.
 *  - 읽음/확인 표시는 만들지 않는다(무압박 원칙). 보여주는 건 내 쪽 피드백뿐이다.
 */

(function () {
  const RW = window.RW;
  const host = window.rwHost;

  const anchor = document.getElementById('charAnchor');
  const caption = document.getElementById('caption');
  const toast = document.getElementById('toast');

  let cfg = null;
  let transport = null;
  let ctrl = null;
  let toastTimer = null;
  let idleTimer = null;

  async function main() {
    cfg = await host.getConfig();
    transport = RW.transport.createTransport(cfg);
    transport.ready.catch((e) => console.error('[remote] transport', e));

    buildButtons();
    buildCharacter();

    // 공용 카탈로그 캐릭터를 쓰는 경우, 도착하면 다시 그린다.
    if (cfg.firebase && RW.catalog && !RW.catalog.isLoaded()) {
      RW.catalog.load(cfg).then(() => buildCharacter()).catch(() => {});
    }

    host.onConfigChanged((next) => {
      const changed = next.characterId !== cfg.characterId;
      cfg = next;
      if (changed) buildCharacter();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') host.closeSelf();
      // 숫자 키로도 보낼 수 있게 (버튼 개수만큼)
      const idx = Number(e.key) - 1;
      if (Number.isInteger(idx) && idx >= 0 && RW.gestures.ACTIVE[idx]) fire(RW.gestures.ACTIVE[idx]);
    });
  }

  // 미리보기 무대(132px) 안에서 발이 놓일 바닥선과 최대 배율.
  const FEET_Y = 104;
  const AVAIL_H = 98;      // 머리 위 6px 여백
  const MAX_SCALE = 0.62;  // 작은 캐릭터를 과하게 키우지 않는다

  // 내 캐릭터(상대 화면에 뜨는 그 캐릭터)를 그린다.
  function buildCharacter() {
    if (ctrl && ctrl.destroy) ctrl.destroy();
    anchor.innerHTML = '';
    const id = cfg.characterId || 'char_seal';
    const spec = RW.characters.rigFor(id, cfg);
    // 스프라이트 클립이 있으면 클립으로, 없으면 리그로 자동 폴백.
    ctrl = RW.player.create(anchor, id, spec);
    RW.engine.fitAnchor(anchor, { box: ctrl.box }, { feetY: FEET_Y, height: AVAIL_H, maxScale: MAX_SCALE });
    backToIdle();
  }

  function backToIdle() {
    clearTimeout(idleTimer);
    if (ctrl) ctrl.play('idle');
  }

  function buildButtons() {
    const box = document.getElementById('buttons');
    box.innerHTML = '';
    RW.gestures.ACTIVE.forEach((g, i) => {
      const b = document.createElement('button');
      b.className = 'btn';
      b.dataset.gid = g.id;
      b.title = `${g.name} — ${g.hint} (단축키 ${i + 1})`;
      b.innerHTML = `<span class="ic">${g.icon}</span><span class="nm">${g.name}</span>`;
      b.addEventListener('click', () => fire(g));
      box.appendChild(b);
    });
  }

  async function fire(g) {
    // 미리보기에서 즉시 연기 — 전송 성공을 기다리지 않고 바로 반응한다.
    caption.textContent = `${g.icon} ${g.name} 보냄`;
    document.querySelectorAll('.btn').forEach((b) => b.classList.toggle('sent', b.dataset.gid === g.id));
    if (ctrl) {
      ctrl.play(g.id, {
        onDone: () => {
          backToIdle();
          caption.textContent = '보낼 신호를 고르세요';
          document.querySelectorAll('.btn.sent').forEach((b) => b.classList.remove('sent'));
        }
      });
    }

    try {
      await transport.send(g.id);
      showToast('전달됨');
    } catch (e) {
      console.error('[remote] send 실패', e);
      showToast('전송 실패');
    }
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1200);
  }

  main();
})();
