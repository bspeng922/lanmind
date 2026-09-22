import React, { useState } from 'react';
import { LocalDirectory, User } from '../types';
import { LocalDirectoryModal } from './LocalDirectoryModal';
import {
  PanelRightClose,
  PanelRightOpen,
  UserCheck,
  Shield,
  Edit3,
  HardDrive,
  Users,
  Activity,
  MessageSquare,
  Send,
  Network,
  FolderTree,
} from 'lucide-react';

interface LANNodesRightPanelProps {
  isExpanded: boolean;
  onToggleExpand: () => void;
  users: User[];
  currentUser: User;
  unreadMessagesByUser?: Record<string, number>;
  unreadMessageTotal?: number;
  onOpenProfileModal: () => void;
  onOpenLanChat?: (targetUser?: User) => void;
  localDirectory: LocalDirectory;
  onLocalDirectoryChange: (directory: LocalDirectory) => void;
}

export const LANNodesRightPanel: React.FC<LANNodesRightPanelProps> = ({
  isExpanded,
  onToggleExpand,
  users,
  currentUser,
  unreadMessagesByUser = {},
  unreadMessageTotal = 0,
  onOpenProfileModal,
  onOpenLanChat,
  localDirectory,
  onLocalDirectoryChange,
}) => {
  const [isDirectoryOpen, setIsDirectoryOpen] = useState(false);
  const otherUsers = users.filter((u) => u.id !== currentUser.id);
  const onlineCount = users.filter((u) => u.isOnline).length;

  if (!isExpanded) {
    return (
      <>
      <aside className="z-20 flex w-14 flex-shrink-0 select-none flex-col items-center gap-3 border-l border-edge bg-surface py-3 shadow-soft transition-all duration-300">
        {/* Expand Toggle Button */}
        <button
          onClick={onToggleExpand}
          className="group relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-sub transition-colors hover:bg-hover hover:text-main"
          title="展开局域网在线节点列表"
        >
          <PanelRightOpen className="h-4 w-4" />
          <span className="absolute right-12 top-1 bg-card text-main text-[10px] px-2 py-1 rounded whitespace-nowrap hidden group-hover:block border border-subtle shadow-panel">
            展开节点列表
          </span>
        </button>

        <div className="h-px w-8 flex-shrink-0 bg-card" />

        {/* LAN Chat Quick Launcher */}
        <button
          onClick={() => onOpenLanChat?.()}
          className="group relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-600/20 text-info transition-all hover:bg-blue-600 hover:text-on-solid"
          title="发起局域网即时沟通"
        >
          <MessageSquare className="w-4 h-4" />
          {unreadMessageTotal > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-on-solid ring-2 ring-edge">
              {unreadMessageTotal > 99 ? '99+' : unreadMessageTotal}
            </span>
          )}
          <span className="absolute right-12 top-1 bg-card text-main text-[10px] px-2 py-1 rounded whitespace-nowrap hidden group-hover:block border border-subtle shadow-panel">
            局域网即时聊天
          </span>
        </button>

        <button
          onClick={() => setIsDirectoryOpen(true)}
          className="group relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent transition-all hover:bg-accent hover:text-on-accent"
          title="管理本地组织目录"
        >
          <FolderTree className="h-4 w-4" />
          <span className="absolute right-12 top-1 hidden whitespace-nowrap rounded border border-subtle bg-card px-2 py-1 text-[10px] text-main shadow-panel group-hover:block">本地组织目录</span>
        </button>

        {/* Stacked User Avatars */}
        <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto px-1 pt-1">
          {otherUsers.map((u) => {
            const isImg = u.avatar && (u.avatar.startsWith('data:image') || u.avatar.startsWith('http'));
            const unreadCount = unreadMessagesByUser[u.id] || 0;
            return (
              <button
                key={u.id}
                onClick={() => onOpenLanChat?.(u)}
                className="relative h-8 w-8 flex-shrink-0 transition-transform hover:scale-105"
                title={`点击与 ${u.nickname} 开启 P2P 聊天 (${u.isOnline ? '在线' : '离线'})`}
              >
                <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-subtle bg-card text-sm">
                  {isImg ? (
                    <img src={u.avatar} alt={u.nickname} className="h-full w-full object-cover" />
                  ) : (
                    <span>{u.avatar || u.nickname.charAt(0)}</span>
                  )}
                </span>
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-edge ${
                    u.isOnline ? 'bg-emerald-400' : 'bg-muted'
                  }`}
                />
                {unreadCount > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-on-solid ring-2 ring-edge">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </aside>
      <LocalDirectoryModal
        isOpen={isDirectoryOpen}
        onClose={() => setIsDirectoryOpen(false)}
        users={users}
        directory={localDirectory}
        onSaved={onLocalDirectoryChange}
      />
      </>
    );
  }

  const isSelfImg = currentUser.avatar && (currentUser.avatar.startsWith('data:image') || currentUser.avatar.startsWith('http'));

  return (
    <>
    <aside className="w-64 bg-surface border-l border-edge text-sub flex flex-col h-full select-none shadow-soft transition-all duration-300 z-20">
      {/* Panel Header */}
      <div className="p-3 border-b border-edge flex items-center justify-between bg-surface/90">
        <div className="flex items-center space-x-2">
          <Network className="w-4 h-4 text-success" />
          <h2 className="text-xs font-bold text-main flex items-center gap-1.5">
            局域网节点
            <span className="text-[10px] bg-emerald-500/10 text-success px-1.5 py-0.5 rounded font-mono border border-emerald-500/20">
              {onlineCount}/{users.length} 在线
            </span>
          </h2>
        </div>

        <div className="flex items-center space-x-1">
          <button
            onClick={() => onOpenLanChat?.()}
            className="relative p-1.5 bg-blue-600/10 hover:bg-blue-600 text-info hover:text-on-solid rounded-lg transition-colors border border-blue-500/20"
            title="打开局域网即时聊天频道"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            {unreadMessageTotal > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-on-solid ring-2 ring-edge">
                {unreadMessageTotal > 99 ? '99+' : unreadMessageTotal}
              </span>
            )}
          </button>
          <button
            onClick={() => setIsDirectoryOpen(true)}
            className="rounded-lg border border-accent/30 bg-accent/10 p-1.5 text-accent transition-colors hover:bg-accent hover:text-on-accent"
            title="管理本地组织目录"
            aria-label="管理本地组织目录"
          >
            <FolderTree className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onToggleExpand}
            className="p-1 hover:bg-hover text-sub hover:text-main rounded-lg transition-colors"
            title="收起右侧节点列表"
          >
            <PanelRightClose className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Self Profile Card */}
      <div className="p-3 border-b border-edge bg-canvas/60 space-y-2">
        <div className="flex items-center justify-between text-[11px] text-sub font-semibold">
          <span>本机节点</span>
        </div>

        <div
          onClick={onOpenProfileModal}
          className="flex items-center space-x-2.5 bg-surface/90 p-2.5 rounded-xl border border-edge/80 hover:border-blue-500/50 cursor-pointer transition-all group"
          title="点击修改个人头像与名称"
        >
          <div className="w-9 h-9 rounded-xl bg-card border border-subtle/80 flex items-center justify-center text-base flex-shrink-0 shadow-soft overflow-hidden group-hover:scale-105 transition-transform">
            {isSelfImg ? (
              <img src={currentUser.avatar} alt={currentUser.nickname} className="w-full h-full object-cover" />
            ) : (
              currentUser.avatar || '👤'
            )}
          </div>
          <div className="min-w-0 flex-1 text-xs">
            <div className="font-bold text-main truncate flex items-center gap-1 group-hover:text-info transition-colors">
              <span className="truncate">{currentUser.nickname}</span>
              <span className="text-[9px] bg-blue-500/20 text-info px-1 rounded font-mono flex-shrink-0">
                本机
              </span>
            </div>
            <div className="text-[10px] text-sub font-mono truncate">{currentUser.ip}</div>
          </div>
        </div>
      </div>

      {/* All LAN Nodes List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        <div className="text-[11px] font-bold text-quiet uppercase tracking-wider mb-1 flex items-center justify-between">
          <span>局域网其他节点 ({otherUsers.length})</span>
        </div>

        <div className="space-y-1.5">
          {otherUsers.length === 0 ? (
            <div className="text-center py-8 text-quiet text-xs bg-canvas/40 rounded-xl border border-edge/60">
              <p>暂无其他局域网节点</p>
              <p className="text-[10px] text-quiet mt-1">开启 P2P 发现后将自动感应同局域网成员</p>
            </div>
          ) : (
            otherUsers.map((u) => {
              const isUserImg = u.avatar && (u.avatar.startsWith('data:image') || u.avatar.startsWith('http'));
              const unreadCount = unreadMessagesByUser[u.id] || 0;
              return (
                <div
                  key={u.id}
                  className="p-2.5 rounded-xl border flex items-center justify-between text-xs transition-all bg-canvas/60 border-edge/80 hover:bg-hover/60 group"
                >
                  <div className="flex items-center space-x-2.5 min-w-0 flex-1">
                    {/* User Avatar with Online Dot */}
                    <div className="relative flex-shrink-0">
                      <div className="w-8 h-8 rounded-lg bg-card border border-subtle/80 flex items-center justify-center text-sm overflow-hidden">
                        {isUserImg ? (
                          <img src={u.avatar} alt={u.nickname} className="w-full h-full object-cover" />
                        ) : (
                          u.avatar || u.nickname.charAt(0)
                        )}
                      </div>
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-edge ${
                          u.isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-muted'
                        }`}
                      />
                      {unreadCount > 0 && (
                        <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-on-solid ring-2 ring-edge">
                          {unreadCount > 99 ? '99+' : unreadCount}
                        </span>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-main flex items-center gap-1">
                        <span className="truncate">{u.nickname}</span>
                      </div>
                      <div className="text-[10px] font-mono text-sub truncate">{u.ip}</div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-1.5 flex-shrink-0 ml-1">
                    <button
                      onClick={() => onOpenLanChat?.(u)}
                      className="p-1.5 bg-card/80 hover:bg-blue-600 text-sub hover:text-on-solid rounded-lg transition-colors border border-subtle/80 hover:border-blue-500"
                      title={`与 ${u.nickname} 发起 P2P 对话`}
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </aside>
    <LocalDirectoryModal
      isOpen={isDirectoryOpen}
      onClose={() => setIsDirectoryOpen(false)}
      users={users}
      directory={localDirectory}
      onSaved={onLocalDirectoryChange}
    />
    </>
  );
};
