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
 *   />
 */

import React from 'react';
import {
  Check,
  AlertTriangle,
  Lock,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { tr, useLocale } from '../../i18n';

interface WikiStatusBarProps {
  words: number;
  minutes: number;
  isLocked?: boolean;
  isDirty: boolean;
  storageOk: boolean;
  fullWidth: boolean;
  onToggleFullWidth: () => void;
}

export const WikiStatusBar: React.FC<WikiStatusBarProps> = ({
  words,
  minutes,
  isLocked = false,
  isDirty,
  storageOk,
  fullWidth,
  onToggleFullWidth,
}) => {
  useLocale();

  return (
    <footer className="flex shrink-0 items-center justify-between border-t border-edge/80 bg-surface/90 px-4 py-1.5 text-xs text-quiet backdrop-blur-xs select-none">
      {/* 左侧：字数、阅读时长、锁定状态 */}
      <div className="flex items-center gap-3">
        <span>{tr('wiki:wikiEditor.readingTime', { value0: words, value1: minutes })}</span>
        {isLocked && (
          <span className="flex items-center gap-1 text-warning font-medium">
            <Lock className="h-3 w-3" />
            <span>只读保护</span>
          </span>
        )}
      </div>

      {/* 右侧：宽屏全宽开关、Ctrl+S 快捷键提示、存储状态 */}
      <div className="flex items-center gap-3">
        {/* Notion 风格全宽/居中切换按钮 */}
        <button
          type="button"
          onClick={onToggleFullWidth}
          className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
            fullWidth
              ? 'bg-accent/15 text-accent hover:bg-accent/25'
              : 'text-quiet hover:bg-hover hover:text-main'
          }`}
          title={
            fullWidth
              ? '当前为全宽铺满模式，点击切换为标准居中阅读模式（约 860px）'
              : '当前为标准居中阅读模式，点击切换为宽屏铺满自适应模式（Notion 全宽风格）'
          }
          aria-label={fullWidth ? '标准居中模式' : '宽屏全宽模式'}
        >
          {fullWidth ? (
            <>
              <Minimize2 className="h-3 w-3" />
              <span>标准宽度</span>
            </>
          ) : (
            <>
              <Maximize2 className="h-3 w-3" />
              <span>宽屏铺满</span>
            </>
          )}
        </button>

        <span className="text-edge select-none">|</span>

        <span className="hidden sm:inline-block opacity-70">
          快捷键：Ctrl+S 发布入库
        </span>

        {storageOk ? (
          <span className="flex items-center gap-1 text-success">
            <Check className="h-3 w-3" />
            <span>{isDirty ? tr('wiki:wikiEditor.unsaved') : tr('wiki:wikiView.saved')}</span>
          </span>
        ) : (
          <span
            className="flex items-center gap-1 text-danger font-medium"
            title={tr('wiki:wikiView.saveFailed')}
          >
            <AlertTriangle className="h-3 w-3" />
            <span>{tr('wiki:wikiView.saveFailed')}</span>
          </span>
        )}
      </div>
    </footer>
  );
};
