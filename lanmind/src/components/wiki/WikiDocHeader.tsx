/**
 * WikiDocHeader — Notion / SiYuan 风格文档头部。
 *
 * CALLING SPEC:
 *   <WikiDocHeader
 *     title={titleDraft}
 *     icon={doc.icon}
 *     isLocked={doc.isLocked}
 *     project={project}
 *     updatedAt={doc.updatedAt}
 *     readingStats={{ words: number, minutes: number }}
 *     onTitleChange={(title: string) => void}
 *     onIconChange={(icon?: string) => void}
 *   />
 *
 * TOOL CONTRACT:
 *   - 页面图标选择器支持常用 Notion 图标库，点击外部或 Esc 快捷关闭
 *   - 无边框大标题随窗口响应式排版
 *   - 元数据属性药丸条（更新时间、关联项目、字数与预估阅读时长）
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Clock,
  Lock,
  Folder,
  FileText,
  Smile,
  X,
  User as UserIcon,
} from 'lucide-react';
import { formatRelativeTime, tr, useLocale } from '../../i18n';
import type { WikiProjectOption } from './wikiTypes';
import { WikiPageTags } from './WikiPageTags';

const NOTION_ICONS = [
  '📄', '📝', '📚', '💡', '🚀', '🎯', '📌', '📊',
  '🛠️', '💻', '🔍', '📋', '🌟', '📁', '💬', '⚡',
  '🎨', '🧩', '🏷️', '✅', '❤️', '🔥', '⚙️', '📈',
];

interface WikiDocHeaderProps {
  title: string;
  icon?: string;
  tags?: string[];
  isLocked?: boolean;
  project?: WikiProjectOption;
  createdAt?: string;
  createdByName?: string;
  updatedAt: string;
  updatedByName?: string;
  readingStats: { words: number; minutes: number };
  onTitleChange: (newTitle: string) => void;
  onIconChange?: (newIcon?: string) => void;
  onTagsChange: (tags: string[]) => void;
  onOpenHistory?: () => void;
}

function formatUpdatedAtText(iso: string, locale: string): string {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return '';
  const diffMinutes = Math.round((Date.now() - timestamp) / 60000);
  if (Math.abs(diffMinutes) < 1) return formatRelativeTime(0, 'minute');
  if (Math.abs(diffMinutes) < 60) return formatRelativeTime(-diffMinutes, 'minute');
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return formatRelativeTime(-diffHours, 'hour');
  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 30) return formatRelativeTime(-diffDays, 'day');
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp));
}

export const WikiDocHeader: React.FC<WikiDocHeaderProps> = ({
  title,
  icon,
  tags,
  isLocked = false,
  project,
  createdAt,
  createdByName,
  updatedAt,
  updatedByName,
  readingStats,
  onTitleChange,
  onIconChange,
  onTagsChange,
  onOpenHistory,
}) => {
  const { locale } = useLocale();
  const [iconMenuOpen, setIconMenuOpen] = useState(false);
  const iconPickerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 点击外部空白区域或按 Escape 键自动关闭图标选择弹层
  useEffect(() => {
    if (!iconMenuOpen) return;
    const handleOutside = (event: PointerEvent) => {
      if (iconPickerRef.current && !iconPickerRef.current.contains(event.target as Node)) {
        setIconMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setIconMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleOutside, true);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handleOutside, true);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [iconMenuOpen]);

  const currentIcon = icon || '📄';

  return (
    <header className="mb-4 flex flex-col gap-2 select-text">
      {/* 顶部行：左侧图标 + 标签列表与添加标签按钮；右侧创建信息、更新时间与修改者、字数阅读时长 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* 左侧：图标 + 标签 */}
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          {/* 1. Notion 风格页面图标（悬浮或点击可自由更换） */}
          <div className="relative shrink-0" ref={iconPickerRef}>
            <button
              type="button"
              disabled={isLocked}
              onClick={() => setIconMenuOpen((prev) => !prev)}
              className={`group/icon relative flex h-10 w-10 items-center justify-center rounded-xl text-2xl transition-all ${
                isLocked
                  ? 'cursor-default opacity-90'
                  : 'hover:bg-hover hover:scale-105 active:scale-95 cursor-pointer ring-1 ring-transparent hover:ring-edge'
              }`}
              title={tr('wiki:wikiEditor.pageIcon')}
              aria-label={tr('wiki:wikiEditor.pageIcon')}
              aria-expanded={iconMenuOpen}
            >
              <span>{currentIcon}</span>
              {!isLocked && (
                <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-surface border border-edge text-quiet opacity-0 group-hover/icon:opacity-100 transition-opacity shadow-2xs">
                  <Smile className="h-2.5 w-2.5" />
                </span>
              )}
            </button>

            {/* 图标选择弹窗 */}
            {iconMenuOpen && !isLocked && (
              <div
                role="menu"
                className="absolute left-0 top-full z-40 mt-1.5 w-64 rounded-xl border border-edge bg-surface/95 p-3 shadow-popover backdrop-blur-md animate-in fade-in zoom-in-95 duration-100 select-none"
              >
                <div className="mb-2 flex items-center justify-between text-xs text-sub border-b border-edge/60 pb-1.5">
                  <span className="font-semibold text-main text-xs">{tr('wiki:wikiEditor.chooseIcon')}</span>
                  {icon && onIconChange && (
                    <button
                      type="button"
                      aria-label={tr('wiki:wikiEditor.removeIcon')}
                      onClick={() => {
                        onIconChange(undefined);
                        setIconMenuOpen(false);
                      }}
                      className="flex items-center gap-1 text-[11px] text-quiet hover:text-danger transition-colors"
                    >
                      <X className="h-3 w-3" />
                      <span>{tr('wiki:wikiEditor.removeIcon')}</span>
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-6 gap-1.5">
                  {NOTION_ICONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      role="menuitem"
                      aria-label={emoji}
                      onClick={() => {
                        onIconChange?.(emoji);
                        setIconMenuOpen(false);
                      }}
                      className={`flex h-8 w-8 items-center justify-center rounded-lg text-lg transition-transform hover:scale-120 hover:bg-hover active:scale-95 ${
                        icon === emoji ? 'bg-accent/15 ring-1 ring-accent' : ''
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 标签列表及“+ 添加标签”按钮（紧随图标之后） */}
          <WikiPageTags tags={tags} isLocked={isLocked} onChange={onTagsChange} />
        </div>

        {/* 右侧：创建者、修改者、更新时间、字数与预估阅读时长 */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-quiet shrink-0">
          {/* 关联项目微标 */}
          {project && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface border border-edge/80 px-2.5 py-0.5 text-xs text-sub shadow-2xs font-medium mr-1">
              {project.color ? (
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: project.color }}
                  aria-hidden="true"
                />
              ) : (
                <Folder className="h-3 w-3 text-accent shrink-0" />
              )}
              <span className="truncate max-w-44 text-main">{project.name}</span>
            </span>
          )}

          {/* 创建者与创建时间 */}
          {createdByName && (
            <>
              <span
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-quiet"
                title={`创建于: ${createdAt ? new Date(createdAt).toLocaleString(locale) : '初始建立'}`}
              >
                <UserIcon className="h-3 w-3 shrink-0 opacity-70" />
                <span>由 {createdByName} 创建</span>
                {createdAt && (
                  <span className="opacity-80">
                    ({new Date(createdAt).toLocaleDateString(locale)})
                  </span>
                )}
              </span>
              <span className="text-edge select-none">·</span>
            </>
          )}

          {/* 最后修改者与修改时间（可点击打开页面历史记录） */}
          <button
            type="button"
            onClick={onOpenHistory}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-quiet hover:text-accent hover:bg-hover transition-colors cursor-pointer"
            title={`最后修改: ${updatedByName ? `由 ${updatedByName} ` : ''}更新于 ${new Date(updatedAt).toLocaleString(locale)} (点击查看页面历史记录)`}
          >
            <Clock className="h-3 w-3 shrink-0 text-accent/80" />
            <span>
              {updatedByName ? `由 ${updatedByName} ` : ''}
              更新于 {formatUpdatedAtText(updatedAt, locale)}
            </span>
          </button>

          <span className="text-edge select-none">·</span>

          {/* 字数与预估阅读时长 */}
          <span
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-quiet"
            title={`全文约 ${readingStats.words} 字，朗读/阅读预估需 ${readingStats.minutes} 分钟`}
          >
            <FileText className="h-3 w-3 shrink-0" />
            <span>{readingStats.words} 字</span>
            <span className="text-edge select-none">·</span>
            <span>约 {readingStats.minutes} 分钟阅读</span>
          </span>

          {/* 只读锁定徽标 */}
          {isLocked && (
            <>
              <span className="text-edge select-none">·</span>
              <span className="inline-flex items-center gap-1 rounded-md bg-warning/10 border border-warning/30 px-2 py-0.5 text-[11px] font-medium text-warning">
                <Lock className="h-3 w-3 shrink-0" />
                <span>只读锁定</span>
              </span>
            </>
          )}
        </div>
      </div>

      {/* 2. 无边框呼吸感大标题输入框 */}
      <input
        ref={inputRef}
        value={title}
        disabled={isLocked}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder={tr('wiki:wikiEditor.titlePlaceholder') || '输入文档标题...'}
        aria-label={tr('wiki:wikiEditor.titleLabel') || '文档标题'}
        className="w-full bg-transparent text-3xl sm:text-4xl font-extrabold tracking-tight text-main placeholder:text-placeholder/40 outline-none border-none py-1 leading-tight focus:ring-0 select-text"
      />
    </header>
  );
};
