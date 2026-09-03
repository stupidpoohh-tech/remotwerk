'use strict';

// 계정 시스템 없는 로컬 설정 저장소.
// userData 폴더에 config.json 하나로 페어링 코드/내 캐릭터/집중 모드 등을 보관한다.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

let cachedPath = null;
let cached = null;

function configPath() {
  if (!cachedPath) {
    cachedPath = path.join(app.getPath('userData'), 'config.json');
  }
  return cachedPath;
}

function defaults() {
  return {
    // 로컬 데모(루프백)용 식별자. Firebase 모드에서는 익명 인증 uid 를 쓴다.
    userId: 'u_' + crypto.randomBytes(6).toString('hex'),
    // 페어링된 방 id (서버가 만든 추측 불가능한 값). 이게 있어야 Firebase 모드로 동작한다.
    roomId: null,
    // 마지막으로 발급/입력한 초대 코드 — 표시용일 뿐 접근 권한과 무관(1회용·24시간 만료).
    pairCode: null,
    // 내가 고른 캐릭터(상대 화면에 상주할 캐릭터)
    characterId: 'preset1',
    // 상대가 고른 캐릭터(내 화면에 상주). 실서비스에선 Firebase members에서 읽지만
    // 로컬/데모 모드를 위해 캐시해 둔다.
    partnerCharacterId: 'preset2',
    // 집중 모드: 켜면 들어오는 신호를 라이브 재생하지 않고 히스토리로만 쌓는다.
    focusMode: false,
    // 오버레이 캐릭터 위치(드래그로 이동, 화면 비율 0..1로 저장)
    overlayPos: { x: 0.82, y: 0.72 },
    // 오버레이 캐릭터 크기 배율(0.5 ~ 2.0). 발밑을 기준으로 커지고 작아진다.
    overlayScale: 1,
    // 내가 만든 커스텀 캐릭터들(리깅 도구 산출물). 프리셋과 동일 포맷의 번들을 담는다.
    //   [{ id, name, swatch, bundle: { skeletonId:'bipedal5', slots:{...} } }]
    customCharacters: [],
    // Firebase 웹 설정. null 이면 로컬 데모 트랜스포트로 동작한다.
    // 이 프로젝트(remotwerk-aa0d2)로 기본 연결되며, 페어링 코드만 입력하면 상대와 묶인다.
    // 웹 API 키는 클라이언트 공개용(비밀 아님)이라 커밋해도 되고, 실제 보호는 RTDB 보안 규칙이 담당한다.
    // 주의: databaseURL 은 Realtime Database 전용 값이라 콘솔 기본 스니펫엔 없어 여기서 채운다.
    //   RTDB 인스턴스가 미국이 아닌 리전이면(예: 싱가포르) 콘솔의 실제 URL 로 교체해야 한다.
    firebase: {
      apiKey: 'AIzaSyBeVN-PB5CrMv9g75hSlUAKX8xRAigsXOM',
      authDomain: 'remotwerk-aa0d2.firebaseapp.com',
      databaseURL: 'https://remotwerk-aa0d2-default-rtdb.asia-southeast1.firebasedatabase.app',
      projectId: 'remotwerk-aa0d2',
      storageBucket: 'remotwerk-aa0d2.firebasestorage.app',
      messagingSenderId: '981582145619',
      appId: '1:981582145619:web:95f9c96280a83a159bfea6',
      measurementId: 'G-4F2NZFC4BE'
    }
  };
}

function load() {
  if (cached) return cached;
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch (_) {
    data = {};
  }
  cached = Object.assign(defaults(), data);
  // userId 는 최초 1회만 생성해 고정
  if (!data.userId) save(cached);
  return cached;
}

function save(next) {
  cached = Object.assign(load(), next);
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(cached, null, 2), 'utf8');
  } catch (err) {
    console.error('[config] 저장 실패', err);
  }
  return cached;
}

module.exports = { load, save };
