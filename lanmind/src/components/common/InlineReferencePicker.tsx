/**
 * InlineReferencePicker — 跨模块（Wiki文档、任务、AI对话）内联快速引用弹出选择器。
 *
 * CALLING SPEC:
 *   <InlineReferencePicker
 *     isOpen={boolean}
 *     triggerPos={{ top: number; left: number } | null}
 *     onSelect={(item: ReferenceItem) => void}
 *     onClose={() => void}
 *     initialQuery?: string
 *   />
 */

import React, { useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Search, FileText, CheckSquare, MessageSquare, X } from 'lucide-react';
import { tr, useLocale } from '../../i18n';
import { searchReferenceItems, type ReferenceItem, type ReferenceKind } from '../../utils/referenceSearch';

export interface InlineReferencePickerProps {
  isOpen: boolean;
  triggerPos: { top: number; left: number } | null;
  onSelect: (item: ReferenceItem) => void;
  onClose: () => void;
  initialQuery?: string;
  excludeId?: string;
}

export const InlineReferencePicker: React.FC<InlineReferencePickerProps> = ({
  isOpen,
  triggerPos,
  onSelect,
  onClose,
  initialQuery = '',
  excludeId,
}) => {
  useLocale();
  const [query, setQuery] = useState(initialQuery);
  const [activeKind, setActiveKind] = useState<ReferenceKind>('all');
  const [items, setItems] = useState<ReferenceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number; placement: 'bottom' | 'top' } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 同步初始化坐标，避免在 (0, 0) 闪烁，遵守 AGENTS.md 规则
  useLayoutEffect(() => {
    if (!isOpen || !triggerPos) {
      setPickerPos(null);
      return;
    }
    const pickerWidth = 360;
    const pickerHeight = 320;
    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;

    let left = triggerPos.left;
    if (left + pickerWidth > screenWidth - 16) {
      left = Math.max(16, screenWidth - pickerWidth - 16);
    }

    const spaceBelow = screenHeight - triggerPos.top - 16;
    const openAbove = spaceBelow < pickerHeight && triggerPos.top > pickerHeight;
    const top = openAbove ? Math.max(16, triggerPos.top - pickerHeight - 8) : triggerPos.top + 8;

    setPickerPos({
      top,
      left,
      placement: openAbove ? 'top' : 'bottom',
    });
  }, [isOpen, triggerPos]);

  useEffect(() => {
    if (isOpen) {
      setQuery(initialQuery);
      setSelectedIndex(0);
      inputRef.current?.focus();
    }
  }, [isOpen, initialQuery]);

  // 检索数据
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    searchReferenceItems(query, { kind: activeKind, limit: 30, excludeId })
      .then((results) => {
        if (cancelled) return;
        setItems(results);
        setSelectedIndex(0);
      })
      .catch((err) => {
        console.error('Failed to search reference items', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, query, activeKind]);

  // 键盘事件处理
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (items.length ? (prev + 1) % items.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (items.length ? (prev - 1 + items.length) % items.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[selectedIndex]) {
        onSelect(items[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const kinds: ReferenceKind[] = ['all', 'wiki', 'task', 'ai'];
      const nextIdx = (kinds.indexOf(activeKind) + 1) % kinds.length;
      setActiveKind(kinds[nextIdx]);
    }
  };

  // 点击外部关闭
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !pickerPos) return null;

  return createPortal(
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        top: `${pickerPos.top}px`,
        left: `${pickerPos.left}px`,
        zIndex: 99999,
        transition: 'none',
      }}
      className={`flex w-90 max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl border border-edge bg-surface shadow-popover backdrop-blur-md animate-in fade-in duration-100 ${
        pickerPos.placement === 'top' ? 'origin-bottom-left' : 'origin-top-left'
      }`}
    >
      {/* 搜索头 */}
      <div className="flex items-center gap-2 border-b border-edge/60 px-3 py-2.5">
        <Search className="h-4 w-4 text-quiet shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={tr('wiki:wikiPicker.searchPlaceholder') || '搜索文档、任务或 AI 对话...'}
          className="flex-1 bg-transparent text-xs text-main placeholder:text-quiet outline-none"
        />
        <button
          type="button"
          onClick={onClose}
          className="flex h-5 w-5 items-center justify-center rounded text-quiet hover:bg-hover hover:text-main"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 分类切换器 */}
      <div className="flex items-center gap-1 border-b border-edge/60 bg-canvas/40 px-2 py-1.5 text-[11px]">
        {(
          [
            { id: 'all', label: tr('wiki:wikiPicker.all') || '全部' },
            { id: 'wiki', label: tr('wiki:wikiPicker.documents') || '文档' },
            { id: 'task', label: tr('wiki:wikiPicker.tasks') || '任务' },
            { id: 'ai', label: tr('wiki:wikiPicker.conversations') || 'AI 对话' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveKind(tab.id)}
            className={`rounded-md px-2 py-0.5 transition-colors ${
              activeKind === tab.id
                ? 'bg-accent/15 font-semibold text-accent'
                : 'text-sub hover:bg-hover hover:text-main'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 结果列表 */}
      <div className="max-h-60 overflow-y-auto p-1 scrollbar-thin">
        {loading && !items.length ? (
          <div className="py-6 text-center text-xs text-quiet">正在检索…</div>
        ) : items.length === 0 ? (
          <div className="py-6 text-center text-xs text-quiet">
            {tr('wiki:wikiPicker.noResults') || '未找到匹配项'}
          </div>
        ) : (
          items.map((item, index) => {
            const isSelected = index === selectedIndex;
            return (
              <div
                key={`${item.kind}-${item.id}`}
                onClick={() => onSelect(item)}
                onMouseEnter={() => setSelectedIndex(index)}
                className={`flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-1.5 transition-colors ${
                  isSelected ? 'bg-hover text-main' : 'text-sub hover:bg-hover hover:text-main'
                }`}
              >
                <span className="shrink-0 text-accent">
                  {item.kind === 'wiki' && <FileText className="h-3.5 w-3.5 text-info" />}
                  {item.kind === 'task' && <CheckSquare className="h-3.5 w-3.5 text-accent" />}
                  {item.kind === 'ai' && <MessageSquare className="h-3.5 w-3.5 text-purple-500" />}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="truncate text-xs font-medium text-main">{item.title}</div>
                  <div className="truncate text-[10px] text-quiet">{item.subtitle}</div>
                </div>
                <span className="shrink-0 rounded border border-edge/60 bg-canvas/60 px-1 py-0.5 text-[9px] text-quiet">
                  {item.badge}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* 底部按键提示 */}
      <div className="flex items-center justify-between border-t border-edge/60 bg-canvas/30 px-3 py-1 text-[10px] text-quiet">
        <span>{tr('wiki:wikiPicker.emptyHint') || '↑↓ 选择，Enter 插入'}</span>
        <span>Tab 切换分类</span>
      </div>
    </div>,
    document.body
  );
};
