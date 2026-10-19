/**
 * AIComposer — 精简现代化的对话输入区。
 *
 * CALLING SPEC:
 *   <AIComposer
 *     value={string}
 *     onChange={(value: string) => void}
 *     onSend={() => void}
 *     disabled={boolean}
 *     sending={boolean}
 *     error={string | null}
 *     assistantName={string}
 *   />
 */

import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowUp, Plus, Paperclip, X, Image as ImageIcon } from 'lucide-react';
import { tr, useLocale } from '../../i18n';

interface AIComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled: boolean;
  sending: boolean;
  error: string | null;
  assistantName: string;
  onDismissError?: () => void;
}

interface ComposerAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl?: string;
}

const MAX_HEIGHT_PX = 176;

export const AIComposer: React.FC<AIComposerProps> = ({
  value,
  onChange,
  onSend,
  disabled,
  sending,
  error,
  onDismissError,
}) => {
  useLocale();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);

  // 高度贴合内容：先归零再按 scrollHeight 计算，避免删除文字后留空。
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value]);

  const canSend = (value.trim().length > 0 || attachments.length > 0) && !disabled && !sending;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach((file: File) => {
      const reader = new FileReader();
      const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        setAttachments((prev) => [
          ...prev,
          {
            id,
            name: file.name,
            type: file.type || 'application/octet-stream',
            size: file.size,
            dataUrl,
          },
        ]);
      };
      if (file.type.startsWith('image/')) {
        reader.readAsDataURL(file);
      } else {
        reader.readAsDataURL(file);
      }
    });

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== id));
  };

  const handleInternalSend = () => {
    if (!canSend) return;

    if (attachments.length > 0) {
      let fullMessage = value.trim();
      const snippets = attachments
        .map((att) => {
          if (att.type.startsWith('image/') && att.dataUrl) {
            return `\n![${att.name}](${att.dataUrl})`;
          }
          return `\n[📎 附件: ${att.name}]`;
        })
        .join('');

      fullMessage = (fullMessage + snippets).trim();
      onChange(fullMessage);
      setAttachments([]);
      window.requestAnimationFrame(() => onSend());
    } else {
      onSend();
    }
  };

  // 支持在输入框中直接 Ctrl+V 粘贴截图
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        const id = `paste-img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        reader.onload = (event) => {
          const dataUrl = event.target?.result as string;
          if (!dataUrl) return;
          setAttachments((prev) => [
            ...prev,
            {
              id,
              name: file.name || '截图.png',
              type: file.type,
              size: file.size,
              dataUrl,
            },
          ]);
        };
        reader.readAsDataURL(file);
        return;
      }
    }
  };

  return (
    <div className="shrink-0 border-t border-edge bg-canvas px-6 py-3">
      <div className="mx-auto w-full max-w-5xl">
        {error && (
          <div className="mb-2 flex items-start gap-2 rounded-lg border border-danger/40 bg-card px-3 py-2 text-[11px] leading-5">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
            <p className="min-w-0 flex-1 break-words text-sub">
              <span className="font-medium text-main">{tr('ai:error.requestFailedTitle')}</span>
              <span className="mx-1">·</span>
              {error}
            </p>
            {onDismissError && (
              <button
                type="button"
                onClick={onDismissError}
                className="shrink-0 rounded px-1 text-[11px] text-quiet transition-colors hover:text-main"
              >
                {tr('ai:error.dismiss')}
              </button>
            )}
          </div>
        )}

        <div className="rounded-2xl border border-edge bg-card p-2.5 shadow-soft focus-within:border-accent/80 focus-within:ring-1 focus-within:ring-accent/20 transition-all">
          {/* 已添加的附件列表展示 */}
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2 px-1">
              {attachments.map((att) => (
                <div
                  key={att.id}
                  className="flex items-center gap-1.5 rounded-lg border border-edge bg-surface/80 px-2 py-1 text-[11px] text-sub shadow-xs"
                >
                  {att.type.startsWith('image/') && att.dataUrl ? (
                    <img src={att.dataUrl} alt="" className="h-5 w-5 rounded object-cover" />
                  ) : (
                    <Paperclip className="h-3.5 w-3.5 text-accent" />
                  )}
                  <span className="max-w-40 truncate font-medium text-main">{att.name}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(att.id)}
                    className="ml-1 rounded p-0.5 text-quiet hover:bg-hover hover:text-danger"
                    title="移除"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            rows={2}
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            onPaste={handlePaste}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                if (event.shiftKey) {
                  return;
                }
                if (event.ctrlKey || event.metaKey) {
                  event.preventDefault();
                  const target = event.currentTarget;
                  const start = target.selectionStart;
                  const end = target.selectionEnd;
                  const nextVal = value.slice(0, start) + '\n' + value.slice(end);
                  onChange(nextVal);
                  requestAnimationFrame(() => {
                    target.selectionStart = target.selectionEnd = start + 1;
                  });
                  return;
                }
                event.preventDefault();
                if (canSend) handleInternalSend();
              }
            }}
            placeholder="输入问题，Enter 发送，Shift / Ctrl + Enter 换行..."
            aria-label={tr('ai:composer.ariaLabel')}
            className="block max-h-44 w-full resize-none bg-transparent px-1.5 text-xs leading-5 text-main outline-none placeholder:text-quiet disabled:opacity-60"
          />

          <div className="mt-2 flex items-center justify-between border-t border-subtle/60 pt-2 px-1">
            {/* 左下角上传附件与图片加号按钮 */}
            <div className="flex items-center gap-1">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileSelect}
                className="hidden"
                accept="image/*,.pdf,.doc,.docx,.txt,.md,.json,.csv,.xlsx"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-sub hover:bg-hover hover:text-accent transition-colors disabled:opacity-40"
                title="上传附件或图片"
                aria-label="上传附件或图片"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>

            {/* 右下角发送按钮 */}
            <button
              type="button"
              onClick={handleInternalSend}
              disabled={!canSend}
              title={sending ? tr('ai:composer.sending') : tr('ai:composer.send')}
              aria-label={sending ? tr('ai:composer.sending') : tr('ai:composer.send')}
              className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 text-[11px] font-medium text-on-accent transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 shadow-xs"
            >
              <ArrowUp className="h-3.5 w-3.5" />
              <span>{sending ? tr('ai:composer.sending') : tr('ai:composer.send')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
