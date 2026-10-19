import React from 'react';
import { BookOpen, Bot, CheckSquare2, MessageSquare, QrCode, Settings } from 'lucide-react';
import type { User } from '../types';

export type AppSection = 'work' | 'wiki' | 'ai' | 'chat' | 'transfer' | 'settings';

interface AppRailProps {
  activeSection: AppSection;
  onWork: () => void;
  onWiki: () => void;
  onAI: () => void;
  onChat: () => void;
  onTransfer: () => void;
  onSettings: () => void;
  unreadCount?: number;
  riskCount?: number;
  currentUser?: User;
  onOpenProfileModal?: () => void;
}

const railItems = [
  { id: 'work' as const, label: 'Work', icon: CheckSquare2 },
  { id: 'wiki' as const, label: 'Wiki', icon: BookOpen },
  { id: 'ai' as const, label: 'AI', icon: Bot },
  { id: 'chat' as const, label: 'Chat', icon: MessageSquare },
  { id: 'transfer' as const, label: 'Optical Transfer', icon: QrCode },
];

/** 48px global navigation rail. Keep labels in tooltips so the canvas remains dense. */
export const AppRail: React.FC<AppRailProps> = ({
  activeSection,
  onWork,
  onWiki,
  onAI,
  onChat,
  onTransfer,
  onSettings,
  unreadCount = 0,
  riskCount = 0,
  currentUser,
  onOpenProfileModal,
}) => {
  const handlers = {
    work: onWork,
    wiki: onWiki,
    ai: onAI,
    chat: onChat,
    transfer: onTransfer,
  };

  const isSelfImg =
    currentUser?.avatar &&
    (currentUser.avatar.startsWith('data:image') || currentUser.avatar.startsWith('http'));

  return (
    <aside className="app-rail z-30 flex w-12 shrink-0 flex-col items-center border-r border-edge bg-surface py-2 text-sub">
      <nav className="flex flex-1 flex-col items-center gap-1" aria-label="Primary navigation">
        {railItems.map(({ id, label, icon: Icon }) => {
          const active = activeSection === id;
          const count = id === 'chat' ? unreadCount : 0;
          return (
            <button
              key={id}
              type="button"
              onClick={handlers[id]}
              className={`relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                active ? 'bg-hover text-main' : 'text-sub hover:bg-hover hover:text-main'
              }`}
              title={label}
              aria-label={label}
              aria-current={active ? 'page' : undefined}
            >
              <Icon className="h-4 w-4" />
              {count > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-on-solid">
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={onSettings}
          className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
            activeSection === 'settings' ? 'bg-hover text-main' : 'text-sub hover:bg-hover hover:text-main'
          }`}
          title="Settings"
          aria-label="Settings"
        >
          <Settings className="h-4 w-4" />
        </button>

        {currentUser && (
          <button
            type="button"
            onClick={onOpenProfileModal}
            className="group relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-subtle bg-card text-xs font-bold text-info transition-colors hover:border-blue-500 shadow-soft"
            title={`${currentUser.nickname} (在线)`}
            aria-label={currentUser.nickname}
          >
            {isSelfImg ? (
              <img
                src={currentUser.avatar}
                alt={currentUser.nickname}
                className="h-full w-full object-cover"
              />
            ) : (
              <span>{currentUser.avatar || currentUser.nickname.charAt(0)}</span>
            )}
            <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-surface" />
          </button>
        )}
      </div>
    </aside>
  );
};
