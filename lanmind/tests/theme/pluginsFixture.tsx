import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '../../src/context/ThemeContext';
import { FeatureManagementPanel } from '../../src/components/settings/FeatureManagementPanel';
import { PluginPermissionRequests } from '../../src/plugins/PluginPermissionRequests';
import { AppRail } from '../../src/app/AppRail';
import { initializeFeatures } from '../../src/modules/state';
import { initializeLocale, setLocalePreference } from '../../src/i18n';
import { setPluginFilePickerForTests, setPluginTransportForTests, type InstalledPlugin, type MarketPackage, type PermissionRequest, type PluginSnapshot } from '../../src/plugins/client';
import '../../src/index.css';

async function start() {
  const params = new URLSearchParams(location.search);
  await initializeLocale(); await setLocalePreference(params.get('locale') === 'en-US' ? 'en-US' : 'zh-CN'); await initializeFeatures();
  const manifest = { schemaVersion: 2 as const, runtime: 'web' as const, id: 'hello', version: '1.0.0', name: { 'en-US': 'Hello Tools', 'zh-CN': 'Hello 工具' }, description: { 'en-US': 'A shared offline utility', 'zh-CN': '局域网共享的离线工具' }, defaultLocale: 'zh-CN', sdkVersion: 1, minHostVersion: '0.2.1', entry: 'index.html', capabilities: ['tasks.read', 'tasks.write'] as InstalledPlugin['manifest']['capabilities'], files: {} };
  const local: InstalledPlugin = { pluginKey: 'a'.repeat(64) + '/hello', publisherId: 'a'.repeat(64), manifest, metadata: { manifest: '', publicKey: 'fixture-public-key', signature: 'fixture-signature' }, sha256: '1'.repeat(64), sizeBytes: 1000, enabled: true, shared: true, available: true, installedAt: '2026-11-02T00:00:00Z' };
  const icon = params.has('unsafe-icon')
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" onload="window.__pluginIconExecuted=true"><script>window.__pluginIconExecuted=true</script><image href="${location.origin}/__plugin_icon_probe__"/><rect width="64" height="64" fill="#48866e"/></svg>`
    : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="#e7f1e9"/><g fill="#48866e"><rect x="13" y="13" width="17" height="17" rx="4"/><rect x="34" y="13" width="17" height="17" rx="4"/><rect x="13" y="34" width="17" height="17" rx="4"/></g><rect x="34" y="34" width="17" height="17" rx="4" fill="#b6ce93"/></svg>';
  local.iconDataUrl = params.has('external-icon') ? `${location.origin}/__plugin_icon_probe__` : params.has('no-icon') ? null : `data:image/svg+xml;base64,${btoa(params.has('bad-icon') ? 'not an image' : icon)}`;
  if (params.has('unsigned')) { local.pluginKey = 'unsigned/hello'; local.publisherId = 'unsigned'; local.metadata = { manifest: '', publicKey: '', signature: '' }; }
  const variant: MarketPackage = { ...local, manifest: { ...manifest, version: '1.1.0' }, sha256: '2'.repeat(64), compatible: true, sources: [{ nodeId: 'one', displayName: 'Node One', address: '192.168.1.10', port: 45995 }] };
  const second: MarketPackage = { ...variant, sources: [{ nodeId: 'two', displayName: 'Node Two', address: '192.168.1.11', port: 45995 }] };
  const conflicting = { ...variant, sha256: '3'.repeat(64) };
  const snapshot: PluginSnapshot = { installed: params.has('empty') ? [] : [local], sharing: true, jobs: [] };
  if (params.has('completed')) snapshot.jobs = [{ id: 'install-one', pluginKey: local.pluginKey, state: 'installed', received: 1000, total: 1000, source: null, error: null }];
  if (params.has('many')) snapshot.installed = Array.from({ length: 24 }, (_, index) => ({ ...local, pluginKey: `${local.publisherId}/hello-${index}`, manifest: { ...manifest, name: { 'en-US': `Tool ${index + 1}`, 'zh-CN': `工具 ${index + 1}` } } }));
  let locked = false;
  let openError = '';
  let openWait: Promise<void> | undefined;
  let permissions: PermissionRequest[] = [];
  let grants = ['tasks.read'];
  const calls: { action: string; payload: Record<string, unknown> }[] = [];
  setPluginFilePickerForTests(async () => '/downloads/block-breeze-main.zip');
  const emit = (event: string, value?: unknown) => window.dispatchEvent(new CustomEvent('lanmind:plugins-test', { detail: { event, value } }));
  Object.assign(window, {
    __pluginCalls: calls,
    __pluginInstall: () => { snapshot.installed = [local]; emit('plugins://changed'); },
    __pluginState: (patch: Partial<InstalledPlugin>) => { Object.assign(local, patch); emit('plugins://changed'); },
    __pluginLock: (value: boolean) => { locked = value; emit('app-lock://state', { locked }); },
    __pluginOpenError: (value: string) => { openError = value; },
    __pluginHoldOpen: () => { openWait = new Promise(resolve => { (window as any).__pluginReleaseOpen = () => { openWait = undefined; resolve(); }; }); },
    __pluginPermission: () => { permissions = [{ requestId: 'request-one', pluginKey: local.pluginKey, name: 'Hello Tools', workspaceId: 'workspace-a', workspaceName: 'Workspace A', userId: 'user-a', capabilities: ['tasks.read', 'tasks.write'], createdAt: '2026-11-02' }]; emit('plugins://permission-request'); },
    __pluginWorkspaceChanged: () => { permissions = []; grants = []; emit('workspace://changed'); },
    __pluginProgress: (state: string) => { const job = { id: 'install-one', pluginKey: local.pluginKey, state, received: 500, total: 1000, source: 'Node Two', error: state === 'failed' ? 'PLUGIN_NO_SOURCES' : null }; snapshot.jobs = [job as PluginSnapshot['jobs'][0]]; emit('plugins://progress', job); },
  });
  setPluginTransportForTests(async <T,>(action: string, payload: Record<string, unknown>) => {
    calls.push({ action, payload });
    let result: unknown = null;
    switch (action) {
      case 'list': if (locked) throw new Error('APP_LOCKED'); result = structuredClone(snapshot); break;
      case 'previewImport': result = { pluginKey: local.pluginKey, manifest, signed: !params.has('unsigned'), sha256: '4'.repeat(64), sizeBytes: 1000 }; break;
      case 'import': snapshot.installed = [local]; emit('plugins://changed'); result = { jobId: 'import-one' }; break;
      case 'market': result = params.has('empty') ? [] : params.has('conflict') ? [variant, second, conflicting] : [variant, second]; break;
      case 'sharing': snapshot.sharing = Boolean(payload.enabled); break;
      case 'flags': if (typeof payload.enabled === 'boolean') local.enabled = payload.enabled; if (typeof payload.shared === 'boolean') local.shared = payload.shared; emit('plugins://changed'); break;
      case 'open': if (openError) throw new Error(openError); await openWait; break;
      case 'install': snapshot.jobs = [{ id: 'install-one', pluginKey: local.pluginKey, state: 'downloading', received: 0, total: 1000, source: 'Node One', error: null }]; result = { jobId: 'install-one' }; break;
      case 'cancel': snapshot.jobs = snapshot.jobs.map(job => ({ ...job, state: 'cancelled' })); break;
      case 'uninstall': snapshot.installed = []; emit('plugins://changed'); break;
      case 'details': result = { grants, audit: [{ version: '1.0.0', action: 'grant', target: 'tasks.read', outcome: 'ok', createdAt: '2026-11-02T00:00:00Z' }], offset: 0 }; break;
      case 'revoke': grants = grants.filter(scope => scope !== payload.capability); break;
      case 'pendingPermissions': result = structuredClone(permissions); break;
      case 'permissionDecision': permissions = []; break;
    }
    return result as T;
  });
  createRoot(document.getElementById('root')!).render(<ThemeProvider><PluginPermissionRequests /><div className="flex h-screen bg-canvas text-main">{params.has('rail') && <AppRail activeSection="settings" onWork={() => {}} onAI={() => {}} onWiki={() => {}} onChat={() => {}} onTransfer={() => {}} onSettings={() => {}} />}<main className="min-w-0 flex-1 overflow-y-auto p-8"><div className="mx-auto max-w-4xl"><FeatureManagementPanel /></div></main></div></ThemeProvider>);
}
void start();
