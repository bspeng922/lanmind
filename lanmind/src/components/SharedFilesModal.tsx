import React, { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { ChevronDown, ChevronRight, Download, File, Folder, FolderPlus, FolderUp, HardDrive, Loader2, Lock, RefreshCw, Upload, X } from 'lucide-react';
import { tr, useLocale } from '../i18n';
import { User } from '../types';
import { SharedFilesApi, type SharedRoot, type SharedEntry, type SharedEntryPage, type ShareProgress } from '../services/sharedFiles';
import { getWorkspaceContext, sameWorkspace } from '../utils/workspaceContext';

interface Props { user: User; currentUser: User; onClose: () => void }
type Selection = { root: SharedRoot; path: string };
const keyFor = (root: SharedRoot, path: string) => JSON.stringify([root.id, path]);
const bytes = (value: number) => value < 1024 ? `${value} B` : value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 ** 2).toFixed(1)} MB`;

function errorMessage(error: unknown): string {
  const code = String(error).match(/SHARE_([A-Z_]+)/)?.[1] ?? 'IO';
  switch (code) {
    case 'DESKTOP': return tr('chat:shares.errorDesktop');
    case 'OFFLINE': return tr('chat:shares.errorOffline');
    case 'READ_ONLY': case 'DENIED': return tr('chat:shares.errorDenied');
    case 'NOT_FOUND': case 'ROOT_CHANGED': return tr('chat:shares.errorMissing');
    case 'EXISTS': return tr('chat:shares.errorExists');
    case 'PATH': return tr('chat:shares.errorPath');
    case 'CHANGED': case 'CHECKSUM': return tr('chat:shares.errorChanged');
    case 'WORKSPACE': return tr('chat:shares.errorWorkspace');
    case 'CANCELLED': return tr('chat:shares.cancelled');
    case 'LIMIT': return tr('chat:shares.errorLimit');
    case 'BUSY': return tr('chat:shares.errorBusy');
    case 'UNAVAILABLE': return tr('chat:shares.errorUnavailable');
    default: return tr('chat:shares.errorIo');
  }
}

export const SharedFilesModal: React.FC<Props> = ({ user, currentUser, onClose }) => {
  useLocale();
  const owner = user.id === currentUser.id;
  const [roots, setRoots] = useState<SharedRoot[]>([]);
  const [pages, setPages] = useState<Record<string, SharedEntryPage>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<Selection | null>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<ShareProgress | null>(null);
  const [transferId, setTransferId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const scope = useRef(getWorkspaceContext());
  const mounted = useRef(true);
  const requestGeneration = useRef(0);
  const activeTransfer = useRef<string | null>(null);
  const cancelRequested = useRef(false);
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const current = () => mounted.current && (!scope.current || sameWorkspace(scope.current));

  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); closeRef.current(); }
      if (event.key === 'Tab') {
        const elements = Array.from<HTMLElement>(panel.current?.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]') ?? []);
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      mounted.current = false; requestGeneration.current += 1;
      if (activeTransfer.current) void SharedFilesApi.cancel(activeTransfer.current).catch(() => {});
      document.removeEventListener('keydown', keydown, true); previous?.focus();
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const unlisten = listen<ShareProgress>('share://progress', ({ payload }) => {
      if (current() && payload.transferId === activeTransfer.current && payload.workspaceId === scope.current?.workspaceId) setTransfer(payload);
    });
    void unlisten.then(stop => { if (disposed) stop(); }).catch(() => {});
    return () => { disposed = true; void unlisten.then(stop => stop()).catch(() => {}); };
  }, []);

  const refresh = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setBusy(true); setError(''); setPages({}); setExpanded(new Set()); setSelected(null); setNewFolder(null);
    try {
      const result = owner ? await SharedFilesApi.localRoots() : (await SharedFilesApi.roots(user.id)).roots;
      if (current() && generation === requestGeneration.current) setRoots(result.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (e) { if (current() && generation === requestGeneration.current) { setRoots([]); setError(errorMessage(e)); } }
    finally { if (current() && generation === requestGeneration.current) setBusy(false); }
  }, [owner, user.id]);
  useEffect(() => { void refresh(); }, [refresh]);

  const load = async (root: SharedRoot, path: string, offset = 0) => {
    const key = keyFor(root, path), generation = requestGeneration.current;
    setLoading(previous => new Set(previous).add(key)); setError('');
    try {
      const result = await SharedFilesApi.list(user.id, root.id, path, offset);
      if (current() && generation === requestGeneration.current) setPages(previous => ({ ...previous, [key]: { ...result, entries: offset ? [...(previous[key]?.entries ?? []), ...result.entries] : result.entries } }));
    } catch (e) { if (current() && generation === requestGeneration.current) setError(errorMessage(e)); }
    finally { if (current()) setLoading(previous => { const next = new Set(previous); next.delete(key); return next; }); }
  };
  const toggle = (root: SharedRoot, path: string) => {
    const key = keyFor(root, path);
    setSelected({ root, path }); setNewFolder(null);
    setExpanded(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next; });
    if (!pages[key] && !loading.has(key)) void load(root, path);
  };
  const mutate = async (operation: () => Promise<SharedRoot[]>) => {
    setBusy(true); setError(''); setNotice('');
    try { const result = await operation(); if (current()) setRoots(result); }
    catch (e) { if (current()) setError(errorMessage(e)); }
    finally { if (current()) setBusy(false); }
  };
  const add = async (directory: boolean) => {
    setError('');
    try {
      if (!isTauri()) throw new Error('SHARE_DESKTOP');
      const paths = await open({ directory, multiple: true, title: tr(directory ? 'chat:shares.addDirectory' : 'chat:shares.addFile') });
      if (!paths || !current()) return;
      await mutate(async () => {
        let result: SharedRoot[] = roots;
        for (const path of Array.isArray(paths) ? paths : [paths]) {
          result = await SharedFilesApi.add(path);
          if (current()) setRoots(result);
        }
        return result;
      });
    } catch (e) { if (current()) setError(errorMessage(e)); }
  };
  const runTransfer = async (operation: (id: string) => Promise<void>) => {
    const id = crypto.randomUUID(); activeTransfer.current = id;
    cancelRequested.current = false;
    setTransferId(id); setTransfer(null); setCancelling(false); setError(''); setNotice('');
    try { await operation(id); if (current()) setNotice(tr('chat:shares.completed')); }
    catch (e) { if (current()) setError(errorMessage(e)); }
    finally { activeTransfer.current = null; if (current()) { setTransferId(null); setTransfer(null); setCancelling(false); } }
  };
  const download = async (root: SharedRoot, path: string, name: string, directory: boolean) => {
    setError('');
    try {
      if (!isTauri()) throw new Error('SHARE_DESKTOP');
      const destination = directory ? await open({ directory: true, multiple: false, title: tr('chat:shares.chooseDestination') }) : await save({ defaultPath: name, title: tr('chat:shares.chooseDestination') });
      if (!destination || Array.isArray(destination) || !current()) return;
      await runTransfer(id => SharedFilesApi.download(user.id, root.id, path, name, directory, destination, id));
    } catch (e) { if (current()) setError(errorMessage(e)); }
  };
  const upload = async () => {
    if (!selected) return;
    const selection = selected;
    setError('');
    try {
      if (!isTauri()) throw new Error('SHARE_DESKTOP');
      const source = await open({ multiple: true, directory: false, title: tr('chat:shares.upload') });
      if (!source || !current()) return;
      await runTransfer(async id => {
        for (const path of Array.isArray(source) ? source : [source]) {
          if (cancelRequested.current) throw new Error('SHARE_CANCELLED');
          await SharedFilesApi.upload(user.id, selection.root.id, selection.path, path, id);
          if (!current()) return;
        }
      });
      if (current()) await load(selection.root, selection.path);
    } catch (e) { if (current()) setError(errorMessage(e)); }
  };
  const mkdir = async (event: React.FormEvent) => {
    event.preventDefault(); if (!selected || !newFolder?.trim()) return;
    setBusy(true); setError('');
    try {
      await SharedFilesApi.mkdir(user.id, selected.root.id, selected.path, newFolder.trim());
      if (current()) { setNewFolder(null); await load(selected.root, selected.path); setExpanded(previous => new Set(previous).add(keyFor(selected.root, selected.path))); }
    } catch (e) { if (current()) setError(errorMessage(e)); }
    finally { if (current()) setBusy(false); }
  };
  const cancel = async () => {
    if (!activeTransfer.current) return; cancelRequested.current = true; setCancelling(true);
    try { await SharedFilesApi.cancel(activeTransfer.current); }
    catch (e) { if (current()) { setError(errorMessage(e)); setCancelling(false); } }
  };
  const transferBusy = !!transferId;
  const renderChildren = (root: SharedRoot, path: string, depth: number): React.ReactNode => {
    const key = keyFor(root, path), page = pages[key];
    if (!expanded.has(key)) return null;
    return <div className="border-l border-edge ml-4 pl-2">
      {page?.entries.map(entry => renderEntry(root, entry, depth))}
      {!loading.has(key) && page?.entries.length === 0 && <p className="px-3 py-2 text-xs text-quiet">{tr('chat:shares.emptyDirectory')}</p>}
      {loading.has(key) && <div className="p-2 text-quiet"><Loader2 className="h-4 w-4 animate-spin" aria-label={tr('chat:shares.loading')} /></div>}
      {page && page.entries.length < page.total && <button type="button" disabled={loading.has(key)} onClick={() => void load(root, path, page.entries.length)} className="px-3 py-2 text-xs text-info">{tr('chat:shares.loadMore')}</button>}
    </div>;
  };
  const renderEntry = (root: SharedRoot, entry: SharedEntry, depth: number): React.ReactNode => {
    const key = keyFor(root, entry.path), isSelected = selected?.root.id === root.id && selected.path === entry.path;
    return <div key={key}>
      <div className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${isSelected ? 'bg-accent/10' : 'hover:bg-hover'}`}>
        <button type="button" disabled={!entry.isDirectory || depth > 64} onClick={() => toggle(root, entry.path)} aria-expanded={entry.isDirectory ? expanded.has(key) : undefined} aria-label={entry.isDirectory ? entry.name : undefined} className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs text-main disabled:opacity-100">
          {entry.isDirectory ? <>{expanded.has(key) ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}<Folder className="h-4 w-4 shrink-0 text-info" /></> : <><span className="w-3 shrink-0" /><File className="h-4 w-4 shrink-0 text-sub" /></>}
          <span className="truncate" title={entry.name}>{entry.name}</span>
        </button>
        {!entry.isDirectory && <span className="shrink-0 text-[10px] text-quiet">{bytes(entry.size)}</span>}
        <button type="button" disabled={transferBusy || busy} onClick={() => void download(root, entry.path, entry.name, entry.isDirectory)} title={tr('chat:shares.downloadItem', { name: entry.name })} aria-label={tr('chat:shares.downloadItem', { name: entry.name })} className="rounded p-1.5 text-sub hover:bg-card hover:text-main disabled:opacity-40"><Download className="h-3.5 w-3.5" /></button>
      </div>
      {entry.isDirectory && depth <= 64 && renderChildren(root, entry.path, depth + 1)}
    </div>;
  };

  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-overlay p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="shared-files-title" tabIndex={-1} className="flex max-h-[85vh] min-h-[360px] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-edge bg-surface text-main shadow-popover outline-none">
      <header className="flex items-center justify-between gap-3 border-b border-edge px-5 py-4">
        <div className="flex min-w-0 items-center gap-2"><FolderUp className="h-5 w-5 shrink-0 text-info" /><h2 id="shared-files-title" className="truncate text-sm font-semibold">{owner ? tr('chat:shares.mine') : tr('chat:shares.userTitle', { name: user.nickname })}</h2></div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" disabled={busy || transferBusy} onClick={() => void refresh()} className="rounded-md p-1.5 text-sub hover:bg-hover disabled:opacity-40" aria-label={tr('chat:shares.refresh')}><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /></button>
          <button type="button" onClick={onClose} className="ui-modal-close-btn" aria-label={tr('chat:shares.close')}><X className="h-4 w-4" /></button>
        </div>
      </header>
      <div className="border-b border-edge bg-canvas/40 px-5 py-3 text-xs leading-5 text-sub">{owner ? tr('chat:shares.ownerHint') : tr('chat:shares.remoteHint')}</div>
      {owner && <div className="flex flex-wrap gap-2 border-b border-edge px-5 py-3">
        <button type="button" disabled={busy} onClick={() => void add(false)} className="theme-btn-secondary flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs"><File className="h-3.5 w-3.5" />{tr('chat:shares.addFile')}</button>
        <button type="button" disabled={busy} onClick={() => void add(true)} className="theme-btn-primary flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs"><FolderPlus className="h-3.5 w-3.5" />{tr('chat:shares.addDirectory')}</button>
      </div>}
      {!owner && selected && <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-5 py-3">
        <span className="min-w-0 flex-1 truncate text-xs text-sub" title={`${selected.root.name}/${selected.path}`}>{selected.root.name}{selected.path ? ` / ${selected.path}` : ''}</span>
        <div className="flex items-center gap-2">
          <button type="button" disabled={!selected.root.writable || transferBusy || busy} onClick={() => void upload()} className="theme-btn-secondary flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs"><Upload className="h-3.5 w-3.5" />{tr('chat:shares.upload')}</button>
          <button type="button" disabled={!selected.root.writable || transferBusy || busy} onClick={() => setNewFolder('')} className="theme-btn-secondary flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs"><FolderPlus className="h-3.5 w-3.5" />{tr('chat:shares.newFolder')}</button>
        </div>
      </div>}
      {newFolder !== null && <form onSubmit={event => void mkdir(event)} className="flex flex-wrap gap-2 border-b border-edge px-5 py-3">
        <input autoFocus value={newFolder} onChange={event => setNewFolder(event.target.value)} maxLength={255} aria-label={tr('chat:shares.folderName')} placeholder={tr('chat:shares.folderName')} className="min-w-0 flex-1 rounded-md border border-edge bg-input px-3 py-1.5 text-xs" />
        <button type="submit" disabled={busy || !newFolder.trim()} className="theme-btn-primary rounded-md px-3 py-1.5 text-xs">{tr('chat:shares.create')}</button>
        <button type="button" onClick={() => setNewFolder(null)} className="theme-btn-secondary rounded-md px-3 py-1.5 text-xs">{tr('chat:shares.cancel')}</button>
      </form>}
      {error && <p role="alert" className="mx-5 mt-3 rounded-md border border-danger/20 bg-danger/10 px-3 py-2 text-xs leading-5 text-danger">{error}</p>}
      {notice && <p role="status" className="px-5 pt-3 text-xs text-success">{notice}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto p-4" aria-busy={busy}>
        {busy && roots.length === 0 ? <div className="flex justify-center p-10"><Loader2 className="h-5 w-5 animate-spin text-quiet" aria-label={tr('chat:shares.loading')} /></div> : roots.length === 0 && !error ? <div className="flex flex-col items-center gap-3 px-4 py-12 text-center text-sub"><HardDrive className="h-9 w-9 text-quiet" /><p className="text-sm">{owner ? tr('chat:shares.emptyMine') : tr('chat:shares.emptyRemote')}</p></div> : roots.map(root => <div key={root.id} className="mb-2 rounded-lg border border-edge p-2">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={owner || !root.available || !root.isDirectory} onClick={() => toggle(root, '')} aria-expanded={!owner && root.isDirectory ? expanded.has(keyFor(root, '')) : undefined} className="flex min-w-0 flex-1 items-center gap-2 px-1 py-2 text-left text-xs font-medium disabled:opacity-100">
              {!owner && root.isDirectory && (expanded.has(keyFor(root, '')) ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />)}
              {root.isDirectory ? <Folder className="h-4 w-4 shrink-0 text-info" /> : <File className="h-4 w-4 shrink-0 text-sub" />}<span className="truncate" title={root.name}>{root.name}</span>
            </button>
            {!root.available && <span className="text-[10px] text-warning">{tr('chat:shares.unavailable')}</span>}
            {owner ? (
              <div className="flex items-center gap-2">
                {!root.isDirectory ? (
                  <div className="relative inline-flex items-center">
                    <select
                      aria-label={tr('chat:shares.permissionFor', { name: root.name })}
                      value="read"
                      disabled
                      title={tr('chat:shares.fileReadOnlyHint') || '单个文件仅支持只读下载；目录可开启可写权限'}
                      className="appearance-none rounded-lg border border-edge bg-input/50 py-1 pl-2.5 pr-7 text-xs font-medium text-sub opacity-60 cursor-not-allowed shadow-2xs"
                    >
                      <option value="read">{tr('chat:shares.readOnly')}</option>
                    </select>
                    <Lock className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-quiet" />
                  </div>
                ) : (
                  <div className="relative inline-flex items-center">
                    <select
                      aria-label={tr('chat:shares.permissionFor', { name: root.name })}
                      value={root.writable ? 'write' : 'read'}
                      disabled={busy || !root.available}
                      onChange={event => void mutate(() => SharedFilesApi.permission(root.id, event.target.value === 'write'))}
                      className="appearance-none rounded-lg border border-edge bg-input py-1 pl-2.5 pr-7 text-xs font-medium text-main transition-colors hover:border-accent/60 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50 cursor-pointer shadow-2xs"
                    >
                      <option value="read">{tr('chat:shares.readOnly')}</option>
                      <option value="write">{tr('chat:shares.writable')}</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-quiet" />
                  </div>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void mutate(() => SharedFilesApi.remove(root.id))}
                  className="rounded-lg border border-danger/20 px-2 py-1 text-xs text-danger hover:bg-danger/10 hover:border-danger/40 transition-colors"
                >
                  {tr('chat:shares.stop')}
                </button>
              </div>
            ) : <>
              <span className={`rounded border px-1.5 py-0.5 text-[10px] ${root.writable ? 'border-warning/20 text-warning' : 'border-edge text-quiet'}`}>{root.writable ? tr('chat:shares.writable') : tr('chat:shares.readOnly')}</span>
              <button type="button" disabled={transferBusy || busy || !root.available} onClick={() => void download(root, '', root.name, root.isDirectory)} className="rounded-md p-1.5 text-sub hover:bg-hover disabled:opacity-40" title={tr('chat:shares.downloadItem', { name: root.name })} aria-label={tr('chat:shares.downloadItem', { name: root.name })}><Download className="h-4 w-4" /></button>
            </>}
          </div>
          {owner && <p className="break-all px-1 pb-1 text-[11px] text-quiet">{root.localPath}</p>}
          {!owner && root.isDirectory && renderChildren(root, '', 0)}
        </div>)}
      </div>
      {transferBusy && <div className="border-t border-edge px-5 py-3">
        <div className="mb-2 flex items-center gap-2 text-xs text-sub"><Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /><span className="min-w-0 flex-1 truncate">{transfer?.name ?? tr('chat:shares.preparing')}</span><span className="shrink-0 text-[10px]">{transfer ? `${bytes(transfer.received)} / ${bytes(transfer.total)}` : ''}</span><button type="button" disabled={cancelling} onClick={() => void cancel()} className="rounded px-2 py-1 text-danger hover:bg-hover disabled:opacity-40">{cancelling ? tr('chat:shares.cancelling') : tr('chat:shares.cancel')}</button></div>
        <progress aria-label={tr('chat:shares.progress')} max={transfer?.total || 1} value={transfer?.received ?? 0} className="h-1.5 w-full accent-current text-info" />
      </div>}
      <footer className="border-t border-edge px-5 py-3 text-[11px] leading-5 text-quiet">{tr('chat:shares.footer')}</footer>
    </div>
  </div>;
};
