/**
 * ChatMentionPicker — Floating member selector dropdown triggered when typing '@' in group chat.
 *
 * CALLING SPEC:
 *   <ChatMentionPicker
 *     query={mentionQuery}
 *     members={groupMembers}
 *     onSelect={({ id, name }) => handleSelectMention(id, name)}
 *     onClose={() => setShowMentionPicker(false)}
 *   />
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Megaphone, Users, User as UserIcon } from 'lucide-react';
import { User } from '../types';
import { MENTION_ALL_TAG, MENTION_ALL_ID } from '../utils/chatMentions';
import { tr, useLocale } from '../i18n';

export interface MentionItem {
  id: string;
  name: string;
  isAll?: boolean;
  avatar?: string;
  ip?: string;
  isOnline?: boolean;
}

interface ChatMentionPickerProps {
  query: string;
  members: User[];
  onSelect: (target: { id: string; name: string }) => void;
  onClose: () => void;
}

export const ChatMentionPicker: React.FC<ChatMentionPickerProps> = ({
  query,
  members,
  onSelect,
  onClose,
}) => {
  useLocale();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);

  const cleanQuery = query.trim().toLowerCase();

  const filteredItems: MentionItem[] = useMemo(() => {
    const list: MentionItem[] = [];

    // Check if @所有人 matches
    const allMatches =
      !cleanQuery ||
      '所有人'.includes(cleanQuery) ||
      'suoyouren'.includes(cleanQuery) ||
      'all'.includes(cleanQuery);

    if (allMatches) {
      list.push({
        id: MENTION_ALL_ID,
        name: tr('chat:lanChatModal.mentionAll'),
        isAll: true,
      });
    }

    // Filter members
    for (const member of members) {
      const matchNickname = member.nickname.toLowerCase().includes(cleanQuery);
      const matchUsername = member.username?.toLowerCase().includes(cleanQuery);
      const matchIp = member.ip?.toLowerCase().includes(cleanQuery);

      if (!cleanQuery || matchNickname || matchUsername || matchIp) {
        list.push({
          id: member.id,
          name: member.nickname,
          avatar: member.avatar,
          ip: member.ip,
          isOnline: member.isOnline,
        });
      }
    }

    return list;
  }, [cleanQuery, members]);

  // Reset selected index when filtered list changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredItems.length]);

  // Auto-scroll selected item into view
  useEffect(() => {
    const currentEl = itemRefs.current[selectedIndex];
    if (currentEl) {
      currentEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Global keyboard listener for navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (filteredItems.length === 0) {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filteredItems.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % filteredItems.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const chosen = filteredItems[selectedIndex];
        if (chosen) {
          onSelect({ id: chosen.id, name: chosen.name });
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [filteredItems, selectedIndex, onSelect, onClose]);

  // Close on outside pointer click
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [onClose]);

  if (filteredItems.length === 0) {
    return (
      <div
        ref={containerRef}
        className="absolute bottom-full left-0 z-50 mb-2 w-72 rounded-xl border border-edge bg-surface/95 p-3 text-center text-xs text-quiet shadow-popover backdrop-blur-md animate-in fade-in duration-100"
      >
        {tr('chat:lanChatModal.noMatchingMembers')}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full left-0 z-50 mb-2 flex max-h-60 w-72 flex-col overflow-hidden rounded-xl border border-edge bg-surface/95 shadow-popover backdrop-blur-md animate-in fade-in zoom-in-95 duration-100 select-none"
    >
      {/* Mini header */}
      <div className="flex items-center gap-1.5 border-b border-edge/80 px-3 py-1.5 text-[10px] font-bold text-sub">
        <Users className="h-3 w-3 text-primary" />
        <span>{tr('chat:lanChatModal.mentionMember')}</span>
      </div>

      {/* Member list */}
      <div className="overflow-y-auto p-1 space-y-0.5">
        {filteredItems.map((item, index) => {
          const isSelected = index === selectedIndex;
          const isImgAvatar =
            item.avatar && (item.avatar.startsWith('data:image') || item.avatar.startsWith('http'));

          return (
            <div
              key={item.id}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={() => onSelect({ id: item.id, name: item.name })}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer transition-colors ${
                isSelected
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-main hover:bg-hover'
              }`}
            >
              {/* Avatar / Icon */}
              <div className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-edge bg-card text-[11px] font-bold overflow-hidden">
                {item.isAll ? (
                  <Megaphone className="h-3.5 w-3.5 text-amber-500" />
                ) : isImgAvatar ? (
                  <img src={item.avatar} alt={item.name} className="h-full w-full object-cover" />
                ) : (
                  item.avatar || item.name.charAt(0)
                )}

                {!item.isAll && typeof item.isOnline === 'boolean' && (
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full border border-surface ${
                      item.isOnline ? 'bg-emerald-500' : 'bg-muted'
                    }`}
                  />
                )}
              </div>

              {/* Name & Subtitle */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-xs font-semibold">
                    {item.isAll ? `@${item.name}` : item.name}
                  </span>
                  {item.isAll && (
                    <span className="shrink-0 rounded bg-amber-500/15 border border-amber-500/20 px-1 text-[9px] text-warning font-normal">
                      ALL
                    </span>
                  )}
                </div>
                {item.isAll ? (
                  <p className="truncate text-[10px] text-quiet">
                    {tr('chat:lanChatModal.mentionAllDesc')}
                  </p>
                ) : item.ip ? (
                  <p className="truncate text-[10px] text-quiet font-mono">{item.ip}</p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
