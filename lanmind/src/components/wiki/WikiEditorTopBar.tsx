/**
 * WikiEditorTopBar — 知识库编辑器顶栏（面包屑导航、保存发布与更多菜单）。
 *
 * CALLING SPEC:
 *   <WikiEditorTopBar
 *     doc={doc}
 *     displayTitle={displayTitle}
 *     ancestors={ancestors}
 *     projects={projects}
 *     projectSelectOptions={projectSelectOptions}
 *     isDirty={isDirty}
 *     isPublishedJustNow={isPublishedJustNow}
 *     fullWidth={fullWidth}
 *     onNavigate={onNavigate}
 *     onChange={onChange}
 *     onPublish={handlePublish}
 *     onToggleFavorite={onToggleFavorite}
 *     toggleFullWidth={toggleFullWidth}
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
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BookOpen,
  ChevronRight,
  Check,
  Save,
  Star,
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
  Plus,
  Sparkles,
  Boxes,
  Link2,
} from 'lucide-react';
import { tr, useLocale } from '../../i18n';
import type { WikiDocument, WikiProjectOption } from './wikiTypes';
import { copyWikiReference } from './wikiLinks';
import { ThemeSelect, ThemeSelectOption } from '../ThemeSelect';

export type EditorMode = 'live' | 'edit';

export interface WikiEditorTopBarProps {
  doc: WikiDocument;
  displayTitle: string;
  ancestors: WikiDocument[];
  projects: WikiProjectOption[];
  projectSelectOptions: ThemeSelectOption[];
  isDirty: boolean;
  isPublishedJustNow: boolean;
  fullWidth?: boolean;
  onNavigate: (id: string) => void;
  onChange: (patch: Partial<WikiDocument>) => void;
  onPublish: () => void;
  onOpenPolish?: () => void;
  polishAvailable?: boolean;
  polishEmpty?: boolean;
  onToggleFavorite: (id: string) => void;
  toggleFullWidth?: () => void;
  onOpenHistory: () => void;
  onOpenShare: () => void;
  onMovePage?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onCreateChild?: () => void;
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
  isDirty,
  isPublishedJustNow,
  fullWidth: _fullWidth,
  onNavigate,
  onChange,
  onPublish,
  onOpenPolish,
  polishAvailable = false,
  polishEmpty = false,
  onToggleFavorite,
  toggleFullWidth: _toggleFullWidth,
  onOpenHistory,
  onOpenShare,
  onMovePage,
  onDuplicate,
  onDelete,
  onCreateChild,
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
  const moreMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number; maxHeight: number; placement: 'bottom' | 'top' } | null>(null);
  const [menuTheme, setMenuTheme] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);

  const handleCopyLink = async () => {
    try {
      await copyWikiReference(doc);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy wiki reference', err);
    }
  };

  // 计算更多菜单浮层坐标与自适应上下翻转
  const calcMenuPosition = useCallback(() => {
    const trigger = moreMenuTriggerRef.current;
    if (!trigger) return null;
    const rect = trigger.getBoundingClientRect();
    const menuWidth = 196;
    const estimatedHeight = moreMenuRef.current?.offsetHeight || 340;
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const openAbove = below < estimatedHeight && above > below;
    const maxHeight = Math.max(120, openAbove ? above : below);
    return {
      top: openAbove ? Math.max(8, rect.top - Math.min(estimatedHeight, maxHeight) - 4) : rect.bottom + 4,
      left: Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8)),
      width: menuWidth,
      maxHeight,
      placement: (openAbove ? 'top' : 'bottom') as 'bottom' | 'top',
    };
  }, []);

  const closeMoreMenu = useCallback(() => {
    setMoreMenuOpen(false);
    setMenuPos(null);
  }, []);

  const toggleMoreMenu = useCallback(() => {
    if (moreMenuOpen) {
      closeMoreMenu();
    } else {
      const pos = calcMenuPosition();
      if (pos) {
        setMenuPos(pos);
        setMenuTheme(moreMenuTriggerRef.current?.closest<HTMLElement>('[data-theme]')?.dataset.theme);
        setMoreMenuOpen(true);
      }
    }
  }, [moreMenuOpen, calcMenuPosition, closeMoreMenu]);

  useLayoutEffect(() => {
    if (!moreMenuOpen) return;
    const updatePosition = () => {
      const pos = calcMenuPosition();
      if (pos) setMenuPos(pos);
      setMenuTheme(moreMenuTriggerRef.current?.closest<HTMLElement>('[data-theme]')?.dataset.theme);
    };
    updatePosition();
    const onScroll = (e: Event) => {
      if (!moreMenuRef.current?.contains(e.target as Node)) {
        updatePosition();
      }
    };
    window.addEventListener('resize', updatePosition);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [moreMenuOpen, calcMenuPosition]);

  // 更多菜单点击外部关闭或按 Esc 关闭
  useEffect(() => {
    if (!moreMenuOpen) return;
    const handleOutside = (event: PointerEvent) => {
      if (
        moreMenuRef.current &&
        !moreMenuRef.current.contains(event.target as Node) &&
        !moreMenuTriggerRef.current?.contains(event.target as Node)
      ) {
        closeMoreMenu();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeMoreMenu();
      }
    };
    document.addEventListener('pointerdown', handleOutside, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handleOutside, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [moreMenuOpen, closeMoreMenu]);

  return (
    <div className="relative z-40 flex shrink-0 items-center justify-between gap-3 border-b border-edge bg-surface px-4 py-2 shadow-xs">
      {/* 左侧：面包屑与紧凑更新时间 */}
      <nav
        aria-label={tr('wiki:wikiEditor.breadcrumbLabel')}
        className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-xs text-sub"
      >
        <div
          className="flex h-6 w-6 items-center justify-center rounded-lg border border-subtle/80 bg-input/50 text-quiet"
          title={tr('wiki:wikiView.knowledgeBase')}
          aria-label={tr('wiki:wikiView.knowledgeBase')}
        >
          <BookOpen className="h-3.5 w-3.5 text-accent" />
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

        <span title={!polishAvailable ? tr('wiki:polish.desktopOnly') : tr('wiki:polish.title')}>
          <button type="button" data-wiki-polish-trigger aria-label={tr('wiki:polish.title')}
            disabled={doc.isLocked || !polishAvailable || polishEmpty}
            onPointerDown={event => { if (event.button === 0) event.preventDefault(); }}
            onClick={onOpenPolish}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-subtle/80 bg-input/60 text-sub transition-colors hover:bg-hover hover:text-main disabled:cursor-not-allowed disabled:opacity-40">
            <Sparkles className="h-3.5 w-3.5" />
          </button>
        </span>

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
                ? tr('wiki:wikiEditor.publishTitleDirty')
                : tr('wiki:wikiEditor.publishTitleClean')
          }
          aria-label={tr('wiki:wikiEditor.publishAriaLabel')}
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

        {/* 更多菜单（历史、副本、移动、导出、锁定、复制链接、分享、删除） */}
        <div className="relative">
          <button
            ref={moreMenuTriggerRef}
            type="button"
            onClick={toggleMoreMenu}
            aria-expanded={moreMenuOpen}
            aria-label={tr('wiki:wikiEditor.moreActions')}
            title={tr('wiki:wikiEditor.moreActions')}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-subtle/80 bg-input/60 text-sub transition-colors hover:bg-hover hover:text-main"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>

          {moreMenuOpen &&
            menuPos &&
            createPortal(
              <div
                ref={moreMenuRef}
                role="menu"
                data-theme={menuTheme}
                style={{
                  position: 'fixed',
                  top: `${menuPos.top}px`,
                  left: `${menuPos.left}px`,
                  width: `${menuPos.width}px`,
                  maxHeight: `${menuPos.maxHeight}px`,
                  zIndex: 99999,
                  transition: 'none',
                  boxShadow: 'var(--popover-shadow)',
                }}
                className={`overflow-y-auto rounded-xl border border-edge bg-card p-1 shadow-popover shadow-2xl animate-in fade-in duration-100 divide-y divide-edge/60 scrollbar-thin ${
                  menuPos.placement === 'top' ? 'origin-bottom-right' : 'origin-top-right'
                }`}
              >
              {/* 分组 1：历史记录、创建副本、移动 */}
              <div className="p-0.5 space-y-0.5">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeMoreMenu();
                    onOpenHistory();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-main bg-transparent hover:bg-hover focus:bg-hover focus:outline-none transition-colors"
                >
                  <Clock className="h-3.5 w-3.5 text-accent" />
                  <span>{tr('wiki:wikiEditor.viewHistory')}</span>
                </button>

                {onDuplicate && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      closeMoreMenu();
                      onDuplicate();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-main bg-transparent hover:bg-hover focus:bg-hover focus:outline-none transition-colors"
                  >
                    <Copy className="h-3.5 w-3.5 text-sub" />
                    <span>{tr('wiki:wikiEditor.duplicatePage')}</span>
                  </button>
                )}

                {onMovePage && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      closeMoreMenu();
                      onMovePage();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-main bg-transparent hover:bg-hover focus:bg-hover focus:outline-none transition-colors"
                  >
                    <FolderInput className="h-3.5 w-3.5 text-accent" />
                    <span>{tr('wiki:wikiEditor.movePage')}</span>
                  </button>
                )}

                {onCreateChild && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      closeMoreMenu();
                      onCreateChild();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-main bg-transparent hover:bg-hover focus:bg-hover focus:outline-none transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5 text-info" />
                    <span>{tr('wiki:wikiView.newChildPage')}</span>
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
                    closeMoreMenu();
                    onExportMarkdown();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-main bg-transparent hover:bg-hover focus:bg-hover focus:outline-none transition-colors disabled:opacity-50"
                >
                  {isExportingMarkdown ? (
                    <Loader2 className="h-3.5 w-3.5 text-accent animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5 text-sub" />
                  )}
                  <span>{tr('wiki:wikiEditor.exportMarkdown')}</span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  disabled={isExportingWord}
                  onClick={() => {
                    closeMoreMenu();
                    onExportWord();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-main bg-transparent hover:bg-hover focus:bg-hover focus:outline-none transition-colors disabled:opacity-50"
                >
                  {isExportingWord ? (
                    <Loader2 className="h-3.5 w-3.5 text-accent animate-spin" />
                  ) : (
                    <FileText className="h-3.5 w-3.5 text-info" />
                  )}
                  <span>{tr('wiki:wikiEditor.exportWord')}</span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  disabled={isExportingPdf}
                  onClick={() => {
                    closeMoreMenu();
                    onExportPdf();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-main bg-transparent hover:bg-hover focus:bg-hover focus:outline-none transition-colors disabled:opacity-50"
                >
                  {isExportingPdf ? (
                    <Loader2 className="h-3.5 w-3.5 text-accent animate-spin" />
                  ) : (
                    <Printer className="h-3.5 w-3.5 text-success" />
                  )}
                  <span>{tr('wiki:wikiEditor.exportPdf')}</span>
                </button>
              </div>

              {/* 分组 3：锁定、分享 */}
              <div className="p-0.5 space-y-0.5">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeMoreMenu();
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
                    closeMoreMenu();
                    void handleCopyLink();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-main bg-transparent hover:bg-hover focus:bg-hover focus:outline-none transition-colors"
                >
                  <Link2 className="h-3.5 w-3.5 text-accent" />
                  <span>{copied ? tr('wiki:wikiEditor.linkCopied') : tr('wiki:wikiEditor.copyLink')}</span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeMoreMenu();
                    onOpenShare();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-main bg-transparent hover:bg-hover focus:bg-hover focus:outline-none transition-colors"
                >
                  <Share2 className="h-3.5 w-3.5 text-info" />
                  <span>{tr('wiki:wikiEditor.shareDocument') || '分享文档'}</span>
                </button>
              </div>

              {/* 分组 4：删除 */}
              {onDelete && (
                <div className="p-0.5">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      closeMoreMenu();
                      onDelete();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-danger hover:bg-danger/10 focus:bg-danger/10 focus:outline-none transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>{tr('wiki:wikiEditor.deletePage')}</span>
                  </button>
                </div>
              )}
              </div>,
              document.body
            )}
        </div>
      </div>
    </div>
  );
};
