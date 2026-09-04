'use strict';

// 렌더러에 노출하는 안전한 호스트 API.
// 애니메이션 재생/신호 송수신(Firebase·로컬 트랜스포트)은 렌더러에서 직접 처리하고,
// 여기서는 설정 저장, 창 제어, 오버레이 클릭 통과 토글만 담당한다.

const { contextBridge, ipcRenderer } = require('electron');
const features = require('../features');

contextBridge.exposeInMainWorld('rwHost', {
  platform: process.platform,

  // 기능 플래그 — src/features.js 하나가 원본이다(메인·렌더러가 같은 값을 본다).
  features: Object.freeze({ ...features }),

  // ---- 설정 ----
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  onConfigChanged: (cb) => {
    const handler = (_e, cfg) => cb(cfg);
    ipcRenderer.on('config:changed', handler);
    return () => ipcRenderer.removeListener('config:changed', handler);
  },

  // ---- 창 제어 ----
  openRemote: () => ipcRenderer.send('ui:open-remote'),
  openHistory: () => ipcRenderer.send('ui:open-history'),
  openSettings: () => ipcRenderer.send('ui:open-settings'),
  // 꺼져 있으면 요청 자체를 보내지 않는다(메인 쪽에서도 한 번 더 막는다).
  openRigger: (editId) => {
    if (!features.characterUpload) return false;
    ipcRenderer.send('ui:open-rigger', editId || null);
    return true;
  },
  openViewer: () => ipcRenderer.send('ui:open-viewer'),
  hideAll: () => ipcRenderer.send('ui:hide-all'),
  closeSelf: () => ipcRenderer.send('ui:close-self'),
  quit: () => ipcRenderer.send('ui:quit'),

  // ---- 앱 정보 / 자동 시작 / 로그 ----
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('app:set-auto-launch', enabled),
  openLogs: () => ipcRenderer.send('app:open-logs'),

  // ---- 오버레이 전용: 캐릭터 위에서만 마우스 이벤트를 받도록 클릭 통과 토글 ----
  setOverlayInteractive: (interactive) =>
    ipcRenderer.send('overlay:set-interactive', interactive),
  overlayContextMenu: () => ipcRenderer.send('overlay:context-menu')
});
