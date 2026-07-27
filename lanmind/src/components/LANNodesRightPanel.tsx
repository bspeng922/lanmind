import React from 'react';
import { User } from '../types';
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
}) => {
  const otherUsers = users.filter((u) => u.id !== currentUser.id);
  const onlineCount = users.filter((u) => u.isOnline).length;

  if (!isExpanded) {
    return (
      <aside className="z-20 flex w-14 flex-shrink-0 select-none flex-col items-center gap-3 border-l border-slate-800 bg-slate-900 py-3 shadow-xl transition-all duration-300">
        {/* Expand Toggle Button */}
        <button
          onClick={onToggleExpand}
          className="group relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
          title="展开局域网在线节点列表"
        >
          <PanelRightOpen className="h-4 w-4" />
          <span className="absolute right-12 top-1 bg-slate-800 text-slate-200 text-[10px] px-2 py-1 rounded whitespace-nowrap hidden group-hover:block border border-slate-700 shadow-md">
            展开节点列表
          </span>
        </button>

        <div className="h-px w-8 flex-shrink-0 bg-slate-800" />

        {/* LAN Chat Quick Launcher */}
        <button
          onClick={() => onOpenLanChat?.()}
          className="group relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-600/20 text-blue-400 transition-all hover:bg-blue-600 hover:text-white"
          title="发起局域网即时沟通"
        >
          <MessageSquare className="w-4 h-4" />
          {unreadMessageTotal > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white ring-2 ring-slate-900">
              {unreadMessageTotal > 99 ? '99+' : unreadMessageTotal}
            </span>
          )}
          <span className="absolute right-12 top-1 bg-slate-800 text-slate-200 text-[10px] px-2 py-1 rounded whitespace-nowrap hidden group-hover:block border border-slate-700 shadow-md">
            局域网即时聊天
          </span>
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
                <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-slate-700 bg-slate-800 text-sm">
                  {isImg ? (
                    <img src={u.avatar} alt={u.nickname} className="h-full w-full object-cover" />
                  ) : (
                    <span>{u.avatar || u.nickname.charAt(0)}</span>
                  )}
                </span>
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-slate-900 ${
                    u.isOnline ? 'bg-emerald-400' : 'bg-slate-600'
                  }`}
                />
                {unreadCount > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white ring-2 ring-slate-900">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </aside>
    );
  }

  const isSelfImg = currentUser.avatar && (currentUser.avatar.startsWith('data:image') || currentUser.avatar.startsWith('http'));

  return (
    <aside className="w-64 bg-slate-900 border-l border-slate-800 text-slate-300 flex flex-col h-full select-none shadow-xl transition-all duration-300 z-20">
      {/* Panel Header */}
      <div className="p-3 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
        <div className="flex items-center space-x-2">
          <Network className="w-4 h-4 text-emerald-400" />
          <h2 className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
            局域网节点
            <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded font-mono border border-emerald-500/20">
              {onlineCount}/{users.length} 在线
            </span>
          </h2>
        </div>

        <div className="flex items-center space-x-1">
          <button
            onClick={() => onOpenLanChat?.()}
            className="relative p-1.5 bg-blue-600/10 hover:bg-blue-600 text-blue-500 hover:text-white rounded-lg transition-colors border border-blue-500/20"
            title="打开局域网即时聊天频道"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            {unreadMessageTotal > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white ring-2 ring-slate-900">
                {unreadMessageTotal > 99 ? '99+' : unreadMessageTotal}
              </span>
            )}
          </button>
          <button
            onClick={onToggleExpand}
            className="p-1 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg transition-colors"
            title="收起右侧节点列表"
          >
            <PanelRightClose className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Self Profile Card */}
      <div className="p-3 border-b border-slate-800 bg-slate-950/60 space-y-2">
        <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold">
          <span>本机节点</span>
        </div>

        <div
          onClick={onOpenProfileModal}
          className="flex items-center space-x-2.5 bg-slate-900/90 p-2.5 rounded-xl border border-slate-800/80 hover:border-blue-500/50 cursor-pointer transition-all group"
          title="点击修改个人头像与名称"
        >
          <div className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700/80 flex items-center justify-center text-base flex-shrink-0 shadow-sm overflow-hidden group-hover:scale-105 transition-transform">
            {isSelfImg ? (
              <img src={currentUser.avatar} alt={currentUser.nickname} className="w-full h-full object-cover" />
            ) : (
              currentUser.avatar || '👤'
            )}
          </div>
          <div className="min-w-0 flex-1 text-xs">
            <div className="font-bold text-slate-100 truncate flex items-center gap-1 group-hover:text-blue-400 transition-colors">
              <span className="truncate">{currentUser.nickname}</span>
              <span className="text-[9px] bg-blue-500/20 text-blue-300 px-1 rounded font-mono flex-shrink-0">
                本机
              </span>
            </div>
            <div className="text-[10px] text-slate-400 font-mono truncate">{currentUser.ip}</div>
          </div>
        </div>
      </div>

      {/* All LAN Nodes List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1 flex items-center justify-between">
          <span>局域网其他节点 ({otherUsers.length})</span>
        </div>

        <div className="space-y-1.5">
          {otherUsers.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-xs bg-slate-950/40 rounded-xl border border-slate-800/60">
              <p>暂无其他局域网节点</p>
              <p className="text-[10px] text-slate-500 mt-1">开启 P2P 发现后将自动感应同局域网成员</p>
            </div>
          ) : (
            otherUsers.map((u) => {
              const isUserImg = u.avatar && (u.avatar.startsWith('data:image') || u.avatar.startsWith('http'));
              const unreadCount = unreadMessagesByUser[u.id] || 0;
              return (
                <div
                  key={u.id}
                  className="p-2.5 rounded-xl border flex items-center justify-between text-xs transition-all bg-slate-950/60 border-slate-800/80 hover:bg-slate-800/60 group"
                >
                  <div className="flex items-center space-x-2.5 min-w-0 flex-1">
                    {/* User Avatar with Online Dot */}
                    <div className="relative flex-shrink-0">
                      <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700/80 flex items-center justify-center text-sm overflow-hidden">
                        {isUserImg ? (
                          <img src={u.avatar} alt={u.nickname} className="w-full h-full object-cover" />
                        ) : (
                          u.avatar || u.nickname.charAt(0)
                        )}
                      </div>
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-slate-900 ${
                          u.isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'
                        }`}
                      />
                      {unreadCount > 0 && (
                        <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white ring-2 ring-slate-900">
                          {unreadCount > 99 ? '99+' : unreadCount}
                        </span>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-slate-200 flex items-center gap-1">
                        <span className="truncate">{u.nickname}</span>
                      </div>
                      <div className="text-[10px] font-mono text-slate-400 truncate">{u.ip}</div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-1.5 flex-shrink-0 ml-1">
                    <button
                      onClick={() => onOpenLanChat?.(u)}
                      className="p-1.5 bg-slate-800/80 hover:bg-blue-600 text-slate-300 hover:text-white rounded-lg transition-colors border border-slate-700/80 hover:border-blue-500"
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
  );
};
