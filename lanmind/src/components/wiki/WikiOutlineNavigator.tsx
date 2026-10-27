/**
 * WikiOutlineNavigator — 知识库长文档浮动导航控制器（置顶、置底与大纲目录快速跳转）。
 *
 * CALLING SPEC:
 *   <WikiOutlineNavigator
 *     canvasRef={React.RefObject<HTMLDivElement>}
 *     content={string}
 *     className={string}
 *   />
 *
 * TOOL CONTRACT:
 *   - 解析 Markdown 正文标题树（支持 H1-H6，自动过滤代码块内部的 #）
 *   - 一体化浮动导航胶囊：置顶 (ArrowUp)、大纲切换 (ListTree)、置底 (ArrowDown)
 *   - 避开右下角协作讨论浮标（bottom-16），位于 bottom-28 right-4
 *   - 展开浮动大纲面板，展示各级小节并根据阅读视口动态高亮当前章节
 *   - 支持点击标题平滑锚点定位（优先匹配 DOM 标题，源码模式保底按行比滚动）
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, ArrowDown, ListTree, X, Hash } from 'lucide-react';
import { tr } from '../../i18n';

export interface WikiHeadingItem {
  id: string;
  level: number;
  text: string;
  lineIndex: number;
}

export function extractMarkdownHeadings(content: string): WikiHeadingItem[] {
  if (!content) return [];
  const lines = content.split('\n');
  const headings: WikiHeadingItem[] = [];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      const text = match[2].replace(/[*_`~]/g, '').trim();
      if (text) {
        headings.push({
          id: `heading-${i}-${text.slice(0, 20).replace(/\s+/g, '-')}`,
          level,
          text,
          lineIndex: i,
        });
      }
    }
  }

  return headings;
}

interface WikiOutlineNavigatorProps {
  canvasRef: React.RefObject<HTMLDivElement | null>;
  content: string;
  className?: string;
  commentsTrigger?: React.ReactNode;
  isCommentsOpen?: boolean;
  onOutlineOpenChange?: (open: boolean) => void;
}

export const WikiOutlineNavigator: React.FC<WikiOutlineNavigatorProps> = ({
  canvasRef,
  content,
  className = '',
  commentsTrigger,
  isCommentsOpen = false,
  onOutlineOpenChange,
}) => {
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 当外部评论面板打开时，自动收起大纲
  useEffect(() => {
    if (isCommentsOpen) {
      setOutlineOpen(false);
      onOutlineOpenChange?.(false);
    }
  }, [isCommentsOpen, onOutlineOpenChange]);

  const headings = useMemo(() => extractMarkdownHeadings(content), [content]);

  // 点击外部收起大纲抽屉
  useEffect(() => {
    if (!outlineOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOutlineOpen(false);
        onOutlineOpenChange?.(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [outlineOpen, onOutlineOpenChange]);

  // 监听画布滚动，计算当前可见小节
  const updateActiveHeading = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || headings.length === 0) {
      setActiveHeadingId(null);
      return;
    }

    const headingElements = canvas.querySelectorAll('h1, h2, h3, h4, h5, h6');
    if (headingElements.length > 0) {
      const canvasRect = canvas.getBoundingClientRect();
      let matchedId: string | null = null;

      for (let i = 0; i < headings.length; i++) {
        const item = headings[i];
        for (const el of headingElements) {
          if (el.textContent && el.textContent.includes(item.text)) {
            const rect = el.getBoundingClientRect();
            if (rect.top <= canvasRect.top + 160) {
              matchedId = item.id;
            }
          }
        }
      }

      if (matchedId) {
        setActiveHeadingId(matchedId);
        return;
      }
    }

    // 纯文本或未匹配到元素时的行比高亮保底
    const totalLines = Math.max(1, content.split('\n').length);
    const scrollRatio = canvas.scrollTop / Math.max(1, canvas.scrollHeight - canvas.clientHeight);
    const currentLineEstimate = scrollRatio * totalLines;

    let closest = headings[0];
    for (const h of headings) {
      if (h.lineIndex <= currentLineEstimate + 5) {
        closest = h;
      }
    }
    if (closest) {
      setActiveHeadingId(closest.id);
    }
  }, [canvasRef, content, headings]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('scroll', updateActiveHeading, { passive: true });
    return () => canvas.removeEventListener('scroll', updateActiveHeading);
  }, [canvasRef, updateActiveHeading]);

  // 平滑置顶
  const scrollToTop = () => {
    if (canvasRef.current) {
      canvasRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // 平滑置底
  const scrollToBottom = () => {
    if (canvasRef.current) {
      canvasRef.current.scrollTo({ top: canvasRef.current.scrollHeight, behavior: 'smooth' });
    }
  };

  // 跳转到指定章节
  const scrollToHeading = (heading: WikiHeadingItem) => {
    setActiveHeadingId(heading.id);
    const canvas = canvasRef.current;
    if (!canvas) return;

    // 优先通过 DOM heading 定位
    const elements = canvas.querySelectorAll('h1, h2, h3, h4, h5, h6');
    for (const el of elements) {
      if (el.textContent && el.textContent.includes(heading.text)) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }

    // 源码/纯文本模式下按行比例滚动
    const totalLines = Math.max(1, content.split('\n').length);
    const scrollMax = canvas.scrollHeight - canvas.clientHeight;
    const targetScrollTop = (heading.lineIndex / totalLines) * scrollMax;
    canvas.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' });
  };

  return (
    <div
      ref={containerRef}
      className={`fixed right-4 bottom-20 z-30 flex items-end gap-2 select-none ${className}`}
    >
      {/* 展开态：大纲目录抽屉卡片 */}
      {outlineOpen && (
        <div
          role="dialog"
          aria-label={tr('wiki:navigator.outline')}
          className="flex w-64 max-h-[60vh] flex-col rounded-2xl border border-edge/80 bg-surface/95 backdrop-blur-md shadow-2xl p-2.5 animate-in fade-in slide-in-from-right-3 duration-200"
        >
          <div className="mb-2 flex items-center justify-between border-b border-edge/40 pb-2 px-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-main">
              <ListTree className="h-4 w-4 text-accent" />
              <span>{tr('wiki:navigator.outline')}</span>
              {headings.length > 0 && (
                <span className="rounded-full bg-accent/10 px-1.5 py-0.2 text-[10px] text-accent">
                  {headings.length}
                </span>
              )}
            </div>
            <button
              type="button"
              aria-label={tr('wiki:navigator.closeOutline')}
              onClick={() => {
                setOutlineOpen(false);
                onOutlineOpenChange?.(false);
              }}
              className="rounded p-0.5 text-quiet hover:bg-hover hover:text-main transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-0.5 pr-1 text-xs custom-scrollbar">
            {headings.length === 0 ? (
              <div className="py-6 text-center text-sub/70">
                <Hash className="mx-auto mb-1.5 h-4 w-4 text-quiet/60" />
                <p>{tr('wiki:navigator.noHeadings')}</p>
              </div>
            ) : (
              headings.map((h, idx) => {
                const isActive = h.id === activeHeadingId;
                // 根据标题等级缩进
                const paddingLeft = (h.level - 1) * 12 + 6;
                return (
                  <button
                    key={`${h.id}-${idx}`}
                    type="button"
                    title={h.text}
                    onClick={() => scrollToHeading(h)}
                    style={{ paddingLeft: `${paddingLeft}px` }}
                    className={`group flex w-full items-center justify-between gap-1.5 rounded-lg py-1.5 pr-2 text-left transition-colors ${
                      isActive
                        ? 'bg-accent/10 text-accent font-medium'
                        : 'text-sub hover:bg-hover hover:text-main'
                    }`}
                  >
                    <span className="truncate flex-1">
                      <span className="opacity-60 mr-1 text-[10px]">
                        {'#'.repeat(Math.min(h.level, 3))}
                      </span>
                      {h.text}
                    </span>
                    {isActive && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent shadow-2xs" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* 浮动控制胶囊（置顶、目录、讨论、置底四合一 Dock） */}
      <div className="flex flex-col items-center rounded-full border border-edge/80 bg-surface/90 backdrop-blur-md shadow-lg p-1 text-sub">
        {/* 回到顶部 */}
        <button
          type="button"
          aria-label={tr('wiki:navigator.scrollToTop')}
          title={tr('wiki:navigator.scrollToTop')}
          onClick={scrollToTop}
          className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-hover hover:text-main active:scale-95 transition-all"
        >
          <ArrowUp className="h-4 w-4" />
        </button>

        <div className="my-0.5 h-px w-4 bg-edge/60" />

        {/* 文章大纲切换 */}
        <button
          type="button"
          aria-label={tr('wiki:navigator.outline')}
          title={
            headings.length > 0
              ? `${tr('wiki:navigator.outline')} (${tr('wiki:navigator.headingsCount', { count: headings.length })})`
              : tr('wiki:navigator.outline')
          }
          onClick={() => {
            setOutlineOpen((open) => {
              const next = !open;
              onOutlineOpenChange?.(next);
              return next;
            });
          }}
          className={`relative flex h-7 w-7 items-center justify-center rounded-full transition-all active:scale-95 ${
            outlineOpen
              ? 'bg-accent text-white shadow-xs'
              : 'hover:bg-hover hover:text-main'
          }`}
        >
          <ListTree className="h-4 w-4" />
          {headings.length > 0 && !outlineOpen && (
            <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
              <span className="h-full w-full rounded-full bg-accent" />
            </span>
          )}
        </button>

        {/* 文章讨论入口（四合一胶囊嵌入） */}
        {commentsTrigger && (
          <>
            <div className="my-0.5 h-px w-4 bg-edge/60" />
            {commentsTrigger}
          </>
        )}

        <div className="my-0.5 h-px w-4 bg-edge/60" />

        {/* 回到底部 */}
        <button
          type="button"
          aria-label={tr('wiki:navigator.scrollToBottom')}
          title={tr('wiki:navigator.scrollToBottom')}
          onClick={scrollToBottom}
          className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-hover hover:text-main active:scale-95 transition-all"
        >
          <ArrowDown className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
