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

    rebuildGrids();

    $('genCode').addEventListener('click', () => {
      $('pairCode').value = genCode();
    });
    $('save').addEventListener('click', save);

    // 리깅 도구에서 새 캐릭터를 저장하면 config 가 갱신 → 그리드 다시 그림
    host.onConfigChanged((next) => {
      cfg = next;
      rebuildGrids();
    });
  }

  function rebuildGrids() {
    buildGrid('myGrid', () => myChar, (id) => { myChar = id; });
    buildGrid('partnerGrid', () => partnerChar, (id) => { partnerChar = id; });
  }

  function genCode() {
    const words = ['LOVE', 'HONEY', 'MOON', 'STAR', 'BEAR', 'CATS', 'DUCK', 'PEAR'];
    const w = words[Math.floor(Math.random() * words.length)];
    return `${w}-${Math.floor(1000 + Math.random() * 9000)}`;
  }

  // 캐릭터 타일 그리드(프리셋 + 커스텀) + (+) 업로드 타일
  function buildGrid(containerId, getSel, setSel) {
    const el = $(containerId);
    el.innerHTML = '';
    const tiles = {};

    for (const c of RW.characters.listAll(cfg)) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      const badge = c.custom ? '<span class="custom-badge">내 제작</span>' : '';
      tile.innerHTML = `<div class="preview"></div>${badge}<div class="cap">${c.name}</div>`;
      renderPreview(tile.querySelector('.preview'), c.id);
      tile.addEventListener('click', () => {
        setSel(c.id);
        for (const k of Object.keys(tiles)) tiles[k].classList.toggle('selected', k === c.id);
      });
      tiles[c.id] = tile;
      el.appendChild(tile);
    }
    tiles[getSel()] && tiles[getSel()].classList.add('selected');

    // (+) 캐릭터 만들기(리깅·업로드 도구 열기)
    const add = document.createElement('div');
    add.className = 'tile add';
    add.title = '내 캐릭터 만들기 (이미지 업로드 · 大자 정합)';
    add.innerHTML = `+<div class="cap">캐릭터 만들기</div>`;
    add.addEventListener('click', () => host.openRigger());
    el.appendChild(add);
  }

  // 미니 프리뷰 — 뉴트럴 포즈로 캐릭터를 그린다(축소). 프리셋/커스텀 공통.
  function renderPreview(container, charId) {
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
    const { skeleton, rig } = RW.characters.rigFor(charId, cfg);
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

    // Firebase 모드면 방 멤버십에 내 캐릭터 등록(커스텀이면 Storage 로 번들 공유)
    if (firebase && patch.pairCode) {
      try {
        const merged = Object.assign({}, cfg, patch);
        const custom = (merged.customCharacters || []).find((c) => c.id === myChar);
        const t = RW.transport.createTransport(merged);
        await t.ready;
        await t.setMyCharacter(myChar, custom ? custom.bundle : null);
        t.destroy();
        status.textContent = custom
          ? '저장됨 · 커스텀 캐릭터를 상대와 공유했습니다.'
          : '저장됨 · 방에 연결되었습니다.';
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
