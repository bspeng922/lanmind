/**
 * AIConversationList — 左侧对话列表：新建、搜索、置顶、重命名、删除。
 *
 * CALLING SPEC:
 *   <AIConversationList
 *     conversations={ConversationSummary[]}
 *     activeId={string | null}
 *     searchQuery={string}
 *     matches={AIConversationMatch[]}
 *     onSelect={(id: string) => void}
 *     onCreate={() => void}
 *     onSearchQueryChange={(value: string) => void}
 *     onRename={(id: string, title: string) => void}
 *     onTogglePinned={(id: string) => void}
 *     onDelete={(id: string) => void}
 *   />
 *
 * TOOL CONTRACT:
 *   - 纯展示 + 本地编辑态；任何写入都通过回调交给上层，自身不访问存储。
 *   - 删除为两段式确认：第一段把行切换成确认条，第二段才触发 onDelete。
 *   - 重命名为内联输入，Enter 提交、Esc 取消、失焦提交。
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  MessageSquarePlus,
  Search,
  X,
  Pin,
  PinOff,
  Pencil,
  Trash2,
  MessageSquare,
  Check,
  Plus,
} from 'lucide-react';
import { tr, useLocale } from '../../i18n';
import type { AIConversationMatch, ConversationSummary } from './aiStore';
import { formatConversationAge } from './aiTime';
import { SEARCH_RESULT_LIMIT } from './aiStore';

interface AIConversationListProps {
  conversations: ConversationSummary[];
  activeId: string | null;
  searchQuery: string;
  matches: AIConversationMatch[];
  onSelect: (conversationId: string) => void;
  onCreate: () => void;
  onSearchQueryChange: (value: string) => void;
  onRename: (conversationId: string, title: string) => void;
  onTogglePinned: (conversationId: string) => void;
}

export const AIConversationList: React.FC<AIConversationListProps> = ({
  conversations,
  activeId,
  searchQuery,
  matches,
  onSelect,
  onCreate,
  onSearchQueryChange,
  onRename,
  onTogglePinned,
  onDelete,
}) => {
  useLocale();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId) renameRef.current?.select();
  }, [renamingId]);

  // 切换会话或改变搜索词时收起临时的行内状态，避免残留在别的行上。
  useEffect(() => {
    setConfirmingDeleteId(null);
  }, [activeId, searchQuery]);

  const beginRename = (conversation: ConversationSummary) => {
    setConfirmingDeleteId(null);
    setRenamingId(conversation.id);
    setRenameDraft(conversation.title);
  };

  const commitRename = (conversation: ConversationSummary) => {
    const next = renameDraft.trim() || conversation.title || tr('ai:conversation.untitled');
    setRenamingId(null);
    if (next !== conversation.title) onRename(conversation.id, next);
  };

  const pinned = conversations.filter((item) => item.pinned);
  const recent = conversations.filter((item) => !item.pinned);
  const isSearching = searchQuery.trim().length > 0;

  const renderRow = (conversation: ConversationSummary) => {
    const isActive = conversation.id === activeId;
    const isRenaming = renamingId === conversation.id;
    const isConfirming = confirmingDeleteId === conversation.id;

    if (isConfirming) {
      return (
        <div
          key={conversation.id}
          className="rounded-lg border border-danger/40 bg-card px-2.5 py-2 text-[11px] leading-5"
        >
          <p className="font-medium text-main">{tr('ai:conversation.deleteConfirmTitle')}</p>
          <p className="mt-0.5 text-sub">
            {tr('ai:conversation.deleteConfirmBody', {
              value0: conversation.title || tr('ai:conversation.untitled'),
              value1: conversation.messageCount,
            })}
          </p>
          <div className="mt-2 flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setConfirmingDeleteId(null)}
              className="rounded-md border border-edge px-2 py-1 text-[11px] text-sub transition-colors hover:bg-hover hover:text-main"
            >
              {tr('ai:conversation.deleteCancel')}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmingDeleteId(null);
                onDelete(conversation.id);
              }}
              className="rounded-md bg-danger px-2 py-1 text-[11px] font-medium text-on-solid transition-opacity hover:opacity-90"
            >
              {tr('ai:conversation.deleteConfirmAction')}
            </button>
          </div>
        </div>
      );
    }

    return (
      <div
        key={conversation.id}
        className={`group relative flex items-center gap-1 rounded-lg px-1 transition-colors ${
          isActive ? 'bg-hover' : 'hover:bg-hover/60'
        }`}
      >
        {isRenaming ? (
          <div className="flex min-w-0 flex-1 items-center gap-1 px-1.5 py-1.5">
            <input
              ref={renameRef}
              value={renameDraft}
              maxLength={80}
              aria-label={tr('ai:conversation.renamePlaceholder')}
              placeholder={tr('ai:conversation.renamePlaceholder')}
              onChange={(event) => setRenameDraft(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitRename(conversation);
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  setRenamingId(null);
                }
              }}
              onBlur={() => commitRename(conversation)}
              className="min-w-0 flex-1 rounded border border-accent bg-input px-1.5 py-0.5 text-xs text-main outline-none"
            />
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commitRename(conversation)}
              className="rounded p-0.5 text-sub hover:text-main"
              title={tr('ai:conversation.rename')}
              aria-label={tr('ai:conversation.rename')}
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onSelect(conversation.id)}
            onDoubleClick={() => beginRename(conversation)}
            title={conversation.title || tr('ai:conversation.untitled')}
            className="min-w-0 flex-1 px-1.5 py-2 text-left"
          >
            <span
              className={`block truncate text-xs ${
                isActive ? 'font-semibold text-main' : 'text-sub group-hover:text-main'
              }`}
            >
              {conversation.title || tr('ai:conversation.untitled')}
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-quiet">
              {conversation.pinned && <Pin className="h-2.5 w-2.5 shrink-0" />}
              <span className="truncate">
                {conversation.messageCount > 0
                  ? tr('ai:conversation.messageCount', { value0: conversation.messageCount })
                  : tr('ai:conversation.noMessagesYet')}
              </span>
              <span className="shrink-0">·</span>
              <span className="shrink-0">{formatConversationAge(conversation.updatedAt)}</span>
            </span>
          </button>
        )}

        {!isRenaming && (
          <div
            className={`flex shrink-0 items-center gap-0.5 pr-1 transition-opacity ${
              isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
            }`}
          >
            <button
              type="button"
              onClick={() => onTogglePinned(conversation.id)}
              className="rounded p-1 text-quiet transition-colors hover:bg-card hover:text-main"
              title={conversation.pinned ? tr('ai:conversation.unpin') : tr('ai:conversation.pin')}
              aria-label={conversation.pinned ? tr('ai:conversation.unpin') : tr('ai:conversation.pin')}
            >
              {conversation.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => beginRename(conversation)}
              className="rounded p-1 text-quiet transition-colors hover:bg-card hover:text-main"
              title={tr('ai:conversation.rename')}
              aria-label={tr('ai:conversation.rename')}
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDeleteId(conversation.id)}
              className="rounded p-1 text-quiet transition-colors hover:bg-card hover:text-danger"
              title={tr('ai:conversation.delete')}
              aria-label={tr('ai:conversation.delete')}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderSearchResults = () => (
    <div className="space-y-0.5">
      <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-quiet">
        {tr('ai:search.sectionTitle')}
      </div>
      {matches.length === 0 ? (
        <div className="px-2 py-3 text-[11px] leading-5 text-sub">
          <p className="font-medium text-main">{tr('ai:search.noResults')}</p>
          <p className="mt-0.5">{tr('ai:search.noResultsHint')}</p>
        </div>
      ) : (
        matches.map((match) => (
          <button
            key={`${match.conversation.id}-${match.scope}-${match.snippet.slice(0, 12)}`}
            type="button"
            onClick={() => onSelect(match.conversation.id)}
            title={tr('ai:search.openConversation')}
            className="block w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-hover"
          >
            <span className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-main">
                {match.conversation.title || tr('ai:conversation.untitled')}
              </span>
              <span className="shrink-0 rounded border border-subtle px-1 text-[10px] text-quiet">
                {match.scope === 'title' ? tr('ai:search.titleMatch') : tr('ai:search.messageMatch')}
              </span>
            </span>
            {match.scope === 'message' && (
              <span className="mt-0.5 block truncate text-[11px] text-sub">{match.snippet}</span>
            )}
          </button>
        ))
      )}
      {matches.length >= SEARCH_RESULT_LIMIT && (
        <p className="px-2 pt-1 text-[10px] text-quiet">
          {tr('ai:search.truncated', { value0: matches.length })}
        </p>
      )}
    </div>
  );

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* 顶部标题栏：左侧标题与会话计数，右侧新建按钮 */}
      <div className="flex items-center justify-between gap-2 border-b border-edge px-3 py-2 shrink-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
          <span className="truncate text-xs font-semibold text-main">{tr('ai:conversation.listTitle')}</span>
          <span className="shrink-0 text-[10px] text-quiet font-mono">{conversations.length}</span>
        </div>
        <button
          type="button"
          onClick={onCreate}
          title={tr('ai:conversation.newHint')}
          aria-label={tr('ai:conversation.new')}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-sub transition-colors hover:bg-hover hover:text-accent"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* 搜索栏 */}
      <div className="border-b border-edge p-2 shrink-0">
        <div className="flex items-center gap-1.5 rounded-lg border border-edge bg-input px-2 focus-within:border-accent">
          <Search className="h-3.5 w-3.5 shrink-0 text-quiet" />
          <input
            ref={searchRef}
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder={tr('ai:search.placeholder')}
            aria-label={tr('ai:search.ariaLabel')}
            className="h-7 min-w-0 flex-1 bg-transparent text-xs text-main outline-none placeholder:text-quiet"
          />
          {isSearching && (
            <button
              type="button"
              onClick={() => {
                onSearchQueryChange('');
                searchRef.current?.focus();
              }}
              title={tr('ai:search.clear')}
              aria-label={tr('ai:search.clear')}
              className="rounded p-0.5 text-quiet transition-colors hover:text-main"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        {isSearching ? (
          renderSearchResults()
        ) : conversations.length === 0 ? (
          <div className="px-2.5 py-4 text-[11px] leading-5 text-sub">
            <p className="font-medium text-main">{tr('ai:conversation.emptyList')}</p>
            <p className="mt-1">{tr('ai:conversation.emptyListHint')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {pinned.length > 0 && (
              <div className="space-y-0.5">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-quiet">
                  {tr('ai:conversation.sectionPinned')}
                </div>
                {pinned.map(renderRow)}
              </div>
            )}
            {recent.length > 0 && (
              <div className="space-y-0.5">
                {pinned.length > 0 && (
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-quiet">
                    {tr('ai:conversation.sectionRecent')}
                  </div>
                )}
                {recent.map(renderRow)}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-edge px-3 py-2 text-[10px] text-quiet">
        <div className="flex min-w-0 items-center gap-1.5 truncate">
          <MessageSquare className="h-3 w-3 shrink-0" />
          <span className="truncate">{tr('ai:welcome.contextHint')}</span>
        </div>
      </div>
    </div>
  );
};
