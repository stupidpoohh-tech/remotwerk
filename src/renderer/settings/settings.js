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
  let myChar = 'char_seal';
  let partnerChar = 'char_ribbon';

  async function main() {
    cfg = await host.getConfig();
    myChar = cfg.characterId || 'char_seal';
    partnerChar = cfg.partnerCharacterId || 'char_ribbon';

    $('firebase').value = cfg.firebase ? JSON.stringify(cfg.firebase, null, 2) : '';

    rebuildGrids();
    refreshPairStatus();

    $('createInvite').addEventListener('click', onCreateInvite);
    $('joinBtn').addEventListener('click', onJoin);
    $('copyCode').addEventListener('click', onCopyCode);
    $('save').addEventListener('click', save);

    initSizeSection();
    initAppSection();
    initConnStatus();
    $('previewPlay').addEventListener('click', playPreviewSequence);

    // 공용 카탈로그는 네트워크에서 받아오므로, 캐시로 먼저 그리고 도착하면 다시 그린다.
    if (cfg.firebase && RW.catalog) {
      RW.catalog.load(cfg)
        .then(() => rebuildGrids())
        .catch((e) => console.warn('[settings] 카탈로그 로드 실패', e));
    }

    // 리깅 도구에서 새 캐릭터를 저장하면 config 가 갱신 → 그리드 다시 그림
    host.onConfigChanged((next) => {
      cfg = next;
      rebuildGrids();
      refreshPairStatus();
    });
  }

  // ---- 캐릭터 크기 ----
  function initSizeSection() {
    const slider = $('charSize');
    const out = $('charSizeVal');
    const cur = Math.round((Number(cfg.overlayScale) || 1) * 100);
    slider.value = Math.max(50, Math.min(200, cur));
    out.textContent = slider.value + '%';

    // 끄는 동안엔 숫자만 갱신하고, 놓을 때 저장한다(설정 저장 폭주 방지).
    slider.addEventListener('input', () => {
      out.textContent = slider.value + '%';
      cfg.overlayScale = Number(slider.value) / 100;
      renderPreview2();                       // 미리보기도 같이 커지고 작아진다
    });
    slider.addEventListener('change', async () => {
      await host.setConfig({ overlayScale: Number(slider.value) / 100 });
      cfg = await host.getConfig();
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

    // 익명 로그인 uid — 콘솔에서 관리자로 등록할 때 필요하다.
    const uidEl = $('myUid');
    if (!cfg.firebase) {
      uidEl.textContent = '(Firebase 설정 없음)';
    } else {
      RW.fb.init(cfg.firebase)
        .then((fb) => { uidEl.textContent = fb.uid; })
        .catch((e) => { uidEl.textContent = '로그인 실패 — ' + (e.message || e); });
    }
    $('copyUid').addEventListener('click', async () => {
      const v = uidEl.textContent;
      if (!v || v.startsWith('(') || v.startsWith('확인')) return;
      try { await navigator.clipboard.writeText(v); $('status').textContent = '사용자 ID를 복사했어요.'; }
      catch (_) { $('status').textContent = '복사 실패 — ID를 직접 선택해 복사해 주세요.'; }
    });
  }

  // ---- 서버 연결 상태 ----
  // RTDB 쓰기는 연결이 없으면 오류 없이 영영 대기한다. 그래서 "지금 연결돼 있는지"를
  // 눈에 보이게 띄워 둔다(초대 코드가 안 만들어질 때 원인을 바로 알 수 있게).
  function initConnStatus() {
    const el = $('connStatus');
    if (!el) return;
    if (!cfg.firebase) {
      el.textContent = 'Firebase 설정이 없어 서버에 연결하지 않습니다.';
      el.className = 'conn-status bad';
      return;
    }
    RW.fb.init(cfg.firebase).catch(() => {});
    RW.fb.onConnected((connected) => {
      el.textContent = connected
        ? '서버 연결됨'
        : '서버에 연결되지 않았어요 — 네트워크(방화벽·VPN·회사망)를 확인해 주세요.';
      el.className = 'conn-status ' + (connected ? 'ok' : 'bad');
    });
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

  // 내가 만든 캐릭터 삭제. 선택 중이었다면 기본 프리셋으로 되돌린다.
  async function deleteCharacter(c) {
    if (!window.confirm(`"${c.name}" 캐릭터를 삭제할까요? 되돌릴 수 없어요.`)) return;
    const next = (cfg.customCharacters || []).filter((x) => x.id !== c.id);
    const patch = { customCharacters: next };
    if (cfg.characterId === c.id) { patch.characterId = 'char_seal'; myChar = 'char_seal'; }
    if (cfg.partnerCharacterId === c.id) { patch.partnerCharacterId = 'char_ribbon'; partnerChar = 'char_ribbon'; }
    await host.setConfig(patch);
    cfg = await host.getConfig();
    rebuildGrids();
    $('status').textContent = `"${c.name}" 을(를) 삭제했어요.`;
  }

  function rebuildGrids() {
    buildGrid('myGrid', () => myChar, (id) => { myChar = id; renderPreview2(); });
    buildGrid('partnerGrid', () => partnerChar, (id) => { partnerChar = id; });
    renderPreview2();
  }

  // ---- 내 캐릭터가 상대 화면에서 어떻게 보일지 ----
  // 실제 오버레이와 같은 배율·같은 엔진으로 그리고, 자율 동작(멍때리기)을 재생한다.
  let previewCtrl = null;
  function renderPreview2() {
    const anchor = $('previewAnchor');
    if (!anchor) return;
    if (previewCtrl && previewCtrl.destroy) previewCtrl.destroy();
    anchor.innerHTML = '';
    const scale = Math.max(0.4, Math.min(2.5, Number(cfg.overlayScale) || 1));
    const spec = RW.characters.rigFor(myChar, cfg);
    previewCtrl = RW.player.create(anchor, myChar, spec);
    // 실제 오버레이와 같은 배율로 두되, 발은 바닥선(240px)에 맞춘다.
    RW.engine.fitAnchor(anchor, { box: previewCtrl.box }, { feetY: 240, scale });
    previewCtrl.play('idle');
    $('previewNow').textContent = '멍때리는 중… (상대 화면에서도 이 크기로 보입니다)';
  }

  // 능동 신호를 차례로 재생해 실제로 어떻게 움직이는지 보여준다.
  function playPreviewSequence() {
    if (!previewCtrl) return;
    const list = RW.gestures.ACTIVE.map((g) => g.id);
    let i = 0;
    const step = () => {
      if (i >= list.length) {
        $('previewNow').textContent = '테스트 끝 — 다시 멍때리는 중…';
        previewCtrl.play('idle');
        return;
      }
      const g = RW.gestures.get(list[i]);
      $('previewNow').textContent = `${g.icon} ${g.name}`;
      previewCtrl.play(list[i], { onDone: () => { i++; step(); } });
    };
    step();
  }

  // 캐릭터 타일 그리드(프리셋 + 커스텀) + (+) 업로드 타일
  function buildGrid(containerId, getSel, setSel) {
    const el = $(containerId);
    el.innerHTML = '';
    const tiles = {};

    for (const c of RW.characters.listAll(cfg)) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      const badge = c.custom
        ? '<span class="custom-badge">내 제작</span>'
        : (c.catalog ? '<span class="custom-badge catalog">공용</span>' : '');
      // 내가 만든 캐릭터만 편집·삭제할 수 있다(공용/프리셋은 불가).
      const tools = c.custom
        ? '<div class="tile-tools"><button class="tt edit" title="편집">✎</button>' +
          '<button class="tt del" title="삭제">🗑</button></div>'
        : '';
      tile.innerHTML = `<div class="preview"></div>${badge}${tools}<div class="cap">${c.name}</div>`;
      renderPreview(tile.querySelector('.preview'), c.id);

      if (c.custom) {
        tile.querySelector('.edit').addEventListener('click', (e) => {
          e.stopPropagation();
          host.openRigger(c.id);
        });
        tile.querySelector('.del').addEventListener('click', (e) => {
          e.stopPropagation();
          deleteCharacter(c);
        });
      }

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
  // 타일은 120px 높이이고 위 26px 은 이름표라, 캐릭터는 그 아래에 들어와야 한다.
  function renderPreview(container, charId) {
    const anchor = document.createElement('div');
    anchor.style.position = 'absolute';
    anchor.style.left = '50%';
    container.appendChild(anchor);
    const spec = RW.characters.rigFor(charId, cfg);
    const p = RW.player.create(anchor, charId, spec);
    RW.engine.fitAnchor(anchor, { box: p.box }, { feetY: 114, height: 86, maxScale: 0.6 });
    p.play('idle', {});
  }

  async function save() {
    const status = $('status');
    let firebase;
    const raw = $('firebase').value.trim();
    if (raw) {
      try { firebase = JSON.parse(raw); }
      catch (_) { status.textContent = 'Firebase 설정 JSON 형식이 올바르지 않아요.'; return; }
    }
    // 칸이 비어 있으면 firebase 를 건드리지 않는다.
    // 예전엔 여기서 null 을 저장해 내장 기본 설정을 지워버렸고, 그 뒤로는 초대 코드가
    // "Firebase 설정이 필요해요" 로 막혔다.

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
