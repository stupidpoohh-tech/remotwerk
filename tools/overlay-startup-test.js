'use strict';
// Run the production overlay entrypoint with controlled transport failures.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(process.argv[2] || path.join(__dirname,
  '../src/renderer/overlay/overlay.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
async function check(kind) {
  let changed, rendered = 0, partnerCallback, resolveReady;
  const anchor = { style: {}, innerHTML: '', querySelector: () => ({}) };
  const char = { style: {}, querySelector: () => anchor, addEventListener() {},
    appendChild() {}, classList: { add() {}, remove() {}, toggle() {} } };
  const cfg = { overlayPos: { x: .82, y: .72 }, overlayScale: 1,
    partnerCharacterId: 'char_ribbon', customCharacters: [] };
  const transport = {
    mode: 'firebase',
    ready: kind === 'pending' ? new Promise(r => { resolveReady = r; })
      : kind === 'rejected' ? Promise.reject(new Error('offline')) : Promise.resolve(),
    getPartnerCharacter: () => kind === 'lookup-pending' ? new Promise(() => {})
      : Promise.resolve(null),
    onSignal() {}, onPartnerCharacter(cb) { partnerCallback = cb; }
  };
  const context = { console: { error() {}, warn() {} },
    innerWidth: 1600, innerHeight: 900, addEventListener() {},
    document: { getElementById: () => char, createElement: () => ({addEventListener(){}}),
      addEventListener() {} },
    rwHost: { getConfig: async () => cfg, onConfigChanged(cb) { changed = cb; } },
    RW: { transport: { createTransport: () => transport },
      characters: { rigFor: () => ({}) },
      player: { create() { rendered++; return { destroy() {} }; } },
      actor: { create: () => ({ start() {}, stop() {} }) } } };
  context.window = context;
  vm.runInNewContext(source, context);
  await flush();
  assert.ok(rendered > 0, kind + ': local character rendered before network');
  assert.equal(typeof changed, 'function', kind + ': recovery subscribed');
  const before = char.style.left;
  await changed({ ...cfg, overlayPos: { x: .5, y: .6 } });
  assert.notEqual(char.style.left, before, kind + ': recenter changes position');
  if (resolveReady) { resolveReady(); await flush(); }
  if (kind !== 'rejected') {
    partnerCallback({ kind: 'preset', id: 'char_seal' });
    assert.equal(rendered, 2, kind + ': online partner replaces local character');
  }
  console.log('PASS ' + kind);
}
(async () => {
  for (const kind of ['pending', 'rejected', 'null-partner', 'lookup-pending']) await check(kind);
})().catch(e => { console.error(e); process.exitCode = 1; });
