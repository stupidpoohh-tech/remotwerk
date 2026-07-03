'use strict';
/* 히스토리 로직.
 *  - 받은 신호만(상대가 보낸 것), 당일(KST) 범위로 표시한다.
 *  - 서버(Firebase)에 저장되므로 내 PC 가 꺼져 있던 사이 받은 신호도 다음에 볼 수 있다.
 *  - 각 항목: 시각 + 동작 이름 + 작은 아이콘.
 */

(function () {
  const RW = window.RW;
  const host = window.rwHost;

  const listEl = document.getElementById('list');
  const emptyEl = document.getElementById('empty');
  const seen = new Set();

  const timeFmt = new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul'
  });

  let transport = null;

  async function main() {
    const cfg = await host.getConfig();
    transport = RW.transport.createTransport(cfg);
    await transport.ready.catch((e) => console.error('[history] transport', e));

    const items = await transport.loadTodayHistory().catch(() => []);
    for (const it of items) addItem(it, false);
    refreshEmpty();

    // 실행 중 새로 들어오는 신호도 즉시 반영(받은 것만)
    transport.onSignal((sig) => {
      if (sig.mine) return;
      addItem({ id: sig.id, gestureId: sig.gestureId, ts: sig.ts }, true);
      refreshEmpty();
    });
  }

  function addItem(it, prepend) {
    if (it.id && seen.has(it.id)) return;
    if (it.id) seen.add(it.id);

    const g = RW.gestures.get(it.gestureId);
    const li = document.createElement('li');
    li.className = 'item';
    li.innerHTML =
      `<span class="time">${timeFmt.format(new Date(it.ts))}</span>` +
      `<span class="icon">${g.icon}</span>` +
      `<span class="name"></span>`;
    li.querySelector('.name').textContent = g.name;

    if (prepend) listEl.insertBefore(li, listEl.firstChild);
    else listEl.appendChild(li);
  }

  function refreshEmpty() {
    emptyEl.hidden = listEl.children.length > 0;
  }

  main();
})();
