import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { tr } from '../i18n';

export type PluginCapability = 'tasks.read' | 'tasks.write' | 'wiki.read' | 'wiki.write';
export interface PluginManifest {
  schemaVersion: 2; runtime: 'web'; id: string; version: string;
  name: Record<string, string>; description: Record<string, string>; defaultLocale: string;
  minHostVersion: string; sdkVersion: number; entry: string; capabilities: PluginCapability[]; files: Record<string, string>;
}
export interface SignedMetadata { manifest: string; publicKey: string; signature: string }
export interface InstalledPlugin {
  pluginKey: string; publisherId: string; manifest: PluginManifest; metadata: SignedMetadata;
  sha256: string; sizeBytes: number; enabled: boolean; shared: boolean; available: boolean; installedAt: string;
}
export interface PluginSource { nodeId: string; displayName: string; address: string; port: number }
export interface MarketPackage {
  pluginKey: string; publisherId: string; manifest: PluginManifest; metadata: SignedMetadata;
  sha256: string; sizeBytes: number; compatible: boolean; sources: PluginSource[];
}
export interface PluginJob {
  id: string; pluginKey: string; state: 'queued' | 'downloading' | 'verifying' | 'installing' | 'installed' | 'failed' | 'cancelled';
  received: number; total: number; source: string | null; error: string | null;
}
export interface PluginSnapshot { installed: InstalledPlugin[]; sharing: boolean; jobs: PluginJob[] }
export interface PermissionRequest {
  requestId: string; pluginKey: string; name: string; workspaceId: string; workspaceName: string; userId: string;
  capabilities: PluginCapability[]; createdAt: string;
}
export interface PluginAudit { version: string; action: string; target: string | null; outcome: string; createdAt: string }
export interface PluginDetails { grants: PluginCapability[]; audit: PluginAudit[]; offset: number }
type Transport = <T>(action: string, payload: Record<string, unknown>) => Promise<T>;
let testTransport: Transport | undefined;
/** Fixtures explicitly inject a transport; browser previews never pretend to install packages. */
export function setPluginTransportForTests(transport?: Transport) { testTransport = transport; }
export async function pluginCall<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (testTransport) return testTransport<T>(action, payload);
  if (isTauri()) return invoke<T>('plugin_api', { action, payload });
  if (action === 'list') return { installed: [], sharing: true, jobs: [] } as T;
  if (action === 'market' || action === 'pendingPermissions') return [] as T;
  throw new Error('PLUGIN_DESKTOP_ONLY');
}
export async function subscribePlugins(callback: (event: string, value?: unknown) => void): Promise<() => void> {
  const browserListener = (event: Event) => { const e = event as CustomEvent<{ event: string; value?: unknown }>; callback(e.detail.event, e.detail.value); };
  window.addEventListener('lanmind:plugins-test', browserListener);
  const unlisten: (() => void)[] = [];
  try {
    if (isTauri()) for (const event of ['plugins://changed', 'plugins://progress', 'plugins://permission-request', 'presence://changed', 'workspace://changed', 'app-lock://state']) {
      unlisten.push(await listen(event, value => callback(event, value.payload)));
    }
  } catch (cause) {
    unlisten.forEach(fn => fn()); window.removeEventListener('lanmind:plugins-test', browserListener); throw cause;
  }
  return () => { unlisten.forEach(fn => fn()); window.removeEventListener('lanmind:plugins-test', browserListener); };
}
export function pluginText(manifest: PluginManifest, field: 'name' | 'description', locale: string): string {
  return manifest[field][locale] ?? manifest[field][manifest.defaultLocale] ?? manifest.id;
}
export function activeJob(job: PluginJob): boolean { return !['installed', 'failed', 'cancelled'].includes(job.state); }
export function pluginError(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause);
  const code = raw.split(':')[0];
  const known = ['PLUGIN_SIGNATURE', 'PLUGIN_INVALID_PACKAGE', 'PLUGIN_HASH', 'PLUGIN_INCOMPATIBLE', 'PLUGIN_DOWNGRADE',
    'PLUGIN_VERSION_COLLISION', 'PLUGIN_NO_SOURCES', 'PLUGIN_BUSY', 'PLUGIN_IO', 'PLUGIN_CANCELLED', 'PLUGIN_DESKTOP_ONLY',
    'PLUGIN_PERMISSION_DENIED', 'PLUGIN_SESSION', 'PLUGIN_PACKAGE_TOO_LARGE', 'APP_LOCKED'];
  return tr(`settings:pluginCenter.errors.${known.includes(code) ? code : 'unknown'}`);
}
export function pluginAppearance(): Record<string, unknown> {
  const style = getComputedStyle(document.documentElement);
  const colors = Object.fromEntries(['--bg-canvas', '--bg-surface', '--bg-card', '--text-main', '--text-sub', '--text-quiet', '--border-main', '--accent'].map(key => [key, style.getPropertyValue(key).trim()]));
  return { id: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark', colors };
}
