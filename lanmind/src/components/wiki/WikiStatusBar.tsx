/**
 * WikiStatusBar — Obsidian / SiYuan 风格编辑器底部状态栏。
 *
 * CALLING SPEC:
 *   <WikiStatusBar
 *     words={readingStats.words}
 *     minutes={readingStats.minutes}
 *     isLocked={doc.isLocked}
 *     isDirty={isDirty}
 *     storageOk={storageOk}
 *     fullWidth={fullWidth}
 *     onToggleFullWidth={() => setFullWidth((prev) => !prev)}
 *     mode={mode}
 *     onModeChange={setMode}
 *     onSave={handlePublish}
 *   />
 */

import React from 'react';
import {
  Check,
  AlertTriangle,
  Lock,
  Maximize2,
  Minimize2,
  Edit3,
  Columns,
  Eye,
  FileText,
  Clock,
} from 'lucide-react';
import { formatRelativeTime, tr, useLocale } from '../../i18n';
import type { EditorMode } from './WikiEditorTopBar';

interface WikiStatusBarProps {
  words: number;
  minutes: number;
  isLocked?: boolean;
  isDirty: boolean;
  storageOk: boolean;
  fullWidth: boolean;
  onToggleFullWidth: () => void;
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  onSave?: () => void;
  updatedAt?: string;
}

function formatRelativeTimestamp(iso: string, locale: string): string {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return '';
  const diffMinutes = Math.round((Date.now() - timestamp) / 60000);
  if (Math.abs(diffMinutes) < 1) return formatRelativeTime(0, 'minute');
  if (Math.abs(diffMinutes) < 60) return formatRelativeTime(-diffMinutes, 'minute');
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return formatRelativeTime(-diffHours, 'hour');
  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 30) return formatRelativeTime(-diffDays, 'day');
  return new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
}

export const WikiStatusBar: React.FC<WikiStatusBarProps> = ({
  words,
  minutes,
  isLocked = false,
  isDirty,
  storageOk,
  fullWidth,
  onToggleFullWidth,
  mode,
  onModeChange,
  onSave,
  updatedAt,
}) => {
  const { locale } = useLocale();

  return (
    <footer className="flex shrink-0 items-center justify-between border-t border-edge/80 bg-surface/90 px-4 py-1.5 text-xs text-sub backdrop-blur-xs select-none">
      {/* 左侧：文档状态、字数统计与只读锁定 */}
      <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
        {/* 存储/保存状态指示 */}
        {!storageOk ? (
          <span
            className="flex items-center gap-1.5 text-danger font-medium"
            title={tr('wiki:wikiView.saveFailed')}
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{tr('wiki:wikiView.saveFailed')}</span>
          </span>
        ) : isDirty ? (
          <button
            type="button"
            onClick={onSave}
            title={tr('wiki:wikiEditor.clickToSave')}
            className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-warning font-medium hover:bg-warning/10 transition-colors"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-warning animate-pulse shrink-0" />
            <span>{tr('wiki:wikiEditor.unsaved')}</span>
            <span className="hidden sm:inline font-mono text-[10px] opacity-75">(Ctrl+S)</span>
          </button>
        ) : (
          <span className="flex items-center gap-1 text-success font-medium">
            <Check className="h-3.5 w-3.5 shrink-0" />
            <span>{tr('wiki:wikiView.saved')}</span>
          </span>
        )}

        {updatedAt && !isDirty && (
          <>
            <span className="text-edge/60 select-none">·</span>
            <span
              className="hidden md:inline-flex items-center gap-1 text-[11px] text-quiet truncate"
              title={new Date(updatedAt).toLocaleString(locale)}
            >
              <Clock className="h-3 w-3 shrink-0 opacity-70" />
              <span>{tr('wiki:wikiEditor.updatedAt', { value0: formatRelativeTimestamp(updatedAt, locale) })}</span>
            </span>
          </>
        )}

        <span className="text-edge/60 select-none">·</span>

        {/* 字数与预计阅读时间 */}
        <span
          className="flex items-center gap-1.5 text-sub truncate"
          title={
            words > 0
              ? tr('wiki:wikiEditor.readingTime', { value0: words, value1: minutes })
              : tr('wiki:wikiEditor.wordsOnly', { value0: 0 })
          }
        >
          <FileText className="h-3 w-3 text-quiet shrink-0" />
          <span>
            {words === 0
              ? tr('wiki:wikiEditor.wordsOnly', { value0: 0 })
              : tr('wiki:wikiEditor.readingTime', { value0: words, value1: minutes })}
          </span>
        </span>

        {/* 只读锁定标识 */}
        {isLocked && (
          <>
            <span className="text-edge/60 select-none">·</span>
            <span
              className="flex items-center gap-1 rounded bg-warning/10 border border-warning/20 px-1.5 py-0.2 text-[11px] font-medium text-warning"
              title={tr('wiki:wikiEditor.lockedTitle')}
            >
              <Lock className="h-2.5 w-2.5 shrink-0" />
              <span>{tr('wiki:wikiEditor.readOnly')}</span>
            </span>
          </>
        )}
      </div>

      {/* 右侧：模式切换（源码/分屏/预览）、宽屏全宽开关与快捷键提示 */}
      <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
        {/* 模式切换胶囊：源码编辑 / 即时分屏 / 沉浸预览 */}
        <div className="flex items-center rounded-lg border border-edge/80 bg-input/70 p-0.5">
          <button
            type="button"
            onClick={() => onModeChange('edit')}
            aria-pressed={mode === 'edit'}
            className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
              mode === 'edit'
                ? 'bg-card text-main shadow-2xs font-semibold'
                : 'text-quiet hover:text-main'
            }`}
            title={tr('wiki:wikiEditor.sourceModeTitle')}
          >
            <Edit3 className="h-3 w-3" aria-hidden="true" />
            <span>{tr('wiki:wikiEditor.source')}</span>
          </button>
          <button
            type="button"
            onClick={() => onModeChange('split')}
            aria-pressed={mode === 'split'}
            className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
              mode === 'split'
                ? 'bg-card text-main shadow-2xs font-semibold'
                : 'text-quiet hover:text-main'
            }`}
            title={tr('wiki:wikiEditor.splitModeTitle')}
          >
            <Columns className="h-3 w-3" aria-hidden="true" />
            <span>{tr('wiki:wikiEditor.split')}</span>
          </button>
          <button
            type="button"
            onClick={() => onModeChange('preview')}
            aria-pressed={mode === 'preview'}
            className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
              mode === 'preview'
                ? 'bg-card text-main shadow-2xs font-semibold'
                : 'text-quiet hover:text-main'
            }`}
            title={tr('wiki:wikiEditor.previewModeTitle')}
          >
            <Eye className="h-3 w-3" aria-hidden="true" />
            <span>{tr('wiki:wikiEditor.preview')}</span>
          </button>
        </div>

        <span className="h-3.5 w-px bg-edge/60 select-none" aria-hidden="true" />

        {/* Notion 风格全宽/居中切换按钮 */}
        <button
          type="button"
          onClick={onToggleFullWidth}
          className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
            fullWidth
              ? 'bg-accent/15 text-accent border border-accent/30'
              : 'text-sub hover:bg-hover hover:text-main'
          }`}
          title={
            fullWidth
              ? tr('wiki:wikiEditor.standardWidthHint')
              : tr('wiki:wikiEditor.fullWidthHint')
          }
          aria-label={fullWidth ? tr('wiki:wikiEditor.standardWidth') : tr('wiki:wikiEditor.fullWidth')}
        >
          {fullWidth ? (
            <>
              <Minimize2 className="h-3 w-3" />
              <span>{tr('wiki:wikiEditor.standardWidth')}</span>
            </>
          ) : (
            <>
              <Maximize2 className="h-3 w-3" />
              <span>{tr('wiki:wikiEditor.fullWidth')}</span>
            </>
          )}
        </button>

        <span className="hidden sm:inline-block h-3.5 w-px bg-edge/60 select-none" aria-hidden="true" />

        {/* 快捷键提示徽章 */}
        <span
          className="hidden sm:flex items-center gap-1 text-[11px] text-quiet opacity-80"
          title={tr('wiki:wikiEditor.publishShortcutHint')}
        >
          <span>{tr('wiki:wikiEditor.shortcutBadge')}</span>
          <kbd className="rounded border border-edge/80 bg-input/80 px-1 py-0.2 font-mono text-[10px] text-sub shadow-2xs">
            Ctrl+S
          </kbd>
        </span>
      </div>
    </footer>
  );
};
