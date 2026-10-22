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
 *   - 底部协作讨论评论区（WikiComments），支持发言与删除
 *   - 更多菜单集成历史记录、复制、移动、Markdown/Word/PDF 导出与删除
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Check } from 'lucide-react';
import { formatRelativeTime, tr, useLocale } from '../../i18n';
import type { User } from '../../types';
import type { WikiDocument, WikiProjectOption, WikiRevision } from './wikiTypes';
import { WikiPagePreview } from './WikiPagePreview';
import { WikiToolbar } from './WikiToolbar';
import { WikiDocHeader } from './WikiDocHeader';
import { WikiPageTags } from './WikiPageTags';
import { WikiStatusBar } from './WikiStatusBar';
import { WikiShareModal } from './WikiShareModal';
import { WikiHistoryModal } from './WikiHistoryModal';
import { WikiComments } from './WikiComments';
import { WikiEditorTopBar, EditorMode } from './WikiEditorTopBar';
import { ThemeSelectOption } from '../ThemeSelect';
import { exportWikiDocument, exportWikiWord, exportWikiPdf } from './wikiExport';
import { recordWikiDocumentChange } from './wikiHistoryStore';
import { processPastedAsset, processDroppedAsset } from './wikiAssetHelper';
import { getWorkspaceContext, scopedStorageKey } from '../../utils/workspaceContext';

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

function formatUpdatedAt(iso: string, locale: string): string {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return '';
  const diffMinutes = Math.round((Date.now() - timestamp) / 60000);
  if (Math.abs(diffMinutes) < 1) return formatRelativeTime(0, 'minute');
  if (Math.abs(diffMinutes) < 60) return formatRelativeTime(-diffMinutes, 'minute');
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return formatRelativeTime(-diffHours, 'hour');
  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 30) return formatRelativeTime(-diffDays, 'day');
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(timestamp));
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
  const { locale } = useLocale();
  const [historyScope] = useState(getWorkspaceContext);
  const draftKey = scopedStorageKey(`wiki-editor-draft:${doc.id}`, historyScope);
  const [mode, setMode] = useState<EditorMode>('edit');
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);

  const [isExportingMarkdown, setIsExportingMarkdown] = useState(false);
  const [isExportingWord, setIsExportingWord] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
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

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    const canvas = canvasRef.current;
    if (!textarea || !canvas) return;
    const scrollTop = canvas.scrollTop;
    const followCaret = document.activeElement === textarea && canvas.scrollHeight - canvas.clientHeight - scrollTop <= 1;
    textarea.style.flexGrow = '0';
    textarea.style.height = '0px';
    textarea.style.height = `${Math.max(24, textarea.scrollHeight + 2)}px`;
    textarea.style.removeProperty('flex-grow');
    textarea.scrollTop = 0;
    canvas.scrollTop = followCaret ? canvas.scrollHeight : scrollTop;
  }, []);

  useLayoutEffect(() => {
    resizeTextarea();
  }, [contentDraft, mode, resizeTextarea]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || mode === 'preview') return;
    let width = textarea.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width === textarea.clientWidth) return;
      width = textarea.clientWidth;
      resizeTextarea();
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [mode, resizeTextarea]);

  /** 点击画布空白处自动定位光标至文档末尾 */
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('wiki-canvas-area')) {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
    }
  }, []);

  const titleDraftRef = useRef(titleDraft);
  titleDraftRef.current = titleDraft;
  const contentDraftRef = useRef(contentDraft);
  contentDraftRef.current = contentDraft;
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const documentRef = useRef(doc);
  documentRef.current = doc;

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
    try {
      const cached = sessionStorage.getItem(draftKey);
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
    if (isDirtyRef.current && saveDocument(titleDraftRef.current, contentDraftRef.current, '自动保存文档')) {
      isDirtyRef.current = false;
      try {
        sessionStorage.removeItem(draftKey);
      } catch {
        /* ignore */
      }
    }
  }, [draftKey, saveDocument]);

  const handleTitleChange = useCallback(
    (newTitle: string) => {
      titleDraftRef.current = newTitle;
      isDirtyRef.current = true;
      setTitleDraft(newTitle);
      setIsDirty(true);
      try {
        sessionStorage.setItem(
          draftKey,
          JSON.stringify({ title: newTitle, content: contentDraftRef.current, version: doc.version }),
        );
      } catch {
        /* ignore */
      }
      onDraftChange?.({ id: doc.id, title: newTitle, content: contentDraftRef.current, version: doc.version });
    },
    [doc.id, doc.version, draftKey, onDraftChange],
  );

  const handleContentChange = useCallback(
    (newContent: string) => {
      contentDraftRef.current = newContent;
      isDirtyRef.current = true;
      setContentDraft(newContent);
      setIsDirty(true);
      try {
        sessionStorage.setItem(
          draftKey,
          JSON.stringify({ title: titleDraftRef.current, content: newContent, version: doc.version }),
        );
      } catch {
        /* ignore */
      }
      onDraftChange?.({ id: doc.id, title: titleDraftRef.current, content: newContent, version: doc.version });
    },
    [doc.id, doc.version, draftKey, onDraftChange],
  );

  /** 显式发布 / 保存入库 */
  const handlePublish = useCallback(() => {
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
  }, [saveDocument, onDraftChange, draftKey]);

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
      if (!saveDocument(revision.title, revision.content, `恢复到版本 v.${revision.version}`, {
        title: titleDraftRef.current,
        content: contentDraftRef.current,
      })) return;

      setTitleDraft(revision.title);
      setContentDraft(revision.content);
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
    setIsExportingMarkdown(true);
    try {
      const saved = await exportWikiDocument(
        { ...doc, title: titleDraft, content: contentDraft },
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
    setIsExportingWord(true);
    try {
      const saved = await exportWikiWord(
        { ...doc, title: titleDraft, content: contentDraft },
        project?.name,
      );
      if (saved) showToast('已成功导出 Word 文档');
    } catch (e) {
      console.error('Failed to export word:', e);
    } finally {
      setIsExportingWord(false);
    }
  };

  const handleExportPdf = async () => {
    setIsExportingPdf(true);
    try {
      const saved = await exportWikiPdf(
        { ...doc, title: titleDraft, content: contentDraft },
        project?.name,
      );
      if (saved) showToast('已唤起 PDF 导出与打印');
    } catch (e) {
      console.error('Failed to export pdf:', e);
    } finally {
      setIsExportingPdf(false);
    }
  };

  /** 处理剪贴板粘贴资产 */
  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (doc.isLocked || !e.clipboardData) return;
    const snippet = await processPastedAsset(e.clipboardData);
    if (!snippet) return;
    e.preventDefault();
    const el = textareaRef.current;
    const start = el?.selectionStart ?? contentDraft.length;
    const end = el?.selectionEnd ?? contentDraft.length;
    const next = contentDraft.slice(0, start) + snippet + contentDraft.slice(end);
    handleContentChange(next);
    window.requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + snippet.length, start + snippet.length);
    });
  };

  /** 处理文件拖拽释放资产 */
  const handleDrop = async (e: React.DragEvent<HTMLTextAreaElement>) => {
    if (doc.isLocked || !e.dataTransfer) return;
    const snippet = await processDroppedAsset(e.dataTransfer);
    if (!snippet) return;
    e.preventDefault();
    const el = textareaRef.current;
    const start = el?.selectionStart ?? contentDraft.length;
    const end = el?.selectionEnd ?? contentDraft.length;
    const next = contentDraft.slice(0, start) + snippet + contentDraft.slice(end);
    handleContentChange(next);
    window.requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + snippet.length, start + snippet.length);
    });
  };

  return (
    <article className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-canvas">
      {/* 页面顶栏：面包屑、保存发布、宽屏切换、模式切换与更多菜单 */}
      <WikiEditorTopBar
        doc={doc}
        displayTitle={displayTitle}
        ancestors={ancestors}
        projects={projects}
        projectSelectOptions={projectSelectOptions}
        mode={mode}
        isDirty={isDirty}
        isPublishedJustNow={isPublishedJustNow}
        fullWidth={fullWidth}
        onNavigate={onNavigate}
        onChange={onChange}
        onPublish={handlePublish}
        onToggleFavorite={onToggleFavorite}
        toggleFullWidth={toggleFullWidth}
        onModeChange={setMode}
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

      {/* 快捷排版工具栏（编辑与分屏模式下置顶粘滞） */}
      {mode !== 'preview' && (
        <WikiToolbar
          textareaRef={textareaRef}
          value={contentDraft}
          onChange={handleContentChange}
          disabled={doc.isLocked}
        />
      )}

      {/* 导出/操作提示信息 */}
      {successToast && (
        <div className="shrink-0 bg-success/15 px-4 py-1.5 text-center text-xs text-success border-b border-success/30 flex items-center justify-center gap-2 animate-in fade-in">
          <Check className="h-3.5 w-3.5" />
          <span>{successToast}</span>
        </div>
      )}

      {/* 文档正文主画布（编辑模式） */}
      {mode === 'edit' && (
        <div
          ref={canvasRef}
          onClick={handleCanvasClick}
          data-wiki-canvas
          className={`wiki-canvas-area flex-1 min-h-0 overflow-y-auto bg-canvas transition-[padding] duration-150 ${
            fullWidth ? 'px-6 sm:px-10 lg:px-16' : 'px-4 sm:px-8'
          }`}
        >
          <div
            className={`wiki-canvas-area flex min-h-full flex-col py-6 sm:py-8 transition-[max-width] duration-150 ${
              fullWidth ? 'w-full max-w-full' : 'max-w-4xl mx-auto'
            }`}
          >
            {/* Notion / SiYuan 风格文档头部（元数据展示：创建者、修改者、最后修改时间等） */}
            <WikiDocHeader
              title={titleDraft}
              icon={doc.icon}
              tags={doc.tags}
              isLocked={doc.isLocked}
              project={project}
              createdAt={doc.createdAt}
              createdByName={doc.createdByName}
              updatedAt={doc.updatedAt}
              updatedByName={doc.updatedByName}
              readingStats={readingStats}
              onTitleChange={handleTitleChange}
              onIconChange={(newIcon) => onChange({ icon: newIcon })}
              onTagsChange={(tags) => onChange({ tags })}
              onOpenHistory={() => setHistoryModalOpen(true)}
            />

            {/* 无边框文档正文编辑区 */}
            <textarea
              ref={textareaRef}
              value={contentDraft}
              readOnly={doc.isLocked}
              onPaste={handlePaste}
              onDrop={handleDrop}
              onChange={(e) => handleContentChange(e.target.value)}
              placeholder={
                doc.isLocked
                  ? tr('wiki:wikiEditor.lockedPlaceholder')
                  : tr('wiki:wikiEditor.contentPlaceholder')
              }
              aria-label={tr('wiki:wikiEditor.contentLabel')}
              spellCheck={false}
              className="w-full min-h-[320px] grow shrink-0 resize-none overflow-hidden border-none bg-transparent p-0 font-sans text-sm sm:text-[15px] leading-relaxed text-main outline-none placeholder:text-placeholder/50 focus:ring-0 tracking-normal select-text"
            />
          </div>
        </div>
      )}

      {/* 双栏即时分屏模式 */}
      {mode === 'split' && (
        <div ref={canvasRef} data-wiki-canvas className="min-h-0 flex-1 overflow-y-auto bg-canvas">
          <div className={`flex min-h-full w-full ${fullWidth ? '' : 'max-w-7xl mx-auto'}`}>
            {/* 左侧：源码编辑区 */}
            <div className="flex w-1/2 min-w-0 flex-col border-r border-edge/70 px-6 py-6 lg:px-8">
              <input
                value={titleDraft}
                disabled={doc.isLocked}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder={tr('wiki:wikiEditor.titlePlaceholder')}
                className="w-full bg-transparent text-2xl font-bold tracking-tight text-main placeholder:text-placeholder/40 outline-none border-none mb-4 leading-tight"
              />
              <div className="mb-4">
                <WikiPageTags tags={doc.tags} isLocked={doc.isLocked} onChange={(tags) => onChange({ tags })} />
              </div>
              <textarea
                ref={textareaRef}
                value={contentDraft}
                readOnly={doc.isLocked}
                onPaste={handlePaste}
                onDrop={handleDrop}
                onChange={(e) => handleContentChange(e.target.value)}
                placeholder={
                  doc.isLocked
                    ? tr('wiki:wikiEditor.lockedPlaceholder')
                    : tr('wiki:wikiEditor.splitPlaceholder')
                }
                aria-label={tr('wiki:wikiEditor.contentLabel')}
                spellCheck={false}
                className="w-full min-h-0 grow shrink-0 resize-none overflow-hidden border-none bg-transparent p-0 font-mono text-xs sm:text-sm leading-relaxed text-main outline-none focus:ring-0 placeholder:text-placeholder/50"
              />
            </div>

            {/* 右侧：实时渲染预览区 */}
            <div className="w-1/2 min-w-0 bg-surface/20 px-6 py-6 lg:px-8 overflow-y-auto select-text cursor-auto">
              {/* 分屏预览顶部文档标题与标签，与左侧基线对齐 */}
              <div className="mb-4 pb-3 border-b border-edge/60 select-text">
                <div className="flex items-center gap-2">
                  {doc.icon && <span className="text-2xl select-none">{doc.icon}</span>}
                  <h1 className="text-2xl font-bold tracking-tight text-main leading-tight truncate select-text">
                    {displayTitle}
                  </h1>
                </div>
                {doc.tags && doc.tags.length > 0 && (
                  <div className="mt-2.5">
                    <WikiPageTags tags={doc.tags} isLocked={true} onChange={() => {}} />
                  </div>
                )}
              </div>
              {contentDraft.trim() ? (
                <WikiPagePreview content={contentDraft} />
              ) : (
                <div className="flex h-40 items-center justify-center text-xs text-quiet select-none">
                  {tr('wiki:wikiEditor.splitPreviewEmpty')}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 沉浸阅读预览模式 */}
      {mode === 'preview' && (
        <div data-wiki-canvas className="flex-1 min-h-0 overflow-y-auto py-8 sm:py-10 bg-canvas select-text cursor-auto">
          <div
            className={`transition-[max-width] duration-150 ${
              fullWidth ? 'w-full px-6 sm:px-10 lg:px-16' : 'max-w-4xl mx-auto px-6 sm:px-10'
            }`}
          >
            <div className="mb-6 flex items-center gap-3 border-b border-edge/60 pb-4 select-text">
              {doc.icon && <span className="text-4xl select-none">{doc.icon}</span>}
              <div className="flex-1 min-w-0 select-text">
                <h1 className="text-3xl sm:text-4xl font-extrabold text-main tracking-tight truncate select-text">
                  {displayTitle}
                </h1>
                <div className="mt-3">
                  <WikiPageTags tags={doc.tags} isLocked={doc.isLocked} onChange={(tags) => onChange({ tags })} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-quiet">
                  {project && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface border border-edge/80 px-2.5 py-0.5 text-xs text-sub">
                      {project.color && (
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: project.color }}
                          aria-hidden="true"
                        />
                      )}
                      <span className="font-medium text-main">{project.name}</span>
                    </span>
                  )}
                  <span>
                    {readingStats.words === 0
                      ? tr('wiki:wikiEditor.wordsOnly', { value0: 0 })
                      : tr('wiki:wikiEditor.readingTime', { value0: readingStats.words, value1: readingStats.minutes })}
                  </span>
                  <span>·</span>
                  <span>{tr('wiki:wikiEditor.updatedAt', { value0: formatUpdatedAt(doc.updatedAt, locale) })}</span>
                  {doc.createdByName && (
                    <>
                      <span>·</span>
                      <span>{tr('wiki:wikiEditor.creatorLabel', { value0: doc.createdByName })}</span>
                    </>
                  )}
                  {doc.updatedByName && (
                    <>
                      <span>·</span>
                      <span>{tr('wiki:wikiEditor.modifierLabel', { value0: doc.updatedByName })}</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {contentDraft.trim() ? (
              <WikiPagePreview content={contentDraft} />
            ) : (
              <p className="rounded-xl border border-dashed border-subtle px-4 py-16 text-center text-xs text-quiet">
                {tr('wiki:wikiEditor.emptyDocument')}
              </p>
            )}

            {/* 页面底部协同评论区 */}
            <div className="mt-12 pt-6 border-t border-edge/60">
              <WikiComments docId={doc.id} currentUser={currentUser} workspaceId={workspaceId} />
            </div>
          </div>
        </div>
      )}

      {/* 底栏状态栏 */}
      <WikiStatusBar
        words={readingStats.words}
        minutes={readingStats.minutes}
        isLocked={doc.isLocked}
        isDirty={isDirty}
        storageOk={storageOk}
        fullWidth={fullWidth}
        onToggleFullWidth={toggleFullWidth}
        mode={mode}
        onModeChange={setMode}
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
