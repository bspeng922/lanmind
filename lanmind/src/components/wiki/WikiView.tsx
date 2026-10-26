import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ApiService } from "../../services/api";
import { getWorkspaceContext, sameWorkspace, scopedStorageKey } from "../../utils/workspaceContext";
/**
 * 知识库（Wiki）主视图。
 *
 * 公开接口：`export const WikiView: React.FC`，不接受任何 props，由 App.tsx 以 `<WikiView />` 挂载。
 * 内部结构可以自由重构，该签名保持不变。
 *
 * 组成：
 * - 左栏 `WikiPageTree`：260px 文档树，含收藏区、搜索框、新建、重命名、副本、删除、同级拖拽排序；
 * - 主栏 `WikiPageEditor`：面包屑 + 标题 + Markdown 正文（编辑 / 预览），项目关联选择器；
 * - 主栏 `WikiSearchResults`：有搜索关键词时替换编辑器，展示标题与正文片段命中；
 * - 空状态 `WikiEmptyState`：页面全部删除后引导创建第一篇。
 *
 * 持久化：全部经 `wikiStore`（localStorage）。输入 350ms 防抖落盘；
 * 切换页面、删除页面、卸载时先 flush 待保存内容，避免丢字。
 * 落盘失败（存储被禁用）时保留内存副本，并在编辑器底栏提示。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tr, useLocale } from '../../i18n';
import { WikiConfirmDialog } from './WikiConfirmDialog';
import { WikiEmptyState } from './WikiEmptyState';
import { WikiPageEditor } from './WikiPageEditor';
import { WikiPageTree } from './WikiPageTree';
import { WikiSearchResults } from './WikiSearchResults';
import { WikiMoveModal } from './WikiMoveModal';
import {
  ancestorsOf,
  collectSubtreeIds,
  createWikiDocument,
  getWikiStorageKey,
  loadWikiState,
  saveWikiState,
  searchWiki,
  type WikiSearchHit,
} from './wikiStore';
import { WIKI_SAVE_EVENT, wikiSaveBlocked, wikiSaveError, resetWikiQueue, rememberWikiBaseline } from './wikiPersistence';
import type { WikiDocument, WikiState } from './wikiTypes';
import { useWikiProjects } from './useWikiProjects';
import type { User } from '../../types';

const SAVE_DEBOUNCE = 350;

/** 待保存的增量。带上目标页面 id，切换页面过程中也不会写错对象。 */
interface PendingPatch {
  pageId: string;
  patch: Partial<WikiDocument>;
}

export interface WikiViewProps {
  workspaceId?: string | null;
  linkedDocumentId?: string | null;
  currentUser?: User;
  users?: User[];
}

export const WikiView: React.FC<WikiViewProps> = ({
  workspaceId,
  linkedDocumentId,
  currentUser,
  users,
}) => {
  useLocale();
  const projects = useWikiProjects();
  const [scope]=useState(() => getWorkspaceContext());

  const [state, setState] = useState<WikiState>(() => loadWikiState(workspaceId,scope));
  const [query, setQuery] = useState('');
  const storageKey = getWikiStorageKey(workspaceId, scope);
  const [saveError, setSaveError] = useState(() => wikiSaveError(storageKey));
  const [storageOk, setStorageOk] = useState(() => !wikiSaveError(storageKey));
  const saveErrorRef = useRef(saveError);
  const [pendingSave, setPendingSave] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    title: string;
    descendants: number;
  } | null>(null);
  const [movingDoc, setMovingDoc] = useState<WikiDocument | null>(null);

  const touchedRef=useRef(0);
  const resolvedLinkRef = useRef<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const pendingRef = useRef<PendingPatch | null>(null);
  const editorDraftRef = useRef<PendingPatch | null>(null);
  const [editorReset, setEditorReset] = useState(0);
  const timerRef = useRef<number | null>(null);

  // A sync refresh waits for local edits and ignores results overtaken by newer input.
  useEffect(() => {
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let unlisten: (() => void) | undefined;
    const refresh = async () => {
      if (!alive || !scope || !sameWorkspace(scope)) return;
      if (saveErrorRef.current) return;
      if (pendingRef.current || editorDraftRef.current || wikiSaveBlocked(storageKey)) { clearTimeout(retry); retry = setTimeout(refresh, SAVE_DEBOUNCE + 100); return; }
      const generation = touchedRef.current;
      try {
        const value = await ApiService.getWorkspaceData('wiki');
        if (!alive || generation !== touchedRef.current || pendingRef.current || editorDraftRef.current || !sameWorkspace(scope)) return;
        if (!value) { rememberWikiBaseline(storageKey, []); saveWikiState(stateRef.current, workspaceId, scope); return; }
        const saved = value as WikiState;
        if (Array.isArray(saved.documents)) {
          const current = stateRef.current;
          const next = { ...saved, selectedId: saved.documents.some(d => d.id === current.selectedId) ? current.selectedId : saved.selectedId };
          stateRef.current = next; setState(next);
          saveWikiState(next, workspaceId, scope, false);
        }
      } catch (error) { if (alive) console.error(error); }
    };
    void refresh();
    if (isTauri()) void listen<{ workspaceId?: string }>('sync://operation', event => {
      if (event.payload.workspaceId === workspaceId) void refresh();
    }).then(dispose => { if (!alive) dispose(); else unlisten = dispose; });
    return () => { alive = false; clearTimeout(retry); unlisten?.(); };
  }, [workspaceId, scope]);

  useEffect(() => {
    const saved = (event: Event) => {
      const detail = (event as CustomEvent<{key: string; error?: string; documents?: WikiDocument[]; pending?: boolean}>).detail;
      if (detail.key !== storageKey || !sameWorkspace(scope)) return;
      setPendingSave(!!detail.pending || !!pendingRef.current);
      if (detail.error) { saveErrorRef.current = detail.error; setSaveError(detail.error); setStorageOk(false); return; }
      if (!detail.documents) return;
      // 本窗口保存图标、标签后，尚未发布的正文草稿仍基于这次已确认的版本。
      const draft = editorDraftRef.current;
      const acknowledged = detail.documents?.find(doc => doc.id === draft?.pageId);
      if (draft && acknowledged) {
        editorDraftRef.current = { ...draft, patch: { ...draft.patch, version: acknowledged.version } };
        try {
          const draftKey = scopedStorageKey(`wiki-editor-draft:${draft.pageId}`, scope);
          const cached = sessionStorage.getItem(draftKey);
          if (cached) sessionStorage.setItem(draftKey, JSON.stringify({ ...JSON.parse(cached), version: acknowledged.version }));
        } catch { /* The live draft remains available. */ }
      }
      const next = { ...stateRef.current, documents: stateRef.current.documents.map(doc => {
        const saved = detail.documents?.find(p => p.id === doc.id);
        return saved ? { ...doc, version: saved.version, updatedAt: saved.updatedAt } : doc;
      }) };
      stateRef.current = next; setState(next); saveWikiState(next, workspaceId, scope, false);
    };
    window.addEventListener(WIKI_SAVE_EVENT, saved);
    return () => window.removeEventListener(WIKI_SAVE_EVENT, saved);
  }, [storageKey, workspaceId, scope]);
  const reloadAfterConflict = async () => {
    try {
      localStorage.setItem(`${storageKey}:conflict-draft`, JSON.stringify(currentDraft()));
      const generation = touchedRef.current;
      const latest = await ApiService.getWorkspaceData('wiki') as WikiState | null;
      if (!latest || !sameWorkspace(scope) || generation !== touchedRef.current) return;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null; pendingRef.current = null; setPendingSave(false);
      editorDraftRef.current = null;
      if (stateRef.current.selectedId) sessionStorage.removeItem(scopedStorageKey(`wiki-editor-draft:${stateRef.current.selectedId}`, scope));
      setEditorReset(value => value + 1);
      resetWikiQueue(storageKey); saveErrorRef.current = ''; setSaveError(''); setStorageOk(true);
      stateRef.current = latest; setState(latest); saveWikiState(latest, workspaceId, scope, false);
    } catch (error) { setSaveError(String(error)); }
  };
  const currentDraft = () => {
    const current = stateRef.current;
    return { ...current, documents: current.documents.map(doc => {
      let next = doc;
      for (const patch of [pendingRef.current, editorDraftRef.current]) if (patch?.pageId === doc.id) next = { ...next, ...patch.patch };
      return next;
    }) };
  };
  const handleDraftChange = useCallback((patch: Partial<WikiDocument> | null) => {
    touchedRef.current++;
    editorDraftRef.current = patch?.id ? { pageId: patch.id, patch } : null;
    const original = stateRef.current.documents.find(doc => doc.id === patch?.id);
    if (patch?.version !== undefined && original?.version !== undefined && patch.version !== original.version) {
      const error = 'VERSION_CONFLICT: ' + tr('wiki:persistence.conflict');
      saveErrorRef.current = error; setSaveError(error); setStorageOk(false);
      try { localStorage.setItem(`${storageKey}:save-error`, error); } catch { /* Keep the live draft. */ }
    }
  }, [storageKey]);

  // Only documents returned by the authorized store can be resolved from a link.
  useEffect(() => {
    if (!linkedDocumentId || resolvedLinkRef.current === linkedDocumentId) return;
    if (!state.documents.some((d) => d.id === linkedDocumentId)) {
      const fresh = loadWikiState(workspaceId, scope);
      if (fresh.documents.some((d) => d.id === linkedDocumentId)) {
        stateRef.current = fresh;
        setState(fresh);
      } else {
        return;
      }
    }
    resolvedLinkRef.current = linkedDocumentId;
    setState((current) => ({ ...current, selectedId: linkedDocumentId }));
    setQuery('');
  }, [linkedDocumentId, state.documents, workspaceId, scope]);

  const documents = state.documents;
  const selectedId = state.selectedId;

  /** 把状态写入内存与存储。storageOk 反映本次写入是否成功。 */
  const commitState = useCallback((next: WikiState) => {
    touchedRef.current += 1;
    stateRef.current = next;
    setState(next);
    setStorageOk(saveWikiState(next, workspaceId,scope));
  }, [workspaceId]);

  /** 立即落盘待保存的增量。 */
  const flushPending = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    setPendingSave(false);
    if (!pending) return;
    const current = stateRef.current;
    const next: WikiState = {
      ...current,
      documents: current.documents.map((doc) =>
        doc.id === pending.pageId
          ? { ...doc, ...pending.patch, updatedAt: new Date().toISOString() }
          : doc,
      ),
    };
    commitState(next);
  }, [commitState]);

  // 页面切换前先落盘。cleanup 在下一次 selectedId 生效前执行，
  // 此时 pendingRef 里可能还压着上一页的改动，直接落盘即可——增量自带页面 id，不会写错对象。
  useEffect(() => () => {
    if (pendingRef.current) flushPending();
  }, [selectedId, flushPending]);

  // 卸载时落盘。
  useEffect(() => () => {
    if (pendingRef.current) flushPending();
  }, [flushPending]);

  const handleChange = useCallback(
    (patch: Partial<WikiDocument>) => {
      const pageId = patch.id ?? stateRef.current.selectedId;
      if (!pageId) return;
      touchedRef.current += 1;
      pendingRef.current = { pageId, patch: { ...(pendingRef.current?.pageId === pageId ? pendingRef.current.patch : {}), ...patch } };
      // 元数据立即反馈到头部和导航树，持久化仍合并到同一次防抖保存。
      const next = {
        ...stateRef.current,
        documents: stateRef.current.documents.map(doc => doc.id === pageId ? { ...doc, ...patch } : doc),
      };
      stateRef.current = next;
      setState(next);
      setPendingSave(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(flushPending, SAVE_DEBOUNCE);
    },
    [flushPending],
  );

  /** 显式点击保存发布或快捷键保存：立即落盘入库 */
  const handleSave = useCallback(
    (patch: Partial<WikiDocument>) => {
      const pageId = patch.id ?? stateRef.current.selectedId;
      if (!pageId) return;
      touchedRef.current += 1;
      pendingRef.current = { pageId, patch: { ...(pendingRef.current?.pageId === pageId ? pendingRef.current.patch : {}), ...patch } };
      flushPending();
    },
    [flushPending],
  );

  const handleSelect = useCallback(
    (id: string) => {
      if (!stateRef.current.documents.some((doc) => doc.id === id)) return;
      if (stateRef.current.selectedId === id) return;
      flushPending();
      commitState({ ...stateRef.current, selectedId: id });
    },
    [commitState, flushPending],
  );

  /**
   * 打开检索结果。命中点击必须同时清空关键词，否则主栏仍停留在检索结果页，
   * 会表现为「点了没反应」。清空关键词与切换选中项在同一次提交里完成。
   */
  const handleOpenFromSearch = useCallback(
    (id: string) => {
      if (!stateRef.current.documents.some((doc) => doc.id === id)) return;
      flushPending();
      setQuery('');
      commitState({ ...stateRef.current, selectedId: id });
    },
    [commitState, flushPending],
  );

  const handleToggleExpanded = useCallback(
    (id: string) => {
      const current = stateRef.current;
      const expanded = current.expandedIds.includes(id)
        ? current.expandedIds.filter((item) => item !== id)
        : [...current.expandedIds, id];
      commitState({ ...current, expandedIds: expanded });
    },
    [commitState],
  );

  /** 新建页面。子页面插到同级末尾并自动展开父级。 */
  const handleCreatePage = useCallback(
    (parentId: string | null) => {
      flushPending();
      const current = stateRef.current;
      const siblings = current.documents.filter((doc) => doc.parentId === parentId);
      const authorId = currentUser?.id;
      const authorName = currentUser?.nickname || currentUser?.username;
      const page = createWikiDocument({
        parentId,
        sortOrder: siblings.length,
        createdBy: authorId,
        createdByName: authorName,
        updatedBy: authorId,
        updatedByName: authorName,
      });
      commitState({
        documents: [...current.documents, page],
        selectedId: page.id,
        expandedIds: parentId && !current.expandedIds.includes(parentId)
          ? [...current.expandedIds, parentId]
          : current.expandedIds,
      });
      setQuery('');
    },
    [commitState, flushPending, currentUser],
  );

  /** 递归删除：先确认，再连同全部后代一起移除。 */
  const confirmDelete = useCallback(() => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    const current = stateRef.current;
    const ids = new Set(collectSubtreeIds(current.documents, target.id));
    const remaining = current.documents.filter((doc) => !ids.has(doc.id));
    const nextSelectedId = current.selectedId && ids.has(current.selectedId)
      ? remaining[0]?.id ?? null
      : current.selectedId;
    pendingRef.current = null;
    commitState({
      documents: remaining,
      selectedId: nextSelectedId,
      expandedIds: current.expandedIds.filter((id) => !ids.has(id)),
    });
  }, [commitState, deleteTarget]);

  const handleRequestDelete = useCallback((id: string) => {
    const current = stateRef.current;
    const target = current.documents.find((doc) => doc.id === id);
    if (!target) return;
    setDeleteTarget({
      id,
      title: target.title.trim() || tr('wiki:wikiView.untitledPage'),
      descendants: collectSubtreeIds(current.documents, id).length - 1,
    });
  }, []);

  const handleRename = useCallback(
    (id: string, title: string) => {
      flushPending();
      const current = stateRef.current;
      commitState({
        ...current,
        documents: current.documents.map((doc) =>
          doc.id === id ? { ...doc, title, updatedAt: new Date().toISOString() } : doc,
        ),
      });
    },
    [commitState, flushPending],
  );

  /** 创建副本：内容与子页面一并复制，标题追加「副本」。 */
  const handleDuplicate = useCallback(
    (id: string) => {
      // 先落盘待保存的改动，否则在防抖窗口内复制会得到缺少最后几个字符的副本。
      flushPending();
      const current = stateRef.current;
      const source = current.documents.find((doc) => doc.id === id);
      if (!source) return;
      const subtreeIds = new Set(collectSubtreeIds(current.documents, id));
      const idMap = new Map<string, string>();
      // 预先分配副本 id，保证父子引用在复制后仍然成立。
      for (const docId of subtreeIds) idMap.set(docId, createWikiDocument({ title: '' }).id);

      const siblings = current.documents.filter((doc) => doc.parentId === source.parentId);
      const clones: WikiDocument[] = [];
      for (const doc of current.documents) {
        if (!subtreeIds.has(doc.id)) continue;
        const cloneId = idMap.get(doc.id) as string;
        const cloneParentId = doc.id === id ? source.parentId : idMap.get(doc.parentId ?? '') ?? null;
        clones.push({
          ...doc,
          id: cloneId,
          title: doc.id === id ? `${doc.title} ${tr('wiki:wikiView.copySuffix')}`.trim() : doc.title,
          parentId: cloneParentId,
          sortOrder: doc.id === id ? siblings.length : doc.sortOrder,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }

      const rootCloneId = idMap.get(id) as string;
      commitState({
        documents: [...current.documents, ...clones],
        selectedId: rootCloneId,
        expandedIds: current.expandedIds,
      });
      setQuery('');
    },
    [commitState, flushPending],
  );

  const handleToggleFavorite = useCallback(
    (id: string) => {
      flushPending();
      const current = stateRef.current;
      commitState({
        ...current,
        documents: current.documents.map((doc) =>
          doc.id === id ? { ...doc, favorite: !doc.favorite } : doc,
        ),
      });
    },
    [commitState, flushPending],
  );

  /** 同级排序：把页面移动到目标父级下的指定下标。 */
  const handleReorder = useCallback(
    (pageId: string, parentId: string | null, index: number) => {
      flushPending();
      const current = stateRef.current;
      const moving = current.documents.find((doc) => doc.id === pageId);
      if (!moving) return;
      const siblings = current.documents
        .filter((doc) => doc.parentId === parentId && doc.id !== pageId)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      const clamped = Math.max(0, Math.min(index, siblings.length));
      siblings.splice(clamped, 0, { ...moving, parentId });
      const order = new Map(siblings.map((doc, position) => [doc.id, position]));
      commitState({
        ...current,
        documents: current.documents.map((doc) =>
          order.has(doc.id)
            ? { ...doc, parentId, sortOrder: order.get(doc.id) as number }
            : doc,
        ),
      });
    },
    [commitState, flushPending],
  );

  /** 移动页面到指定的父页面或根目录 */
  const handleMovePage = useCallback(
    (pageId: string, newParentId: string | null) => {
      flushPending();
      const current = stateRef.current;
      const targetDoc = current.documents.find((doc) => doc.id === pageId);
      if (!targetDoc) return;
      if (targetDoc.parentId === newParentId) return;

      const subtreeIds = new Set(collectSubtreeIds(current.documents, pageId));
      if (newParentId && subtreeIds.has(newParentId)) return;

      const newSiblings = current.documents.filter(
        (doc) => doc.parentId === newParentId && doc.id !== pageId,
      );
      const updatedExpandedIds =
        newParentId && !current.expandedIds.includes(newParentId)
          ? [...current.expandedIds, newParentId]
          : current.expandedIds;

      commitState({
        ...current,
        documents: current.documents.map((doc) =>
          doc.id === pageId
            ? {
                ...doc,
                parentId: newParentId,
                sortOrder: newSiblings.length,
                updatedAt: new Date().toISOString(),
              }
            : doc,
        ),
        expandedIds: updatedExpandedIds,
      });
      setMovingDoc(null);
    },
    [commitState, flushPending],
  );

  const searchHits: WikiSearchHit[] = useMemo(
    () => (query.trim() ? searchWiki(documents, query) : []),
    [documents, query],
  );
  const matchedIds = useMemo(
    () => new Set(searchHits.map((hit) => hit.document.id)),
    [searchHits],
  );

  const selected = documents.find((doc) => doc.id === selectedId) ?? documents[0];
  const ancestors = useMemo(
    () => (selected ? ancestorsOf(documents, selected.id) : []),
    [documents, selected],
  );
  const pathOf = useCallback((id: string) => ancestorsOf(documents, id), [documents]);

  return (
    <section
      className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-canvas text-main"
      aria-label={tr('wiki:wikiView.wikiSurfaceLabel')}
    >
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {documents.length > 0 && (
          <WikiPageTree
            documents={documents}
            selectedId={selected?.id ?? null}
            expandedIds={state.expandedIds}
            matchedIds={matchedIds}
            query={query}
            onQueryChange={setQuery}
            onSelect={handleSelect}
            onToggleExpanded={handleToggleExpanded}
            onCreatePage={handleCreatePage}
            onRename={handleRename}
            onDuplicate={handleDuplicate}
            onDelete={handleRequestDelete}
            onToggleFavorite={handleToggleFavorite}
            onReorder={handleReorder}
            onMovePage={(id) => setMovingDoc(documents.find((d) => d.id === id) ?? null)}
          />
        )}

        {documents.length === 0 ? (
          <WikiEmptyState onCreate={() => handleCreatePage(null)} />
        ) : query.trim() ? (
          <WikiSearchResults
            query={query}
            hits={searchHits}
            pathOf={pathOf}
            onOpen={handleOpenFromSearch}
            onOpenAncestor={handleOpenFromSearch}
          />
        ) : selected ? (
          <WikiPageEditor
            key={selected.id}
            document={selected}
            ancestors={ancestors}
            projects={projects}
            pendingSave={pendingSave}
            storageOk={storageOk}
            currentUser={currentUser}
            workspaceId={workspaceId}
            onChange={handleChange}
            onSave={handleSave}
            onDraftChange={handleDraftChange}
            resetToken={editorReset}
            onNavigate={handleSelect}
            onToggleFavorite={handleToggleFavorite}
            onMovePage={() => setMovingDoc(selected)}
            onDuplicate={handleDuplicate}
            onDelete={handleRequestDelete}
            onCreateChild={() => handleCreatePage(selected.id)}
          />
        ) : null}
      </div>

      {saveError && <div role="alert" className="mx-4 my-3 shrink-0 rounded-lg border border-subtle bg-surface p-3 text-xs text-main shadow-soft">
        <p>{tr('wiki:persistence.conflict')}</p><p className="mt-1 text-sub">{saveError}</p>
          <button className="mt-2 underline" onClick={() => { const blob = new Blob([JSON.stringify(currentDraft(), null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'wiki-draft.json'; a.click(); URL.revokeObjectURL(url); }}>{tr('wiki:persistence.exportDraft')}</button>
        <button className="ml-4 underline" onClick={() => void reloadAfterConflict()}>{tr('wiki:persistence.reload')}</button>
      </div>}
      <WikiConfirmDialog
        open={Boolean(deleteTarget)}
        danger
        title={tr('wiki:wikiDelete.title')}
        message={
          deleteTarget && deleteTarget.descendants > 0
            ? tr('wiki:wikiDelete.confirmWithChildren', {
                value0: deleteTarget.title,
                value1: deleteTarget.descendants,
              })
            : tr('wiki:wikiDelete.confirmSingle', { value0: deleteTarget?.title ?? '' })
        }
        confirmLabel={tr('wiki:wikiDelete.confirm')}
        cancelLabel={tr('wiki:wikiDelete.cancel')}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
      <WikiMoveModal
        doc={movingDoc}
        documents={documents}
        isOpen={Boolean(movingDoc)}
        onClose={() => setMovingDoc(null)}
        onMove={handleMovePage}
      />
    </section>
  );
};
