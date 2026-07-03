'use strict';

// Remotwerk 메인 프로세스.
// 창 관리(오버레이·리모컨·히스토리·설정), 전역 단축키, 트레이를 담당한다.
// 투명·항상 위·클릭 통과는 OS별로 세부가 다르므로 각 플랫폼에서 확인이 필요하다.

const path = require('path');
const {
  app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen, nativeImage
} = require('electron');

const config = require('./config');

const isDev = process.argv.includes('--dev');
const PRELOAD = path.join(__dirname, 'preload.js');
const RENDERER = path.join(__dirname, '..', 'renderer');

/** @type {Object<string, BrowserWindow>} */
const win = {};
let tray = null;

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
    width: 300, height: 300,
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
    width: 480, height: 620,
    title: 'Remotwerk — 설정',
    resizable: true,
    center: true,
    webPreferences: baseWebPrefs()
  });
  w.loadFile(path.join(RENDERER, 'settings', 'settings.html'));
  win.settings = w;
  bringToFront(w);
  w.once('ready-to-show', () => bringToFront(w));
  w.on('closed', () => { win.settings = null; });
  return w;
}

function createRigger() {
  if (win.rigger && !win.rigger.isDestroyed()) { bringToFront(win.rigger); return win.rigger; }
  const w = new BrowserWindow({
    width: 900, height: 680,
    title: 'Remotwerk — 캐릭터 만들기',
    resizable: true,
    center: true,
    webPreferences: baseWebPrefs()
  });
  w.loadFile(path.join(RENDERER, 'rigger', 'rigger.html'));
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

function anyVisible() {
  return Object.values(win).some((w) => w && !w.isDestroyed() && w.isVisible());
}

function toggleBossKey() {
  if (anyVisible()) {
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
  // 텍스트 에셋 없이도 "보이는" 아이콘을 코드로 그린다(보라색 원형 점).
  // (실제 배포 시 assets 의 아이콘으로 교체)
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

function buildTray() {
  try {
    tray = new Tray(buildTrayIcon());
  } catch (_) {
    return; // 일부 환경(헤드리스)에서는 트레이 생성이 불가할 수 있음
  }
  tray.setToolTip('Remotwerk');
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) return;
  const cfg = config.load();
  const menu = Menu.buildFromTemplate([
    { label: '리모컨 열기', accelerator: 'CommandOrControl+Shift+R', click: () => createRemote() },
    { label: '히스토리 열기', click: () => createHistory() },
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
    { type: 'separator' },
    { label: '페어링 · 캐릭터 설정', accelerator: 'CommandOrControl+Shift+S', click: () => createSettings() },
    { label: '캐릭터 만들기 (업로드·리깅)', click: () => createRigger() },
    { label: '동작 뷰어 (디버그)', click: () => createViewer() },
    { type: 'separator' },
    { label: '종료', click: () => { app.isQuiting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

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
  ipcMain.on('ui:open-rigger', () => createRigger());
  ipcMain.on('ui:open-viewer', () => createViewer());
  ipcMain.on('ui:hide-all', () => hideAll());
  ipcMain.on('ui:quit', () => { app.isQuiting = true; app.quit(); });
  ipcMain.on('ui:close-self', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w && !w.isDestroyed()) w.close();
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
  globalShortcut.register('CommandOrControl+Shift+R', () => createRemote());
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
    const cfg = config.load();
    if (!cfg.pairCode) createSettings();
    else createRemote();
  });

  app.whenReady().then(() => {
    const cfg = config.load();
    console.log('[main] start | paired =', !!cfg.pairCode, '| pairCode =', cfg.pairCode, '| config =', require('path').join(app.getPath('userData'), 'config.json'));
    console.log('[main] Open settings anytime with Ctrl/Cmd+Shift+S or the tray icon.');

    registerIpc();
    registerShortcuts();

    // 페어링 전이면 설정 화면부터 띄운다. 오버레이/트레이 생성보다 먼저 열어,
    // 그쪽에서 예외가 나더라도 설정 창이 막히지 않게 한다.
    if (!cfg.pairCode) createSettings();

    // 오버레이/트레이/디스플레이 이벤트는 실패해도 앱이 죽지 않도록 각각 보호한다.
    try { createOverlay(); } catch (e) { console.error('[main] createOverlay 실패', e); }
    try { buildTray(); } catch (e) { console.error('[main] buildTray 실패', e); }
    try { registerDisplayEvents(); } catch (e) { console.error('[main] display 이벤트', e); }

    app.on('activate', () => {
      if (!win.overlay || win.overlay.isDestroyed()) createOverlay();
    });
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
