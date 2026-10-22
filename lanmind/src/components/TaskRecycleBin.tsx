import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, MoreHorizontal, RefreshCw, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { ApiService } from '../services/api';
import { tr, useLocale } from '../i18n';
import { localizeMessage } from '../i18n/messages';
import type { Project, TaskRecycleDetail, TaskRecycleEntry, TaskRecyclePage, TaskRecycleResult, User } from '../types';
import { scopedStorageKey } from '../utils/workspaceContext';
import { formatTaskDateTime } from '../utils/timeFormat';
import { downloadFile, formatFileSize } from '../utils/fileTransfer';
import { TaskMarkdown } from './TaskMarkdown';
import { ThemeSelect, type ThemeSelectOption } from './ThemeSelect';
import { useTheme } from '../context/ThemeContext';
import '../styles/task-recycle.css';

type Selection = { id: string; deletionId: string }[];
interface Props {
  currentUser: User;
  users: User[];
  projects: Project[];
  initialProjectId?: string | null;
  readOnly?: boolean;
  onChanged: () => void | Promise<void>;
  onBack?: () => void;
}

function RecycleDialog({ children, onClose, busy, title }: { children: React.ReactNode; onClose: () => void; busy?: boolean; title: string }) {
  const { currentTheme } = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onClose, busy });
  callbacks.current = { onClose, busy };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (!callbacks.current.busy) callbacks.current.onClose(); }
      if (event.key === 'Tab') {
        const controls = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled)') || []) as HTMLElement[];
        const first = controls[0], last = controls.at(-1);
        if (!first) { event.preventDefault(); ref.current?.focus(); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(<div className="recycle-overlay" data-theme={currentTheme.id} onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}><div ref={ref} role="dialog" aria-modal="true" aria-label={title} aria-busy={busy} tabIndex={-1} className="recycle-dialog"><header><h2>{title}</h2><button type="button" disabled={busy} onClick={onClose} aria-label={tr('tasks:recycle.close')}><X size={18} /></button></header>{children}</div></div>, document.body);
}

export const TaskRecycleBin: React.FC<Props> = ({ currentUser, users, projects, initialProjectId, readOnly = false, onChanged, onBack }) => {
  useLocale();
  const [query, setQuery] = useState('');
  const [projectId, setProjectId] = useState(initialProjectId || '');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<TaskRecyclePage>({ items: [], total: 0, page: 1, pageSize: 50 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [detail, setDetail] = useState<TaskRecycleDetail | null>(null);
  const [confirm, setConfirm] = useState<{ action: 'restore' | 'purge'; selection: Selection; warnings?: TaskRecycleResult['warnings'] } | null>(null);
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(() => new Set());
  const request = useRef(0);
  const detailRequest = useRef(0);
  const actionLock = useRef(false);
  const scope = scopedStorageKey(`task-recycle:${currentUser.id}`);
  const active = useRef(scope); active.current = scope;
  useEffect(() => { active.current = scope; setDetail(null); setConfirm(null); setError(''); setNotice(''); return () => { request.current++; active.current = ''; }; }, [scope]);
  const load = useCallback(async () => {
    const token = ++request.current;
    setLoading(true); setError('');
    try {
      const result = await ApiService.taskRecycle<TaskRecyclePage>('list', { query, projectId: projectId || null, page }, currentUser.id);
      if (token === request.current && active.current === scope) { setData(result); setDetail((current) => current && result.items.some((e) => e.id === current.task.id && !e.minimal) ? current : null); }
    } catch (reason) { if (token === request.current) setError(String(reason)); }
    finally { if (token === request.current) setLoading(false); }
  }, [query, projectId, page, currentUser.id, scope]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 200); return () => { window.clearTimeout(timer); request.current++; }; }, [load]);
  useEffect(() => { const timer = window.setInterval(() => { if (!actionLock.current) void load(); }, 20_000); return () => window.clearInterval(timer); }, [load]);
  useEffect(() => {
    const close = (event: Event) => document.querySelectorAll<HTMLDetailsElement>('.recycle-actions details[open]').forEach((menu) => { if (!menu.contains(event.target as Node)) menu.open = false; });
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') document.querySelectorAll<HTMLDetailsElement>('.recycle-actions details[open]').forEach((menu) => { menu.open = false; menu.querySelector<HTMLElement>('summary')?.focus(); }); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, []);
  const name = (id: string | null) => id === currentUser.id ? tr('tasks:taskLayoutPanel.me') : users.find((u) => u.id === id)?.nickname || id || tr('tasks:recycle.unknown');
  const location = (id: string | null) => projects.find((p) => p.id === id)?.name || (id ? tr('tasks:recycle.missingProject') : tr('tasks:kanbanView.personalTask'));
  const selectionFor = (entry: TaskRecycleEntry): Selection => [{ id: entry.id, deletionId: entry.meta.deletionId }];
  const perform = async (action: 'restore' | 'purge', selection: Selection, confirmed = false) => {
    if (readOnly || actionLock.current) return;
    if (action === 'purge' && !confirmed) { setConfirm({ action, selection }); return; }
    actionLock.current = true; setBusy(true); setError(''); setNotice('');
    detailRequest.current++;
    const operationScope = scope;
    try {
      const result = await ApiService.taskRecycle<TaskRecycleResult>(action, { selection, confirmed }, currentUser.id);
      if (active.current !== operationScope) return;
      if (result.needsConfirmation) { setConfirm({ action, selection, warnings: result.warnings }); return; }
      setConfirm(null); setDetail(null);
      if (action === 'purge') for (const item of selection) localStorage.removeItem(scopedStorageKey(`lanmind_task_attachments:${item.id}`));
      setNotice(tr(action === 'restore' ? 'tasks:recycle.restored' : 'tasks:recycle.purged'));
      await onChanged(); await load();
    } catch (reason) { if (active.current === operationScope) { await load(); setError(String(reason)); } }
    finally { actionLock.current = false; if (active.current === operationScope) setBusy(false); }
  };
  const preview = async (entry: TaskRecycleEntry) => {
    const token = ++detailRequest.current;
    setError('');
    try { const result = await ApiService.taskRecycle<TaskRecycleDetail>('detail', { id: entry.id }, currentUser.id); if (token === detailRequest.current && active.current === scope) setDetail(result); }
    catch (reason) { if (token === detailRequest.current) setError(String(reason)); }
  };
  const remaining = (expires: string) => {
    const hours = Math.max(0, Math.ceil((Date.parse(expires) - Date.now()) / 3_600_000));
    return tr(hours > 24 ? 'tasks:recycle.days' : 'tasks:recycle.hours', { count: hours > 24 ? Math.ceil(hours / 24) : hours });
  };
  const locationOptions: ThemeSelectOption[] = useMemo(() => [
    { value: '', label: tr('tasks:recycle.allLocations') },
    { value: 'personal', label: tr('tasks:kanbanView.personalTask') },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ], [projects]);
  return <section className="task-recycle-view" aria-label={tr('tasks:recycle.title')}>
    <header className="recycle-heading">
      {onBack && <button type="button" className="recycle-icon" onClick={onBack} aria-label={tr('tasks:recycle.back')}><ArrowLeft size={16} /></button>}
      <div className="recycle-heading-text"><h1><Trash2 size={18} />{tr('tasks:recycle.title')}<span>{tr('tasks:recycle.count', { count: data.total })}</span></h1><p>{tr('tasks:recycle.retention')}</p></div>
      <button type="button" className="recycle-icon" disabled={loading || busy} onClick={() => void load()} aria-label={tr('tasks:recycle.refresh')}><RefreshCw size={16} /></button>
    </header>
    <div className="recycle-toolbar">
      <label>
        <Search size={15} />
        <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder={tr('tasks:recycle.search')} aria-label={tr('tasks:recycle.search')} />
      </label>
      <div className="recycle-toolbar-select">
        <ThemeSelect
          portal
          value={projectId}
          options={locationOptions}
          onChange={(nextId) => { setProjectId(nextId); setPage(1); }}
          ariaLabel={tr('tasks:recycle.location')}
          width="auto"
        />
      </div>
    </div>
    {readOnly && <p className="recycle-message">{tr('tasks:recycle.readOnly')}</p>}
    {error && <p role="alert" className="recycle-message text-danger">{localizeMessage(error)}</p>}
    {notice && <p role="status" className="recycle-message text-success">{notice}</p>}
    <div className="recycle-list" aria-busy={loading}>
      <div className="recycle-columns" aria-hidden="true"><span>{tr('tasks:recycle.task')}</span><span>{tr('tasks:recycle.location')}</span><span>{tr('tasks:recycle.deletedBy')}</span><span>{tr('tasks:recycle.deletedAt')}</span><span>{tr('tasks:recycle.remaining')}</span><span /></div>
      {data.items.filter((entry) => !entry.parentTaskId || !data.items.some((parent) => parent.id === entry.parentTaskId && parent.meta.batchId === entry.meta.batchId) || expandedBatches.has(entry.meta.batchId)).map((entry) => {
        const group = data.items.filter((item) => item.meta.batchId === entry.meta.batchId);
        const groupSelection = entry.batchSelection || group.map((item) => ({ id: item.id, deletionId: item.meta.deletionId }));
        const familySize = Math.max(group.length, groupSelection.length);
        return <article className="recycle-row" key={entry.id} data-task-id={entry.id}>
          <div className="recycle-task-cell"><button className="recycle-title" type="button" disabled={entry.minimal} onClick={() => void preview(entry)}>{entry.identifier && <span>{entry.identifier}</span>}{entry.title}</button>{!entry.parentTaskId && familySize > 1 && <button type="button" className="recycle-family" aria-expanded={expandedBatches.has(entry.meta.batchId)} onClick={() => setExpandedBatches((current) => { const next = new Set(current); if (next.has(entry.meta.batchId)) next.delete(entry.meta.batchId); else next.add(entry.meta.batchId); return next; })}>{tr('tasks:recycle.children', { count: familySize - 1 })}</button>}</div>
          <span className="recycle-location">{location(entry.projectId)}</span><span className="recycle-actor">{name(entry.meta.deletedBy)}</span><time dateTime={entry.meta.deletedAt}>{formatTaskDateTime(entry.meta.deletedAt)}</time><span className="recycle-remaining">{remaining(entry.meta.expiresAt)}</span>
          <div className="recycle-actions"><button type="button" disabled={busy || readOnly || !entry.canRestore} title={entry.archived ? tr('tasks:recycle.archived') : undefined} onClick={() => void perform('restore', selectionFor(entry))}><RotateCcw size={13} />{tr('tasks:recycle.restore')}</button><details><summary aria-label={tr('tasks:recycle.more')}><MoreHorizontal size={17} /></summary><div className="recycle-menu">{groupSelection.length > 1 && <button type="button" disabled={busy || readOnly || group.some((e) => !e.canRestore)} onClick={(e) => { e.currentTarget.closest('details')?.removeAttribute('open'); void perform('restore', groupSelection); }}>{tr('tasks:recycle.restoreGroup', { count: groupSelection.length })}</button>}<button type="button" className="text-danger" disabled={busy || readOnly || !entry.canPurge} onClick={(e) => { e.currentTarget.closest('details')?.removeAttribute('open'); void perform('purge', selectionFor(entry)); }}>{tr('tasks:recycle.purge')}</button></div></details></div>
        </article>;
      })}
      {!data.items.length && <div className="recycle-empty"><Trash2 size={28} /><h2>{tr(loading ? 'tasks:recycle.loading' : query || projectId ? 'tasks:recycle.noResults' : 'tasks:recycle.empty')}</h2><p>{tr('tasks:recycle.retention')}</p>{(query || projectId) && <button type="button" onClick={() => { setQuery(''); setProjectId(''); setPage(1); }}>{tr('tasks:recycle.clear')}</button>}</div>}
    </div>
    {data.total > 50 && <footer className="recycle-pagination"><button type="button" disabled={busy || loading || data.page <= 1} onClick={() => setPage(data.page - 1)}>{tr('tasks:recycle.previous')}</button><span>{data.page} / {Math.ceil(data.total / 50)}</span><button type="button" disabled={busy || loading || data.page * 50 >= data.total} onClick={() => setPage(data.page + 1)}>{tr('tasks:recycle.next')}</button></footer>}
    {detail && !confirm && <RecycleDialog title={tr('tasks:recycle.preview')} onClose={() => setDetail(null)}><h3 className="recycle-preview-title">{detail.task.identifier} {detail.task.title}</h3><dl className="recycle-meta"><div><dt>{tr('tasks:recycle.location')}</dt><dd>{location(detail.task.projectId)}</dd></div><div><dt>{tr('tasks:recycle.deletedBy')}</dt><dd>{name(detail.meta.deletedBy)}</dd></div><div><dt>{tr('tasks:recycle.deletedAt')}</dt><dd>{formatTaskDateTime(detail.meta.deletedAt)}</dd></div><div><dt>{tr('tasks:recycle.expiresAt')}</dt><dd>{formatTaskDateTime(detail.meta.expiresAt)}</dd></div></dl><TaskMarkdown value={detail.task.description} attachments={detail.task.attachments} />{detail.task.subtasks.length > 0 && <ul className="recycle-checklist">{detail.task.subtasks.map((s) => <li key={s.id}>{s.completed ? '☑' : '☐'} {s.title}</li>)}</ul>}{detail.task.attachments?.map((file) => <div className="recycle-file" key={file.id}><span>{file.name} · {formatFileSize(file.size)}</span>{file.dataUrl && <button type="button" onClick={() => downloadFile(file.dataUrl!, file.name)}>{tr('tasks:listView.download')}</button>}</div>)}{detail.comments.length > 0 && <section className="recycle-comments"><h3>{tr('tasks:recycle.comments')}</h3>{detail.comments.map((comment) => <article key={comment.id}><span>{name(comment.authorId)} · {formatTaskDateTime(comment.createdAt)}</span><p>{comment.content}</p></article>)}</section>}<footer><button type="button" onClick={() => setDetail(null)}>{tr('tasks:recycle.close')}</button><button type="button" disabled={readOnly || busy || !data.items.find((e) => e.id === detail.task.id)?.canRestore} onClick={() => void perform('restore', [{ id: detail.task.id, deletionId: detail.meta.deletionId }])}>{tr('tasks:recycle.restore')}</button></footer></RecycleDialog>}
    {confirm && <RecycleDialog title={tr(confirm.action === 'purge' ? 'tasks:recycle.purgeTitle' : 'tasks:recycle.restoreTitle')} busy={busy} onClose={() => setConfirm(null)}><p>{tr(confirm.action === 'purge' ? 'tasks:recycle.purgeConfirm' : 'tasks:recycle.restoreConfirm', { count: confirm.selection.length })}</p><ul className="recycle-checklist">{confirm.selection.map((s) => <li key={s.id}>{data.items.find((e) => e.id === s.id)?.title || s.id}</li>)}</ul>{confirm.warnings && <ul className="recycle-checklist">{confirm.warnings.map((w, i) => <li key={i}>{tr(`tasks:recycle.warning.${w.kind}`)}</li>)}</ul>}{error && <p role="alert" className="text-danger">{localizeMessage(error)}</p>}<footer><button type="button" disabled={busy} onClick={() => setConfirm(null)}>{tr('tasks:taskModal.cancel')}</button><button className={confirm.action === 'purge' ? 'text-danger' : ''} type="button" disabled={busy} onClick={() => void perform(confirm.action, confirm.selection, true)}>{tr(busy ? 'tasks:recycle.processing' : confirm.action === 'purge' ? 'tasks:recycle.purge' : 'tasks:recycle.restore')}</button></footer></RecycleDialog>}
  </section>;
}
