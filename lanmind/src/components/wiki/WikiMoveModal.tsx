/**
 * WikiMoveModal — 知识库页面移动弹窗。
 *
 * CALLING SPEC:
 *   <WikiMoveModal
 *     doc={doc}
 *     documents={documents}
 *     isOpen={isOpen}
 *     onClose={() => setIsOpen(false)}
 *     onMove={(docId, targetParentId) => void}
 *   />
 */

import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { FolderInput, X, Check, FileText } from 'lucide-react';
import { tr, useLocale } from '../../i18n';
import type { WikiDocument } from './wikiTypes';
import { collectSubtreeIds } from './wikiStore';

export interface WikiMoveModalProps {
  doc: WikiDocument | null;
  documents: WikiDocument[];
  isOpen: boolean;
  onClose: () => void;
  onMove: (docId: string, targetParentId: string | null) => void;
}

export const WikiMoveModal: React.FC<WikiMoveModalProps> = ({
  doc,
  documents,
  isOpen,
  onClose,
  onMove,
}) => {
  useLocale();
  const [selectedParentId, setSelectedParentId] = useState<string | null>(() => doc?.parentId ?? null);

  // 禁止移动到自身或自身的任何后代节点下，避免成环
  const forbiddenIds = useMemo(() => {
    if (!doc) return new Set<string>();
    return new Set(collectSubtreeIds(documents, doc.id));
  }, [doc, documents]);

  // 构建平铺的树形展示列表（含缩进深度）
  const flattenedOptions = useMemo(() => {
    const result: { doc: WikiDocument; depth: number }[] = [];
    const buildTree = (parentId: string | null, depth: number) => {
      const children = documents
        .filter((d) => d.parentId === parentId)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      for (const child of children) {
        result.push({ doc: child, depth });
        buildTree(child.id, depth + 1);
      }
    };
    buildTree(null, 0);
    return result;
  }, [documents]);

  if (!isOpen || !doc) return null;

  const currentTitle = doc.title.trim() || tr('wiki:wikiView.untitledPage');

  const handleConfirm = () => {
    onMove(doc.id, selectedParentId);
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tr('wiki:wikiTree.movePageTitle')}
        className="flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-edge bg-surface shadow-popover"
      >
        {/* 头部 */}
        <div className="flex shrink-0 items-center justify-between border-b border-edge px-5 py-3.5">
          <div className="flex items-center gap-2">
            <FolderInput className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-bold text-main">{tr('wiki:wikiTree.movePageTitle')}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-sub hover:bg-hover hover:text-main transition-colors"
            title={tr('common:header.close') || '关闭'}
            aria-label={tr('common:header.close') || '关闭'}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 内容 */}
        <div className="p-5 space-y-4">
          <div className="rounded-xl border border-edge/60 bg-canvas/60 p-3">
            <div className="text-[11px] text-quiet mb-1">{tr('wiki:wikiTree.currentPage')}</div>
            <div className="text-xs font-semibold text-main truncate flex items-center gap-1.5">
              {doc.icon ? (
                <span className="text-sm">{doc.icon}</span>
              ) : (
                <FileText className="h-3.5 w-3.5 text-accent shrink-0" />
              )}
              <span>{currentTitle}</span>
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-sub mb-2">
              {tr('wiki:wikiTree.movePageTarget')}
            </div>
            <div className="max-h-64 overflow-y-auto rounded-xl border border-edge bg-card p-1.5 space-y-1">
              {/* 选项：根目录（顶级页面） */}
              <button
                type="button"
                onClick={() => setSelectedParentId(null)}
                className={`w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors cursor-pointer text-left ${
                  selectedParentId === null
                    ? 'bg-accent/15 text-accent font-semibold'
                    : 'text-main hover:bg-hover'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm">📁</span>
                  <span className="truncate">{tr('wiki:wikiTree.rootDirectory')}</span>
                </div>
                {selectedParentId === null && <Check className="h-3.5 w-3.5 text-accent shrink-0" />}
              </button>

              {/* 树形所有页面 */}
              {flattenedOptions.map(({ doc: item, depth }) => {
                const isForbidden = forbiddenIds.has(item.id);
                const isSelected = selectedParentId === item.id;
                const isCurrentSelf = item.id === doc.id;
                const itemTitle = item.title.trim() || tr('wiki:wikiView.untitledPage');

                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={isForbidden}
                    onClick={() => !isForbidden && setSelectedParentId(item.id)}
                    style={{ paddingLeft: `${10 + depth * 14}px` }}
                    className={`w-full flex items-center justify-between gap-2 rounded-lg pr-2.5 py-1.5 text-xs transition-colors text-left ${
                      isForbidden
                        ? 'opacity-40 cursor-not-allowed text-quiet'
                        : isSelected
                          ? 'bg-accent/15 text-accent font-semibold cursor-pointer'
                          : 'text-main hover:bg-hover cursor-pointer'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      {item.icon ? (
                        <span className="text-xs">{item.icon}</span>
                      ) : (
                        <FileText className="h-3 w-3 text-quiet shrink-0" />
                      )}
                      <span className="truncate">{itemTitle}</span>
                      {isCurrentSelf && (
                        <span className="text-[10px] text-quiet shrink-0">({tr('wiki:wikiHistory.current')})</span>
                      )}
                    </div>
                    {isSelected && <Check className="h-3.5 w-3.5 text-accent shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-2 border-t border-edge px-5 py-3 bg-surface/50">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-edge px-3.5 py-1.5 text-xs text-sub hover:bg-hover hover:text-main transition-colors"
          >
            {tr('wiki:wikiDelete.cancel')}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="theme-btn-primary rounded-xl px-4 py-1.5 text-xs font-semibold shadow-xs transition-colors"
          >
            {tr('wiki:wikiTree.moveConfirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
