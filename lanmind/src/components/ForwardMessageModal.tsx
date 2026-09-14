import React, { useState, useMemo } from 'react';
import { X, Search, Send, User as UserIcon, Users, Check } from 'lucide-react';
import { LanChatMessage, LanChatGroup, User } from '../types';

interface ForwardMessageModalProps {
  isOpen: boolean;
  onClose: () => void;
  message: LanChatMessage | null;
  users: User[];
  groups: LanChatGroup[];
  currentUserId: string;
  onForward: (targetType: 'user' | 'group' | 'broadcast', targetId: string) => Promise<void>;
}

export const ForwardMessageModal: React.FC<ForwardMessageModalProps> = ({
  isOpen,
  onClose,
  message,
  users,
  groups,
  currentUserId,
  onForward,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTarget, setSelectedTarget] = useState<{
    type: 'user' | 'group' | 'broadcast';
    id: string;
    name: string;
  } | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'users' | 'groups'>('all');

  const availableUsers = useMemo(() => {
    return users.filter((u) => u.id !== currentUserId);
  }, [users, currentUserId]);

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return availableUsers;
    return availableUsers.filter(
      (u) =>
        (u.displayName && u.displayName.toLowerCase().includes(q)) ||
        u.username.toLowerCase().includes(q)
    );
  }, [availableUsers, searchQuery]);

  const filteredGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => g.name.toLowerCase().includes(q));
  }, [groups, searchQuery]);

  if (!isOpen || !message) return null;

  const handleConfirmForward = async () => {
    if (!selectedTarget || isSending) return;
    setIsSending(true);
    try {
      await onForward(selectedTarget.type, selectedTarget.id);
      setSelectedTarget(null);
      setSearchQuery('');
      onClose();
    } catch (e) {
      console.error('Failed to forward message:', e);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-subtle/80 bg-surface/95 shadow-popover backdrop-blur-md flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-edge/80 px-4 py-3">
          <div className="flex items-center space-x-2">
            <Send className="h-4 w-4 text-info" />
            <h3 className="text-sm font-semibold text-main">转发消息</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-sub hover:bg-hover hover:text-main"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Message Preview */}
        <div className="bg-card/40 px-4 py-2 border-b border-edge/60">
          <div className="text-[11px] text-sub mb-0.5">转发内容：</div>
          <div className="text-xs text-sub line-clamp-2 break-all bg-surface/60 p-2 rounded border border-subtle/40">
            {message.type === 'file' ? `[文件] ${message.fileName || message.content}` : message.content}
          </div>
        </div>

        {/* Search Input & Category Filter */}
        <div className="p-3 border-b border-edge/80 space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-sub" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索联系人或群聊..."
              className="w-full rounded-lg border border-subtle/80 bg-card/70 pl-8 pr-3 py-1.5 text-xs text-main placeholder-quiet focus:border-accent/50 focus:outline-none"
            />
          </div>

          <div className="flex space-x-1.5">
            <button
              onClick={() => setActiveTab('all')}
              className={`px-2.5 py-1 text-[11px] rounded-md transition-colors ${
                activeTab === 'all'
                  ? 'bg-info/10 text-info border border-info/40'
                  : 'bg-card/60 text-sub hover:text-sub'
              }`}
            >
              全部
            </button>
            <button
              onClick={() => setActiveTab('users')}
              className={`px-2.5 py-1 text-[11px] rounded-md transition-colors ${
                activeTab === 'users'
                  ? 'bg-info/10 text-info border border-info/40'
                  : 'bg-card/60 text-sub hover:text-sub'
              }`}
            >
              联系人 ({availableUsers.length})
            </button>
            <button
              onClick={() => setActiveTab('groups')}
              className={`px-2.5 py-1 text-[11px] rounded-md transition-colors ${
                activeTab === 'groups'
                  ? 'bg-info/10 text-info border border-info/40'
                  : 'bg-card/60 text-sub hover:text-sub'
              }`}
            >
              群聊 ({groups.length})
            </button>
          </div>
        </div>

        {/* Target List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {/* Groups Section */}
          {(activeTab === 'all' || activeTab === 'groups') && filteredGroups.length > 0 && (
            <div>
              <div className="text-[11px] font-medium text-sub px-2 py-1 flex items-center space-x-1">
                <Users className="w-3 h-3" />
                <span>群聊</span>
              </div>
              {filteredGroups.map((group) => {
                const isSelected =
                  selectedTarget?.type === 'group' && selectedTarget?.id === group.id;
                return (
                  <div
                    key={group.id}
                    onClick={() =>
                      setSelectedTarget({
                        type: 'group',
                        id: group.id,
                        name: group.name,
                      })
                    }
                    className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-blue-600/20 border border-blue-500/50'
                        : 'hover:bg-hover/60'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <div className="h-7 w-7 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-info">
                        <Users className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-main truncate">
                          {group.name}
                        </div>
                        <div className="text-[10px] text-sub">
                          {Array.isArray(group.memberIds) ? group.memberIds.length : 0} 位成员
                        </div>
                      </div>
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-info" />}
                  </div>
                );
              })}
            </div>
          )}

          {/* Users Section */}
          {(activeTab === 'all' || activeTab === 'users') && filteredUsers.length > 0 && (
            <div>
              <div className="text-[11px] font-medium text-sub px-2 py-1 flex items-center space-x-1 mt-1">
                <UserIcon className="w-3 h-3" />
                <span>联系人</span>
              </div>
              {filteredUsers.map((user) => {
                const isSelected =
                  selectedTarget?.type === 'user' && selectedTarget?.id === user.id;
                return (
                  <div
                    key={user.id}
                    onClick={() =>
                      setSelectedTarget({
                        type: 'user',
                        id: user.id,
                        name: user.displayName || user.username,
                      })
                    }
                    className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-blue-600/20 border border-blue-500/50'
                        : 'hover:bg-hover/60'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5 min-w-0">
                      {user.avatar ? (
                        <img
                          src={user.avatar}
                          alt={user.displayName || user.username}
                          className="h-7 w-7 rounded-full object-cover border border-subtle"
                        />
                      ) : (
                        <div className="h-7 w-7 rounded-full bg-hover flex items-center justify-center text-xs font-bold text-main">
                          {(user.displayName || user.username || '?').slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-main truncate">
                          {user.displayName || user.username}
                        </div>
                        <div className="text-[10px] text-sub truncate">
                          @{user.username}
                        </div>
                      </div>
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-info" />}
                  </div>
                );
              })}
            </div>
          )}

          {filteredGroups.length === 0 && filteredUsers.length === 0 && (
            <div className="py-8 text-center text-xs text-quiet">
              未找到匹配的联系人或群聊
            </div>
          )}
        </div>

        {/* Footer with Selected and Send button */}
        <div className="flex items-center justify-between border-t border-edge/80 px-4 py-2.5 bg-surface/60">
          <div className="text-xs text-sub truncate max-w-[200px]">
            {selectedTarget ? (
              <span>
                发送给：<strong className="text-info">{selectedTarget.name}</strong>
              </span>
            ) : (
              <span className="text-quiet">请选择接收目标</span>
            )}
          </div>
          <div className="flex space-x-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-subtle/80 bg-card/80 px-3 py-1.5 text-xs text-sub hover:bg-hover"
            >
              取消
            </button>
            <button
              onClick={handleConfirmForward}
              disabled={!selectedTarget || isSending}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-on-solid hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-1"
            >
              <Send className="w-3 h-3" />
              <span>{isSending ? '发送中...' : '发送'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
