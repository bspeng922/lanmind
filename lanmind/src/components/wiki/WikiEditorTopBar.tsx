/**
 * WikiEditorTopBar — 知识库编辑器顶栏（面包屑导航、保存发布、宽屏切换、模式切换与更多菜单）。
 *
 * CALLING SPEC:
 *   <WikiEditorTopBar
 *     doc={doc}
 *     displayTitle={displayTitle}
 *     ancestors={ancestors}
 *     projects={projects}
 *     projectSelectOptions={projectSelectOptions}
 *     mode={mode}
 *     isDirty={isDirty}
 *     isPublishedJustNow={isPublishedJustNow}
 *     fullWidth={fullWidth}
 *     onNavigate={onNavigate}
 *     onChange={onChange}
 *     onPublish={handlePublish}
 *     onToggleFavorite={onToggleFavorite}
 *     toggleFullWidth={toggleFullWidth}
 *     onModeChange={setMode}
 *     onOpenHistory={() => setHistoryModalOpen(true)}
 *     onOpenShare={() => setShareModalOpen(true)}
 *     onMovePage={onMovePage}
 *     onDuplicate={onDuplicate ? () => onDuplicate(doc.id) : undefined}
 *     onDelete={onDelete ? () => onDelete(doc.id) : undefined}
 *     onExportMarkdown={handleExportMarkdown}
 *     onExportWord={handleExportWord}
 *     onExportPdf={handleExportPdf}
 *     isExportingMarkdown={isExportingMarkdown}
 *     isExportingWord={isExportingWord}
 *     isExportingPdf={isExportingPdf}
 *   />
 *
 * TOOL CONTRACT:
 *   - 面包屑支持逐级跳转
 *   - 一键保存发布、宽屏全宽切换、收藏快捷键
 *   - 整合更多操作面板：查看历史、创建副本、移动、多格式导出(MD/Word/PDF)、锁定保护、删除
 *   - 模式切换：源码编辑 / 即时分屏 / 沉浸预览
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronRight,
  Check,
  Save,
  Star,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Unlock,
  Lock,
  Share2,
  FolderInput,
  Download,
  FileText,
  Printer,
  Copy,
  Trash2,
  Clock,
  Loader2,
  Edit3,
  Columns,
  Eye,
} from 'lucide-react';
import { tr, useLocale } from '../../i18n';
import type { WikiDocument, WikiProjectOption } from './wikiTypes';
import { ThemeSelect, ThemeSelectOption } from '../ThemeSelect';

export type EditorMode = 'edit' | 'split' | 'preview';

export interface WikiEditorTopBarProps {
  doc: WikiDocument;
  displayTitle: string;
  ancestors: WikiDocument[];
  projects: WikiProjectOption[];
  projectSelectOptions: ThemeSelectOption[];
  mode: EditorMode;
  isDirty: boolean;
  isPublishedJustNow: boolean;
  fullWidth: boolean;
  onNavigate: (id: string) => void;
  onChange: (patch: Partial<WikiDocument>) => void;
  onPublish: () => void;
  onToggleFavorite: (id: string) => void;
  toggleFullWidth: () => void;
  onModeChange: (mode: EditorMode) => void;
  onOpenHistory: () => void;
  onOpenShare: () => void;
  onMovePage?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onExportMarkdown: () => void;
  onExportWord: () => void;
  onExportPdf: () => void;
  isExportingMarkdown?: boolean;
  isExportingWord?: boolean;
  isExportingPdf?: boolean;
}

export const WikiEditorTopBar: React.FC<WikiEditorTopBarProps> = ({
  doc,
  displayTitle,
  ancestors,
  projects,
  projectSelectOptions,
  mode,
  isDirty,
  isPublishedJustNow,
  fullWidth,
  onNavigate,
  onChange,
  onPublish,
  onToggleFavorite,
  toggleFullWidth,
  onModeChange,
  onOpenHistory,
  onOpenShare,
  onMovePage,
  onDuplicate,
  onDelete,
  onExportMarkdown,
  onExportWord,
  onExportPdf,
  isExportingMarkdown = false,
  isExportingWord = false,
  isExportingPdf = false,
}) => {
  useLocale();
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  // 更多菜单点击外部关闭或按 Esc 关闭
  useEffect(() => {
    if (!moreMenuOpen) return;
    const handleOutside = (event: PointerEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setMoreMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleOutside, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handleOutside, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [moreMenuOpen]);

  return (
    <div className="relative z-20 flex shrink-0 items-center justify-between gap-3 border-b border-edge bg-surface px-4 py-2 shadow-xs">
      {/* 左侧：面包屑与紧凑更新时间 */}
      <nav
        aria-label={tr('wiki:wikiEditor.breadcrumbLabel')}
        className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-xs text-sub"
      >
        <div className="flex items-center gap-1.5 rounded-lg border border-subtle/80 bg-input/50 px-2 py-0.5 text-quiet">
          <BookOpen className="h-3.5 w-3.5 text-accent" />
          <span className="font-semibold text-main text-xs">{tr('wiki:wikiView.knowledgeBase')}</span>
        </div>

        <ChevronRight className="h-3 w-3 text-quiet/70 shrink-0" aria-hidden="true" />

        {ancestors.map((ancestor) => (
          <React.Fragment key={ancestor.id}>
            <button
              type="button"
              onClick={() => onNavigate(ancestor.id)}
              className="max-w-40 truncate rounded-md px-1.5 py-0.5 text-xs font-medium text-sub transition-colors hover:bg-hover hover:text-main"
              title={ancestor.title.trim() || tr('wiki:wikiView.untitledPage')}
            >
              {ancestor.title.trim() || tr('wiki:wikiView.untitledPage')}
            </button>
            <ChevronRight className="h-3 w-3 text-quiet/70 shrink-0" aria-hidden="true" />
          </React.Fragment>
        ))}

        <span
          className="max-w-60 truncate rounded-md bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent"
          aria-current="page"
        >
          {displayTitle}
        </span>
      </nav>

      {/* 右侧：关联项目、保存发布、视图模式与更多菜单 */}
      <div className="flex shrink-0 items-center gap-2">
        {/* 关联项目 */}
        <div className="w-40 hidden md:block">
          <ThemeSelect
            portal
            disabled={doc.isLocked}
            options={projectSelectOptions}
            value={doc.projectId || ''}
            onChange={(val) => {
              const nextProjectId = val || null;
              onChange({ projectId: nextProjectId });
            }}
            title={tr('wiki:wikiEditor.belongsToProject')}
          />
        </div>

        {/* 显式发布 / 保存按钮 */}
        <button
          type="button"
          onClick={onPublish}
          disabled={doc.isLocked}
          className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all ${
            isPublishedJustNow
              ? 'bg-success/15 text-success border border-success/30'
              : isDirty
                ? 'bg-accent text-on-accent shadow-soft hover:opacity-95 hover:scale-105 active:scale-95'
                : 'bg-input/60 text-quiet border border-subtle/80 hover:text-main'
          }`}
          title={
            isPublishedJustNow
              ? tr('wiki:wikiEditor.published')
              : isDirty
                ? '保存并发布到知识库 (快捷键 Ctrl+S)'
                : '已发布保存 (快捷键 Ctrl+S)'
          }
          aria-label="保存并发布"
        >
          {isPublishedJustNow ? (
            <Check className="h-3.5 w-3.5 text-success" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
        </button>

        {/* 收藏按钮 */}
        <button
          type="button"
          onClick={() => onToggleFavorite(doc.id)}
          aria-pressed={doc.favorite}
          className={`flex h-7 w-7 items-center justify-center rounded-lg border border-subtle/80 bg-input/60 transition-colors ${
            doc.favorite ? 'text-warning' : 'text-sub hover:text-main'
          }`}
          title={doc.favorite ? tr('wiki:wikiTree.removeFavorite') : tr('wiki:wikiTree.addFavorite')}
        >
          <Star className={`h-3.5 w-3.5 ${doc.favorite ? 'fill-current' : ''}`} />
        </button>

        {/* 宽屏全宽一键切换快捷按钮 */}
        <button
          type="button"
          onClick={toggleFullWidth}
          aria-pressed={fullWidth}
          className={`flex h-7 w-7 items-center justify-center rounded-lg border border-subtle/80 bg-input/60 transition-colors ${
            fullWidth ? 'text-accent border-accent/40 bg-accent/10' : 'text-sub hover:text-main'
          }`}
          title={fullWidth ? '切换为标准居中宽度 (约 860px)' : '切换为全宽铺满自适应 (Notion Full Width)'}
          aria-label={fullWidth ? '标准宽度' : '宽屏铺满'}
        >
          {fullWidth ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>

        {/* 更多菜单（历史、副本、移动、导出、锁定、分享、删除） */}
        <div className="relative" ref={moreMenuRef}>
          <button
            type="button"
            onClick={() => setMoreMenuOpen((prev) => !prev)}
            aria-expanded={moreMenuOpen}
            aria-label={tr('wiki:wikiEditor.moreActions')}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-subtle/80 bg-input/60 text-sub transition-colors hover:bg-hover hover:text-main"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>

          {moreMenuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-50 mt-1 w-48 rounded-xl border border-edge bg-card p-1 shadow-popover animate-in fade-in duration-100 divide-y divide-edge/60"
            >
              {/* 分组 1：历史记录、创建副本、移动 */}
              <div className="p-0.5 space-y-0.5">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    onOpenHistory();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-main bg-transparent hover:bg-hover focus:bg-hover focus:outline-none transition-colors"
                >
                  <Clock className="h-3.5 w-3.5 text-accent" />
                  <span>查看页面历史</span>
                </button>

                {onDuplicate && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      onDuplicate();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-main bg-transparent hover:bg-hover focus:bg-hover focus:outline-none transition-colors"
                  >
                    <Copy className="h-3.5 w-3.5 text-sub" />
                    <span>创建副本</span>
                  </button>
                )}

                {onMovePage && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      onMovePage();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-main bg-transparent hover:bg-hover focus:bg-hover focus:outline-none transition-colors"
                  >
                    <FolderInput className="h-3.5 w-3.5 text-accent" />
                    <span>{tr('wiki:wikiEditor.movePage')}</span>
                  </button>
                )}
              </div>

              {/* 分组 2：导出（Markdown / Word / PDF） */}
              <div className="p-0.5 space-y-0.5">
                <button
                  type="button"
                  role="menuitem"
                  disabled={isExportingMarkdown}
                  onClick={() => {
                    setMoreMenuOpen(false);
                    onExportMarkdown();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-main bg-transparent hover:bg-hover focus:bg-hover focus:outline-none transition-colors disabled:opacity-50"
                >
                  {isExportingMarkdown ? (
                    <Loader2 className="h-3.5 w-3.5 text-accent animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5 text-sub" />
                  )}
                  <span>导出为 Markdown</span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  disabled={isExportingWord}
                  onClick={() => {
                    setMoreMenuOpen(false);
                    onExportWord();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-main bg-transparent hover:bg-hover focus:bg-hover focus:outline-none transition-colors disabled:opacity-50"
                >
                  {isExportingWord ? (
                    <Loader2 className="h-3.5 w-3.5 text-accent animate-spin" />
                  ) : (
                    <FileText className="h-3.5 w-3.5 text-info" />
                  )}
                  <span>导出为 Word (.doc)</span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  disabled={isExportingPdf}
                  onClick={() => {
                    setMoreMenuOpen(false);
                    onExportPdf();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-main bg-transparent hover:bg-hover focus:bg-hover focus:outline-none transition-colors disabled:opacity-50"
                >
                  {isExportingPdf ? (
                    <Loader2 className="h-3.5 w-3.5 text-accent animate-spin" />
                  ) : (
                    <Printer className="h-3.5 w-3.5 text-success" />
                  )}
                  <span>导出为 PDF</span>
                </button>
              </div>

              {/* 分组 3：锁定、分享 */}
              <div className="p-0.5 space-y-0.5">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    onChange({ isLocked: !doc.isLocked });
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-main bg-transparent hover:bg-hover focus:bg-hover focus:outline-none transition-colors"
                >
                  {doc.isLocked ? (
                    <>
                      <Unlock className="h-3.5 w-3.5 text-warning" />
                      <span>{tr('wiki:wikiEditor.lockedTitle') || '解除只读锁定'}</span>
                    </>
                  ) : (
                    <>
                      <Lock className="h-3.5 w-3.5 text-sub" />
                      <span>{tr('wiki:wikiEditor.unlockedTitle') || '开启只读锁定'}</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    onOpenShare();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-main bg-transparent hover:bg-hover focus:bg-hover focus:outline-none transition-colors"
                >
                  <Share2 className="h-3.5 w-3.5 text-info" />
                  <span>{tr('wiki:wikiEditor.share') || '局域网分享'}</span>
                </button>
              </div>

              {/* 分组 4：删除 */}
              {onDelete && (
                <div className="p-0.5">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      onDelete();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-danger hover:bg-danger/10 focus:bg-danger/10 focus:outline-none transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>删除页面</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 模式切换：源码编辑 / 即时分屏 / 沉浸预览 */}
        <div className="flex items-center rounded-lg border border-subtle bg-input/80 p-0.5">
          <button
            type="button"
            onClick={() => onModeChange('edit')}
            aria-pressed={mode === 'edit'}
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
              mode === 'edit' ? 'bg-card text-main shadow-soft font-semibold' : 'text-sub hover:text-main'
            }`}
            title="纯文本源码模式"
          >
            <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{tr('wiki:wikiEditor.source')}</span>
          </button>
          <button
            type="button"
            onClick={() => onModeChange('split')}
            aria-pressed={mode === 'split'}
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
              mode === 'split' ? 'bg-card text-main shadow-soft font-semibold' : 'text-sub hover:text-main'
            }`}
            title="双栏即时分屏对照"
          >
            <Columns className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{tr('wiki:wikiEditor.split')}</span>
          </button>
          <button
            type="button"
            onClick={() => onModeChange('preview')}
            aria-pressed={mode === 'preview'}
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
              mode === 'preview' ? 'bg-card text-main shadow-soft font-semibold' : 'text-sub hover:text-main'
            }`}
            title="阅读排版预览"
          >
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{tr('wiki:wikiEditor.preview')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
