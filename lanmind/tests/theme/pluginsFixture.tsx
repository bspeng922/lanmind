import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '../../src/context/ThemeContext';
import { FeatureManagementPanel } from '../../src/components/settings/FeatureManagementPanel';
import { PluginPermissionRequests } from '../../src/plugins/PluginPermissionRequests';
import { initializeFeatures } from '../../src/modules/state';
import { initializeLocale, setLocalePreference } from '../../src/i18n';
import { setPluginFilePickerForTests, setPluginTransportForTests, type InstalledPlugin, type MarketPackage, type PermissionRequest, type PluginSnapshot } from '../../src/plugins/client';
import '../../src/index.css';

async function start() {
  const params = new URLSearchParams(location.search);
  await initializeLocale(); await setLocalePreference(params.get('locale') === 'en-US' ? 'en-US' : 'zh-CN'); await initializeFeatures();
  const manifest = { schemaVersion: 2 as const, runtime: 'web' as const, id: 'hello', version: '1.0.0', name: { 'en-US': 'Hello Tools', 'zh-CN': 'Hello 工具' }, description: { 'en-US': 'A shared offline utility', 'zh-CN': '局域网共享的离线工具' }, defaultLocale: 'zh-CN', sdkVersion: 1, minHostVersion: '0.2.1', entry: 'index.html', capabilities: ['tasks.read', 'tasks.write'] as InstalledPlugin['manifest']['capabilities'], files: {} };
  const local: InstalledPlugin = { pluginKey: 'a'.repeat(64) + '/hello', publisherId: 'a'.repeat(64), manifest, metadata: { manifest: '', publicKey: 'fixture-public-key', signature: 'fixture-signature' }, sha256: '1'.repeat(64), sizeBytes: 1000, enabled: true, shared: true, available: true, installedAt: '2026-11-02T00:00:00Z' };
  if (params.has('unsigned')) { local.pluginKey = 'unsigned/hello'; local.publisherId = 'unsigned'; local.metadata = { manifest: '', publicKey: '', signature: '' }; }
  const variant: MarketPackage = { ...local, manifest: { ...manifest, version: '1.1.0' }, sha256: '2'.repeat(64), compatible: true, sources: [{ nodeId: 'one', displayName: 'Node One', address: '192.168.1.10', port: 45995 }] };
  const second: MarketPackage = { ...variant, sources: [{ nodeId: 'two', displayName: 'Node Two', address: '192.168.1.11', port: 45995 }] };
  const conflicting = { ...variant, sha256: '3'.repeat(64) };
  const snapshot: PluginSnapshot = { installed: params.has('empty') ? [] : [local], sharing: true, jobs: [] };
  let permissions: PermissionRequest[] = [];
  let grants = ['tasks.read'];
  const calls: { action: string; payload: Record<string, unknown> }[] = [];
  setPluginFilePickerForTests(async () => '/downloads/block-breeze-main.zip');
  const emit = (event: string, value?: unknown) => window.dispatchEvent(new CustomEvent('lanmind:plugins-test', { detail: { event, value } }));
  Object.assign(window, {
    __pluginCalls: calls,
    __pluginPermission: () => { permissions = [{ requestId: 'request-one', pluginKey: local.pluginKey, name: 'Hello Tools', workspaceId: 'workspace-a', workspaceName: 'Workspace A', userId: 'user-a', capabilities: ['tasks.read', 'tasks.write'], createdAt: '2026-11-02' }]; emit('plugins://permission-request'); },
    __pluginWorkspaceChanged: () => { permissions = []; grants = []; emit('workspace://changed'); },
    __pluginProgress: (state: string) => { const job = { id: 'install-one', pluginKey: local.pluginKey, state, received: 500, total: 1000, source: 'Node Two', error: state === 'failed' ? 'PLUGIN_NO_SOURCES' : null }; snapshot.jobs = [job as PluginSnapshot['jobs'][0]]; emit('plugins://progress', job); },
  });
  setPluginTransportForTests(async <T,>(action: string, payload: Record<string, unknown>) => {
    calls.push({ action, payload });
    let result: unknown = null;
    switch (action) {
      case 'list': result = structuredClone(snapshot); break;
      case 'previewImport': result = { pluginKey: local.pluginKey, manifest, signed: !params.has('unsigned'), sha256: '4'.repeat(64), sizeBytes: 1000 }; break;
      case 'import': result = { jobId: 'import-one' }; break;
      case 'market': result = params.has('empty') ? [] : params.has('conflict') ? [variant, second, conflicting] : [variant, second]; break;
      case 'sharing': snapshot.sharing = Boolean(payload.enabled); break;
      case 'flags': if (typeof payload.enabled === 'boolean') local.enabled = payload.enabled; if (typeof payload.shared === 'boolean') local.shared = payload.shared; break;
      case 'install': snapshot.jobs = [{ id: 'install-one', pluginKey: local.pluginKey, state: 'downloading', received: 0, total: 1000, source: 'Node One', error: null }]; result = { jobId: 'install-one' }; break;
      case 'cancel': snapshot.jobs = snapshot.jobs.map(job => ({ ...job, state: 'cancelled' })); break;
      case 'uninstall': snapshot.installed = []; break;
      case 'details': result = { grants, audit: [{ version: '1.0.0', action: 'grant', target: 'tasks.read', outcome: 'ok', createdAt: '2026-11-02T00:00:00Z' }], offset: 0 }; break;
      case 'revoke': grants = grants.filter(scope => scope !== payload.capability); break;
      case 'pendingPermissions': result = structuredClone(permissions); break;
      case 'permissionDecision': permissions = []; break;
    }
    return result as T;
  });
  createRoot(document.getElementById('root')!).render(<ThemeProvider><PluginPermissionRequests /><main className="h-screen overflow-y-auto bg-canvas p-8 text-main"><div className="mx-auto max-w-4xl"><FeatureManagementPanel /></div></main></ThemeProvider>);
}
void start();
