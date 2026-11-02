// Injected before plugin scripts. Identity and authorization are always checked in Rust.
(() => {
  let sequence = 0;
  const call = (method, payload = {}) => Promise.resolve().then(() => window.__TAURI_INTERNALS__.invoke('plugin_bridge', {
    method, payload, requestId: globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${++sequence}-${Math.random().toString(36).slice(2)}`,
  }))
    .catch(cause => { const error = new Error(String(cause)); error.code = String(cause).split(':')[0]; throw error; });
  const apply = async () => {
    const context = await call('context.get');
    document.documentElement.lang = context.locale;
    document.documentElement.style.colorScheme = context.theme.id;
    for (const [key, value] of Object.entries(context.theme.colors)) document.documentElement.style.setProperty(key, value);
    window.dispatchEvent(new CustomEvent('lanmind:context', { detail: context }));
    return context;
  };
  const api = Object.freeze({
    version: 1,
    context: Object.freeze({ get: () => call('context.get') }),
    storage: Object.freeze({ get: key => call('storage.get', { key }), set: (key, value) => call('storage.set', { key, value }), delete: key => call('storage.delete', { key }) }),
    tasks: Object.freeze({ list: (args = {}) => call('tasks.list', args), get: taskId => call('tasks.get', { taskId }), create: args => call('tasks.create', args), update: args => call('tasks.update', args) }),
    projects: Object.freeze({ list: () => call('projects.list') }),
    states: Object.freeze({ list: () => call('states.list') }),
    wiki: Object.freeze({ list: (args = {}) => call('wiki.list', args), get: args => call('wiki.get', typeof args === 'string' ? { pageId: args } : args), create: args => call('wiki.create', args), update: args => call('wiki.update', args) }),
  });
  Object.defineProperty(window, 'LanMind', { value: api, writable: false, configurable: false });
  document.addEventListener('DOMContentLoaded', () => { void apply().catch(() => {}); }, { once: true });
  window.addEventListener('lanmind:appearance', () => { void apply().catch(() => {}); });
})();
