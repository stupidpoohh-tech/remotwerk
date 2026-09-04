'use strict';

// Remotwerk 메인 프로세스.
// 창 관리(오버레이·리모컨·히스토리·설정), 전역 단축키, 트레이를 담당한다.
// 투명·항상 위·클릭 통과는 OS별로 세부가 다르므로 각 플랫폼에서 확인이 필요하다.

const path = require('path');
const fs = require('fs');
const {
  app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen, nativeImage, shell
} = require('electron');

const config = require('./config');
const features = require('../features');

const isDev = process.argv.includes('--dev');
const PRELOAD = path.join(__dirname, 'preload.js');
const RENDERER = path.join(__dirname, '..', 'renderer');

/** @type {Object<string, BrowserWindow>} */
const win = {};
let tray = null;

// ---------------------------------------------------------------------------
// 에러 로깅 — 배포본에서 사용자 문의를 받았을 때 원인을 볼 수 있어야 한다.
// ---------------------------------------------------------------------------

function logDir() { return path.join(app.getPath('userData'), 'logs'); }
function logFile() { return path.join(logDir(), 'main.log'); }

// 오류가 아닌 사실도 남긴다. "캐릭터가 안 보인다" 같은 신고는 추측으로는 못 좁힌다 —
// 오버레이가 어디에 몇 픽셀로 떠 있는지, 어떤 캐릭터를 그리는지가 기록에 있어야 한다.
function logInfo(tag, data) {
  const line = `[${new Date().toISOString()}] ${tag}: ${typeof data === 'string' ? data : JSON.stringify(data)}\n`;
  console.log(line.trim());
  try {
    fs.mkdirSync(logDir(), { recursive: true });
    try {
      if (fs.statSync(logFile()).size > 1024 * 1024) fs.writeFileSync(logFile(), '');
    } catch (_) { /* 파일 없음 */ }
    fs.appendFileSync(logFile(), line);
  } catch (_) { /* 로깅 실패는 무시 */ }
}

function logError(tag, err) {
  const line = `[${new Date().toISOString()}] ${tag}: ${(err && err.stack) || err}\n`;
  console.error(line.trim());
  try {
    fs.mkdirSync(logDir(), { recursive: true });
    // 로그가 무한정 커지지 않도록 1MB 넘으면 새로 시작
    try {
      if (fs.statSync(logFile()).size > 1024 * 1024) fs.writeFileSync(logFile(), '');
    } catch (_) { /* 파일 없음 */ }
    fs.appendFileSync(logFile(), line);
  } catch (_) { /* 로깅 실패는 무시 */ }
}

process.on('uncaughtException', (e) => logError('uncaughtException', e));
process.on('unhandledRejection', (e) => logError('unhandledRejection', e));

// ---------------------------------------------------------------------------
// 자동 시작(로그인 시 실행) — 상주 앱이라 기본 동작에 가깝다.
// ---------------------------------------------------------------------------

function getAutoLaunch() {
  try { return !!app.getLoginItemSettings().openAtLogin; } catch (_) { return false; }
}

function setAutoLaunch(enabled) {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!enabled,
      // 자동 시작으로 켜졌을 때는 설정창을 띄우지 않기 위한 표식
      args: ['--autostart']
    });
  } catch (e) {
    logError('setAutoLaunch', e);
  }
  return getAutoLaunch();
}

const startedByAutoLaunch = process.argv.includes('--autostart');

// ---------------------------------------------------------------------------
// 자동 업데이트 — 패키징된 빌드에서만 동작한다.
// ---------------------------------------------------------------------------

function setupAutoUpdate() {
  if (!app.isPackaged) return;              // 개발 실행(npm start)에서는 건너뜀
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    logError('autoUpdater(모듈 없음)', e);
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', (e) => logError('autoUpdater', e));
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[main] update downloaded:', info && info.version);
    if (tray) tray.setToolTip('Remotwerk — 업데이트 준비됨(재시작 시 적용)');
    refreshTrayMenu();
  });
  autoUpdater.checkForUpdates().catch((e) => logError('checkForUpdates', e));
  // 6시간마다 재확인 (상주 앱이라 오래 켜져 있다)
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// 창 생성
// ---------------------------------------------------------------------------

function baseWebPrefs() {
  return {
    preload: PRELOAD,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false
  };
}

// 모든 디스플레이를 합친 가상 데스크톱 전체 범위(음수 좌표 포함).
function virtualDesktopBounds() {
  const displays = screen.getAllDisplays();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of displays) {
    const b = d.bounds; // workArea 아님 — 작업표시줄까지 포함한 전체 화면
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  if (!isFinite(minX)) {
    const p = screen.getPrimaryDisplay().bounds;
    return { x: p.x, y: p.y, width: p.width, height: p.height };
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function fitOverlayToVirtualDesktop() {
  if (!win.overlay || win.overlay.isDestroyed()) return;
  win.overlay.setBounds(virtualDesktopBounds());
}

function createOverlay() {
  if (win.overlay && !win.overlay.isDestroyed()) return win.overlay;

  // 캐릭터가 모니터 경계를 넘어 이동할 수 있도록, 오버레이는 가상 데스크톱 전체를 덮는다.
  const { x, y, width, height } = virtualDesktopBounds();

  const w = new BrowserWindow({
    x, y, width, height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,          // 오버레이가 포커스를 훔치지 않도록
    alwaysOnTop: true,
    fullscreenable: false,
    webPreferences: baseWebPrefs()
  });

  // 항상 위 + 모든 워크스페이스에 표시 (macOS 포함)
  w.setAlwaysOnTop(true, 'screen-saver');
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // 기본은 클릭 통과. 캐릭터 위에서만 렌더러가 요청해 잠깐 켠다(forward 로 hover 감지 유지).
  w.setIgnoreMouseEvents(true, { forward: true });

  w.loadFile(path.join(RENDERER, 'overlay', 'overlay.html'));
  win.overlay = w;

  {
    const cfg = config.load();
    logInfo('overlay', {
      bounds: { x, y, width, height },
      displays: screen.getAllDisplays().length,
      pos: cfg.overlayPos, scale: cfg.overlayScale,
      me: cfg.characterId, partner: cfg.partnerCharacterId,
      customs: (cfg.customCharacters || []).map((c) => c.id),
      paired: !!cfg.roomId, focusMode: !!cfg.focusMode
    });
  }
  w.on('closed', () => { win.overlay = null; });
  return w;
}

function createRemote() {
  if (win.remote && !win.remote.isDestroyed()) {
    positionRemoteAtCursor(win.remote);
    win.remote.show();
    win.remote.focus();
    return win.remote;
  }

  const w = new BrowserWindow({
    // 카드가 200×184 라서 그림자·토스트 여백만 남기고 창을 줄였다(업무 화면을 덜 가린다).
    width: 236, height: 226,
    transparent: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: baseWebPrefs()
  });
  w.setAlwaysOnTop(true, 'screen-saver');
  w.loadFile(path.join(RENDERER, 'remote', 'remote.html'));
  win.remote = w;
  w.on('closed', () => { win.remote = null; });
  // 포커스를 잃으면 리모컨은 닫아 업무를 가리지 않게 한다.
  w.on('blur', () => { if (win.remote && !win.remote.isDestroyed()) win.remote.hide(); });
  w.once('ready-to-show', () => {
    positionRemoteAtCursor(w);
    w.show();
    w.focus();
  });
  return w;
}

function positionRemoteAtCursor(w) {
  const pt = screen.getCursorScreenPoint();
  const [ww, wh] = w.getSize();
  const disp = screen.getDisplayNearestPoint(pt);
  const area = disp.workArea;
  let x = Math.round(pt.x - ww / 2);
  let y = Math.round(pt.y - wh / 2);
  x = Math.max(area.x, Math.min(x, area.x + area.width - ww));
  y = Math.max(area.y, Math.min(y, area.y + area.height - wh));
  w.setPosition(x, y);
}

// 일반 창(설정/히스토리/리깅/뷰어)을 확실히 보이게 한다.
// 오버레이는 화면 전체를 덮는 screen-saver 레벨 항상-위 창이라, 일반 창이 그 뒤에 가려질 수
// 있다(특히 투명 합성이 약한 환경). 잠깐 오버레이 위로 띄운 뒤 일반 레벨로 되돌려 가시성을 보장.
function bringToFront(w) {
  if (!w || w.isDestroyed()) return;
  if (w.isMinimized()) w.restore();
  w.show();
  w.setAlwaysOnTop(true, 'screen-saver');
  w.focus();
  w.moveTop();
  setTimeout(() => { if (w && !w.isDestroyed()) w.setAlwaysOnTop(false); }, 700);
}

function createHistory() {
  if (win.history && !win.history.isDestroyed()) { bringToFront(win.history); return win.history; }
  const w = new BrowserWindow({
    width: 360, height: 520,
    title: 'Remotwerk — 오늘 받은 신호',
    resizable: true,
    skipTaskbar: false,
    center: true,
    webPreferences: baseWebPrefs()
  });
  w.loadFile(path.join(RENDERER, 'history', 'history.html'));
  win.history = w;
  bringToFront(w);
  w.once('ready-to-show', () => bringToFront(w));
  w.on('closed', () => { win.history = null; });
  return w;
}

function createSettings() {
  if (win.settings && !win.settings.isDestroyed()) { bringToFront(win.settings); return win.settings; }
  const w = new BrowserWindow({
    // 내용이 1900px 가까이 되는 긴 화면이라 어차피 스크롤된다. 그래도 620 은
    // "캐릭터 고르기" 한 구획도 다 안 들어가서, 미리보기와 저장 버튼이 매번 잘렸다.
    // 760 이면 1080p 작업표시줄까지 감안해도 넉넉히 들어간다(창은 조절 가능).
    width: 480, height: 760,
    title: 'Remotwerk — 설정',
    resizable: true,
    center: true,
    webPreferences: baseWebPrefs()
  });
  w.loadFile(path.join(RENDERER, 'settings', 'settings.html'));
  win.settings = w;
  bringToFront(w);
  w.once('ready-to-show', () => bringToFront(w));

  // 설정 창이 이 앱의 **작업표시줄 대표 창**이다.
  //
  // 오버레이는 투명·클릭 통과·포커스 없음이라 작업표시줄에 뜰 수 없다(그렇게 만들면
  // 캐릭터를 누를 때마다 작업 중인 창에서 포커스를 빼앗아 비침습성 원칙을 어긴다).
  // 그래서 평범한 창인 설정 창을 남겨 두고, 닫기를 누르면 **최소화**한다.
  // 앱이 켜져 있는 동안 작업표시줄에서 계속 보이고, 눌러서 되돌아올 수 있다.
  // 완전히 끄는 것은 트레이 메뉴의 '종료'(또는 캐릭터 우클릭 → 종료)다.
  w.on('close', (e) => {
    if (app.isQuiting) return;
    e.preventDefault();
    w.minimize();
  });
  w.on('closed', () => { win.settings = null; });
  return w;
}

// editId 를 주면 그 캐릭터를 불러와 편집한다(없으면 새로 만들기).
function createRigger(editId) {
  // 기능이 꺼져 있으면 창을 만들지 않는다. 화면에서 버튼만 숨기면 IPC 로는 여전히
  // 열 수 있으므로, 마지막 관문은 여기다.
  if (!features.characterUpload) {
    logInfo('rigger', '기능이 꺼져 있어 열지 않음(features.characterUpload=false)');
    return null;
  }
  // 편집 대상이 바뀌면 기존 창을 닫고 새로 연다(창 안에서 대상 교체보다 단순하고 안전).
  if (win.rigger && !win.rigger.isDestroyed()) {
    if (!editId) { bringToFront(win.rigger); return win.rigger; }
    win.rigger.destroy();
    win.rigger = null;
  }
  const w = new BrowserWindow({
    width: 940, height: 720,
    title: editId ? 'Remotwerk — 캐릭터 편집' : 'Remotwerk — 캐릭터 만들기',
    resizable: true,
    center: true,
    webPreferences: baseWebPrefs()
  });
  w.loadFile(path.join(RENDERER, 'rigger', 'rigger.html'), editId ? { query: { edit: editId } } : undefined);
  win.rigger = w;
  bringToFront(w);
  w.once('ready-to-show', () => bringToFront(w));
  w.on('closed', () => { win.rigger = null; });
  return w;
}

// 디버그용 동작 뷰어 — 캐릭터를 골라 동작을 즉시 재생해 본다.
function createViewer() {
  if (win.viewer && !win.viewer.isDestroyed()) { bringToFront(win.viewer); return win.viewer; }
  const w = new BrowserWindow({
    width: 520, height: 640,
    title: 'Remotwerk — 동작 뷰어 (디버그)',
    resizable: true,
    center: true,
    webPreferences: baseWebPrefs()
  });
  w.loadFile(path.join(RENDERER, 'viewer', 'viewer.html'));
  win.viewer = w;
  bringToFront(w);
  w.once('ready-to-show', () => bringToFront(w));
  w.on('closed', () => { win.viewer = null; });
  return w;
}

// ---------------------------------------------------------------------------
// 즉시 숨김(보스키) / 복원
// ---------------------------------------------------------------------------

function hideAll() {
  for (const key of Object.keys(win)) {
    const w = win[key];
    if (w && !w.isDestroyed() && w.isVisible()) w.hide();
  }
}

// 보스키의 기준은 **캐릭터가 보이는가** 다.
// 예전에는 아무 창이나 하나 떠 있으면(설정 창만 열려 있어도) '숨기기'를 골랐다.
// 설정 창이 작업표시줄 대표 창이 되면서 거의 항상 떠 있으므로, 그대로 두면
// 보스키가 '복원' 을 영영 못 고른다.
function overlayVisible() {
  return !!(win.overlay && !win.overlay.isDestroyed() && win.overlay.isVisible());
}

function anyVisible() {
  return Object.values(win).some((w) => w && !w.isDestroyed() && w.isVisible());
}

function toggleBossKey() {
  if (overlayVisible() || anyVisible()) {
    hideAll();
  } else {
    // 복원 시엔 오버레이만 다시 띄운다(다른 창은 사용자가 필요할 때 연다).
    const o = win.overlay || createOverlay();
    o.showInactive();
  }
}

// ---------------------------------------------------------------------------
// 트레이 / 메뉴바
// ---------------------------------------------------------------------------

function buildTrayIcon() {
  // 실제 앱 아이콘을 쓴다. 트레이 아이콘이 정체불명의 점이면 사용자가 앱을 못 찾는다.
  // (Windows 11 은 새 트레이 아이콘을 기본으로 숨김 영역에 넣기 때문에 더 그렇다.)
  // PNG 파일에서 바로 만든다. addRepresentation 에 PNG 바이트를 넘기면 안 된다 —
  // 그 buffer 는 **압축되지 않은 비트맵**이어야 해서, PNG 를 주면 빈 이미지가 되고
  // 빈 이미지로 Tray 를 만들면 실패한다(그래서 아이콘이 아예 안 보였다).
  for (const f of ['tray-32.png', 'tray-16.png']) {
    try {
      const img = nativeImage.createFromPath(path.join(__dirname, f));
      if (!img.isEmpty()) return img;
      logError('buildTrayIcon', new Error(`빈 이미지: ${f}`));
    } catch (e) {
      logError('buildTrayIcon', e);
    }
  }

  // 아이콘 파일을 못 읽으면 코드로 그린 점이라도 띄운다(트레이가 아예 없으면 앱을 못 찾는다).
  const size = 16, r = 7, cx = 7.5, cy = 7.5;
  const buf = Buffer.alloc(size * size * 4, 0);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const inside = (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r;
      if (inside) { buf[i] = 138; buf[i + 1] = 99; buf[i + 2] = 255; buf[i + 3] = 255; } // RGBA 보라
    }
  }
  const img = nativeImage.createEmpty();
  img.addRepresentation({ width: size, height: size, scaleFactor: 1, buffer: buf });
  return img;
}

// 캐릭터를 화면 가운데로 되돌리고, 숨어 있었다면 다시 띄운다.
// 위치·크기를 한꺼번에 되돌리므로 "어디 갔는지 모르겠다" 상태에서 무조건 빠져나올 수 있다.
// 숨겨져 있던 오버레이를 다시 띄운다. 여러 경로(트레이·두 번째 실행·activate)가
// 같은 함수를 쓰게 해서, 어디로 들어오든 캐릭터가 되살아나게 한다.
function showOverlay() {
  const o = (win.overlay && !win.overlay.isDestroyed()) ? win.overlay : createOverlay();
  if (o && !o.isDestroyed() && !o.isVisible()) o.showInactive();
  return o;
}

function recenterCharacter() {
  const o = showOverlay();
  if (o && !o.isDestroyed()) fitOverlayToVirtualDesktop();

  // **가상 데스크톱의 한가운데가 아니라 실제 모니터의 한가운데로 보낸다.**
  // 가상 데스크톱은 모든 모니터를 둘러싼 직사각형이라, 모니터가 대각선으로 놓이면
  // 그 한가운데(0.5, 0.6)가 어느 화면에도 속하지 않는 빈 공간일 수 있다.
  // 그러면 "가운데로 되돌리기" 를 눌러도 캐릭터가 여전히 안 보인다.
  let pos = { x: 0.5, y: 0.6 };
  try {
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) || screen.getPrimaryDisplay();
    const wa = d.workArea;
    const b = (o && !o.isDestroyed()) ? o.getBounds() : null;
    if (b && b.width > 0 && b.height > 0) {
      const cx = wa.x + wa.width / 2;
      const cy = wa.y + wa.height * 0.6;
      pos = {
        x: Math.max(0, Math.min(1, (cx - b.x) / b.width)),
        y: Math.max(0, Math.min(1, (cy - b.y) / b.height))
      };
    }
    logInfo('recenter', { display: wa, overlay: b, pos });
  } catch (e) {
    logError('recenterCharacter', e);
  }

  const next = config.save({ overlayPos: pos, overlayScale: 1 });
  broadcastConfig(next);
}

function buildTray() {
  try {
    tray = new Tray(buildTrayIcon());
  } catch (e) {
    // 예전에는 여기서 조용히 return 했다. 그런데 오버레이 창은 작업표시줄에 뜨지 않으므로
    // **트레이가 없으면 앱에 닿을 방법이 사라진다** — 프로세스는 살아 있는데 화면에는
    // 아무것도 없는 상태가 된다. 조용히 넘기면 안 되는 실패다.
    logError('buildTray', e);
    tray = null;
    createSettings();          // 최소한 창 하나는 띄워서 앱을 찾을 수 있게 한다
    return;
  }
  logInfo('tray', '트레이 아이콘 생성됨');
  tray.setToolTip('Remotwerk — 클릭하면 리모컨');
  // 좌클릭/더블클릭으로 바로 리모컨을 연다(메뉴를 거치지 않아도 되게).
  tray.on('click', () => createRemote());
  tray.on('double-click', () => createRemote());
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) return;
  const cfg = config.load();
  const menu = Menu.buildFromTemplate([
    { label: '리모컨 열기', click: () => createRemote() },
    { label: '히스토리 열기', click: () => createHistory() },
    { type: 'separator' },
    // 캐릭터를 잃어버렸을 때의 탈출구.
    // 모니터를 바꾸거나 끝으로 끌어 두면 화면 밖으로 나가 영영 못 찾을 수 있다.
    { label: '캐릭터 화면 가운데로 되돌리기', click: () => recenterCharacter() },
    { type: 'separator' },
    {
      label: '집중 모드',
      type: 'checkbox',
      checked: !!cfg.focusMode,
      click: (item) => {
        const next = config.save({ focusMode: item.checked });
        broadcastConfig(next);
      }
    },
    { label: '즉시 숨김 / 복원', accelerator: 'CommandOrControl+Shift+H', click: () => toggleBossKey() },
    {
      label: '컴퓨터 켤 때 자동 시작',
      type: 'checkbox',
      checked: getAutoLaunch(),
      click: (item) => setAutoLaunch(item.checked)
    },
    { type: 'separator' },
    { label: '페어링 · 캐릭터 설정', accelerator: 'CommandOrControl+Shift+S', click: () => createSettings() },
    { label: '동작 뷰어 (디버그)', click: () => createViewer() },
    { type: 'separator' },
    { label: '종료', click: () => { app.isQuiting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

// 우클릭 메뉴의 크기 프리셋 — 슬라이더/핸들을 못 찾는 사람을 위한 가장 쉬운 길.
function setOverlayScale(scale) {
  const next = config.save({ overlayScale: scale });
  broadcastConfig(next);
}

function broadcastConfig(cfg) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('config:changed', cfg);
  }
  refreshTrayMenu();
}

function registerIpc() {
  ipcMain.handle('config:get', () => config.load());
  ipcMain.handle('config:set', (_e, patch) => {
    const next = config.save(patch || {});
    broadcastConfig(next);
    return next;
  });

  ipcMain.on('ui:open-remote', () => createRemote());
  ipcMain.on('ui:open-history', () => createHistory());
  ipcMain.on('ui:open-settings', () => createSettings());
  ipcMain.on('ui:open-rigger', (_e, editId) => {
    if (!features.characterUpload) return;      // 꺼져 있으면 요청을 무시한다
    createRigger(editId || null);
  });
  ipcMain.on('ui:open-viewer', () => createViewer());
  ipcMain.on('ui:hide-all', () => hideAll());
  ipcMain.on('ui:quit', () => { app.isQuiting = true; app.quit(); });
  ipcMain.on('ui:close-self', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w && !w.isDestroyed()) w.close();
  });

  // 앱 정보 / 자동 시작 / 로그
  ipcMain.handle('app:get-info', () => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
    autoLaunch: getAutoLaunch(),
    logPath: logFile()
  }));
  ipcMain.handle('app:set-auto-launch', (_e, enabled) => {
    const v = setAutoLaunch(enabled);
    refreshTrayMenu();
    return v;
  });
  ipcMain.on('app:open-logs', () => {
    try {
      fs.mkdirSync(logDir(), { recursive: true });
      shell.openPath(logDir());
    } catch (e) { logError('openLogs', e); }
  });

  // 오버레이 캐릭터 우클릭 메뉴 — 창을 다 닫아도 캐릭터가 남으므로,
  // 캐릭터 자체에서 끄기/숨기기로 갈 수 있어야 한다.
  ipcMain.on('overlay:context-menu', () => {
    const menu = Menu.buildFromTemplate([
      { label: '리모컨 열기', click: () => createRemote() },
      { label: '설정', accelerator: 'CommandOrControl+Shift+S', click: () => createSettings() },
      { label: '히스토리', click: () => createHistory() },
      { type: 'separator' },
      {
        label: '캐릭터 크기',
        submenu: [
          { label: '작게 (70%)', click: () => setOverlayScale(0.7) },
          { label: '보통 (100%)', click: () => setOverlayScale(1) },
          { label: '크게 (140%)', click: () => setOverlayScale(1.4) },
          { label: '아주 크게 (200%)', click: () => setOverlayScale(2) }
        ]
      },
      { label: '캐릭터 숨기기 (다시 보기: Ctrl+Shift+H)', click: () => hideAll() },
      { type: 'separator' },
      { label: 'Remotwerk 종료', click: () => { app.isQuiting = true; app.quit(); } }
    ]);
    menu.popup({ window: win.overlay });
  });

  ipcMain.on('overlay:set-interactive', (_e, interactive) => {
    if (!win.overlay || win.overlay.isDestroyed()) return;
    if (interactive) {
      win.overlay.setIgnoreMouseEvents(false);
    } else {
      win.overlay.setIgnoreMouseEvents(true, { forward: true });
    }
  });
}

// ---------------------------------------------------------------------------
// 전역 단축키
// ---------------------------------------------------------------------------

function registerShortcuts() {
  // 리모컨 전역 단축키는 뺐다 — 캐릭터를 톡 클릭하거나 트레이 아이콘을 누르면 열리고,
  // 전역 단축키는 다른 프로그램의 Ctrl+Shift+R(새로고침 등)을 가로채기만 한다.
  globalShortcut.register('CommandOrControl+Shift+H', () => toggleBossKey());
  globalShortcut.register('CommandOrControl+Shift+S', () => createSettings());
}

// 모니터 추가/제거/해상도 변경 시 오버레이를 가상 데스크톱 전체로 다시 맞춘다.
function registerDisplayEvents() {
  screen.on('display-added', fitOverlayToVirtualDesktop);
  screen.on('display-removed', fitOverlayToVirtualDesktop);
  screen.on('display-metrics-changed', fitOverlayToVirtualDesktop);
}

// ---------------------------------------------------------------------------
// 앱 라이프사이클
// ---------------------------------------------------------------------------

// 단일 인스턴스 보장 (로컬 데모 트랜스포트 루프백/트레이 중복 방지)
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // 앱은 트레이에 상주하므로, 이미 실행 중일 때 다시 켜면 이 핸들러가 뜬다.
  // 페어링 전이면 설정창을, 이후면 리모컨을 앞으로 띄운다.
  app.on('second-instance', () => {
    // 이미 켜져 있는데 또 실행했다는 건 "안 보인다" 는 뜻일 때가 많다.
    // 숨겨진 오버레이부터 되살린다(예전엔 설정/리모컨만 열어 캐릭터는 계속 안 보였다).
    showOverlay();
    const cfg = config.load();
    if (!cfg.roomId) createSettings();
    else createRemote();
  });

  app.whenReady().then(() => {
    const cfg = config.load();
    console.log('[main] start | v' + app.getVersion(), '| packaged =', app.isPackaged,
      '| paired =', !!cfg.roomId, '| autostart =', startedByAutoLaunch);
    console.log('[main] config =', path.join(app.getPath('userData'), 'config.json'));
    console.log('[main] logs   =', logFile());
    console.log('[main] Open settings anytime with Ctrl/Cmd+Shift+S or the tray icon.');

    registerIpc();
    registerShortcuts();

    // 설정 창을 띄운다. 오버레이/트레이 생성보다 먼저 열어, 그쪽에서 예외가 나더라도
    // 설정 창이 막히지 않게 한다. 이 창이 작업표시줄 대표 창 역할도 한다.
    //
    // 예전에는 페어링 전(!roomId)에만 띄웠다. 그래서 한 번 페어링하고 나면 실행해도
    // 아무 창도 안 뜨고, 트레이를 못 찾으면 앱을 켰는지조차 알 수 없었다.
    // 단, 로그인 시 자동 실행으로 켜진 경우엔 조용히 시작한다(업무 방해 금지).
    if (!startedByAutoLaunch) createSettings();

    // 오버레이/트레이/디스플레이 이벤트는 실패해도 앱이 죽지 않도록 각각 보호한다.
    try { createOverlay(); } catch (e) { logError('createOverlay', e); }
    try { buildTray(); } catch (e) { logError('buildTray', e); }
    try { registerDisplayEvents(); } catch (e) { logError('registerDisplayEvents', e); }
    try { setupAutoUpdate(); } catch (e) { logError('setupAutoUpdate', e); }

    app.on('activate', () => { showOverlay(); });
  });

  // 오버레이 상주 앱이므로 모든 창을 닫아도 종료하지 않는다(트레이로 유지).
  app.on('window-all-closed', (e) => {
    if (!app.isQuiting) {
      // 아무 것도 안 함 — 트레이에 상주
    } else if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('will-quit', () => globalShortcut.unregisterAll());
}
