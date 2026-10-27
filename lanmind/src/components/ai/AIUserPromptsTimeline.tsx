/**
 * AIUserPromptsTimeline — 右侧浮动提问时间线指示器与快速跳转面板。
 *
 * CALLING SPEC:
 *   <AIUserPromptsTimeline
 *     prompts={UserPromptItem[]}
 *     activePromptId={string | null}
 *     onSelectPrompt={(id: string) => void}
 *   />
 */

import React, { useEffect, useRef, useState } from 'react';
import { MessageSquare, X } from 'lucide-react';
import { tr } from '../../i18n';

export interface UserPromptItem {
  id: string;
  content: string;
  createdAt: string;
}

interface AIUserPromptsTimelineProps {
  prompts: UserPromptItem[];
  activePromptId: string | null;
  onSelectPrompt: (promptId: string) => void;
  className?: string;
}

export function formatPromptPreview(content: string): string {
  const firstLine = content.split('\n').map((l) => l.trim()).find((l) => l.length > 0) || '';
  const clean = firstLine.replace(/^#+\s*/, '').replace(/[*_`~]/g, '').trim();
  return clean || tr('ai:v2.emptyPromptFallback');
}

export const AIUserPromptsTimeline: React.FC<AIUserPromptsTimelineProps> = ({
  prompts,
  activePromptId,
  onSelectPrompt,
  className = '',
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<number | null>(null);

  const clearHideTimer = () => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const handleMouseEnter = () => {
    clearHideTimer();
    setIsExpanded(true);
  };

  const handleMouseLeave = () => {
    clearHideTimer();
    // 鼠标移出容器延迟 250ms 收起，保留舒适过渡与容错安全区
    hideTimerRef.current = window.setTimeout(() => {
      setIsExpanded(false);
    }, 250);
  };

  useEffect(() => {
    return () => clearHideTimer();
  }, []);

  // 点击外部收起展开卡片（保底）
  useEffect(() => {
    if (!isExpanded) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        clearHideTimer();
        setIsExpanded(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isExpanded]);

  // 当会话内提问数小于 2 时不打扰视口
  if (prompts.length < 2) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`absolute right-3.5 top-1/2 -translate-y-1/2 z-20 flex flex-col items-end select-none ${className}`}
    >
      {/* 展开浮动卡片（参考 DeepSeek 效果） */}
      {isExpanded ? (
        <div
          role="dialog"
          aria-label={tr('ai:v2.promptsTimeline')}
          className="flex w-64 max-h-[60vh] flex-col rounded-2xl border border-edge/80 bg-surface/95 backdrop-blur-md shadow-xl p-2.5 animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="mb-2 flex items-center justify-between border-b border-edge/40 pb-1.5 px-1">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-main">
              <MessageSquare className="h-3.5 w-3.5 text-accent" />
              <span>{tr('ai:v2.promptsTimeline')}</span>
              <span className="rounded-full bg-accent/10 px-1.5 py-0.2 text-[10px] text-accent">
                {prompts.length}
              </span>
            </span>
            <button
              type="button"
              aria-label={tr('ai:v2.close')}
              onClick={() => {
                clearHideTimer();
                setIsExpanded(false);
              }}
              className="rounded p-0.5 text-quiet hover:bg-hover hover:text-main transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
            {prompts.map((p, index) => {
              const isActive = p.id === activePromptId;
              const preview = formatPromptPreview(p.content);
              return (
                <button
                  key={p.id}
                  type="button"
                  title={preview}
                  onClick={() => {
                    onSelectPrompt(p.id);
                    clearHideTimer();
                    setIsExpanded(false);
                  }}
                  className={`group flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                    isActive
                      ? 'bg-accent/10 text-accent font-medium'
                      : 'text-sub hover:bg-hover hover:text-main'
                  }`}
                >
                  <span className="truncate flex-1">
                    <span className="mr-1 text-[10px] text-quiet opacity-70">#{index + 1}</span>
                    {preview}
                  </span>
                  <span
                    className={`shrink-0 transition-all ${
                      isActive
                        ? 'h-1 w-3.5 rounded-full bg-accent shadow-2xs'
                        : 'h-0.5 w-2.5 rounded-full bg-quiet/40 group-hover:bg-sub'
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        /* 折叠态指示条（小短横线/点组） */
        <button
          type="button"
          onClick={() => setIsExpanded(true)}
          title={tr('ai:v2.promptsTimeline')}
          aria-label={tr('ai:v2.promptsTimeline')}
          className="group flex flex-col items-end gap-1.5 rounded-full bg-surface/70 backdrop-blur-sm border border-edge/40 px-1.5 py-2.5 shadow-xs transition-all hover:bg-surface hover:shadow-md hover:border-edge"
        >
          {prompts.map((p) => {
            const isActive = p.id === activePromptId;
            return (
              <span
                key={p.id}
                className={`transition-all duration-200 ${
                  isActive
                    ? 'h-1 w-4 rounded-full bg-accent shadow-2xs'
                    : 'h-0.5 w-2.5 rounded-full bg-quiet/40 group-hover:bg-sub group-hover:w-3'
                }`}
              />
            );
          })}
        </button>
      )}
    </div>
  );
};
