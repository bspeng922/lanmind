/**
 * Wiki 样式快捷工具栏组件。
 *
 * CALLING SPEC:
 *   <WikiToolbar
 *     textareaRef={textareaRef}
 *     value={content}
 *     onChange={(newContent) => setContent(newContent)}
 *     disabled={isLocked}
 *   />
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Heading,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Code,
  Link,
  Image as ImageIcon,
  Paperclip,
  Table,
  RotateCcw,
  RotateCw,
  Highlighter,
  ChevronDown,
} from 'lucide-react';
import { tr, useLocale } from '../../i18n';
import { saveWikiAsset } from './wikiAssetStore';

export interface WikiToolbarProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export const WikiToolbar: React.FC<WikiToolbarProps> = ({
  textareaRef,
  value,
  onChange,
  disabled = false,
}) => {
  useLocale();
  const [headingOpen, setHeadingOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 点击外部关闭标题下拉
  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setHeadingOpen(false);
      }
    };
    window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  /**
   * 辅助工具：在当前光标选区包裹或插入语法，并保持焦点与光标
   */
  const wrapOrInsert = (before: string, after: string = '', defaultText: string = '') => {
    const el = textareaRef.current;
    if (!el || disabled) return;

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end);

    let nextValue: string;
    let nextStart: number;
    let nextEnd: number;

    if (selected) {
      nextValue = value.slice(0, start) + before + selected + after + value.slice(end);
      nextStart = start + before.length;
      nextEnd = start + before.length + selected.length;
    } else {
      const inserted = defaultText || '';
      nextValue = value.slice(0, start) + before + inserted + after + value.slice(end);
      nextStart = start + before.length;
      nextEnd = nextStart + inserted.length;
    }

    onChange(nextValue);
    window.requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(nextStart, nextEnd);
    });
  };

  /**
   * 辅助工具：在当前行首设置前缀（如标题、引用、列表）
   */
  const setLinePrefix = (prefix: string) => {
    const el = textareaRef.current;
    if (!el || disabled) return;

    const start = el.selectionStart;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = value.indexOf('\n', start);
    if (lineEnd === -1) lineEnd = value.length;

    const lineText = value.slice(lineStart, lineEnd);
    // 去掉旧有的 markdown 标题/引用/列表前缀
    const cleanedLine = lineText.replace(/^(#{1,6}\s+|-\s*\[[ x]\]\s+|[-*+]\s+|\d+\.\s+|>+\s*)/, '');
    const nextLine = prefix ? `${prefix}${cleanedLine}` : cleanedLine;
    const nextValue = value.slice(0, lineStart) + nextLine + value.slice(lineEnd);

    onChange(nextValue);
    window.requestAnimationFrame(() => {
      el.focus();
      const newPos = lineStart + nextLine.length;
      el.setSelectionRange(newPos, newPos);
    });
  };

  const handleHeadingSelect = (level: number) => {
    if (level === 0) {
      setLinePrefix('');
    } else {
      setLinePrefix(`${'#'.repeat(level)} `);
    }
    setHeadingOpen(false);
  };

  const insertTable = () => {
    const tableTemplate =
      '\n| 列标题 1 | 列标题 2 | 列标题 3 |\n| :--- | :--- | :--- |\n| 单元格 1 | 单元格 2 | 单元格 3 |\n| 单元格 4 | 单元格 5 | 单元格 6 |\n';
    wrapOrInsert(tableTemplate);
  };

  const handleUndo = () => {
    const el = textareaRef.current;
    if (!el || disabled) return;
    el.focus();
    try {
      document.execCommand('undo');
    } catch {
      /* ignore */
    }
  };

  const handleRedo = () => {
    const el = textareaRef.current;
    if (!el || disabled) return;
    el.focus();
    try {
      document.execCommand('redo');
    } catch {
      /* ignore */
    }
  };

  useLocale();

  return (
    <div
      role="toolbar"
      aria-label={tr('wiki:toolbar.ariaLabel')}
      className={`relative z-10 flex shrink-0 flex-wrap items-center gap-0.5 border-b border-edge/80 bg-surface px-3 py-1.5 text-xs text-sub backdrop-blur-xs transition-opacity ${
        disabled ? 'opacity-50 pointer-events-none' : ''
      }`}
    >
      {/* 标题层级下拉 */}
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setHeadingOpen((prev) => !prev)}
          className="flex h-7 items-center gap-1 rounded-md px-2 font-medium text-main hover:bg-hover transition-colors"
          title={tr('wiki:toolbar.headingDropdownTitle')}
        >
          <Heading className="h-3.5 w-3.5 text-accent" />
          <span className="text-xs">{tr('wiki:toolbar.headingButton')}</span>
          <ChevronDown className="h-3 w-3 text-quiet" />
        </button>

        {headingOpen && (
          <div className="absolute left-0 top-full z-50 mt-1 w-40 rounded-xl border border-edge bg-surface p-1 shadow-popover animate-in fade-in duration-100">
            <button
              type="button"
              onClick={() => handleHeadingSelect(0)}
              className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs text-main hover:bg-hover"
            >
              {tr('wiki:toolbar.paragraph')}
            </button>
            <button
              type="button"
              onClick={() => handleHeadingSelect(1)}
              className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-sm font-bold text-main hover:bg-hover"
            >
              {tr('wiki:toolbar.h1')}
            </button>
            <button
              type="button"
              onClick={() => handleHeadingSelect(2)}
              className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs font-bold text-main hover:bg-hover"
            >
              {tr('wiki:toolbar.h2')}
            </button>
            <button
              type="button"
              onClick={() => handleHeadingSelect(3)}
              className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-main hover:bg-hover"
            >
              {tr('wiki:toolbar.h3')}
            </button>
            <button
              type="button"
              onClick={() => handleHeadingSelect(4)}
              className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-[11px] font-medium text-main hover:bg-hover"
            >
              {tr('wiki:toolbar.h4')}
            </button>
          </div>
        )}
      </div>

      <div className="mx-1 h-4 w-px bg-edge/60" aria-hidden="true" />

      {/* 字体格式化：加粗、斜体、下划线、删除线、高亮 */}
      <button
        type="button"
        onClick={() => wrapOrInsert('**', '**', tr('wiki:toolbar.boldDefault'))}
        className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover hover:text-main transition-colors"
        title={tr('wiki:toolbar.boldTitle')}
        aria-label={tr('wiki:toolbar.bold')}
      >
        <Bold className="h-3.5 w-3.5 font-bold" />
      </button>

      <button
        type="button"
        onClick={() => wrapOrInsert('*', '*', tr('wiki:toolbar.italicDefault'))}
        className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover hover:text-main transition-colors"
        title={tr('wiki:toolbar.italicTitle')}
        aria-label={tr('wiki:toolbar.italic')}
      >
        <Italic className="h-3.5 w-3.5" />
      </button>

      <button
        type="button"
        onClick={() => wrapOrInsert('<u>', '</u>', tr('wiki:toolbar.underlineDefault'))}
        className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover hover:text-main transition-colors"
        title={tr('wiki:toolbar.underline')}
        aria-label={tr('wiki:toolbar.underline')}
      >
        <Underline className="h-3.5 w-3.5" />
      </button>

      <button
        type="button"
        onClick={() => wrapOrInsert('~~', '~~', tr('wiki:toolbar.strikethroughDefault'))}
        className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover hover:text-main transition-colors"
        title={tr('wiki:toolbar.strikethrough')}
        aria-label={tr('wiki:toolbar.strikethrough')}
      >
        <Strikethrough className="h-3.5 w-3.5" />
      </button>

      <button
        type="button"
        onClick={() => wrapOrInsert('==', '==', tr('wiki:toolbar.highlightDefault'))}
        className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover hover:text-main transition-colors"
        title={tr('wiki:toolbar.highlightTitle')}
        aria-label={tr('wiki:toolbar.highlight')}
      >
        <Highlighter className="h-3.5 w-3.5 text-warning" />
      </button>

      <div className="mx-1 h-4 w-px bg-edge/60" aria-hidden="true" />

      {/* 列表与待办 */}
      <button
        type="button"
        onClick={() => setLinePrefix('- ')}
        className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover hover:text-main transition-colors"
        title={tr('wiki:toolbar.bulletList')}
        aria-label={tr('wiki:toolbar.bulletList')}
      >
        <List className="h-3.5 w-3.5" />
      </button>

      <button
        type="button"
        onClick={() => setLinePrefix('1. ')}
        className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover hover:text-main transition-colors"
        title={tr('wiki:toolbar.orderedList')}
        aria-label={tr('wiki:toolbar.orderedList')}
      >
        <ListOrdered className="h-3.5 w-3.5" />
      </button>

      <button
        type="button"
        onClick={() => setLinePrefix('- [ ] ')}
        className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover hover:text-main transition-colors"
        title={tr('wiki:toolbar.taskListTitle')}
        aria-label={tr('wiki:toolbar.taskList')}
      >
        <CheckSquare className="h-3.5 w-3.5 text-info" />
      </button>

      <div className="mx-1 h-4 w-px bg-edge/60" aria-hidden="true" />

      {/* 引用与代码 */}
      <button
        type="button"
        onClick={() => setLinePrefix('> ')}
        className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover hover:text-main transition-colors"
        title={tr('wiki:toolbar.quote')}
        aria-label={tr('wiki:toolbar.quote')}
      >
        <Quote className="h-3.5 w-3.5" />
      </button>

      <button
        type="button"
        onClick={() => wrapOrInsert('`', '`', 'code')}
        className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover hover:text-main transition-colors"
        title={tr('wiki:toolbar.code')}
        aria-label={tr('wiki:toolbar.code')}
      >
        <Code className="h-3.5 w-3.5" />
      </button>

      <div className="mx-1 h-4 w-px bg-edge/60" aria-hidden="true" />

      {/* 链接、图片、附件与表格 */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file || disabled) return;
          try {
            const { assetPath, fileName } = await saveWikiAsset(file, file.name);
            wrapOrInsert(`\n![${fileName}](${assetPath})\n`);
          } catch (err) {
            console.error('Failed to upload image:', err);
          } finally {
            if (imageInputRef.current) imageInputRef.current.value = '';
          }
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file || disabled) return;
          try {
            const { assetPath, fileName } = await saveWikiAsset(file, file.name);
            wrapOrInsert(`\n[📎 ${fileName}](${assetPath})\n`);
          } catch (err) {
            console.error('Failed to upload attachment:', err);
          } finally {
            if (fileInputRef.current) fileInputRef.current.value = '';
          }
        }}
      />

      <button
        type="button"
        onClick={() => wrapOrInsert('[链接文字](', ')', 'https://')}
        className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover hover:text-main transition-colors"
        title={tr('wiki:toolbar.link')}
        aria-label={tr('wiki:toolbar.link')}
      >
        <Link className="h-3.5 w-3.5" />
      </button>

      <button
        type="button"
        onClick={() => imageInputRef.current?.click()}
        className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover hover:text-main transition-colors"
        title={tr('wiki:toolbar.image')}
        aria-label={tr('wiki:toolbar.image')}
      >
        <ImageIcon className="h-3.5 w-3.5 text-info" />
      </button>

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover hover:text-main transition-colors"
        title={tr('wiki:toolbar.attachment')}
        aria-label={tr('wiki:toolbar.attachment')}
      >
        <Paperclip className="h-3.5 w-3.5 text-sub" />
      </button>

      <button
        type="button"
        onClick={insertTable}
        className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover hover:text-main transition-colors"
        title={tr('wiki:toolbar.table')}
        aria-label={tr('wiki:toolbar.table')}
      >
        <Table className="h-3.5 w-3.5" />
      </button>

      <div className="mx-1 h-4 w-px bg-edge/60" aria-hidden="true" />

      {/* 撤销 / 重做 */}
      <button
        type="button"
        onClick={handleUndo}
        className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover hover:text-main transition-colors"
        title={tr('wiki:toolbar.undo')}
        aria-label={tr('wiki:toolbar.undo')}
      >
        <RotateCcw className="h-3 w-3" />
      </button>

      <button
        type="button"
        onClick={handleRedo}
        className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover hover:text-main transition-colors"
        title={tr('wiki:toolbar.redo')}
        aria-label={tr('wiki:toolbar.redo')}
      >
        <RotateCw className="h-3 w-3" />
      </button>
    </div>
  );
};
