/**
 * 知识库的确认对话框。
 *
 * 调用约定：受控组件。`open` 为 false 时不渲染任何内容。
 * 与右侧抽屉、页面内联编辑一起替代 `window.confirm`，保证与工作项界面一致的视觉语言。
 * Esc 关闭，遮罩点击关闭，danger 变体用于不可撤销操作。
 */

import React, { useEffect } from 'react';
import { useLocale } from '../../i18n';

interface WikiConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const WikiConfirmDialog: React.FC<WikiConfirmDialogProps> = ({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  onCancel,
}) => {
  useLocale();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-sm rounded-xl border border-edge bg-surface p-4 shadow-popover">
        <h2 className="text-sm font-semibold text-main">{title}</h2>
        <p className="mt-2 text-xs leading-5 text-sub">{message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-subtle px-3 py-1.5 text-xs text-sub transition-colors hover:bg-hover hover:text-main"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              danger
                ? 'bg-danger text-on-solid hover:opacity-90'
                : 'bg-accent text-on-accent hover:opacity-90'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
