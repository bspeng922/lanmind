/**
 * 知识库页面编辑器（主栏）。
 *
 * CALLING SPEC:
 *   <WikiPageEditor
 *     document={doc}
 *     ancestors={ancestors}
 *     projects={projects}
 *     pendingSave={pendingSave}
 *     storageOk={storageOk}
 *     currentUser={currentUser}
 *     workspaceId={workspaceId}
 *     onChange={(patch) => updateDoc(patch)}
 *     onSave={(patch) => saveDoc(patch)}
 *     onNavigate={(id) => openDoc(id)}
 *     onToggleFavorite={(id) => toggleFav(id)}
 *     onMovePage={() => openMoveModal()}
 *     onDuplicate={(id) => duplicateDoc(id)}
 *     onDelete={(id) => deleteDoc(id)}
 *   />
 *
 * TOOL CONTRACT:
 *   - 本地 Draft 机制 + 浏览器 SessionStorage 双重缓存，打字即时响应且光标绝不跳位
 *   - 显式「保存发布」按钮 + Ctrl+S 快捷键立即持久化入库，自动记录版本快照锚点
 *   - 沉浸式文档画布，集成 WikiDocHeader（展示创建时间、创建者、更新时间、修改者并支持打开历史）
 *   - 右下角协作讨论浮层（WikiComments），支持发言、引用与删除
 *   - 更多菜单集成历史记录、复制、移动、Markdown/Word/PDF 导出与删除
 */

import React, { useEffect, useMemo, useRef, useState, useCallback, lazy, Suspense } from 'react';
import { AlertCircle, Check } from 'lucide-react';
import { tr } from '../../i18n';
import type { User } from '../../types';
import type { WikiDocument, WikiProjectOption, WikiRevision } from './wikiTypes';
import type { WikiMarkdownEditorHandle } from './WikiMarkdownEditor';
import { WikiDocHeader } from './WikiDocHeader';
import { WikiStatusBar } from './WikiStatusBar';
import { WikiShareModal } from './WikiShareModal';
import { WikiHistoryModal } from './WikiHistoryModal';
import { WikiComments } from './WikiComments';
import { WikiEditorTopBar, EditorMode } from './WikiEditorTopBar';
import { ThemeSelectOption } from '../ThemeSelect';
import { exportWikiDocument, exportWikiWord, exportWikiPdf } from './wikiExport';
import { recordWikiDocumentChange } from './wikiHistoryStore';
import { getWorkspaceContext, scopedStorageKey } from '../../utils/workspaceContext';

const WikiMarkdownEditor = lazy(() => import('./WikiMarkdownEditor').then(module => ({ default: module.WikiMarkdownEditor })));
let sessionEditorMode: EditorMode = 'live';

interface WikiPageEditorProps {
  document: WikiDocument;
  ancestors: WikiDocument[];
  projects: WikiProjectOption[];
  pendingSave: boolean;
  storageOk: boolean;
  currentUser?: User;
  workspaceId?: string | null;
  onChange: (patch: Partial<WikiDocument>) => void;
  onSave?: (patch: Partial<WikiDocument>) => void;
  onDraftChange?: (patch: Partial<WikiDocument> | null) => void;
  resetToken?: number;
  onNavigate: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onMovePage?: () => void;
  onDuplicate?: (id: string) => void;
  onDelete?: (id: string) => void;
  onCreateChild?: () => void;
}

function computeReadingStats(text: string): { words: number; minutes: number } {
  const clean = text.replace(/```[\s\S]*?```/g, '').replace(/#+|\*+|`|\[.*?\]\(.*?\)/g, '');
  const cjkMatches = clean.match(/[\u4e00-\u9fa5]/g) || [];
  const enMatches = clean.match(/[a-zA-Z0-9_-]+/g) || [];
  const words = cjkMatches.length + enMatches.length;
  const minutes = words === 0 ? 0 : Math.max(1, Math.ceil(words / 300));
  return { words, minutes };
}

export const WikiPageEditor: React.FC<WikiPageEditorProps> = ({
  document: doc,
  ancestors,
  projects,
  pendingSave,
  storageOk,
  currentUser,
  workspaceId,
  onChange,
  onSave,
  onDraftChange,
  resetToken = 0,
  onNavigate,
  onToggleFavorite,
  onMovePage,
  onDuplicate,
  onDelete,
  onCreateChild,
}) => {
  const [historyScope] = useState(getWorkspaceContext);
  const draftKey = scopedStorageKey(`wiki-editor-draft:${doc.id}`, historyScope);
  const [mode, setMode] = useState<EditorMode>(sessionEditorMode);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);

  const [isExportingMarkdown, setIsExportingMarkdown] = useState(false);
  const [isExportingWord, setIsExportingWord] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [toastError, setToastError] = useState(false);

  const showToast = useCallback((msg: string, isError = false) => {
    setToastError(isError);
    setSuccessToast(msg);
    window.setTimeout(() => setSuccessToast(null), 2500);
  }, []);

  // 本地草稿与改动脏标记
  const [titleDraft, setTitleDraft] = useState(doc.title);
  const [contentDraft, setContentDraft] = useState(doc.content);
  const [isDirty, setIsDirty] = useState(false);
  const [isPublishedJustNow, setIsPublishedJustNow] = useState(false);

  // 宽屏模式（默认从本地存储恢复）
  const [fullWidth, setFullWidth] = useState(() => {
    try {
      return localStorage.getItem('wiki_editor_full_width') === 'true';
    } catch {
      return false;
    }
  });

  const toggleFullWidth = useCallback(() => {
    setFullWidth((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('wiki_editor_full_width', String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const editorRef = useRef<WikiMarkdownEditorHandle>(null);
  const draftCacheTimerRef = useRef<number | null>(null);
  const acceptedResetTokenRef = useRef(resetToken);
  const handleModeChange = useCallback((next: EditorMode) => {
    editorRef.current?.getValue();
    sessionEditorMode = next;
    setMode(next);
  }, []);

  const titleDraftRef = useRef(titleDraft);
  titleDraftRef.current = titleDraft;
  const contentDraftRef = useRef(contentDraft);
  contentDraftRef.current = contentDraft;
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const documentRef = useRef(doc);
  documentRef.current = doc;

  const flushDraftCache = useCallback(() => {
    if (draftCacheTimerRef.current !== null) window.clearTimeout(draftCacheTimerRef.current);
    draftCacheTimerRef.current = null;
    if (!isDirtyRef.current) return;
    try {
      sessionStorage.setItem(draftKey, JSON.stringify({
        title: titleDraftRef.current, content: contentDraftRef.current, version: documentRef.current.version,
      }));
    } catch { /* Retain the in-memory draft if storage is unavailable. */ }
  }, [draftKey]);
  const scheduleDraftCache = useCallback(() => {
    if (draftCacheTimerRef.current !== null) window.clearTimeout(draftCacheTimerRef.current);
    draftCacheTimerRef.current = window.setTimeout(flushDraftCache, 250);
  }, [flushDraftCache]);
  useEffect(() => {
    const flush = () => { editorRef.current?.getValue(); flushDraftCache(); };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    const visibility = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      flush();
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [flushDraftCache]);

  // 所有正文保存共用同一条历史链；文档版本号由后台确认，前端不猜测同步时钟。
  const saveDocument = useCallback((
    title: string,
    content: string,
    comment: string,
    backup?: Pick<WikiDocument, 'title' | 'content'>,
  ): boolean => {
    const before = documentRef.current;
    if (before.isLocked) return false;
    const author = {
      id: currentUser?.id || 'current',
      name: currentUser?.nickname || currentUser?.username || '当前用户',
    };
    const patch: Partial<WikiDocument> = {
      id: before.id, title, content,
      updatedBy: author.id,
      updatedByName: author.name,
      updatedAt: new Date().toISOString(),
    };
    const after = { ...before, ...patch };
    let historyBefore = before;
    if (backup && (backup.title !== before.title || backup.content !== before.content)) {
      historyBefore = { ...after, ...backup };
      recordWikiDocumentChange(before, historyBefore, author, '恢复前的草稿快照', workspaceId, historyScope);
    }
    recordWikiDocumentChange(historyBefore, after, author, comment, workspaceId, historyScope);
    if (before.title !== title || before.content !== content) {
      if (onSave) onSave(patch);
      else onChange(patch);
    }
    return true;
  }, [currentUser, workspaceId, historyScope, onSave, onChange]);

  // 1. 文档初始化与切换：检查 sessionStorage 是否有未发布的缓存草稿
  useEffect(() => {
    const discardDraft = acceptedResetTokenRef.current !== resetToken;
    acceptedResetTokenRef.current = resetToken;
    if (discardDraft) {
      // An explicit reload accepts server content, including when an old cache timer just ran.
      if (draftCacheTimerRef.current !== null) window.clearTimeout(draftCacheTimerRef.current);
      draftCacheTimerRef.current = null;
      editorRef.current?.replaceDocument(doc.content);
    }
    try {
      if (discardDraft) sessionStorage.removeItem(draftKey);
      const cached = discardDraft ? null : sessionStorage.getItem(draftKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && (parsed.content !== doc.content || parsed.title !== doc.title)) {
          setTitleDraft(parsed.title ?? doc.title);
          setContentDraft(parsed.content ?? doc.content);
          setIsDirty(true);
          isDirtyRef.current = true;
          onDraftChange?.({
            id: doc.id,
            title: parsed.title ?? doc.title,
            content: parsed.content ?? doc.content,
            version: parsed.version ?? doc.version,
          });
          return;
        }
      }
    } catch {
      /* ignore */
    }
    setTitleDraft(doc.title);
    setContentDraft(doc.content);
    setIsDirty(false);
    isDirtyRef.current = false;
    onDraftChange?.(null);
  }, [doc.id, draftKey, resetToken]);

  useEffect(() => {
    if (!isDirtyRef.current) {
      setTitleDraft(doc.title);
      setContentDraft(doc.content);
    }
  }, [doc.title, doc.content]);

  // 2. 离开页面或切换前：如果有脏数据，自动落盘入库
  useEffect(() => () => {
    editorRef.current?.getValue();
    flushDraftCache();
    if (isDirtyRef.current && saveDocument(titleDraftRef.current, contentDraftRef.current, '自动保存文档')) {
      isDirtyRef.current = false;
      try {
        sessionStorage.removeItem(draftKey);
      } catch {
        /* ignore */
      }
    }
  }, [draftKey, saveDocument, flushDraftCache]);

  const handleTitleChange = useCallback(
    (newTitle: string) => {
      titleDraftRef.current = newTitle;
      isDirtyRef.current = true;
      setTitleDraft(newTitle);
      setIsDirty(true);
      scheduleDraftCache();
      onDraftChange?.({ id: doc.id, title: newTitle, content: contentDraftRef.current, version: doc.version });
    },
    [doc.id, doc.version, scheduleDraftCache, onDraftChange],
  );

  const handleContentChange = useCallback(
    (newContent: string) => {
      contentDraftRef.current = newContent;
      isDirtyRef.current = true;
      setContentDraft(newContent);
      setIsDirty(true);
      scheduleDraftCache();
      onDraftChange?.({ id: doc.id, title: titleDraftRef.current, content: newContent, version: doc.version });
    },
    [doc.id, doc.version, scheduleDraftCache, onDraftChange],
  );

  /** 显式发布 / 保存入库 */
  const handlePublish = useCallback(() => {
    editorRef.current?.getValue();
    flushDraftCache();
    if (!saveDocument(titleDraftRef.current, contentDraftRef.current, '更新文档内容')) return;
    setIsDirty(false);
    isDirtyRef.current = false;
    onDraftChange?.(null);
    try {
      sessionStorage.removeItem(draftKey);
    } catch {
      /* ignore */
    }
    setIsPublishedJustNow(true);
    window.setTimeout(() => setIsPublishedJustNow(false), 2000);
  }, [saveDocument, onDraftChange, draftKey, flushDraftCache]);

  // 快捷键 Ctrl+S / Cmd+S 立即发布保存
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handlePublish();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePublish]);

  /** 恢复旧版本回调 */
  const handleRestoreRevision = useCallback(
    (revision: WikiRevision) => {
      editorRef.current?.getValue();
      if (!saveDocument(revision.title, revision.content, `恢复到版本 v.${revision.version}`, {
        title: titleDraftRef.current,
        content: contentDraftRef.current,
      })) return;

      setTitleDraft(revision.title);
      setContentDraft(revision.content);
      editorRef.current?.replaceDocument(revision.content);
      titleDraftRef.current = revision.title;
      contentDraftRef.current = revision.content;
      setIsDirty(false);
      isDirtyRef.current = false;
      onDraftChange?.(null);

      try {
        sessionStorage.removeItem(draftKey);
      } catch {
        /* ignore */
      }
      showToast(`已恢复至版本 v.${revision.version}`);
    },
    [saveDocument, onDraftChange, draftKey, showToast],
  );

  const displayTitle = titleDraft.trim() || tr('wiki:wikiView.untitledPage');
  const project = projects.find((item) => item.id === doc.projectId);
  const readingStats = useMemo(() => computeReadingStats(contentDraft), [contentDraft]);

  const projectSelectOptions: ThemeSelectOption[] = useMemo(() => {
    const defaultOpt: ThemeSelectOption = {
      value: '',
      label: tr('wiki:wikiEditor.noProject'),
      tone: 'slate',
    };
    const projectOpts: ThemeSelectOption[] = projects.map((p) => ({
      value: p.id,
      label: `💼 ${p.name}`,
      tone: 'blue',
    }));
    return [defaultOpt, ...projectOpts];
  }, [projects]);

  // 导出逻辑
  const handleExportMarkdown = async () => {
    editorRef.current?.getValue();
    setIsExportingMarkdown(true);
    try {
      const saved = await exportWikiDocument(
        { ...doc, title: titleDraftRef.current, content: contentDraftRef.current },
        project?.name,
      );
      if (saved) showToast('已成功导出 Markdown');
    } catch (e) {
      console.error('Failed to export markdown:', e);
    } finally {
      setIsExportingMarkdown(false);
    }
  };

  const handleExportWord = async () => {
    editorRef.current?.getValue();
    setIsExportingWord(true);
    try {
      const saved = await exportWikiWord(
        { ...doc, title: titleDraftRef.current, content: contentDraftRef.current },
        project?.name,
      );
      if (saved) showToast('已成功导出 Word 文档');
    } catch (e) {
      console.error('Failed to export word:', e);
      showToast(tr('wiki:wikiEditor.exportFailed'), true);
    } finally {
      setIsExportingWord(false);
    }
  };

  const handleExportPdf = async () => {
    editorRef.current?.getValue();
    setIsExportingPdf(true);
    try {
      const saved = await exportWikiPdf(
        { ...doc, title: titleDraftRef.current, content: contentDraftRef.current },
        project?.name,
      );
      if (saved) showToast(tr('wiki:wikiEditor.pdfExported'));
    } catch (e) {
      console.error('Failed to export pdf:', e);
      showToast(tr('wiki:wikiEditor.exportFailed'), true);
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <article className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-canvas">
      {/* 页面顶栏：面包屑、保存发布与更多菜单 */}
      <WikiEditorTopBar
        doc={doc}
        displayTitle={displayTitle}
        ancestors={ancestors}
        projects={projects}
        projectSelectOptions={projectSelectOptions}
        isDirty={isDirty}
        isPublishedJustNow={isPublishedJustNow && !pendingSave && storageOk}
        fullWidth={fullWidth}
        onNavigate={onNavigate}
        onChange={onChange}
        onPublish={handlePublish}
        onToggleFavorite={onToggleFavorite}
        toggleFullWidth={toggleFullWidth}
        onOpenHistory={() => setHistoryModalOpen(true)}
        onOpenShare={() => setShareModalOpen(false || true)}
        onMovePage={onMovePage}
        onDuplicate={onDuplicate ? () => onDuplicate(doc.id) : undefined}
        onDelete={onDelete ? () => onDelete(doc.id) : undefined}
        onCreateChild={onCreateChild}
        onExportMarkdown={handleExportMarkdown}
        onExportWord={handleExportWord}
        onExportPdf={handleExportPdf}
        isExportingMarkdown={isExportingMarkdown}
        isExportingWord={isExportingWord}
        isExportingPdf={isExportingPdf}
      />

      {/* 导出/操作提示信息 */}
      {successToast && (
        <div role={toastError ? 'alert' : 'status'} className={`shrink-0 px-4 py-1.5 text-center text-xs border-b flex items-center justify-center gap-2 animate-in fade-in ${toastError ? 'bg-danger/15 text-danger border-danger/30' : 'bg-success/15 text-success border-success/30'}`}>
          {toastError ? <AlertCircle className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
          <span>{successToast}</span>
        </div>
      )}

      {/* 同一编辑器实例承载编辑与源码，保留选择区和撤销历史。 */}
      <div data-wiki-canvas data-wiki-edit-canvas
        className={`min-h-0 flex-1 overflow-y-auto bg-canvas ${fullWidth ? 'px-6 sm:px-10 lg:px-16' : 'px-4 sm:px-8'}`}>
        <div className={`flex min-h-full flex-col py-6 sm:py-8 ${fullWidth ? 'w-full' : 'max-w-4xl mx-auto'}`}>
          {/* 顶部文字编辑按钮区（置于最上方：在图标和标签上面） */}
          <div
            id="wiki-toolbar-slot"
            className="wiki-toolbar-slot sticky top-0 z-20 -mt-2 mb-4 bg-canvas/80 backdrop-blur-md pt-1 pb-1 transition-all"
          />

          <WikiDocHeader title={titleDraft} icon={doc.icon} tags={doc.tags} isLocked={doc.isLocked}
            project={project} createdAt={doc.createdAt} createdByName={doc.createdByName}
            updatedAt={doc.updatedAt} updatedByName={doc.updatedByName} readingStats={readingStats}
            onTitleChange={handleTitleChange} onIconChange={(icon) => onChange({ icon })}
            onTagsChange={(tags) => onChange({ tags })} onOpenHistory={() => setHistoryModalOpen(true)} />
          <Suspense fallback={<p role="status" className="py-4 text-sm text-quiet">{tr('wiki:wikiEditor.loading')}</p>}>
            <WikiMarkdownEditor ref={editorRef} documentKey={draftKey} value={contentDraft} mode={mode}
              readOnly={!!doc.isLocked} onChange={handleContentChange} onBlur={flushDraftCache} />
          </Suspense>
        </div>
      </div>

      <WikiComments docId={doc.id} currentUser={currentUser} workspaceId={workspaceId}
        suspended={historyModalOpen || shareModalOpen} />

      {/* 底栏状态栏 */}
      <WikiStatusBar
        words={readingStats.words}
        minutes={readingStats.minutes}
        isLocked={doc.isLocked}
        isDirty={isDirty}
        storageOk={storageOk}
        pendingSave={pendingSave}
        fullWidth={fullWidth}
        onToggleFullWidth={toggleFullWidth}
        mode={mode}
        onModeChange={handleModeChange}
        onSave={handlePublish}
        updatedAt={doc.updatedAt}
      />

      {/* 分享弹窗 */}
      <WikiShareModal
        document={doc}
        isOpen={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
      />

      {/* 历史修改记录弹窗 */}
      <WikiHistoryModal
        doc={doc}
        ancestors={ancestors}
        isOpen={historyModalOpen}
        currentUser={currentUser}
        workspaceId={workspaceId}
        onClose={() => setHistoryModalOpen(false)}
        onRestore={handleRestoreRevision}
      />
    </article>
  );
};
