import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeft,
  Calendar,
  Check as CheckIcon,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  Folder,
  FolderInput,
  FolderOpen,
  Globe,
  KeyRound,
  Lock,
  LockKeyhole,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';
import { tr, useLocale } from '../../../src/i18n';
import type { User } from '../../../src/types';
import { useFeatures } from '../../../src/modules/state';
import { ThemeSelect } from '../../../src/components/ThemeSelect';
import {
  blankEntry,
  defaultPolicy,
  descendants,
  folderPath,
  useVault,
  vaultClient,
  vaultError,
  type VaultClient,
  type VaultEntry,
  type VaultFolder,
  type VaultList,
} from '../client';
import { Button, Check, Field, FolderSelect, Modal, inputClass, primaryClass } from './ui';
import { EditPanel, ErrorLine, GeneratorPanel, SettingsPanel, SharePanel, TransferPanel } from './Panels';

export interface VaultProps {
  key?: string | number;
  users?: User[];
  currentUserId?: string;
  incomingMessageId?: string | null;
  onShareHandled?: () => void;
  client?: VaultClient;
}

export default function VaultApp({ client = vaultClient, ...props }: VaultProps) {
  useLocale();
  const status = useVault(client);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void client
      .initialize()
      .then(() => {
        if (active) setReady(true);
      })
      .catch((e) => {
        if (active) setError(vaultError(e));
      });
    return () => {
      active = false;
    };
  }, [client]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas p-8 text-sub" role="alert">
        {error}
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas p-8 text-sub" role="status">
        {tr('vault:loading')}
      </div>
    );
  }
  return status.locked ? (
    <Unlock client={client} configured={status.configured} />
  ) : (
    <Unlocked key={status.sessionVersion} client={client} {...props} />
  );
}

function Unlock({ client, configured }: { client: VaultClient; configured: boolean }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  return (
    <div className="flex h-full w-full items-center justify-center overflow-auto bg-canvas p-6">
      <form
        className="w-full max-w-md space-y-5 rounded-2xl border border-edge bg-surface p-7 shadow-popover"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          if (!configured && password !== confirm) {
            setError(tr('vault:mismatch'));
            return;
          }
          setBusy(true);
          void client
            .call(configured ? 'unlock' : 'create', { password })
            .catch((e) => {
              setError(vaultError(e));
              setPassword('');
              setConfirm('');
            })
            .finally(() => setBusy(false));
        }}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/15 text-accent border border-accent/20">
          <LockKeyhole className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-tight text-main">
            {tr(configured ? 'vault:title' : 'vault:createVault')}
          </h1>
          <p className="mt-1.5 text-xs leading-relaxed text-sub">
            {tr(configured ? 'vault:unlockHelp' : 'vault:createHelp')}
          </p>
        </div>
        <Field label={tr('vault:masterPassword')} required>
          <input
            type="password"
            required
            minLength={configured ? 1 : 12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            className={inputClass}
          />
        </Field>
        {!configured && (
          <Field label={tr('vault:confirmPassword')} required>
            <input
              type="password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              className={inputClass}
            />
          </Field>
        )}
        <ErrorLine error={error} />
        <button type="submit" disabled={busy} className={`${primaryClass} w-full py-2.5`}>
          {tr(configured ? 'vault:unlock' : 'vault:createVault')}
        </button>
      </form>
    </div>
  );
}

const emptyData: VaultList = { entries: [], folders: [], policy: defaultPolicy, idleMinutes: 5 };

function Unlocked({
  client,
  users = [],
  currentUserId = '',
  incomingMessageId,
  onShareHandled,
}: VaultProps & { client: VaultClient }) {
  const enabled = useFeatures();
  const [data, setData] = useState<VaultList>(emptyData);
  const [view, setView] = useState('all');
  const [query, setQuery] = useState('');
  const [matched, setMatched] = useState<Set<string> | null>(null);
  const [sort, setSort] = useState('updated');
  const [kind, setKind] = useState('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [entry, setEntry] = useState<VaultEntry | null>(null);
  const [edit, setEdit] = useState<VaultEntry | null>(null);
  const [panel, setPanel] = useState<'generator' | 'settings' | 'import' | 'export' | 'share' | null>(null);
  const [folder, setFolder] = useState<VaultFolder | null>(null);
  const [deleteFolder, setDeleteFolder] = useState<VaultFolder | null>(null);
  const [deleteRecords, setDeleteRecords] = useState(false);
  const [confirm, setConfirm] = useState<'delete' | 'purge' | null>(null);
  const [move, setMove] = useState(false);
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (operation: () => Promise<void>) => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await operation();
    } catch (e) {
      setError(vaultError(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    const next: VaultList = await client.call('list');
    setData(next);
  }, [client]);

  useEffect(() => {
    let active = true;
    const load = () => {
      void client
        .call<VaultList>('list')
        .then((next) => {
          if (active) setData(next);
        })
        .catch((e) => {
          if (active) setError(vaultError(e));
        });
    };
    load();
    const dispose = client.onChanged(load);
    return () => {
      active = false;
      dispose();
    };
  }, [client]);

  useEffect(() => {
    let last = 0;
    const activity = () => {
      if (Date.now() - last < 10000) return;
      last = Date.now();
      void client.call('activity').catch(() => {});
    };
    window.addEventListener('pointerdown', activity);
    window.addEventListener('keydown', activity);
    return () => {
      window.removeEventListener('pointerdown', activity);
      window.removeEventListener('keydown', activity);
    };
  }, [client]);

  useEffect(() => {
    let active = true;
    if (!query.trim()) {
      setMatched(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void client
        .call<string[]>('search', { query })
        .then((ids) => {
          if (active) setMatched(new Set(ids));
        })
        .catch((e) => {
          if (active) setError(vaultError(e));
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, data, client]);

  useEffect(() => {
    setSelected([]);
    setEntry(null);
  }, [view]);

  const visible = useMemo(() => {
    const folders = descendants(data.folders, view);
    return data.entries
      .filter((item) => {
        if ((view === 'trash') !== !!item.deletedAt || (kind !== 'all' && item.kind !== kind)) return false;
        if (view === 'favorites' && !item.favorite) return false;
        if (view === 'ssh' && item.kind !== 'ssh') return false;
        if (view === 'unfiled' && item.folderId) return false;
        if (!['all', 'favorites', 'ssh', 'trash', 'unfiled'].includes(view) && (!item.folderId || !folders.has(item.folderId)))
          return false;
        return !query.trim() || matched?.has(item.id);
      })
      .sort((a, b) =>
        sort === 'name' ? a.name.localeCompare(b.name) : b.updatedAt.localeCompare(a.updatedAt)
      );
  }, [data, view, kind, sort, query, matched]);

  const openEntry = (id: string) =>
    void run(async () => {
      setEntry(null);
      const result = await client.call<VaultEntry>('get', { id });
      setEntry(result);
    });

  const toggleFavorite = useCallback(
    async (id: string) => {
      try {
        await client.call('toggleFavorite', { id });
        if (entry && entry.id === id) {
          setEntry((prev) => (prev ? { ...prev, favorite: !prev.favorite } : null));
        }
      } catch (e) {
        setError(vaultError(e));
      }
    },
    [client, entry]
  );

  const closePanel = useCallback(() => setPanel(null), []);
  const closeEdit = useCallback(() => setEdit(null), []);
  const folderIds = deleteFolder ? descendants(data.folders, deleteFolder.id) : new Set<string>();
  const title = ['all', 'favorites', 'unfiled', 'ssh', 'trash'].includes(view)
    ? tr(`vault:${view}`)
    : folderPath(data.folders, view);

  // Category counts
  const counts = useMemo(() => {
    const total = data.entries.filter((e) => !e.deletedAt).length;
    const favorites = data.entries.filter((e) => !e.deletedAt && e.favorite).length;
    const unfiled = data.entries.filter((e) => !e.deletedAt && !e.folderId).length;
    const ssh = data.entries.filter((e) => !e.deletedAt && e.kind === 'ssh').length;
    const trash = data.entries.filter((e) => !!e.deletedAt).length;
    return { all: total, favorites, unfiled, ssh, trash };
  }, [data.entries]);

  // Folder item counts (including descendants)
  const folderCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of data.folders) {
      const allIds = descendants(data.folders, f.id);
      map.set(f.id, data.entries.filter((e) => !e.deletedAt && e.folderId && allIds.has(e.folderId)).length);
    }
    return map;
  }, [data.folders, data.entries]);

  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-canvas text-main" data-vault>
      {/* Top Header */}
      <header className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-edge px-5 py-3.5 bg-canvas">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent border border-accent/20 shrink-0">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold tracking-tight text-main truncate">{tr('vault:title')}</h1>
            <p className="text-[11px] text-sub truncate mt-0.5">{tr('vault:subtitle')}</p>
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          <Button onClick={() => setPanel('generator')}>
            <KeyRound className="h-3.5 w-3.5 text-accent" />
            <span className="hidden sm:inline">{tr('vault:generate')}</span>
          </Button>
          <Button onClick={() => setPanel('import')}>
            <Download className="h-3.5 w-3.5" />
            <span className="hidden md:inline">{tr('vault:import')}</span>
          </Button>
          <Button onClick={() => setPanel('export')}>
            <Upload className="h-3.5 w-3.5" />
            <span className="hidden md:inline">{tr('vault:export')}</span>
          </Button>
          <Button aria-label={tr('vault:settings')} onClick={() => setPanel('settings')}>
            <Settings className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{tr('vault:settings')}</span>
          </Button>
          <Button
            onClick={() =>
              void run(async () => {
                await client.call('lock');
              })
            }
          >
            <LockKeyhole className="h-3.5 w-3.5" />
            <span>{tr('vault:lock')}</span>
          </Button>
        </div>
      </header>

      {/* Main 3-Column Area */}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* Column 1: Categories & Folders */}
        <aside
          className="w-40 sm:w-44 md:w-48 shrink-0 overflow-y-auto border-r border-edge bg-surface/40 p-2 sm:p-2.5 custom-scrollbar"
          aria-label={tr('vault:folders')}
        >
          <div className="space-y-1">
            {(['all', 'favorites', 'unfiled', 'ssh', 'trash'] as const).map((id) => (
              <button
                key={id}
                type="button"
                aria-label={tr(`vault:${id}`)}
                onClick={() => setView(id)}
                aria-current={view === id ? 'page' : undefined}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-medium transition-all ${
                  view === id
                    ? 'bg-accent/15 text-accent font-semibold border border-accent/20'
                    : 'text-sub hover:bg-hover hover:text-main'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {id === 'trash' ? (
                    <Trash2 className="h-3.5 w-3.5 shrink-0" />
                  ) : id === 'favorites' ? (
                    <Star className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                  ) : id === 'ssh' ? (
                    <KeyRound className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <Folder className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span className="truncate">{tr(`vault:${id}`)}</span>
                </div>
                {counts[id] > 0 && (
                  <span
                    aria-hidden="true"
                    className={`ml-1.5 rounded-full px-1.5 py-0.2 text-[10px] font-semibold ${
                      view === id ? 'bg-accent/20 text-accent' : 'bg-surface text-quiet'
                    }`}
                  >
                    {counts[id]}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="mt-4 pt-3.5 border-t border-edge/60 mb-2 flex items-center justify-between px-2 text-[11px] font-bold text-sub uppercase tracking-wider">
            <span className="flex items-center gap-1.5">
              <Folder className="h-3 w-3 text-quiet" />
              <span>{tr('vault:folders')}</span>
            </span>
            <button
              type="button"
              aria-label={tr('vault:newFolder')}
              title={tr('vault:newFolder')}
              onClick={() =>
                setFolder({
                  id: '',
                  name: '',
                  parentId: data.folders.some((f) => f.id === view) ? view : null,
                })
              }
              className="rounded-lg p-1 text-sub hover:text-main hover:bg-hover transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="space-y-1">
            {data.folders.length === 0 ? (
              <div className="px-2.5 py-4 text-center rounded-xl bg-canvas/40 border border-dashed border-edge/60">
                <p className="text-[11px] text-quiet">{tr('vault:noFolders')}</p>
              </div>
            ) : (
              data.folders
                .slice()
                .sort((a, b) => folderPath(data.folders, a.id).localeCompare(folderPath(data.folders, b.id)))
                .map((f) => {
                  const depth = folderPath(data.folders, f.id).split(' / ').length - 1;
                  const count = folderCounts.get(f.id) || 0;
                  return (
                    <div
                      key={f.id}
                      className={`group flex items-center justify-between rounded-xl transition-all ${
                        view === f.id
                          ? 'bg-accent/15 text-accent font-semibold border border-accent/20 shadow-soft'
                          : 'text-sub hover:bg-hover hover:text-main border border-transparent'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setView(f.id)}
                        title={folderPath(data.folders, f.id)}
                        style={{ paddingLeft: `${Math.max(10, depth * 12 + 10)}px` }}
                        className="flex min-w-0 flex-1 items-center gap-2 py-2 pr-1 text-left text-xs"
                      >
                        {view === f.id ? (
                          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-accent" />
                        ) : (
                          <Folder className="h-3.5 w-3.5 shrink-0 text-quiet group-hover:text-sub transition-colors" />
                        )}
                        <span className="truncate">{f.name}</span>
                      </button>
                      <div className="flex items-center shrink-0 pr-1.5 gap-1">
                        {count > 0 && (
                          <span
                            aria-hidden="true"
                            className={`rounded-full px-1.5 py-0.2 text-[10px] font-semibold ${
                              view === f.id ? 'bg-accent/20 text-accent' : 'bg-surface text-quiet'
                            }`}
                          >
                            {count}
                          </span>
                        )}
                        <button
                          type="button"
                          aria-label={`${tr('vault:renameFolder')}: ${f.name}`}
                          title={tr('vault:renameFolder')}
                          onClick={() => setFolder(f)}
                          className="p-1 text-quiet opacity-0 group-hover:opacity-100 hover:text-main rounded-md hover:bg-surface/80 transition-all"
                        >
                          <Settings className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        </aside>

        {/* Column 2: Record List (Adaptive Bounded Width) */}
        <section
          className={`flex flex-col min-w-0 border-r border-edge shrink-0 w-full md:w-[280px] lg:w-[320px] xl:w-[360px] 2xl:w-[400px] bg-canvas/30 ${
            entry ? 'max-md:hidden' : 'flex'
          }`}
        >
          {/* Header & Search */}
          <div className="space-y-3 border-b border-edge p-3.5 bg-canvas/60">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <h2 className="truncate text-xs font-bold uppercase tracking-wider text-main">{title}</h2>
                <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">
                  {visible.length}
                </span>
              </div>
              <Button
                primary
                onClick={() => setEdit(blankEntry(data.folders.some((f) => f.id === view) ? view : null))}
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{tr('vault:newRecord')}</span>
              </Button>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-quiet" />
              <input
                aria-label={tr('vault:search')}
                placeholder={tr('vault:search')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className={`${inputClass} pl-8 py-1.5 text-xs`}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <ThemeSelect
                portal
                ariaLabel={tr('vault:typeFilter')}
                value={kind}
                options={[
                  { value: 'all', label: tr('vault:allTypes') },
                  { value: 'login', label: tr('vault:login') },
                  { value: 'ssh', label: tr('vault:sshKey') },
                ]}
                onChange={setKind}
              />
              <ThemeSelect
                portal
                ariaLabel={tr('vault:sort')}
                value={sort}
                options={[
                  { value: 'updated', label: tr('vault:sortUpdated') },
                  { value: 'name', label: tr('vault:sortName') },
                ]}
                onChange={setSort}
              />
            </div>

            <div className="flex items-center justify-between pt-0.5">
              <label className="flex items-center gap-2 text-xs text-sub cursor-pointer select-none">
                <input
                  type="checkbox"
                  aria-label={tr('vault:selectAll')}
                  checked={visible.length > 0 && visible.every((e) => selected.includes(e.id))}
                  onChange={(e) => setSelected(e.target.checked ? visible.map((e) => e.id) : [])}
                  className="accent-accent h-3.5 w-3.5 rounded cursor-pointer"
                />
                <span>{tr('vault:selected', { count: selected.length })}</span>
              </label>
              {selected.length > 0 && view !== 'trash' && (
                <Button onClick={() => setMove(true)}>
                  <FolderInput className="h-3.5 w-3.5" />
                  <span>{tr('vault:move')}</span>
                </Button>
              )}
            </div>
          </div>

          {/* List items */}
          <div className="min-h-0 flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
            {visible.length === 0 ? (
              <p className="px-4 py-12 text-center text-xs text-quiet">{tr('vault:empty')}</p>
            ) : (
              visible.map((item) => (
                <div
                  key={item.id}
                  className={`group relative flex items-center gap-2 rounded-xl border px-3 py-2.5 transition-all ${
                    entry?.id === item.id
                      ? 'bg-hover border-edge shadow-soft'
                      : 'border-transparent hover:bg-hover/60 hover:border-edge/40'
                  }`}
                >
                  <input
                    type="checkbox"
                    aria-label={tr('vault:selectItem', { name: item.name })}
                    checked={selected.includes(item.id)}
                    onChange={(e) =>
                      setSelected((ids) =>
                        e.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id)
                      )
                    }
                    className="accent-accent h-3.5 w-3.5 rounded shrink-0 cursor-pointer"
                  />
                  <button
                    type="button"
                    onClick={() => openEntry(item.id)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-edge bg-surface text-sub group-hover:text-accent group-hover:border-accent/30 transition-colors">
                      {item.kind === 'ssh' ? <KeyRound className="h-4 w-4" /> : <LockKeyhole className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-main">{item.name}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-quiet">
                        {item.kind === 'ssh' ? item.algorithm || 'SSH' : item.username || item.urls[0] || '—'}
                      </span>
                    </span>
                  </button>

                  {/* Favorite button on the right */}
                  <button
                    type="button"
                    aria-label={tr('vault:toggleFavorite')}
                    title={item.favorite ? tr('vault:favorites') : tr('vault:favorite')}
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleFavorite(item.id);
                    }}
                    className={`p-1.5 rounded-lg transition-all shrink-0 ${
                      item.favorite
                        ? 'text-amber-400 hover:text-amber-500 hover:scale-110'
                        : 'text-quiet/40 hover:text-amber-400 hover:scale-110 opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    <Star className={`h-4 w-4 ${item.favorite ? 'fill-current' : ''}`} />
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Column 3: Detail View or Empty State */}
        {entry ? (
          <div className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-canvas custom-scrollbar">
            {/* Mobile/Narrow window back button */}
            <Button className="mb-4 md:hidden" onClick={() => setEntry(null)}>
              <ArrowLeft className="h-3.5 w-3.5" />
              {tr('vault:all')}
            </Button>

            {/* Detail Header */}
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-edge pb-5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-accent/15 text-accent border border-accent/20 shrink-0">
                    {entry.kind === 'ssh' ? <KeyRound className="h-5 w-5" /> : <LockKeyhole className="h-5 w-5" />}
                  </div>
                  <div className="min-w-0">
                    <h2 className="break-words text-lg font-bold text-main">{entry.name}</h2>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="inline-flex items-center gap-1 rounded-md bg-surface border border-edge px-2 py-0.5 text-[11px] font-medium text-sub">
                        <Folder className="h-3 w-3 text-quiet" />
                        {entry.folderId ? folderPath(data.folders, entry.folderId) : tr('vault:unfiled')}
                      </span>
                      {entry.favorite && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[11px] font-semibold text-amber-500">
                          <Star className="h-3 w-3 fill-current" />
                          {tr('vault:favorite')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Top-Right Action Buttons */}
              <div className="flex items-center gap-2 shrink-0">
                {entry.deletedAt ? (
                  <>
                    <Button
                      primary
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await client.call('restore', entry);
                          setEntry(null);
                          await refresh();
                        })
                      }
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>{tr('vault:restore')}</span>
                    </Button>
                    <Button disabled={busy} danger onClick={() => setConfirm('purge')}>
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>{tr('vault:purge')}</span>
                    </Button>
                  </>
                ) : (
                  <>
                    <Button onClick={() => setEdit(entry)}>
                      <Edit3 className="h-3.5 w-3.5 text-sub" />
                      <span>{tr('vault:edit')}</span>
                    </Button>
                    <Button
                      disabled={!enabled.chat}
                      title={!enabled.chat ? tr('vault:chatDisabled') : undefined}
                      onClick={() => setPanel('share')}
                    >
                      <Share2 className="h-3.5 w-3.5 text-sub" />
                      <span>{tr('vault:share')}</span>
                    </Button>
                    {/* "..." More menu */}
                    <RecordMoreMenu
                      onClone={() =>
                        void run(async () => {
                          setEdit(await client.call('clone', { id: entry.id, suffix: tr('vault:cloneSuffix') }));
                        })
                      }
                      onMove={() => {
                        setSelected([entry.id]);
                        setMove(true);
                      }}
                      onDelete={() => setConfirm('delete')}
                    />
                  </>
                )}
              </div>
            </div>

            {/* Credential Details - Adaptive Width */}
            <div className="space-y-5 pt-4 sm:pt-6 w-full max-w-4xl xl:max-w-5xl 2xl:max-w-6xl">
              <div className="space-y-4 rounded-2xl border border-edge bg-surface/50 p-5 shadow-soft">
                <h3 className="text-xs font-bold text-sub uppercase tracking-wider">{tr('vault:credentials')}</h3>

                {entry.kind === 'login' ? (
                  <>
                    <DetailField client={client} entry={entry} field="username" value={entry.username} />
                    <DetailField client={client} entry={entry} field="password" value={entry.password} secret />
                    <DetailUrls client={client} urls={entry.urls} onEdit={() => setEdit(entry)} />
                  </>
                ) : (
                  <>
                    <DetailField client={client} entry={entry} field="fingerprint" value={entry.fingerprint} />
                    <DetailField client={client} entry={entry} field="publicKey" value={entry.publicKey} />
                    <DetailField client={client} entry={entry} field="privateKey" value={entry.privateKey} secret />
                    <DetailField client={client} entry={entry} field="keyPassphrase" value={entry.keyPassphrase} secret />
                  </>
                )}
              </div>

              {/* Notes */}
              <div className="space-y-2 rounded-2xl border border-edge bg-surface/50 p-5 shadow-soft">
                <h3 className="text-xs font-bold text-sub uppercase tracking-wider">{tr('vault:notes')}</h3>
                <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-main font-mono">
                  {entry.notes || '—'}
                </p>
              </div>

              {/* Timestamps */}
              <div className="flex flex-wrap items-center gap-4 pt-2 text-[11px] text-quiet">
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>{tr('vault:created')}: {formatDate(entry.createdAt)}</span>
                </div>
                <span>•</span>
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>{tr('vault:updated')}: {formatDate(entry.updatedAt)}</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="hidden md:flex min-w-0 flex-1 flex-col items-center justify-center p-8 text-center bg-canvas">
            <div className="h-16 w-16 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent mb-4 shadow-soft">
              <ShieldCheck className="h-8 w-8" />
            </div>
            <h3 className="text-sm font-bold text-main">{tr('vault:noRecordSelected')}</h3>
            <p className="mt-1.5 text-xs text-sub max-w-xs leading-relaxed">
              {tr('vault:selectRecordHint')}
            </p>
          </div>
        )}
      </div>

      {/* Global Error/Notice Footer Bar */}
      {(error || notice) && (
        <div className="border-t border-edge px-4 py-2.5 bg-canvas/80">
          <ErrorLine error={error} />
          {notice && <p role="status" className="text-xs text-accent font-semibold">{notice}</p>}
        </div>
      )}

      {/* Modals */}
      {edit && (
        <EditPanel
          client={client}
          initial={edit}
          data={data}
          onClose={closeEdit}
          onSaved={(id) => {
            setEdit(null);
            void refresh();
            openEntry(id);
          }}
        />
      )}
      {panel === 'generator' && (
        <GeneratorPanel
          client={client}
          initial={data.policy}
          idleMinutes={data.idleMinutes}
          onClose={closePanel}
        />
      )}
      {panel === 'settings' && <SettingsPanel client={client} data={data} onClose={closePanel} />}
      {(panel === 'import' || panel === 'export') && (
        <TransferPanel
          client={client}
          direction={panel}
          ids={selected.length ? selected : entry ? [entry.id] : []}
          visibleIds={visible.map((e) => e.id)}
          allowSshExport={
            selected.length
              ? selected.length === 1 && data.entries.find((e) => e.id === selected[0])?.kind === 'ssh'
              : entry?.kind === 'ssh'
          }
          onClose={closePanel}
        />
      )}
      {panel === 'share' && entry && (
        <SharePanel
          client={client}
          entry={entry}
          users={users}
          currentUserId={currentUserId}
          onClose={closePanel}
        />
      )}
      {folder && (
        <FolderEditor
          folder={folder}
          data={data}
          client={client}
          onClose={() => setFolder(null)}
          onDelete={() => {
            setDeleteFolder(folder);
            setFolder(null);
            setDeleteRecords(false);
          }}
          onSaved={() => {
            setFolder(null);
            void refresh();
          }}
        />
      )}
      {deleteFolder && (
        <Modal
          icon={<Trash2 className="h-4 w-4 text-rose-500" />}
          title={tr('vault:deleteFolder')}
          description={tr('vault:deleteFolderHelp')}
          onClose={() => setDeleteFolder(null)}
          footer={
            <>
              <Button onClick={() => setDeleteFolder(null)} className="ui-cancel-button">
                {tr('vault:cancel')}
              </Button>
              <Button
                danger
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await client.call('deleteFolder', {
                      id: deleteFolder.id,
                      deleteEntries: deleteRecords,
                    });
                    setDeleteFolder(null);
                    setView('all');
                    await refresh();
                  })
                }
              >
                {tr('vault:delete')}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-xs text-sub leading-relaxed">{tr('vault:deleteFolderHelp')}</p>
            <p className="text-xs font-semibold text-main">
              {tr('vault:affectedRecords', {
                count: data.entries.filter((e) => e.folderId && folderIds.has(e.folderId)).length,
              })}
            </p>
            <Check label={tr('vault:deleteFolderRecords')} checked={deleteRecords} onChange={setDeleteRecords} />
          </div>
        </Modal>
      )}
      {confirm && entry && (
        <Modal
          icon={<AlertTriangle className="h-4 w-4 text-rose-500" />}
          title={tr(`vault:${confirm}`)}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <Button onClick={() => setConfirm(null)} className="ui-cancel-button">
                {tr('vault:cancel')}
              </Button>
              <Button
                danger
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await client.call(confirm, { id: entry.id, revision: entry.revision });
                    setConfirm(null);
                    setEntry(null);
                    await refresh();
                  })
                }
              >
                {tr(`vault:${confirm}`)}
              </Button>
            </>
          }
        >
          <p className="text-xs leading-relaxed text-sub">
            {tr(confirm === 'delete' ? 'vault:deleteConfirm' : 'vault:purgeConfirm')}
          </p>
        </Modal>
      )}
      {move && (
        <Modal
          icon={<FolderInput className="h-4 w-4" />}
          title={tr('vault:move')}
          onClose={() => setMove(false)}
          footer={
            <>
              <Button onClick={() => setMove(false)} className="ui-cancel-button">
                {tr('vault:cancel')}
              </Button>
              <Button
                primary
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await client.call('move', { ids: selected, folderId: moveTo });
                    setMove(false);
                    setSelected([]);
                    setEntry(null);
                    await refresh();
                  })
                }
              >
                {tr('vault:move')}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Field label={tr('vault:folder')}>
              <FolderSelect folders={data.folders} value={moveTo} onChange={setMoveTo} />
            </Field>
          </div>
        </Modal>
      )}
      {incomingMessageId && (
        <ReceivePanel
          client={client}
          messageId={incomingMessageId}
          data={data}
          onClose={() => onShareHandled?.()}
          onSaved={() => {
            onShareHandled?.();
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function DetailField({
  client,
  entry,
  field,
  value,
  secret = false,
}: {
  client: VaultClient;
  entry: VaultEntry;
  field: string;
  value: string;
  secret?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorNotice, setErrorNotice] = useState('');

  useEffect(() => {
    setVisible(false);
    setCopied(false);
    setErrorNotice('');
  }, [entry.id, value]);

  const copyValue = () => {
    void client
      .call('copy', { id: entry.id, field })
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch((e) => setErrorNotice(vaultError(e)));
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-sub font-medium">
        <span>{tr(`vault:${field}`)}</span>
        {copied && (
          <span role="status" className="flex items-center gap-1 text-[11px] text-accent font-semibold animate-in fade-in">
            <CheckIcon className="h-3 w-3" />
            {tr('vault:copied')}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 rounded-xl border border-edge bg-surface px-3.5 py-2.5 shadow-soft">
        <pre className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-main select-all">
          {secret && !visible ? '••••••••••••••••' : value || '—'}
        </pre>
        <div className="flex items-center gap-1 shrink-0 ml-1">
          {secret && (
            <button
              type="button"
              aria-label={`${tr(visible ? 'vault:hide' : 'vault:reveal')}: ${tr(`vault:${field}`)}`}
              onClick={() => setVisible((v) => !v)}
              className="p-1.5 rounded-lg text-sub hover:text-main hover:bg-hover transition-colors"
            >
              {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          )}
          <button
            type="button"
            disabled={!!entry.deletedAt || !value}
            aria-label={`${tr('vault:copy')}: ${tr(`vault:${field}`)}`}
            onClick={copyValue}
            className="p-1.5 rounded-lg text-sub hover:text-main hover:bg-hover transition-colors disabled:opacity-30"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {errorNotice && <p role="status" className="text-xs text-rose-500 font-medium">{errorNotice}</p>}
    </div>
  );
}

function DetailUrls({
  client,
  urls,
  onEdit,
}: {
  client: VaultClient;
  urls: string[];
  onEdit: () => void;
}) {
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const validUrls = urls.map((u) => u.trim()).filter(Boolean);

  const openUrl = (url: string) => {
    const isHttp = /^https?:\/\//i.test(url);
    const fullUrl = isHttp ? url : `https://${url}`;
    void client.call('openUrl', { url: fullUrl }).catch(() => {
      window.open(fullUrl, '_blank', 'noopener,noreferrer');
    });
  };

  const copyUrl = (url: string) => {
    void client
      .call('copyGenerated', { value: url })
      .then(() => {
        setCopiedUrl(url);
        setTimeout(() => setCopiedUrl(null), 2000);
      })
      .catch(() => {
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          navigator.clipboard.writeText(url).then(() => {
            setCopiedUrl(url);
            setTimeout(() => setCopiedUrl(null), 2000);
          }).catch(() => {});
        }
      });
  };

  if (validUrls.length === 0) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-sub font-medium">
          <span>{tr('vault:url')}</span>
        </div>
        <div className="flex items-center justify-between gap-2 rounded-xl border border-edge bg-surface px-3.5 py-2.5 shadow-soft">
          <span className="text-xs font-mono text-quiet">—</span>
          <button
            type="button"
            onClick={onEdit}
            className="flex items-center gap-1 text-[11px] font-semibold text-accent hover:underline transition-colors"
          >
            <Edit3 className="h-3 w-3" />
            <span>{tr('vault:edit')}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-sub font-medium">
        <span>{tr('vault:url')}</span>
        {copiedUrl && (
          <span role="status" className="flex items-center gap-1 text-[11px] text-accent font-semibold animate-in fade-in">
            <CheckIcon className="h-3 w-3" />
            {tr('vault:copied')}
          </span>
        )}
      </div>
      <div className="space-y-2">
        {validUrls.map((url, i) => {
          const isHttp = /^https?:\/\//i.test(url);
          const fullUrl = isHttp ? url : `https://${url}`;
          return (
            <div
              key={`${i}:${url}`}
              className="flex items-center justify-between gap-2 rounded-xl border border-edge bg-surface px-3.5 py-2.5 shadow-soft"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Globe className="h-3.5 w-3.5 text-sub shrink-0" />
                <button
                  type="button"
                  onClick={() => openUrl(url)}
                  className="truncate text-left text-xs font-medium text-accent hover:underline cursor-pointer"
                  title={url}
                >
                  {url}
                </button>
              </div>
              <div className="flex items-center gap-1 shrink-0 ml-1">
                <button
                  type="button"
                  onClick={() => openUrl(url)}
                  aria-label={`${tr('vault:openSite')}: ${url}`}
                  title={tr('vault:openSite')}
                  className="p-1.5 rounded-lg text-sub hover:text-main hover:bg-hover transition-colors"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`${tr('vault:copy')}: ${url}`}
                  title={tr('vault:copy')}
                  onClick={() => copyUrl(url)}
                  className="p-1.5 rounded-lg text-sub hover:text-main hover:bg-hover transition-colors"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecordMoreMenu({
  onClone,
  onMove,
  onDelete,
}: {
  onClone: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isOpen) {
      setIsOpen(false);
      setMenuPos(null);
    } else {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) {
        setMenuPos({
          top: rect.bottom + 6,
          right: window.innerWidth - rect.right,
        });
        setIsOpen(true);
      }
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (
        !triggerRef.current?.contains(event.target as Node) &&
        !(event.target as HTMLElement).closest('.vault-more-menu')
      ) {
        setIsOpen(false);
        setMenuPos(null);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={tr('vault:moreActions')}
        onClick={toggle}
        className="flex h-8 w-8 items-center justify-center rounded-xl border border-edge bg-surface text-sub hover:text-main hover:bg-hover hover:border-edge-focus transition-all shadow-soft"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {isOpen &&
        menuPos &&
        createPortal(
          <div
            className="vault-more-menu fixed z-[99999] min-w-[150px] rounded-2xl border border-subtle bg-surface/95 backdrop-blur-md p-1.5 shadow-popover animate-in fade-in zoom-in-95 duration-100 origin-top-right text-xs"
            style={{
              top: `${menuPos.top}px`,
              right: `${menuPos.right}px`,
              transition: 'none',
            }}
          >
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                setMenuPos(null);
                onClone();
              }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-main hover:bg-hover transition-colors"
            >
              <Copy className="h-3.5 w-3.5 text-sub" />
              <span>{tr('vault:clone')}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                setMenuPos(null);
                onMove();
              }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-main hover:bg-hover transition-colors"
            >
              <FolderInput className="h-3.5 w-3.5 text-sub" />
              <span>{tr('vault:move')}</span>
            </button>
            <div className="my-1 border-t border-edge/60" />
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                setMenuPos(null);
                onDelete();
              }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-rose-500 hover:bg-rose-500/10 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>{tr('vault:delete')}</span>
            </button>
          </div>,
          document.body
        )}
    </div>
  );
}

function FolderEditor({
  client,
  folder,
  data,
  onClose,
  onSaved,
  onDelete,
}: {
  client: VaultClient;
  folder: VaultFolder;
  data: VaultList;
  onClose: () => void;
  onSaved: () => void;
  onDelete: () => void;
}) {
  const [value, setValue] = useState(folder);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <Modal
      icon={<Folder className="h-4 w-4" />}
      title={tr(folder.id ? 'vault:renameFolder' : 'vault:newFolder')}
      onClose={onClose}
      footerLeft={
        folder.id ? (
          <Button danger disabled={busy} onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            {tr('vault:deleteFolder')}
          </Button>
        ) : undefined
      }
      footer={
        <>
          <Button onClick={onClose} className="ui-cancel-button">
            {tr('vault:cancel')}
          </Button>
          <Button type="submit" form="vault-folder-form" primary disabled={busy}>
            {tr('vault:save')}
          </Button>
        </>
      }
    >
      <form
        id="vault-folder-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          void client
            .call('saveFolder', { folder: value })
            .then(onSaved)
            .catch((e) => setError(vaultError(e)))
            .finally(() => setBusy(false));
        }}
      >
        <Field label={tr('vault:name')} required>
          <input
            className={inputClass}
            required
            maxLength={256}
            value={value.name}
            onChange={(e) => setValue((v) => ({ ...v, name: e.target.value }))}
            placeholder={tr('vault:name')}
          />
        </Field>
        <Field label={tr('vault:parentFolder')}>
          <FolderSelect
            value={value.parentId}
            folders={data.folders}
            emptyLabel={tr('vault:rootFolder')}
            exclude={folder.id ? descendants(data.folders, folder.id) : undefined}
            onChange={(parentId) => setValue((v) => ({ ...v, parentId }))}
          />
        </Field>
        <ErrorLine error={error} />
      </form>
    </Modal>
  );
}

function ReceivePanel({
  client,
  messageId,
  data,
  onClose,
  onSaved,
}: {
  client: VaultClient;
  messageId: string;
  data: VaultList;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [entry, setEntry] = useState<VaultEntry | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    let active = true;
    void client
      .call<VaultEntry>('receive', { messageId })
      .then((entry) => {
        if (active) setEntry(entry);
      })
      .catch((e) => {
        if (active) setError(vaultError(e));
      });
    return () => {
      active = false;
    };
  }, [client, messageId]);

  return (
    <Modal
      icon={<ShieldCheck className="h-4 w-4 text-accent" />}
      title={tr('vault:shareCard')}
      description={tr('vault:saveShare')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} className="ui-cancel-button">
            {tr('vault:cancel')}
          </Button>
          <Button
            disabled={busy || !entry}
            primary
            onClick={() => {
              setBusy(true);
              void client
                .call('saveShare', { messageId, folderId })
                .then(onSaved)
                .catch((e) => setError(vaultError(e)))
                .finally(() => setBusy(false));
            }}
          >
            {tr('vault:saveShare')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorLine error={error} />
        {entry && (
          <>
            <div className="rounded-xl border border-edge bg-surface/50 p-4 space-y-2">
              <h3 className="font-bold text-main">{entry.name}</h3>
              {entry.urls.length > 0 && (
                <p className="break-all text-xs text-sub">{entry.urls.join('\n')}</p>
              )}
              {entry.username && <p className="text-xs font-mono text-accent">{entry.username}</p>}
            </div>

            {entry.kind === 'ssh' ? (
              <div className="rounded-xl border border-edge bg-surface/50 p-4 space-y-2">
                <pre className="whitespace-pre-wrap break-all font-mono text-xs">{entry.publicKey}</pre>
                <p className="break-all text-[11px] text-sub font-mono">{entry.fingerprint}</p>
              </div>
            ) : (
              entry.password && (
                <div>
                  <Field label={tr('vault:password')}>
                    <div className="flex gap-2">
                      <input
                        type={show ? 'text' : 'password'}
                        readOnly
                        value={entry.password}
                        className={`${inputClass} flex-1 font-mono`}
                        autoComplete="off"
                      />
                      <Button onClick={() => setShow((v) => !v)}>
                        {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        {tr(show ? 'vault:hide' : 'vault:reveal')}
                      </Button>
                    </div>
                  </Field>
                </div>
              )
            )}
            <Field label={tr('vault:folder')}>
              <FolderSelect folders={data.folders} value={folderId} onChange={setFolderId} />
            </Field>
          </>
        )}
      </div>
    </Modal>
  );
}
