'use strict';
/* 설정/페어링 로직.
 *  - 페어링 코드 생성/입력, 내 캐릭터 선택, (상대 캐릭터: 데모용), Firebase 설정.
 *  - 저장 시 config 에 기록하고, Firebase 모드면 방 멤버십에 내 캐릭터를 등록한다.
 *  - (+) 타일은 자리만 잡아 두고 비활성(업로드는 Prompt B).
 */

(function () {
  const RW = window.RW;
  const host = window.rwHost;

  const $ = (id) => document.getElementById(id);
  let cfg = null;
  let myChar = 'preset1';
  let partnerChar = 'preset2';

  async function main() {
    cfg = await host.getConfig();
    myChar = cfg.characterId || 'preset1';
    partnerChar = cfg.partnerCharacterId || 'preset2';

    $('pairCode').value = cfg.pairCode || '';
    $('firebase').value = cfg.firebase ? JSON.stringify(cfg.firebase, null, 2) : '';

    buildGrid('myGrid', () => myChar, (id) => { myChar = id; }, true);
    buildGrid('partnerGrid', () => partnerChar, (id) => { partnerChar = id; }, false);

    $('genCode').addEventListener('click', () => {
      $('pairCode').value = genCode();
    });
    $('save').addEventListener('click', save);
  }

  function genCode() {
    const words = ['LOVE', 'HONEY', 'MOON', 'STAR', 'BEAR', 'CATS', 'DUCK', 'PEAR'];
    const w = words[Math.floor(Math.random() * words.length)];
    return `${w}-${Math.floor(1000 + Math.random() * 9000)}`;
  }

  // 캐릭터 타일 그리드 + (+) 비활성 타일
  function buildGrid(containerId, getSel, setSel, allowAddPlaceholder) {
    const el = $(containerId);
    el.innerHTML = '';
    const tiles = {};

    for (const p of RW.presets.PRESETS) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.innerHTML = `<div class="preview"></div><div class="cap">${p.name}</div>`;
      renderPreview(tile.querySelector('.preview'), p.id);
      tile.addEventListener('click', () => {
        setSel(p.id);
        for (const k of Object.keys(tiles)) tiles[k].classList.toggle('selected', k === p.id);
      });
      tiles[p.id] = tile;
      el.appendChild(tile);
    }
    tiles[getSel()] && tiles[getSel()].classList.add('selected');

    // (+) 자리만 잡아 두고 비활성
    const add = document.createElement('div');
    add.className = 'tile add';
    add.title = '캐릭터 업로드(추후 지원)';
    add.innerHTML = `+<div class="cap">업로드(준비중)</div>`;
    el.appendChild(add);
  }

  // 미니 프리뷰 — 뉴트럴 포즈로 캐릭터를 그린다(축소).
  function renderPreview(container, presetId) {
    const wrap = document.createElement('div');
    wrap.style.position = 'absolute';
    wrap.style.left = '50%';
    wrap.style.top = '8px';
    wrap.style.transform = 'scale(0.42)';
    wrap.style.transformOrigin = 'top center';
    const anchor = document.createElement('div');
    anchor.style.position = 'absolute';
    anchor.style.left = '0';
    anchor.style.top = '120px';
    wrap.appendChild(anchor);
    container.appendChild(wrap);
    const { skeleton, rig } = RW.presets.rigFor(presetId);
    RW.engine.mount(anchor, { skeleton, rig });
  }

  async function save() {
    const status = $('status');
    let firebase = null;
    const raw = $('firebase').value.trim();
    if (raw) {
      try { firebase = JSON.parse(raw); }
      catch (_) { status.textContent = 'Firebase 설정 JSON 형식이 올바르지 않아요.'; return; }
    }

    const patch = {
      pairCode: $('pairCode').value.trim() || null,
      characterId: myChar,
      partnerCharacterId: partnerChar,
      firebase
    };

    status.textContent = '저장 중…';
    await host.setConfig(patch);

    // Firebase 모드면 방 멤버십에 내 캐릭터 등록
    if (firebase && patch.pairCode) {
      try {
        const t = RW.transport.createTransport(Object.assign({}, cfg, patch));
        await t.ready;
        await t.setMyCharacter(myChar);
        t.destroy();
        status.textContent = '저장됨 · 방에 연결되었습니다.';
      } catch (e) {
        console.error(e);
        status.textContent = '저장됨 · Firebase 연결 확인이 필요해요.';
      }
    } else {
      status.textContent = '저장됨 · 로컬 데모 모드로 실행됩니다.';
    }
  }

  main();
})();
