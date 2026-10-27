/**
 * 知识库文档树（左栏，宽 260px）。
 *
 * 调用约定：受控组件。
 * - `documents` 为全部页面，树自行按 `parentId` + `sortOrder` 组织层级；
 * - `expandedIds` / `onToggleExpanded` 控制折叠展开，展开状态由视图持久化；
 * - 排序拖拽通过 Pointer Events 实现（与看板一致，不使用 HTML5 drag-and-drop），
 *   仅允许在同级之间调整顺序，落点计算后经 `onReorder` 回传；
 * - 重命名使用行内输入框，回车提交、Esc 取消、失焦提交。
 *
 * 隐藏的 `openIds` 逻辑：搜索命中时会临时展开命中页面的祖先链，用户手动折叠的节点不受影响。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  ChevronDown,
  FileText,
  MoreHorizontal,
  Pencil,
  Plus,
  Star,
  Trash2,
  Copy,
  GripVertical,
  Search,
  X,
  Download,
  Loader2,
  FolderInput,
  Link2,
} from 'lucide-react';
import { tr, useLocale } from '../../i18n';
import type { WikiDocument } from './wikiTypes';
import { copyWikiReference } from './wikiLinks';
import { exportWikiDocument, exportAllWikiDocuments } from './wikiExport';

interface WikiPageTreeProps {
  documents: WikiDocument[];
  selectedId: string | null;
  expandedIds: string[];
  /** 搜索命中的页面 id。非空时只高亮命中项，可点击的仍是完整树。 */
  matchedIds: Set<string>;
  onSelect: (id: string) => void;
  onToggleExpanded: (id: string) => void;
  onCreatePage: (parentId: string | null) => void;
  onRename: (id: string, title: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onMovePage?: (id: string) => void;
  onReorder: (pageId: string, parentId: string | null, index: number) => void;
  query: string;
  onQueryChange: (value: string) => void;
}

interface TreeRowProps {
  doc: WikiDocument;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  selected: boolean;
  matched: boolean;
  dragging: boolean;
  dropIndicator: 'before' | 'after' | null;
  renaming: boolean;
  onSelect: (id: string) => void;
  onToggleExpanded: (id: string) => void;
  onCreateChild: (id: string) => void;
  onStartRename: (id: string) => void;
  onCommitRename: (id: string, title: string) => void;
  onCancelRename: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onStartMove?: (id: string) => void;
  onPointerDownRow: (event: React.PointerEvent<HTMLDivElement>, doc: WikiDocument) => void;
  onPointerMoveRow: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUpRow: (event: React.PointerEvent<HTMLDivElement>) => void;
  onMenuToggle: (id: string) => void;
  menuOpen: boolean;
  onMenuClose: () => void;
}

const rowIndent = (depth: number) => ({ paddingLeft: `${8 + depth * 14}px` });

/** 单行。抽出来是为了让递归渲染保持可读。 */
const TreeRow: React.FC<TreeRowProps> = ({
  doc,
  depth,
  hasChildren,
  expanded,
  selected,
  matched,
  dragging,
  dropIndicator,
  renaming,
  onSelect,
  onToggleExpanded,
  onCreateChild,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDuplicate,
  onDelete,
  onToggleFavorite,
  onStartMove,
  onPointerDownRow,
  onPointerMoveRow,
  onPointerUpRow,
  onMenuToggle,
  menuOpen,
  onMenuClose,
}) => {
  const [draftTitle, setDraftTitle] = useState(doc.title);
  const inputRef = useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (renaming) {
      setDraftTitle(doc.title);
      window.setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [renaming, doc.title]);

  const displayTitle = doc.title.trim() || tr('wiki:wikiView.untitledPage');

  return (
    <div
      data-wiki-row={doc.id}
      data-wiki-parent={doc.parentId ?? ''}
      className="group relative"
    >
      {dropIndicator && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute left-2 right-2 h-px bg-accent ${dropIndicator === 'before' ? 'top-0' : 'bottom-0'}`}
        />
      )}
      <div
        onPointerDown={(event) => onPointerDownRow(event, doc)}
        onPointerMove={onPointerMoveRow}
        onPointerUp={onPointerUpRow}
        onPointerCancel={onPointerUpRow}
        onClick={() => {
          if (!menuOpen && !renaming) onSelect(doc.id);
        }}
        style={rowIndent(depth)}
        className={`flex cursor-pointer items-center gap-1 rounded-md py-1 pr-1.5 text-xs transition-colors ${
          selected
            ? 'bg-hover font-semibold text-main'
            : matched
              ? 'bg-card text-main'
              : 'text-sub hover:bg-hover hover:text-main'
        } ${dragging ? 'opacity-50' : ''}`}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={expanded ? tr('wiki:wikiTree.collapse', { value0: displayTitle }) : tr('wiki:wikiTree.expand', { value0: displayTitle })}
            aria-expanded={expanded}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpanded(doc.id);
            }}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-quiet transition-colors hover:bg-card hover:text-main"
          >
            <ChevronRight className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          </button>
        ) : (
          <span className="h-4 w-4 shrink-0" aria-hidden="true" />
        )}

        {doc.icon ? (
          <span className="flex h-4 w-4 shrink-0 items-center justify-center text-sm leading-none" aria-hidden="true">{doc.icon}</span>
        ) : (
          <FileText className="h-3.5 w-3.5 shrink-0 text-quiet" aria-hidden="true" />
        )}

        {renaming ? (
          <input
            ref={inputRef}
            value={draftTitle}
            autoFocus
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => setDraftTitle(event.target.value)}
            onBlur={() => onCommitRename(doc.id, draftTitle)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onCommitRename(doc.id, draftTitle);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                onCancelRename();
              }
            }}
            placeholder={tr('wiki:wikiEditor.titlePlaceholder')}
            className="h-6 min-w-0 flex-1 rounded border border-subtle bg-input px-1.5 text-xs text-main outline-none focus:border-info"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate" title={displayTitle}>
            {displayTitle}
          </span>
        )}

        {!renaming && (
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <button
              type="button"
              aria-label={tr('wiki:wikiView.newChildPage')}
              title={tr('wiki:wikiView.newChildPage')}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onCreateChild(doc.id);
              }}
              className="flex h-5 w-5 items-center justify-center rounded text-quiet transition-colors hover:bg-card hover:text-info"
            >
              <Plus className="h-3 w-3" />
            </button>
            <button
              type="button"
              data-page-more-btn={doc.id}
              aria-label={tr('wiki:wikiTree.pageActions', { value0: displayTitle })}
              title={tr('wiki:wikiTree.pageActions', { value0: displayTitle })}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onMenuToggle(doc.id);
              }}
              className="flex h-5 w-5 items-center justify-center rounded text-quiet transition-colors hover:bg-card hover:text-main"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {doc.favorite && !renaming && (
          <Star className="h-3 w-3 shrink-0 fill-current text-warning group-hover:hidden" aria-hidden="true" />
        )}
      </div>

      {menuOpen && (
        <div
          role="menu"
          data-page-menu={doc.id}
          aria-label={tr('wiki:wikiTree.pageActions', { value0: displayTitle })}
          className="absolute right-1 z-30 mt-0.5 min-w-28 rounded-lg border border-edge bg-surface/95 p-1 shadow-popover backdrop-blur-md select-none"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {onStartMove && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onMenuClose();
                onStartMove(doc.id);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-main transition-colors hover:bg-hover"
            >
              <FolderInput className="h-3.5 w-3.5 text-accent" />
              {tr('wiki:wikiTree.movePage')}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              onMenuClose();
              try {
                await copyWikiReference(doc);
              } catch (err) {
                console.error('Failed to copy wiki reference', err);
              }
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-main transition-colors hover:bg-hover"
          >
            <Link2 className="h-3.5 w-3.5 text-accent" />
            {tr('wiki:wikiTree.copyLink')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onMenuClose();
              onDelete(doc.id);
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-danger transition-colors hover:bg-hover"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {tr('wiki:wikiTree.delete')}
          </button>
        </div>
      )}
    </div>
  );
};

export const WikiPageTree: React.FC<WikiPageTreeProps> = ({
  documents,
  selectedId,
  expandedIds,
  matchedIds,
  onSelect,
  onToggleExpanded,
  onCreatePage,
  onRename,
  onDuplicate,
  onDelete,
  onToggleFavorite,
  onMovePage,
  onReorder,
  query,
  onQueryChange,
}) => {
  useLocale();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: 'before' | 'after' } | null>(null);
  const [isExportingAll, setIsExportingAll] = useState(false);

  const selectedDoc = useMemo(
    () => (selectedId ? documents.find((d) => d.id === selectedId) || null : null),
    [documents, selectedId],
  );

  // 点击外部空白区域或按 Escape 键自动关闭节点更多菜单与新建菜单
  useEffect(() => {
    if (!menuId && !createMenuOpen) return;
    const handleOutside = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (menuId) {
        const isInsideMenu = target.closest(`[data-page-menu="${menuId}"]`);
        const isMoreButton = target.closest(`[data-page-more-btn="${menuId}"]`);
        if (!isInsideMenu && !isMoreButton) {
          setMenuId(null);
        }
      }
      if (createMenuOpen) {
        const isInsideCreateMenu = target.closest('[data-create-menu]');
        const isCreateButton = target.closest('[data-create-btn]');
        if (!isInsideCreateMenu && !isCreateButton) {
          setCreateMenuOpen(false);
        }
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setMenuId(null);
        setCreateMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleOutside, true);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handleOutside, true);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [menuId, createMenuOpen]);

  const handleExportAll = async () => {
    if (documents.length === 0 || isExportingAll) return;
    setIsExportingAll(true);
    try {
      await exportAllWikiDocuments(documents);
    } catch (err) {
      console.error('Failed to export all wiki documents:', err);
    } finally {
      setIsExportingAll(false);
    }
  };

  const pointerDragRef = useRef<{
    pointerId: number;
    pageId: string;
    parentId: string | null;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  const expanded = useMemo(() => new Set(expandedIds), [expandedIds]);
  const orderedSiblings = useMemo(() => {
    const map = new Map<string, WikiDocument[]>();
    for (const key of ['', ...documents.map((doc) => doc.id)]) map.set(key, []);
    for (const doc of documents) {
      const key = doc.parentId ?? '';
      const list = map.get(key);
      if (list) list.push(doc);
      else map.set(key, [doc]);
    }
    for (const list of map.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);
    return map;
  }, [documents]);

  const favorites = useMemo(() => documents.filter((doc) => doc.favorite), [documents]);

  /** 是否处于搜索过滤状态。有关键词时树只保留命中页面及其祖先链。 */
  const searching = query.trim().length > 0;
  const filtering = searching;

  /** 搜索时命中页面的祖先链需要自动展开。 */
  const autoExpanded = useMemo(() => {
    if (!searching) return null;
    const set = new Set<string>();
    const byId = new Map<string, WikiDocument>(documents.map((doc) => [doc.id, doc] as const));
    for (const id of matchedIds) {
      let cursor = byId.get(id)?.parentId ?? null;
      let guard = 0;
      while (cursor && guard++ <= documents.length) {
        set.add(cursor);
        cursor = byId.get(cursor)?.parentId ?? null;
      }
    }
    return set;
  }, [searching, matchedIds, documents]);

  const isExpanded = (id: string) => expanded.has(id) || Boolean(autoExpanded?.has(id));

  const rowAtPoint = (x: number, y: number) => {
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-wiki-row]');
    if (!element || !element.dataset.wikiRow) return null;
    const rect = element.getBoundingClientRect();
    return {
      id: element.dataset.wikiRow as string,
      parentId: element.dataset.wikiParent || null,
      position: (y < rect.top + rect.height / 2 ? 'before' : 'after') as 'before' | 'after',
    };
  };

  const clearDrag = () => {
    pointerDragRef.current = null;
    setDraggingId(null);
    setDropTarget(null);
  };

  const handlePointerDownRow = (event: React.PointerEvent<HTMLDivElement>, doc: WikiDocument) => {
    if (event.button !== 0 || renamingId === doc.id) return;
    pointerDragRef.current = {
      pointerId: event.pointerId,
      pageId: doc.id,
      parentId: doc.parentId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMoveRow = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
    drag.moved = true;
    setDraggingId(drag.pageId);
    const hit = rowAtPoint(event.clientX, event.clientY);
    // 只允许同级排序：落点必须与拖动项同属一个父级，且不是自身。
    setDropTarget(
      hit && hit.id !== drag.pageId && hit.parentId === drag.parentId
        ? { id: hit.id, position: hit.position }
        : null,
    );
    event.preventDefault();
  };

  const handlePointerUpRow = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const target = dropTarget;
    const moved = drag.moved;
    const pageId = drag.pageId;
    const parentId = drag.parentId;
    clearDrag();
    if (!moved || !target) return;

    const siblings = (orderedSiblings.get(parentId ?? '') ?? []).filter((doc) => doc.id !== pageId);
    const targetIndex = siblings.findIndex((doc) => doc.id === target.id);
    if (targetIndex === -1) return;
    const insertIndex = target.position === 'after' ? targetIndex + 1 : targetIndex;
    onReorder(pageId, parentId, insertIndex);
  };

  const commitRename = (id: string, title: string) => {
    setRenamingId(null);
    const trimmed = title.trim();
    if (trimmed && trimmed !== documents.find((doc) => doc.id === id)?.title) onRename(id, trimmed);
  };

  const renderNodes = (parentId: string | null, depth: number): React.ReactNode => {
    const siblings = orderedSiblings.get(parentId ?? '') ?? [];
    return siblings.map((doc) => {
      const children = orderedSiblings.get(doc.id) ?? [];
      // 搜索过滤时子节点可能全部被隐藏，此时不应再显示展开箭头。
      const hasChildren = filtering
        ? children.some((child) => hasMatchBelow(child.id, matchedIds, orderedSiblings))
        : children.length > 0;
      const open = isExpanded(doc.id);
      // 搜索状态下隐藏不含命中的分支，但保留命中页面的祖先链。
      if (filtering && !hasMatchBelow(doc.id, matchedIds, orderedSiblings)) return null;
      return (
        <React.Fragment key={doc.id}>
          <TreeRow
            doc={doc}
            depth={depth}
            hasChildren={hasChildren}
            expanded={open}
            selected={selectedId === doc.id}
            matched={matchedIds.has(doc.id)}
            dragging={draggingId === doc.id}
            dropIndicator={dropTarget?.id === doc.id ? dropTarget.position : null}
            renaming={renamingId === doc.id}
            onSelect={onSelect}
            onToggleExpanded={onToggleExpanded}
            // 不在这里补一次展开：onCreatePage 已经把父级写入 expandedIds，
            // 再用本帧的 expanded 快照判断会把它当作「未展开」而重新折叠。
            onCreateChild={onCreatePage}
            onStartRename={setRenamingId}
            onCommitRename={commitRename}
            onCancelRename={() => setRenamingId(null)}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
            onToggleFavorite={onToggleFavorite}
            onStartMove={onMovePage}
            onPointerDownRow={handlePointerDownRow}
            onPointerMoveRow={handlePointerMoveRow}
            onPointerUpRow={handlePointerUpRow}
            onMenuToggle={(id) => setMenuId((current) => (current === id ? null : id))}
            menuOpen={menuId === doc.id}
            onMenuClose={() => setMenuId(null)}
          />
          {hasChildren && open && renderNodes(doc.id, depth + 1)}
        </React.Fragment>
      );
    });
  };

  const rootChildren = orderedSiblings.get('') ?? [];

  return (
    <aside
      className="flex w-[260px] shrink-0 flex-col border-r border-edge bg-surface"
      aria-label={tr('wiki:wikiView.knowledgeBase')}
    >
      <div className="flex items-center justify-between gap-2 border-b border-edge px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <GripVertical className="h-3.5 w-3.5 shrink-0 text-quiet" aria-hidden="true" />
          <span className="truncate text-xs font-semibold text-main">{tr('wiki:wikiTree.allPages')}</span>
          <span className="shrink-0 text-[10px] text-quiet">{documents.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleExportAll}
            disabled={isExportingAll || documents.length === 0}
            title={tr('wiki:wikiTree.exportAll')}
            aria-label={tr('wiki:wikiTree.exportAll')}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-sub transition-colors hover:bg-hover hover:text-accent disabled:opacity-40"
          >
            {isExportingAll ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
          </button>
          {/* 新建页面组合分裂按钮 (默认在当前选中页面下新建子页面，下拉可选择新建一级页面) */}
          <div className="relative inline-flex items-center rounded-lg border border-edge/80 bg-input/50 transition-colors hover:border-subtle hover:bg-input/80">
            <button
              type="button"
              data-create-btn
              onClick={() => {
                if (selectedDoc) {
                  onCreatePage(selectedDoc.id);
                } else {
                  onCreatePage(null);
                }
              }}
              title={
                selectedDoc
                  ? tr('wiki:wikiTree.newChildPage')
                  : tr('wiki:wikiTree.newRootPage')
              }
              aria-label={
                selectedDoc
                  ? tr('wiki:wikiTree.newChildPage')
                  : tr('wiki:wikiTree.newRootPage')
              }
              className="flex h-6 items-center justify-center pl-1.5 pr-1 text-sub transition-colors hover:text-info rounded-l-lg"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>

            <span className="h-3 w-px bg-edge/70" aria-hidden="true" />

            <button
              type="button"
              data-create-btn
              onClick={() => setCreateMenuOpen((prev) => !prev)}
              title={tr('wiki:wikiTree.createPageMenu')}
              aria-label={tr('wiki:wikiTree.createPageMenu')}
              aria-expanded={createMenuOpen}
              className={`flex h-6 w-4 items-center justify-center text-sub transition-colors hover:text-main rounded-r-lg ${
                createMenuOpen ? 'bg-hover text-main' : ''
              }`}
            >
              <ChevronDown className="h-2.5 w-2.5" />
            </button>

            {createMenuOpen && (
              <div
                data-create-menu
                role="menu"
                style={{ boxShadow: 'var(--popover-shadow)' }}
                className="absolute right-0 top-full z-40 mt-1 min-w-44 rounded-xl border border-edge bg-card p-1 shadow-popover shadow-xl backdrop-blur-md select-none animate-in fade-in zoom-in-95 duration-100"
              >
                {selectedDoc && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setCreateMenuOpen(false);
                      onCreatePage(selectedDoc.id);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-main transition-colors hover:bg-hover"
                  >
                    <Plus className="h-3.5 w-3.5 text-info shrink-0" />
                    <span className="truncate">
                      {tr('wiki:wikiTree.newChildPage')}
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setCreateMenuOpen(false);
                    onCreatePage(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-main transition-colors hover:bg-hover"
                >
                  <FileText className="h-3.5 w-3.5 text-accent shrink-0" />
                  <span>{tr('wiki:wikiTree.newRootPage')}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="border-b border-edge px-3 py-2">
        <label className="flex items-center gap-1.5 rounded-md border border-subtle bg-input px-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-quiet" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={tr('wiki:wikiTree.searchPlaceholder')}
            aria-label={tr('wiki:wikiTree.searchPlaceholder')}
            className="h-7 min-w-0 flex-1 bg-transparent text-xs text-main outline-none placeholder:text-placeholder"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQueryChange('')}
              aria-label={tr('wiki:wikiTree.clearSearch')}
              title={tr('wiki:wikiTree.clearSearch')}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-quiet hover:text-main"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
        {favorites.length > 0 && (
          <section aria-label={tr('wiki:wikiTree.favorites')} className="mb-1.5">
            <h2 className="px-2 pb-1 text-[10px] font-semibold tracking-wide text-quiet">{tr('wiki:wikiTree.favorites')}</h2>
            {favorites.map((doc) => (
              <button
                key={`favorite-${doc.id}`}
                type="button"
                onClick={() => onSelect(doc.id)}
                className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors ${
                  selectedId === doc.id ? 'bg-hover font-semibold text-main' : 'text-sub hover:bg-hover hover:text-main'
                }`}
              >
                {doc.icon ? (
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center text-sm leading-none" aria-hidden="true">{doc.icon}</span>
                ) : (
                  <FileText className="h-3.5 w-3.5 shrink-0 text-quiet" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1 truncate">{doc.title.trim() || tr('wiki:wikiView.untitledPage')}</span>
                <Star className="h-3 w-3 shrink-0 fill-current text-warning" aria-hidden="true" />
              </button>
            ))}
          </section>
        )}

        <section aria-label={tr('wiki:wikiTree.allPages')}>
          {rootChildren.length === 0 ? (
            <p className="px-2 py-3 text-[11px] leading-5 text-quiet">
              {searching ? tr('wiki:wikiTree.noMatches') : tr('wiki:wikiTree.empty')}
            </p>
          ) : (
            renderNodes(null, 0)
          )}
        </section>

        {filtering && rootChildren.length > 0 && !rootChildren.some((doc) => hasMatchBelow(doc.id, matchedIds, orderedSiblings)) && (
          <p className="px-2 py-3 text-[11px] leading-5 text-quiet">{tr('wiki:wikiTree.noMatches')}</p>
        )}


      </div>

      <div className="shrink-0 border-t border-edge px-3 py-1.5 text-[10px] text-quiet">
        {tr('wiki:wikiView.pageCount', { value0: documents.length })}
      </div>
    </aside>
  );
};

/** 判断某页面自身或其任一后代是否为搜索命中。 */
function hasMatchBelow(
  id: string,
  matchedIds: Set<string>,
  orderedSiblings: Map<string, WikiDocument[]>,
): boolean {
  if (matchedIds.has(id)) return true;
  const stack = [...(orderedSiblings.get(id) ?? [])];
  const seen = new Set<string>();
  while (stack.length) {
    const doc = stack.pop() as WikiDocument;
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);
    if (matchedIds.has(doc.id)) return true;
    stack.push(...(orderedSiblings.get(doc.id) ?? []));
  }
  return false;
}
