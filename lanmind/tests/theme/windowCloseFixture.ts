// Development-only IPC simulator. Preferences stay in browser test storage.
import { mockIPC } from '@tauri-apps/api/mocks';

export function configureWindowCloseFixture(params: URLSearchParams) {
  const controls = { commands: [] as { command: string; args: unknown }[], failReads: params.has('read-error'), failSaves: false };
  (window as any).__windowCloseFixture = controls;
  (window as any).isTauri = true;
  mockIPC((command, args) => {
    controls.commands.push({ command, args });
    switch (command) {
      case 'get_close_button_behavior':
        if (controls.failReads) throw new Error('无法读取本机配置');
        return localStorage.getItem('test-close-button-behavior') || 'tray';
      case 'set_close_button_behavior': {
        if (controls.failSaves) throw new Error('本机配置保存失败');
        const behavior = (args as { behavior: string }).behavior;
        localStorage.setItem('test-close-button-behavior', behavior);
        return behavior;
      }
      case 'get_app_lock_status':
        return { revision: 0, enabled: false, idleMinutes: 5, passwordConfigured: false, locked: false };
      case 'plugin:app|version': return '0.1.5';
      case 'plugin:autostart|is_enabled': return false;
      default: return null;
    }
  });
}
