import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, ExternalLink, Info, Loader2, Puzzle, RefreshCw, Search, ShieldAlert, ShieldCheck, Upload, Wifi } from 'lucide-react';
import { currentLocale, tr, useLocale } from '../i18n';
import { activeJob, packageSigned, pickPluginPackage, pluginAppearance, pluginCall, pluginError, pluginText, subscribePlugins,
  type InstalledPlugin, type MarketPackage, type PluginDetails, type PluginImportPreview, type PluginJob, type PluginManifest, type PluginSnapshot, type SignedMetadata } from './client';
import { comparePluginVersions, groupPluginCatalog, type PluginGroup } from './catalog';
import { PluginDialog } from './PluginDialog';
import { PluginIcon } from './PluginIcon';

const button = 'ui-cancel-button inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50';
const primary = 'theme-btn-primary inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50';
const bytes = (value: number) => `${(value / (1024 * 1024)).toFixed(2)} MB`;
function Switch({ checked, label, disabled, onChange }: { checked: boolean; label: string; disabled?: boolean; onChange: () => void }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onChange}
    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-accent' : 'border border-edge bg-hover'}`}>
    <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
  </button>;
}
function Badge({ children }: { children: React.ReactNode }) { return <span className="inline-flex items-center gap-1 rounded-md border border-edge bg-hover px-2 py-0.5 text-[11px] text-sub">{children}</span>; }
function SignatureStatus({ metadata }: { metadata: SignedMetadata }) {
  return <span className="inline-flex items-center gap-1 text-xs text-sub">{packageSigned(metadata) ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />}{tr(`settings:pluginCenter.${packageSigned(metadata) ? 'signed' : 'unsigned'}`)}</span>;
}
function Empty({ title, hint }: { title: string; hint?: string }) { return <div className="rounded-xl border border-dashed border-edge px-6 py-9 text-center"><Puzzle className="mx-auto mb-3 h-6 w-6 text-quiet" /><p className="text-sm font-medium text-main">{title}</p>{hint && <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-sub">{hint}</p>}</div>; }

export function PluginCenter({ children }: { children: React.ReactNode }) {
  useLocale(); const locale = currentLocale();
  const [tab, setTab] = useState<'installed' | 'market'>('installed'); const [query, setQuery] = useState('');
  const [snapshot, setSnapshot] = useState<PluginSnapshot>({ installed: [], sharing: true, jobs: [] });
  const [packages, setPackages] = useState<MarketPackage[]>([]); const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState(false); const [error, setError] = useState('');
  const [detail, setDetail] = useState<{ pluginKey: string; manifest: PluginManifest; publisherId: string } | null>(null);
  const [uninstalling, setUninstalling] = useState<InstalledPlugin | null>(null); const [clearData, setClearData] = useState(false);
  const [unsignedRequest, setUnsignedRequest] = useState<(PluginImportPreview & { path?: string }) | null>(null);
  const [recentSuccesses, setRecentSuccesses] = useState<string[]>([]);
  const successTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const mounted = useRef(false); const currentTab = useRef(tab); currentTab.current = tab;
  const marketRequest = useRef(0); const listRequest = useRef(0);
  const marketInFlight = useRef(false);
  const refreshList = useCallback(async () => {
    const id = ++listRequest.current; const next = await pluginCall<PluginSnapshot>('list');
    if (mounted.current && listRequest.current === id) setSnapshot(next);
  }, []);
  const refreshMarket = useCallback(async () => {
    if (marketInFlight.current) return;
    marketInFlight.current = true;
    const id = ++marketRequest.current; if (mounted.current) setRefreshing(true);
    try { const next = await pluginCall<MarketPackage[]>('market'); if (mounted.current && marketRequest.current === id) setPackages(next); }
    catch (cause) { if (mounted.current && marketRequest.current === id) setError(pluginError(cause)); }
    finally { marketInFlight.current = false; if (mounted.current && marketRequest.current === id) setRefreshing(false); }
  }, []);
  useEffect(() => {
    mounted.current = true; let stop: (() => void) | undefined; let presenceTimer: ReturnType<typeof setTimeout> | undefined;
    void subscribePlugins((event, payload) => {
      if (!mounted.current) return;
      if (event === 'plugins://progress') {
        const job = payload as PluginJob;
        setSnapshot(previous => ({ ...previous, jobs: [...previous.jobs.filter(item => item.id !== job.id), job] }));
        if (job.state === 'installed' && !successTimers.current.has(job.id)) {
          setRecentSuccesses(previous => [...previous, job.id]);
          successTimers.current.set(job.id, setTimeout(() => {
            successTimers.current.delete(job.id);
            if (mounted.current) setRecentSuccesses(previous => previous.filter(id => id !== job.id));
          }, 5000));
        }
        if (!activeJob(job)) void refreshList().catch(() => {});
      } else if (event === 'plugins://changed') void refreshList().catch(() => {});
      else if (event === 'plugins://permission-request') { setDetail(null); setUninstalling(null); setUnsignedRequest(null); }
      else if (event === 'workspace://changed' || event === 'app-lock://state') { setDetail(null); setUnsignedRequest(null); }
      else if (event === 'presence://changed' && currentTab.current === 'market') {
        clearTimeout(presenceTimer); presenceTimer = setTimeout(() => { void refreshMarket(); }, 500);
      }
    }).then(unlisten => { if (mounted.current) { stop = unlisten; void refreshList().catch(cause => setError(pluginError(cause))); } else unlisten(); }).catch(cause => { if (mounted.current) setError(pluginError(cause)); });
    return () => { mounted.current = false; ++listRequest.current; ++marketRequest.current; stop?.(); clearTimeout(presenceTimer); successTimers.current.forEach(clearTimeout); successTimers.current.clear(); };
  }, [refreshList, refreshMarket]);
  useEffect(() => {
    if (tab !== 'market') return;
    void refreshMarket();
    const interval = setInterval(() => { if (document.visibilityState === 'visible') void refreshMarket(); }, 30_000);
    const visible = () => { if (document.visibilityState === 'visible') void refreshMarket(); };
    document.addEventListener('visibilitychange', visible);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', visible); };
  }, [tab, refreshMarket]);
  const perform = async (action: string, payload: Record<string, unknown> = {}): Promise<boolean> => {
    if (pending) return false;
    setPending(true); setError('');
    try { await pluginCall(action, payload); await refreshList(); return true; }
    catch (cause) { if (mounted.current) setError(pluginError(cause)); return false; }
    finally { if (mounted.current) setPending(false); }
  };
  const importPackage = async () => {
    if (pending) return;
    setPending(true); setError('');
    try {
      const path = await pickPluginPackage();
      if (!path) return;
      const preview = await pluginCall<PluginImportPreview>('previewImport', { path });
      if (!mounted.current) return;
      if (!preview.signed) setUnsignedRequest({ ...preview, path });
      else { await pluginCall('import', { path, expectedSha256: preview.sha256 }); await refreshList(); }
    } catch (cause) { if (mounted.current) setError(pluginError(cause)); }
    finally { if (mounted.current) setPending(false); }
  };
  const groups = useMemo(() => groupPluginCatalog(packages, snapshot.installed), [packages, snapshot.installed]);
  const matches = (m: PluginManifest, publisher: string) => `${pluginText(m, 'name', locale)} ${pluginText(m, 'description', locale)} ${m.id} ${publisher}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const visible = groups.filter(group => matches(group.variants[0].manifest, group.variants[0].publisherId));
  const busy = pending || snapshot.jobs.some(activeJob);
  const showDetail = (item: { pluginKey: string; manifest: PluginManifest; publisherId: string }) => setDetail({ pluginKey: item.pluginKey, manifest: item.manifest, publisherId: item.publisherId });
  const install = (variant: MarketPackage) => {
    if (!packageSigned(variant.metadata)) {
      setDetail(null); setError(''); setUnsignedRequest({ ...variant, signed: false });
      return Promise.resolve(false);
    }
    return perform('install', { pluginKey: variant.pluginKey, sha256: variant.sha256 });
  };
  const confirmUnsigned = async () => {
    if (!unsignedRequest) return;
    const item = unsignedRequest;
    const ok = await (item.path
      ? perform('import', { path: item.path, expectedSha256: item.sha256, allowUnsigned: true })
      : perform('install', { pluginKey: item.pluginKey, sha256: item.sha256, allowUnsigned: true }));
    if (ok) setUnsignedRequest(null);
  };
  return <div className="space-y-5" data-plugin-center>
    <section aria-label={tr('settings:pluginCenter.sharing')} className="flex items-center justify-between gap-4 rounded-xl border border-edge bg-card p-4">
      <div><h3 className="flex items-center gap-2 text-sm font-medium"><Wifi className="h-4 w-4 text-sub" />{tr('settings:pluginCenter.sharing')}</h3><p className="mt-1 max-w-xl text-xs leading-5 text-sub">{tr('settings:pluginCenter.sharingHint')}</p></div>
      <Switch checked={snapshot.sharing} label={tr('settings:pluginCenter.sharing')} disabled={pending} onChange={() => void perform('sharing', { enabled: !snapshot.sharing })} />
    </section>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge pb-3">
      <div role="tablist" aria-label={tr('settings:features.title')} className="flex gap-1 rounded-lg border border-edge bg-card p-1">
        {(['installed', 'market'] as const).map(value => <button type="button" key={value} role="tab" aria-selected={tab === value} aria-controls={`plugin-tab-${value}`} id={`plugin-tab-button-${value}`} onClick={() => { setTab(value); setQuery(''); }} className={`rounded-md px-3 py-1.5 text-xs font-medium ${tab === value ? 'bg-hover text-main' : 'text-sub hover:text-main'}`}>{tr(`settings:pluginCenter.${value}`)}</button>)}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className={button} disabled={busy} onClick={() => void importPackage()}><Upload className="h-3.5 w-3.5" />{tr('settings:pluginCenter.import')}</button>
        {tab === 'market' && <button type="button" className={button} disabled={refreshing} onClick={() => void refreshMarket()}><RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'motion-safe:animate-spin' : ''}`} />{tr('settings:pluginCenter.refresh')}</button>}
      </div>
    </div>
    {error && <p role="alert" className="rounded-lg border border-edge bg-card p-3 text-sm text-danger">{error}</p>}
    <div aria-live="polite" className="space-y-2">{snapshot.jobs.filter(job => job.state !== 'installed' || recentSuccesses.includes(job.id)).slice(-3).reverse().map(job => <div key={job.id} data-plugin-job={job.id} className="rounded-lg border border-edge bg-card p-3">
      <div className="flex items-center justify-between gap-3 text-xs"><span className="flex items-center gap-2">{activeJob(job) && <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />}{tr(`settings:pluginCenter.jobs.${job.state}`)}{job.source && <span className="text-quiet">· {job.source}</span>}</span>{activeJob(job) && <button type="button" className="text-sub hover:text-main" onClick={() => void perform('cancel', { jobId: job.id })}>{tr('settings:pluginCenter.cancel')}</button>}</div>
      {activeJob(job) && <div role="progressbar" aria-label={tr(`settings:pluginCenter.jobs.${job.state}`)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.total ? Math.min(100, Math.round(job.received / job.total * 100)) : 0} className="mt-2 h-1.5 overflow-hidden rounded-full bg-hover"><div className="h-full bg-accent" style={{ width: `${job.total ? Math.min(100, job.received / job.total * 100) : 0}%` }} /></div>}
      {job.error && job.state === 'failed' && <p className="mt-2 text-xs text-danger">{pluginError(job.error)}</p>}
    </div>)}</div>
    {tab === 'installed' ? <div id="plugin-tab-installed" role="tabpanel" aria-labelledby="plugin-tab-button-installed" className="space-y-6">
      {children}
      <section className="space-y-3"><h3 className="flex items-center gap-2 text-sm font-semibold"><Puzzle className="h-4 w-4" />{tr('settings:pluginCenter.installedPlugins')}</h3>
        {!snapshot.installed.length && <Empty title={tr('settings:pluginCenter.emptyInstalled')} hint={tr('settings:pluginCenter.emptyInstalledHint')} />}
        {snapshot.installed.map(item => {
          const name = pluginText(item.manifest, 'name', locale);
          const update = groups.find(g => g.pluginKey === item.pluginKey)?.recommended;
          return <article key={item.pluginKey} data-plugin-key={item.pluginKey} className="space-y-3 rounded-xl border border-edge bg-card p-4">
            <div className="flex items-start gap-3"><PluginIcon source={item.iconDataUrl} /><div className="min-w-0 flex-1"><p className="flex flex-wrap items-center gap-2 text-sm font-semibold">{name}<span className="font-normal text-quiet">v{item.manifest.version}</span></p><p className="mt-1 text-xs leading-5 text-sub">{pluginText(item.manifest, 'description', locale)}</p></div><Switch checked={item.enabled} label={tr('settings:pluginCenter.enable', { name })} disabled={busy || !item.available} onChange={() => void perform('flags', { pluginKey: item.pluginKey, enabled: !item.enabled })} /></div>
            <div className="flex flex-wrap gap-2"><Badge><SignatureStatus metadata={item.metadata} /></Badge><Badge>{bytes(item.sizeBytes)}</Badge></div>
            {!item.available && <p role="alert" className="text-xs text-danger">{tr('settings:pluginCenter.unavailable')}</p>}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-edge pt-3"><div className="flex items-center gap-2"><Switch checked={item.shared} label={`${tr('settings:pluginCenter.sharePlugin')} ${name}`} disabled={busy || !item.available} onChange={() => void perform('flags', { pluginKey: item.pluginKey, shared: !item.shared })} /><span className="text-xs text-sub">{tr('settings:pluginCenter.sharePlugin')}</span></div>
              <div className="flex flex-wrap gap-2"><button type="button" className={button} onClick={() => showDetail(item)}>{tr('settings:pluginCenter.details')}</button><button type="button" className={button} disabled={busy} onClick={() => { setClearData(false); setUninstalling(item); }}>{tr('settings:pluginCenter.uninstall')}</button>{update && comparePluginVersions(update.manifest.version, item.manifest.version) > 0 && <button type="button" className={button} disabled={busy} onClick={() => void install(update)}>{tr('settings:pluginCenter.update')}</button>}<button type="button" className={primary} disabled={busy || !item.enabled || !item.available} onClick={() => void perform('open', { pluginKey: item.pluginKey, theme: pluginAppearance(), locale })}><ExternalLink className="h-3.5 w-3.5" />{tr('settings:pluginCenter.open')}</button></div>
            </div>
            {item.shared && !snapshot.sharing && <p className="text-xs leading-5 text-quiet">{tr('settings:pluginCenter.sharingOffHint')}</p>}
          </article>;
        })}
      </section>
    </div> : <div id="plugin-tab-market" role="tabpanel" aria-labelledby="plugin-tab-button-market" className="space-y-4" aria-busy={refreshing}>
      <p className="text-xs leading-5 text-sub">{tr('settings:pluginCenter.marketHint')}</p>
      <label className="flex items-center gap-2 rounded-lg border border-edge bg-card px-3 py-2 text-sub"><Search className="h-4 w-4" /><input type="search" value={query} onChange={event => setQuery(event.target.value)} aria-label={tr('settings:pluginCenter.search')} placeholder={tr('settings:pluginCenter.search')} className="min-w-0 flex-1 bg-transparent text-sm text-main outline-none placeholder:text-quiet" /></label>
      {!visible.length && !refreshing && <Empty title={tr(query ? 'settings:pluginCenter.noMatches' : 'settings:pluginCenter.emptyMarket')} hint={!query ? tr('settings:pluginCenter.emptyMarketHint') : undefined} />}
      {visible.map(group => {
        const variant = group.recommended ?? group.variants[0]; const local = snapshot.installed.find(p => p.pluginKey === group.pluginKey);
        const already = local?.available && local.sha256 === variant.sha256; const downgrade = local && comparePluginVersions(local.manifest.version, variant.manifest.version) > 0;
        return <article key={group.pluginKey} data-plugin-key={group.pluginKey} className="space-y-3 rounded-xl border border-edge bg-card p-4">
          <div className="flex items-start gap-3"><PluginIcon source={local?.iconDataUrl} /><div className="min-w-0 flex-1"><p className="flex flex-wrap items-center gap-2 text-sm font-semibold">{pluginText(variant.manifest, 'name', locale)}<Badge><Wifi className="h-3 w-3" />{tr('settings:pluginCenter.lan')}</Badge></p><p className="mt-1 text-xs leading-5 text-sub">{pluginText(variant.manifest, 'description', locale)}</p></div><button type="button" className="shrink-0 rounded p-1 text-sub hover:bg-hover" aria-label={`${tr('settings:pluginCenter.details')} ${pluginText(variant.manifest, 'name', locale)}`} onClick={() => showDetail(variant)}><Info className="h-4 w-4" /></button></div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-quiet"><span>v{variant.manifest.version}</span><span>{bytes(variant.sizeBytes)}</span><span>{tr('settings:pluginCenter.sources', { count: variant.sources.length })}</span></div>
          <p className="select-text break-all font-mono text-[10px] text-quiet">{variant.publisherId}</p>
          <div className="flex flex-wrap items-center justify-between gap-3"><SignatureStatus metadata={variant.metadata} />{group.recommended ? <button type="button" className={primary} disabled={busy || already || Boolean(downgrade)} onClick={() => void install(variant)}><Download className="h-3.5 w-3.5" />{tr(already ? 'settings:pluginCenter.installedStatus' : local ? 'settings:pluginCenter.update' : 'settings:pluginCenter.install')}</button> : <button type="button" className={button} onClick={() => showDetail(variant)}>{tr('settings:pluginCenter.viewVersions')}</button>}</div>
        </article>;
      })}
    </div>}
    {detail && <PluginDetail item={detail} group={groups.find(g => g.pluginKey === detail.pluginKey)} local={snapshot.installed.find(p => p.pluginKey === detail.pluginKey)} busy={busy} operationError={error} onClose={() => setDetail(null)} install={install} perform={perform} />}
    {unsignedRequest && <PluginDialog title={tr('settings:pluginCenter.unsignedTitle')} onClose={() => { if (!pending) setUnsignedRequest(null); }}>
      <p role="alert" className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm leading-6"><ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />{tr('settings:pluginCenter.unsignedHint')}</p>
      <div><h3 className="text-sm font-semibold">{pluginText(unsignedRequest.manifest, 'name', locale)} <span className="font-normal text-quiet">v{unsignedRequest.manifest.version}</span></h3><p className="mt-2 text-sm leading-6 text-sub">{pluginText(unsignedRequest.manifest, 'description', locale)}</p></div>
      {snapshot.installed.some(p => p.pluginKey === unsignedRequest.pluginKey && p.sha256 !== unsignedRequest.sha256) && <p className="text-sm leading-6 text-sub">{tr('settings:pluginCenter.unsignedReplace')}</p>}
      <section className="space-y-2"><h3 className="text-sm font-medium">{tr('settings:pluginCenter.permissions')}</h3>{unsignedRequest.manifest.capabilities.length ? <ul className="space-y-1 text-sm text-sub">{unsignedRequest.manifest.capabilities.map(capability => <li key={capability}>{tr(`settings:pluginCenter.capabilities.${capability}`)}</li>)}</ul> : <p className="text-sm text-sub">{tr('settings:pluginCenter.noPermissions')}</p>}<p className="text-xs leading-5 text-sub">{tr('settings:pluginCenter.permissionScope')}</p></section>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" className={button} disabled={pending} onClick={() => setUnsignedRequest(null)}>{tr('settings:pluginCenter.cancel')}</button><button type="button" className={primary} disabled={pending} onClick={() => void confirmUnsigned()}>{tr('settings:pluginCenter.unsignedInstall')}</button></div>
    </PluginDialog>}
    {uninstalling && <PluginDialog title={tr('settings:pluginCenter.uninstallTitle', { name: pluginText(uninstalling.manifest, 'name', locale) })} onClose={() => { if (!pending) setUninstalling(null); }}>
      <p className="text-sm leading-6 text-sub">{tr('settings:pluginCenter.uninstallHint')}</p><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={clearData} onChange={event => setClearData(event.target.checked)} className="mt-1" />{tr('settings:pluginCenter.clearData')}</label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" className={button} disabled={pending} onClick={() => setUninstalling(null)}>{tr('settings:pluginCenter.cancel')}</button><button type="button" className={primary} disabled={busy} onClick={async () => { if (await perform('uninstall', { pluginKey: uninstalling.pluginKey, clearData })) setUninstalling(null); }}>{tr('settings:pluginCenter.uninstall')}</button></div>
    </PluginDialog>}
  </div>;
}

function PluginDetail({ item, group, local, busy, operationError, onClose, install, perform }: {
  item: { pluginKey: string; manifest: PluginManifest; publisherId: string }; group?: PluginGroup; local?: InstalledPlugin; busy: boolean; operationError: string; onClose: () => void;
  install: (variant: MarketPackage) => Promise<boolean>; perform: (action: string, payload?: Record<string, unknown>) => Promise<boolean>;
}) {
  useLocale(); const locale = currentLocale();
  const [selection, setSelection] = useState(group?.recommended?.sha256 ?? group?.variants[0]?.sha256);
  useEffect(() => { setSelection(previous => group?.variants.some(item => item.sha256 === previous) ? previous : group?.recommended?.sha256 ?? group?.variants[0]?.sha256); }, [group]);
  const variant = group?.variants.find(v => v.sha256 === selection); const manifest = variant?.manifest ?? local?.manifest ?? item.manifest;
  const [details, setDetails] = useState<PluginDetails>({ grants: [], audit: [], offset: 0 }); const [error, setError] = useState('');
  const [loading, setLoading] = useState(false); const [more, setMore] = useState(false); const generation = useRef(0);
  const load = useCallback(async (offset = 0) => {
    if (!local) return;
    const id = ++generation.current; setLoading(true);
    try { const result = await pluginCall<PluginDetails>('details', { pluginKey: item.pluginKey, offset }); if (generation.current === id) { setDetails(previous => ({ ...result, audit: offset ? [...previous.audit, ...result.audit] : result.audit })); setMore(result.audit.length === 50); } }
    catch (cause) { if (generation.current === id) setError(pluginError(cause)); }
    finally { if (generation.current === id) setLoading(false); }
  }, [item.pluginKey, local?.sha256]);
  useEffect(() => { void load(); return () => { ++generation.current; }; }, [load]);
  const conflict = Boolean(group?.conflicts.has(manifest.version));
  const already = local?.available && local.sha256 === variant?.sha256; const downgrade = local && comparePluginVersions(local.manifest.version, manifest.version) > 0;
  return <PluginDialog title={`${tr('settings:pluginCenter.details')} · ${pluginText(manifest, 'name', locale)}`} onClose={onClose}>
    <div className="flex items-start gap-3"><PluginIcon source={local?.iconDataUrl} /><p className="min-w-0 text-sm leading-6 text-sub">{pluginText(manifest, 'description', locale)}</p></div>
    <div className="space-y-2 text-xs"><SignatureStatus metadata={(variant ?? local)?.metadata ?? { manifest: '', publicKey: '', signature: '' }} /><p className="text-quiet">{tr(`settings:pluginCenter.${item.publisherId === 'unsigned' ? 'unsignedIdentity' : 'publisher'}`)}</p><p className="select-text break-all font-mono text-main">{item.publisherId === 'unsigned' ? manifest.id : item.publisherId}</p><p className="text-sub">{tr('settings:pluginCenter.hostVersion', { version: manifest.minHostVersion, sdk: manifest.sdkVersion })}</p></div>
    {group && <section className="space-y-2"><h3 className="text-sm font-semibold">{tr('settings:pluginCenter.versions')}</h3><select aria-label={tr('settings:pluginCenter.version')} value={selection} onChange={event => setSelection(event.target.value)} className="w-full rounded-lg border border-edge bg-card px-3 py-2 text-sm text-main">{group.variants.map(v => <option key={v.sha256} value={v.sha256}>v{v.manifest.version}{group.conflicts.has(v.manifest.version) ? ` · ${tr('settings:pluginCenter.collision')}` : !v.compatible ? ` · ${tr('settings:pluginCenter.incompatible')}` : ''}</option>)}</select>
      {variant && <><p className="text-xs text-sub">{bytes(variant.sizeBytes)} · {tr('settings:pluginCenter.sources', { count: variant.sources.length })}</p><ul className="space-y-1 text-xs text-sub">{variant.sources.map(source => <li key={source.nodeId}>{source.displayName} · {source.address}</li>)}</ul><p className="text-xs text-quiet">{tr('settings:pluginCenter.hash')}</p><p className="select-text break-all font-mono text-[10px] text-sub">{variant.sha256}</p></>}
      {conflict && <p role="alert" className="text-xs leading-5 text-danger">{tr('settings:pluginCenter.collisionHint')}</p>}
      <button type="button" className={primary} disabled={busy || conflict || !variant?.compatible || already || Boolean(downgrade)} onClick={() => { if (variant) void install(variant); }}>{tr(already ? 'settings:pluginCenter.installedStatus' : local ? 'settings:pluginCenter.update' : 'settings:pluginCenter.install')}</button>
    </section>}
    <section className="space-y-3"><h3 className="text-sm font-semibold">{tr('settings:pluginCenter.permissions')}</h3><p className="text-xs leading-5 text-sub">{tr('settings:pluginCenter.permissionScope')}</p>
      {!manifest.capabilities.length && <p className="text-xs text-sub">{tr('settings:pluginCenter.noPermissions')}</p>}
      {manifest.capabilities.map(capability => <div key={capability} className="flex items-center justify-between gap-3 rounded-lg border border-edge p-3 text-xs"><div><p>{tr(`settings:pluginCenter.capabilities.${capability}`)}</p><p className="mt-1 text-quiet">{tr(details.grants.includes(capability) ? 'settings:pluginCenter.granted' : 'settings:pluginCenter.notGranted')}</p></div>{local && details.grants.includes(capability) && <button type="button" className={button} disabled={busy} onClick={async () => { if (await perform('revoke', { pluginKey: item.pluginKey, capability })) void load(); }}>{tr('settings:pluginCenter.revoke')}</button>}</div>)}
    </section>
    {local && <section className="space-y-3"><h3 className="text-sm font-semibold">{tr('settings:pluginCenter.audit')}</h3>{!details.audit.length && <p className="text-xs text-sub">{tr('settings:pluginCenter.emptyAudit')}</p>}<ul className="space-y-2">{details.audit.map((entry, index) => <li key={`${entry.createdAt}-${index}`} className="flex flex-wrap justify-between gap-2 border-b border-edge pb-2 text-xs"><span>{tr(`settings:pluginCenter.actions.${entry.action}`)} · {tr(`settings:pluginCenter.outcomes.${entry.outcome}`)}<span className="ml-2 text-quiet">v{entry.version}</span>{entry.target && <span className="ml-2 select-text break-all text-quiet">{entry.target}</span>}</span><time className="text-quiet">{new Date(entry.createdAt).toLocaleString(locale)}</time></li>)}</ul>{more && <button type="button" className={button} disabled={loading} onClick={() => void load(details.audit.length)}>{tr('settings:pluginCenter.moreAudit')}</button>}</section>}
    {(error || operationError) && <p role="alert" className="text-sm text-danger">{error || operationError}</p>}
  </PluginDialog>;
}
