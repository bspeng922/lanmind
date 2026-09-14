import React, { useMemo } from 'react';
import { X, CheckCircle2, Clock, Users } from 'lucide-react';
import { LanChatMessage, User } from '../types';

interface ReadReceiptsModalProps {
  isOpen: boolean;
  onClose: () => void;
  message?: LanChatMessage | null;
  targetTitle?: string;
  targetContent?: string;
  readBy?: string[];
  authorId?: string;
  groupMembers: User[];
  currentUserId: string;
}

export const ReadReceiptsModal: React.FC<ReadReceiptsModalProps> = ({
  isOpen,
  onClose,
  message,
  targetTitle,
  targetContent,
  readBy,
  authorId,
  groupMembers,
  currentUserId,
}) => {
  const { readMembers, unreadMembers, displayTitle } = useMemo(() => {
    const title = targetTitle ?? '消息已读详情';
    const effectiveReadBy = readBy ?? message?.readBy ?? [];
    const senderOrAuthorId = authorId ?? message?.senderId;

    if (!message && !readBy) {
      return { readMembers: [], unreadMembers: [], displayTitle: title };
    }

    // Group recipients exclude the sender/author themselves
    const eligibleMembers = senderOrAuthorId
      ? groupMembers.filter((m) => m.id !== senderOrAuthorId)
      : groupMembers;
    const readIds = new Set(effectiveReadBy);

    const read: User[] = [];
    const unread: User[] = [];

    eligibleMembers.forEach((member) => {
      if (readIds.has(member.id)) {
        read.push(member);
      } else {
        unread.push(member);
      }
    });

    return { readMembers: read, unreadMembers: unread, displayTitle: title };
  }, [message, targetTitle, readBy, authorId, groupMembers]);

  if (!isOpen || (!message && !readBy)) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-overlay p-4 backdrop-blur-sm animate-fadeIn"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-subtle/80 bg-surface/95 shadow-popover backdrop-blur-md"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-edge/80 px-4 py-3">
          <div className="flex items-center space-x-2">
            <Users className="h-4 w-4 text-info" />
            <h3 className="text-sm font-semibold text-main">{displayTitle}</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-sub hover:bg-hover hover:text-main"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Target Content Preview if available */}
        {(targetContent || message?.content) && (
          <div className="border-b border-edge/80 bg-canvas/50 px-4 py-2 text-xs text-sub truncate flex items-center gap-1.5">
            <span className="text-quiet shrink-0">内容:</span>
            <span className="truncate">
              {targetContent ||
                (message?.type === 'file'
                  ? `[文件] ${message.fileName || message.content}`
                  : message?.content)}
            </span>
          </div>
        )}

        {/* Dual Column Layout: Read (Left) & Unread (Right) */}
        <div className="grid grid-cols-2 divide-x divide-edge bg-surface/90 min-h-[220px]">
          {/* Left: 已读 */}
          <div className="flex flex-col">
            <div className="flex items-center justify-between px-3.5 py-2 bg-emerald-500/5 border-b border-edge/80">
              <div className="flex items-center space-x-1.5 text-xs font-medium text-success">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>已读</span>
              </div>
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-success">
                {readMembers.length} 人
              </span>
            </div>
            <div className="max-h-72 overflow-y-auto p-2 space-y-1 divide-y divide-edge/40 flex-1">
              {readMembers.length === 0 ? (
                <div className="py-10 text-center text-xs text-quiet">
                  暂无成员已读
                </div>
              ) : (
                readMembers.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between p-2 rounded-lg hover:bg-hover/50 transition-colors"
                  >
                    <div className="flex items-center space-x-2 min-w-0">
                      {member.avatar ? (
                        <img
                          src={member.avatar}
                          alt={member.displayName || member.username}
                          className="h-6 w-6 rounded-full object-cover border border-subtle shrink-0"
                        />
                      ) : (
                        <div className="h-6 w-6 rounded-full bg-hover flex items-center justify-center text-[11px] font-bold text-main shrink-0">
                          {(member.displayName || member.username || '?').slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center space-x-1">
                          <span className="text-xs font-medium text-main truncate">
                            {member.displayName || member.username}
                          </span>
                          {member.id === currentUserId && (
                            <span className="text-[9px] text-info bg-blue-500/10 px-1 rounded">
                              我
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right: 未读 */}
          <div className="flex flex-col">
            <div className="flex items-center justify-between px-3.5 py-2 bg-amber-500/5 border-b border-edge/80">
              <div className="flex items-center space-x-1.5 text-xs font-medium text-warning">
                <Clock className="w-3.5 h-3.5" />
                <span>未读</span>
              </div>
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-warning">
                {unreadMembers.length} 人
              </span>
            </div>
            <div className="max-h-72 overflow-y-auto p-2 space-y-1 divide-y divide-edge/40 flex-1">
              {unreadMembers.length === 0 ? (
                <div className="py-10 text-center text-xs text-quiet">
                  所有人均已读
                </div>
              ) : (
                unreadMembers.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between p-2 rounded-lg hover:bg-hover/50 transition-colors"
                  >
                    <div className="flex items-center space-x-2 min-w-0">
                      {member.avatar ? (
                        <img
                          src={member.avatar}
                          alt={member.displayName || member.username}
                          className="h-6 w-6 rounded-full object-cover border border-subtle shrink-0"
                        />
                      ) : (
                        <div className="h-6 w-6 rounded-full bg-hover flex items-center justify-center text-[11px] font-bold text-main shrink-0">
                          {(member.displayName || member.username || '?').slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center space-x-1">
                          <span className="text-xs font-medium text-main truncate">
                            {member.displayName || member.username}
                          </span>
                          {member.id === currentUserId && (
                            <span className="text-[9px] text-info bg-blue-500/10 px-1 rounded">
                              我
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-edge/80 px-4 py-2.5 bg-surface/60">
          <button
            onClick={onClose}
            className="rounded-lg border border-subtle/80 bg-card/80 px-3 py-1.5 text-xs text-sub hover:bg-hover"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};
