import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('the SDK survives native initialization order, propagates errors and never retries a write', async () => {
  const events = new EventTarget();
  const document = new EventTarget();
  const colors = new Map();
  document.documentElement = { lang: '', style: { setProperty: (key, value) => colors.set(key, value) } };
  const window = { addEventListener: events.addEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events) };
  vm.runInNewContext(fs.readFileSync(new URL('../src-tauri/src/plugins/sdk.js', import.meta.url), 'utf8'), { window, document, CustomEvent });
  assert.equal(Object.isFrozen(window.LanMind.tasks), true);
  assert.equal(Object.getOwnPropertyDescriptor(window, 'LanMind').writable, false);
  const context = { workspaceId: 'one', locale: 'en-US', theme: { id: 'light', colors: { '--bg-canvas': '#fff' } } };
  const calls = [];
  // The SDK is injected before __TAURI_INTERNALS__ becomes available.
  const pendingContext = window.LanMind.context.get();
  window.__TAURI_INTERNALS__ = { invoke: async (command, payload) => {
    calls.push({ command, ...payload });
    if (payload.method === 'tasks.update') throw 'PLUGIN_VERSION_CONFLICT';
    return context;
  } };
  assert.equal(await pendingContext, context);
  await assert.rejects(window.LanMind.tasks.update({ taskId: 'task', expectedVersion: 1, patch: { title: 'Update' } }), error => error.code === 'PLUGIN_VERSION_CONFLICT');
  assert.equal(calls.filter(call => call.method === 'tasks.update').length, 1);
  const appearance = new Promise(resolve => events.addEventListener('lanmind:context', event => resolve(event.detail), { once: true }));
  document.dispatchEvent(new Event('DOMContentLoaded'));
  assert.equal(await appearance, context);
  assert.equal(document.documentElement.lang, 'en-US');
  assert.equal(document.documentElement.style.colorScheme, 'light');
  assert.equal(colors.get('--bg-canvas'), '#fff');
  assert.equal(new Set(calls.map(call => call.requestId)).size, calls.length);
  assert.ok(calls.every(call => call.command === 'plugin_bridge'));
});

test('plugin isolation removes WebRTC networking before plugin code can capture it', () => {
  const context = vm.createContext({ RTCPeerConnection: function PeerConnection() {} });
  vm.runInContext(fs.readFileSync(new URL('../src-tauri/src/plugins/isolation.js', import.meta.url), 'utf8'), context);
  assert.equal(vm.runInContext('typeof RTCPeerConnection', context), 'undefined');
  assert.equal(vm.runInContext('Reflect.set(globalThis, "RTCPeerConnection", () => {})', context), false);
  assert.equal(vm.runInContext('Reflect.deleteProperty(globalThis, "RTCPeerConnection")', context), false);
});
