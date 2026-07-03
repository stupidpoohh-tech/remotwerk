'use strict';
/* 리모컨 로직.
 *  - 능동 동작 8개를 원형으로 배치. 버튼을 누르면 신호를 발사하고 "전달됨" 토스트만 띄운다.
 *  - 읽음/확인 표시는 만들지 않는다(무압박 원칙).
 */

(function () {
  const RW = window.RW;
  const host = window.rwHost;

  const radial = document.getElementById('radial');
  const toast = document.getElementById('toast');

  let transport = null;
  let toastTimer = null;

  const CENTER = 150;   // 라디얼 중심
  const RADIUS = 100;   // 버튼 배치 반경

  async function main() {
    const cfg = await host.getConfig();
    transport = RW.transport.createTransport(cfg);
    transport.ready.catch((e) => console.error('[remote] transport', e));

    layoutButtons();

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') host.closeSelf();
    });
  }

  function layoutButtons() {
    const list = RW.gestures.ACTIVE;
    list.forEach((g, i) => {
      const angle = (-90 + i * (360 / list.length)) * (Math.PI / 180); // 12시부터 시계방향
      const x = CENTER + RADIUS * Math.cos(angle);
      const y = CENTER + RADIUS * Math.sin(angle);

      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.style.left = x + 'px';
      btn.style.top = y + 'px';
      btn.textContent = g.icon;
      btn.title = g.name;              // 학습용 툴팁(라벨은 표시하지 않음)
      btn.setAttribute('aria-label', g.name);
      btn.addEventListener('click', () => fire(g));
      radial.appendChild(btn);
    });
  }

  async function fire(g) {
    try {
      await transport.send(g.gestureId);
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
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1100);
  }

  main();
})();
