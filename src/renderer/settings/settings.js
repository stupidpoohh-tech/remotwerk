'use strict';
/* 설정/페어링 로직.
 *  - 페어링: 1회용 초대 코드 발급/참여(익명 인증 + 방 멤버십 기반). 코드는 접근 열쇠가 아니라
 *    방에 들어오기 위한 초대장일 뿐이며, 연결 후에는 uid 멤버십으로만 권한이 판단된다.
 *  - 내 캐릭터 선택, (상대 캐릭터: 로컬 데모용), Firebase 설정.
 *  - (+) 타일 → 리깅 도구.
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

    $('firebase').value = cfg.firebase ? JSON.stringify(cfg.firebase, null, 2) : '';

    rebuildGrids();
    refreshPairStatus();

    $('createInvite').addEventListener('click', onCreateInvite);
    $('joinBtn').addEventListener('click', onJoin);
    $('copyCode').addEventListener('click', onCopyCode);
    $('save').addEventListener('click', save);

    initAppSection();

    // 리깅 도구에서 새 캐릭터를 저장하면 config 가 갱신 → 그리드 다시 그림
    host.onConfigChanged((next) => {
      cfg = next;
      rebuildGrids();
      refreshPairStatus();
    });
  }

  // ---- 앱(버전 · 자동 시작 · 로그) ----
  async function initAppSection() {
    let info = null;
    try { info = await host.getAppInfo(); } catch (_) { /* 구버전 preload */ }
    if (!info) { $('appVersion').textContent = '버전 정보를 읽을 수 없어요.'; return; }

    $('appVersion').textContent =
      `Remotwerk v${info.version}` + (info.packaged ? '' : ' (개발 실행)');
    $('autoLaunch').checked = !!info.autoLaunch;

    $('autoLaunch').addEventListener('change', async (e) => {
      const applied = await host.setAutoLaunch(e.target.checked);
      e.target.checked = !!applied;   // OS 가 거부하면 되돌린다
    });
    $('openLogs').addEventListener('click', (e) => { e.preventDefault(); host.openLogs(); });
  }

  // ---- 페어링 ----
  function setPairMsg(msg) { $('pairMsg').textContent = msg || ''; }

  function refreshPairStatus() {
    const el = $('pairStatus');
    if (cfg.roomId) {
      el.textContent = '✅ 페어링 완료 — 상대와 연결되어 있어요.';
      el.className = 'pair-status ok';
    } else {
      el.textContent = '⚠️ 아직 페어링되지 않았어요. 코드를 만들거나, 받은 코드로 참여하세요.';
      el.className = 'pair-status warn';
    }
  }

  async function onCreateInvite() {
    if (!cfg.firebase) return setPairMsg('Firebase 설정이 필요해요.');
    setPairMsg('방을 만드는 중…');
    try {
      const { code, expiresAt, roomId } = await RW.pairing.createRoomAndInvite(cfg);
      await host.setConfig({ roomId, pairCode: code });
      cfg = await host.getConfig();
      $('inviteCode').textContent = code;
      $('inviteBox').hidden = false;
      $('inviteExpiry').textContent =
        '1회용 코드예요. ' + new Date(expiresAt).toLocaleString('ko-KR') + ' 까지 유효합니다.';
      setPairMsg('이 코드를 상대에게 전달하세요. 상대가 참여하면 자동으로 연결됩니다.');
      refreshPairStatus();
    } catch (e) {
      setPairMsg('실패: ' + (e && e.message ? e.message : e));
    }
  }

  async function onJoin() {
    if (!cfg.firebase) return setPairMsg('Firebase 설정이 필요해요.');
    const raw = $('joinCode').value;
    if (!RW.pairing.isValidCode(raw)) {
      return setPairMsg(`코드는 ${RW.pairing.CODE_LEN}자리예요. 다시 확인해 주세요.`);
    }
    setPairMsg('참여하는 중…');
    try {
      const { roomId } = await RW.pairing.joinWithCode(cfg, raw);
      await host.setConfig({ roomId, pairCode: RW.pairing.normalize(raw) });
      cfg = await host.getConfig();
      $('inviteBox').hidden = true;
      setPairMsg('연결됐어요! 리모컨(Ctrl+Shift+R)으로 신호를 보내보세요.');
      refreshPairStatus();
    } catch (e) {
      setPairMsg('실패: ' + (e && e.message ? e.message : e));
    }
  }

  async function onCopyCode() {
    const code = $('inviteCode').textContent;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setPairMsg('코드를 복사했어요.');
    } catch (_) {
      setPairMsg('복사에 실패했어요. 코드를 직접 선택해 복사해 주세요.');
    }
  }

  function rebuildGrids() {
    buildGrid('myGrid', () => myChar, (id) => { myChar = id; });
    buildGrid('partnerGrid', () => partnerChar, (id) => { partnerChar = id; });
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

    // 페어링(roomId)은 위 초대/참여 흐름에서만 설정된다. 여기서는 건드리지 않는다.
    const patch = {
      characterId: myChar,
      partnerCharacterId: partnerChar,
      firebase
    };

    status.textContent = '저장 중…';
    await host.setConfig(patch);

    // 페어링된 상태면 방 멤버십에 내 캐릭터 등록(커스텀이면 Storage 로 번들 공유)
    if (firebase && cfg.roomId) {
      try {
        const merged = Object.assign({}, cfg, patch);
        const custom = (merged.customCharacters || []).find((c) => c.id === myChar);
        const t = RW.transport.createTransport(merged);
        await t.ready;
        await t.setMyCharacter(myChar, custom ? custom.bundle : null);
        t.destroy();
        status.textContent = custom
          ? '저장됨 · 커스텀 캐릭터를 상대와 공유했습니다.'
          : '저장됨 · 방에 반영되었습니다.';
      } catch (e) {
        console.error(e);
        status.textContent = '저장됨 · Firebase 연결 확인이 필요해요.';
      }
    } else if (!cfg.roomId) {
      status.textContent = '저장됨 · 아직 페어링 전이라 로컬 데모로 동작합니다.';
    } else {
      status.textContent = '저장됨 · 로컬 데모 모드로 실행됩니다.';
    }
  }

  main();
})();
