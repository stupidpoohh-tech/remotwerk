'use strict';
/* 공용 캐릭터 카탈로그 (admin 이 올리는 캐릭터).
 *
 * 두 종류의 커스텀 캐릭터가 있다:
 *   - 개인(custom)  : 내 PC 의 config 에만 있고, 나만 선택할 수 있다. 상대에게는 방
 *                     Storage 로 번들을 올려 전달한다.
 *   - 공용(catalog) : 관리자가 올린 캐릭터. 모든 사용자가 목록에서 고를 수 있다.
 *                     번들이 서버에 이미 있으므로 상대는 id 만 알면 내려받는다.
 *
 * 저장 위치는 RTDB `catalog/{id}`. 번들이 최대 2MB 라 RTDB 값 한도(10MB) 안에 들고,
 * 무엇보다 보안 규칙으로 "관리자만 쓰기"를 강제할 수 있다.
 * (Storage 규칙에서는 RTDB 의 관리자 목록을 조회할 수 없어 쓰기 제한이 어렵다.)
 *
 * 관리자 판별: RTDB `admins/{uid} === true`. 이 목록은 Firebase 콘솔에서만 수정한다.
 */

(function (root) {
  const RW = (root.RW = root.RW || {});

  const CACHE_KEY = 'rw-catalog-cache';
  let cache = readCache();      // [{ id, name, swatch, bundle }]
  let loaded = false;
  let adminFlag = null;

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '[]'); } catch (_) { return []; }
  }
  function writeCache(list) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(list)); } catch (_) { /* 용량 초과 무시 */ }
  }

  // 이미 받아 둔 목록(동기). 네트워크 전에도 UI 를 그릴 수 있게 캐시를 쓴다.
  function cached() { return cache; }
  function isLoaded() { return loaded; }

  function usable(cfg) { return !!(cfg && cfg.firebase); }

  // 서버에서 카탈로그를 받아 캐시를 갱신한다.
  async function load(cfg) {
    if (!usable(cfg)) return cache;
    const fb = await RW.fb.init(cfg.firebase);
    const snap = await fb.dbMod.get(fb.dbMod.ref(fb.db, 'catalog'));
    const out = [];
    snap.forEach((c) => {
      const v = c.val() || {};
      if (v.bundle) out.push({ id: c.key, name: v.name || c.key, swatch: v.swatch || '#2a9d5c', bundle: v.bundle });
    });
    cache = out;
    loaded = true;
    writeCache(out);
    return out;
  }

  // 특정 id 하나만 (상대 캐릭터 해석용)
  async function get(cfg, id) {
    const hit = cache.find((c) => c.id === id);
    if (hit) return hit;
    if (!usable(cfg)) return null;
    const fb = await RW.fb.init(cfg.firebase);
    const snap = await fb.dbMod.get(fb.dbMod.ref(fb.db, `catalog/${id}`));
    if (!snap.exists()) return null;
    const v = snap.val() || {};
    const entry = { id, name: v.name || id, swatch: v.swatch || '#2a9d5c', bundle: v.bundle };
    if (entry.bundle) { cache = cache.concat([entry]); writeCache(cache); }
    return entry;
  }

  async function isAdmin(cfg) {
    if (adminFlag !== null) return adminFlag;
    if (!usable(cfg)) return (adminFlag = false);
    try {
      const fb = await RW.fb.init(cfg.firebase);
      const snap = await fb.dbMod.get(fb.dbMod.ref(fb.db, `admins/${fb.uid}`));
      adminFlag = snap.exists() && snap.val() === true;
    } catch (_) {
      adminFlag = false;
    }
    return adminFlag;
  }

  // 관리자 전용: 공용 카탈로그에 올리기(같은 id 면 덮어쓰기)
  async function publish(cfg, entry) {
    const fb = await RW.fb.init(cfg.firebase);
    const id = entry.id || ('cat_' + Date.now().toString(36));
    await fb.dbMod.set(fb.dbMod.ref(fb.db, `catalog/${id}`), {
      name: entry.name,
      swatch: entry.swatch || '#2a9d5c',
      bundle: entry.bundle,
      createdBy: fb.uid,
      createdAt: fb.dbMod.serverTimestamp()
    });
    await load(cfg);
    return id;
  }

  async function remove(cfg, id) {
    const fb = await RW.fb.init(cfg.firebase);
    await fb.dbMod.remove(fb.dbMod.ref(fb.db, `catalog/${id}`));
    await load(cfg);
  }

  RW.catalog = { load, get, cached, isLoaded, isAdmin, publish, remove };
})(typeof window !== 'undefined' ? window : globalThis);
