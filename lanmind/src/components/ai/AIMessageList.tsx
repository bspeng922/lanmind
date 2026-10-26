/**
 * AIMessageList — 对话消息流。
 *
 * CALLING SPEC:
 *   <AIMessageList
 *     messages={AIMessage[]}
 *     assistantName={string}
 *     pending={boolean}
 *     isSending={boolean}
 *     onRetry={() => void}
 *     onCreateWorkItem={(text: string) => void}
 *     onOpenReport={() => void}
 *   />
 *
 * TOOL CONTRACT:
 *   - 输入：会话消息数组与助手显示名，全部来自上层，组件自身不读写存储。
 *   - 输出：用户/助手两种气泡样式；助手消息带复制按钮与后续动作。
 *   - 自动滚动到最新消息；仅在列表长度变化时触发，避免重渲染时反复跳动。
 *   - 复制失败时行内提示，不引入全局提示依赖。
 */

import React, { useEffect, useRef, useState } from 'react';
import { Bot, ClipboardList, Copy, Check, RefreshCw, AlertCircle, User as UserIcon, ListPlus, Pencil, Paperclip } from 'lucide-react';
import { tr, useLocale } from '../../i18n';
import type { AIMessage } from './aiStore';
import { formatMessageTimestamp } from './aiTime';
import { AssistantMarkdown } from './AssistantMarkdown';

interface AIMessageListProps {
  messages: AIMessage[];
  assistantName: string;
  /** 正在等待模型返回。 */
  isSending: boolean;
  /** 出错消息之后允许重新生成。 */
  onRetry?: () => void;
  /** 编辑用户消息并重新发送生成新回复。 */
  onEditAndResend?: (messageId: string, newContent: string) => void;
  onCreateWorkItem?: (initialTitle: string) => void;
  onOpenReport?: () => void;
}

export const AIMessageList: React.FC<AIMessageListProps> = ({
  messages,
  assistantName,
  isSending,
  onRetry,
  onEditAndResend,
  onCreateWorkItem,
  onOpenReport,
}) => {
  useLocale();
  const endRef = useRef<HTMLDivElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyErrorId, setCopyErrorId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const lastContent = messages[messages.length - 1]?.content;

  useEffect(() => {
    const parent = endRef.current?.parentElement?.parentElement;
    if (parent && typeof parent.scrollTo === 'function') {
      parent.scrollTo({
        top: parent.scrollHeight,
        behavior: isSending ? 'auto' : 'smooth',
      });
    } else {
      endRef.current?.scrollIntoView({ behavior: isSending ? 'auto' : 'smooth', block: 'end' });
    }
  }, [messages.length, isSending, lastContent]);

  const copy = async (message: AIMessage) => {
    try {
      if (!navigator.clipboard || !window.isSecureContext) throw new Error('unavailable');
      await navigator.clipboard.writeText(message.content);
      setCopyErrorId(null);
      setCopiedId(message.id);
      window.setTimeout(() => setCopiedId((current) => (current === message.id ? null : current)), 1800);
    } catch {
      setCopiedId(null);
      setCopyErrorId(message.id);
      window.setTimeout(() => setCopyErrorId((current) => (current === message.id ? null : current)), 2600);
    }
  };

  const handleStartEdit = (message: AIMessage) => {
    setEditingMessageId(message.id);
    setEditDraft(message.content);
    requestAnimationFrame(() => {
      editTextareaRef.current?.focus();
    });
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditDraft('');
  };

  const handleSaveEdit = (messageId: string) => {
    const content = editDraft.trim();
    if (!content || isSending) return;
    setEditingMessageId(null);
    setEditDraft('');
    onEditAndResend?.(messageId, content);
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-6 py-5 select-text">
      {messages.map((message, index) => {
        const isUser = message.role === 'user';
        const isLast = index === messages.length - 1;
        if (isUser) {
          if (editingMessageId === message.id) {
            return (
              <div key={message.id} className="flex flex-col items-end gap-1 w-full">
                <div className="flex w-full justify-end">
                  <div className="w-full max-w-[90%] rounded-2xl border-2 border-accent bg-surface p-3.5 shadow-soft transition-all">
                    <textarea
                      ref={editTextareaRef}
                      value={editDraft}
                      disabled={isSending}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          if (event.shiftKey) return;
                          if (event.ctrlKey || event.metaKey) {
                            event.preventDefault();
                            const target = event.currentTarget;
                            const start = target.selectionStart;
                            const end = target.selectionEnd;
                            const nextVal = editDraft.slice(0, start) + '\n' + editDraft.slice(end);
                            setEditDraft(nextVal);
                            requestAnimationFrame(() => {
                              target.selectionStart = target.selectionEnd = start + 1;
                            });
                            return;
                          }
                          event.preventDefault();
                          if (editDraft.trim() && !isSending) {
                            handleSaveEdit(message.id);
                          }
                        }
                      }}
                      rows={Math.min(8, Math.max(2, editDraft.split('\n').length))}
                      className="block w-full resize-none bg-transparent text-xs leading-5 text-main outline-none placeholder:text-quiet"
                      placeholder="编辑消息，Enter 发送，Shift / Ctrl + Enter 换行..."
                      autoFocus
                    />
                    <div className="mt-3 flex items-center justify-between border-t border-edge/40 pt-2 px-1">
                      <div className="flex items-center text-quiet">
                        <Paperclip className="h-4 w-4" />
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleCancelEdit}
                          disabled={isSending}
                          className="rounded-full border border-edge bg-card px-3.5 py-1 text-xs text-sub hover:bg-hover hover:text-main transition-colors disabled:opacity-50"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(message.id)}
                          disabled={!editDraft.trim() || isSending}
                          className="rounded-full bg-accent px-4 py-1 text-xs font-medium text-on-accent hover:opacity-90 transition-opacity disabled:opacity-50"
                        >
                          发送
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div key={message.id} className="group flex flex-col items-end gap-1">
              <div className="flex max-w-[85%] items-start gap-2">
                <div className="min-w-0 rounded-xl rounded-br-sm border border-edge bg-hover px-3 py-2 text-xs leading-5 text-main shadow-soft select-text cursor-text" data-selectable="true">
                  <p className="whitespace-pre-wrap break-words select-text">{message.content}</p>
                </div>
                <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-edge bg-card text-quiet">
                  <UserIcon className="h-3.5 w-3.5" />
                </span>
              </div>
              <div className="flex items-center gap-2 pr-8">
                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <button
                    type="button"
                    onClick={() => void copy(message)}
                    title={copiedId === message.id ? tr('ai:message.copied') : tr('ai:message.copy')}
                    aria-label={copiedId === message.id ? tr('ai:message.copied') : tr('ai:message.copy')}
                    className="flex h-6 w-6 items-center justify-center rounded text-quiet hover:bg-hover hover:text-main transition-colors"
                  >
                    {copiedId === message.id ? (
                      <Check className="h-3.5 w-3.5 text-success" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                  {onEditAndResend && (
                    <button
                      type="button"
                      onClick={() => handleStartEdit(message)}
                      disabled={isSending}
                      title="编辑并重新发送"
                      aria-label="编辑并重新发送"
                      className="flex h-6 w-6 items-center justify-center rounded text-quiet hover:bg-hover hover:text-main transition-colors disabled:opacity-40"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <span className="font-mono text-[10px] text-quiet">
                  {formatMessageTimestamp(message.createdAt, message.id)}
                </span>
              </div>
            </div>
          );
        }

        return (
          <div key={message.id} className="group flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent text-on-accent">
                <Bot className="h-3.5 w-3.5" />
              </span>
              <span className="text-[11px] font-semibold text-main">{assistantName}</span>
              <span className="font-mono text-[10px] text-quiet">
                {formatMessageTimestamp(message.createdAt, message.id)}
              </span>
              <button
                type="button"
                onClick={() => void copy(message)}
                title={copiedId === message.id ? tr('ai:message.copied') : tr('ai:message.copy')}
                aria-label={copiedId === message.id ? tr('ai:message.copied') : tr('ai:message.copy')}
                className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-quiet opacity-0 transition-opacity hover:bg-hover hover:text-main group-hover:opacity-100 focus-visible:opacity-100"
              >
                {copiedId === message.id ? (
                  <Check className="h-3 w-3 text-success" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                <span>
                  {copyErrorId === message.id
                    ? tr('ai:message.copyFailed')
                    : copiedId === message.id
                      ? tr('ai:message.copied')
                      : tr('ai:message.copy')}
                </span>
              </button>
            </div>

            <div className="pl-8 select-text cursor-text" data-selectable="true">
              {message.content ? (
                <div>
                  <AssistantMarkdown value={message.content} />
                  {isSending && isLast && (
                    <span className="inline-block h-3.5 w-1.5 translate-y-0.5 ml-1 bg-accent animate-pulse align-middle" />
                  )}
                </div>
              ) : isSending && isLast ? (
                <div className="flex items-center gap-1.5 py-1 text-xs text-sub">
                  <span className="inline-flex items-center gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:0ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:300ms]" />
                  </span>
                  <span className="ml-1 text-[11px] text-quiet">
                    {tr('ai:message.generating', { value0: assistantName })}
                  </span>
                </div>
              ) : !message.error ? (
                <p className="text-xs leading-5 text-sub">{tr('ai:message.emptyResponse')}</p>
              ) : null}

              {message.error && (
                <div className="mt-2 flex items-start gap-2 rounded-lg border border-danger/40 bg-card px-2.5 py-2 text-[11px] leading-5">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-main">{tr('ai:error.requestFailedTitle')}</p>
                    <p className="mt-0.5 break-words text-sub">
                      {tr('ai:error.requestFailedBody', { value0: message.error })}
                    </p>
                  </div>
                  {isLast && onRetry && (
                    <button
                      type="button"
                      onClick={onRetry}
                      className="flex shrink-0 items-center gap-1 rounded-md border border-edge px-2 py-1 text-[11px] text-sub transition-colors hover:bg-hover hover:text-main"
                    >
                      <RefreshCw className="h-3 w-3" />
                      <span>{tr('ai:message.retry')}</span>
                    </button>
                  )}
                </div>
              )}

              {message.content && !message.error && isLast && !isSending && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {onCreateWorkItem && (
                    <button
                      type="button"
                      onClick={() => onCreateWorkItem(titleFromMessage(message.content))}
                      className="flex items-center gap-1.5 rounded-md border border-edge px-2 py-1 text-[11px] text-sub transition-colors hover:bg-hover hover:text-main"
                    >
                      <ListPlus className="h-3 w-3" />
                      <span>{tr('ai:message.createWorkItem')}</span>
                    </button>
                  )}
                  {onOpenReport && (
                    <button
                      type="button"
                      onClick={onOpenReport}
                      className="flex items-center gap-1.5 rounded-md border border-edge px-2 py-1 text-[11px] text-sub transition-colors hover:bg-hover hover:text-main"
                    >
                      <ClipboardList className="h-3 w-3" />
                      <span>{tr('ai:message.openReport')}</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {isSending && (!messages.length || messages[messages.length - 1]?.role !== 'assistant') && (
        <div className="flex items-center gap-2 pl-8 text-[11px] text-sub">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent text-on-accent">
            <Bot className="h-3.5 w-3.5" />
          </span>
          <span className="flex items-center gap-1">
            {tr('ai:message.generating', { value0: assistantName })}
            <span className="inline-flex gap-0.5">
              <span className="h-1 w-1 animate-bounce rounded-full bg-accent [animation-delay:0ms]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-accent [animation-delay:150ms]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-accent [animation-delay:300ms]" />
            </span>
          </span>
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
};

/**
 * 把一条回复转成工作项标题：取第一行有内容的小标题，去掉 Markdown 记号。
 * 导入到 AIWorkspace 之外的组件不应依赖此函数之外的行为。
 */
export const titleFromMessage = (content: string): string => {
  const line = content
    .split('\n')
    .map((item) => item.replace(/^(?:\d{1,3}[.)]\s+|[#>\-*+]\s*)+/, '').trim())
    .find((item) => item.length > 0) ?? '';
  return line.length > 60 ? `${line.slice(0, 60).trimEnd()}…` : line;
};
