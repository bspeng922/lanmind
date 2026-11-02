import React, { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { ShieldCheck } from 'lucide-react';
import { currentLocale, tr, useLocale } from '../i18n';
import { useTheme } from '../context/ThemeContext';
import { pluginAppearance, pluginCall, pluginError, subscribePlugins, type PermissionRequest } from './client';
import { PluginDialog } from './PluginDialog';

/** Mounted in the trusted main application, independent of whether settings is open. */
export function PluginPermissionRequests() {
  useLocale(); const { currentTheme } = useTheme(); const locale = currentLocale();
  const [requests, setRequests] = useState<PermissionRequest[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const mounted = useRef(false); const generation = useRef(0);
  const refresh = useCallback(async () => {
    const attempt = ++generation.current;
    try { const next = await pluginCall<PermissionRequest[]>('pendingPermissions'); if (mounted.current && generation.current === attempt) setRequests(next); }
    catch { if (mounted.current && generation.current === attempt) setRequests([]); }
  }, []);
  useEffect(() => {
    mounted.current = true; let stop: (() => void) | undefined;
    void subscribePlugins(event => { if (['plugins://permission-request', 'workspace://changed', 'app-lock://state'].includes(event)) void refresh(); }).then(unlisten => { if (mounted.current) { stop = unlisten; void refresh(); } else unlisten(); }).catch(() => { if (mounted.current) setRequests([]); });
    return () => { mounted.current = false; ++generation.current; stop?.(); };
  }, [refresh]);
  useEffect(() => {
    if (!isTauri()) return;
    const frame = requestAnimationFrame(() => { void pluginCall('appearance', { theme: pluginAppearance(), locale }).catch(() => {}); });
    return () => cancelAnimationFrame(frame);
  }, [currentTheme.id, locale]);
  const request = requests[0];
  const decide = async (allow: boolean) => {
    if (!request || busy) return;
    setBusy(true); setError('');
    try { await pluginCall('permissionDecision', { requestId: request.requestId, allow }); await refresh(); }
    catch (cause) { if (mounted.current) setError(pluginError(cause)); await refresh(); }
    finally { if (mounted.current) setBusy(false); }
  };
  if (!request) return null;
  return <PluginDialog title={tr('settings:pluginCenter.permissionTitle')} onClose={() => { if (!busy) void decide(false); }}>
    <ShieldCheck className="h-7 w-7 text-info" aria-hidden="true" />
    <p className="text-sm leading-6">{tr('settings:pluginCenter.permissionRequest', { name: request.name, workspace: request.workspaceName })}</p>
    <p className="text-xs text-sub">{tr('settings:pluginCenter.signed')}</p>
    <p className="select-text break-all font-mono text-xs text-quiet">{request.pluginKey}</p>
    <ul className="space-y-2 rounded-lg border border-edge bg-card p-4 text-sm">{request.capabilities.map(capability => <li key={capability}>{tr(`settings:pluginCenter.capabilities.${capability}`)}</li>)}</ul>
    <p className="text-xs leading-5 text-sub">{tr('settings:pluginCenter.permissionUserScope')}</p>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <div className="flex justify-end gap-2">
      <button type="button" disabled={busy} className="ui-cancel-button rounded-lg px-4 py-2 text-sm" onClick={() => void decide(false)}>{tr('settings:pluginCenter.deny')}</button>
      <button type="button" disabled={busy} className="theme-btn-primary rounded-lg px-4 py-2 text-sm" onClick={() => void decide(true)}>{tr('settings:pluginCenter.allow')}</button>
    </div>
  </PluginDialog>;
}
