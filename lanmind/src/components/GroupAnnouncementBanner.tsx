/**
 * GroupAnnouncementBanner.tsx — Top pinned announcement bar for group chats.
 *
 * CALLING SPEC:
 *   <GroupAnnouncementBanner
 *     pinnedAnnouncement={LanGroupAnnouncement | null}
 *     totalAnnouncementsCount={number}
 *     onOpenAnnouncementsModal={() => void}
 *     onDismiss={() => void}
 *   />
 */

import React from 'react';
import { Megaphone, ChevronRight, X, Pin } from 'lucide-react';
import { LanGroupAnnouncement } from '../types';

interface GroupAnnouncementBannerProps {
  pinnedAnnouncement: LanGroupAnnouncement | null;
  totalAnnouncementsCount: number;
  onOpenAnnouncementsModal: () => void;
  onDismiss: () => void;
}

export const GroupAnnouncementBanner: React.FC<GroupAnnouncementBannerProps> = ({
  pinnedAnnouncement,
  totalAnnouncementsCount,
  onOpenAnnouncementsModal,
  onDismiss,
}) => {
  if (!pinnedAnnouncement) return null;

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-warning/10 border-b border-amber-500/30 text-xs backdrop-blur-sm animate-fadeIn">
      {/* Left: Icon & Title + Content Preview */}
      <button
        type="button"
        onClick={onOpenAnnouncementsModal}
        className="flex items-center space-x-2.5 min-w-0 flex-1 text-left group cursor-pointer"
        title="点击查看公告详情"
      >
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-amber-500/20 text-warning">
          <Megaphone className="h-3 w-3" />
        </div>
        <div className="flex items-center space-x-1.5 min-w-0 flex-1">
          <span className="inline-flex items-center space-x-0.5 rounded bg-amber-500/20 px-1 py-0.2 text-[10px] font-semibold text-warning border border-amber-500/30 shrink-0">
            <Pin className="h-2 w-2 fill-warning" />
            <span>公告</span>
          </span>
          <span className="font-semibold text-main shrink-0 truncate max-w-[120px] group-hover:text-warning transition-colors">
            {pinnedAnnouncement.title}
          </span>
          <span className="text-sub truncate group-hover:text-main transition-colors">
            {pinnedAnnouncement.content}
          </span>
        </div>
      </button>

      {/* Right: Actions */}
      <div className="flex items-center space-x-2 shrink-0 pl-2">
        <button
          type="button"
          onClick={onOpenAnnouncementsModal}
          className="flex items-center space-x-0.5 text-[11px] font-medium text-warning hover:text-warning transition-colors"
        >
          <span>共{totalAnnouncementsCount}条</span>
          <ChevronRight className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded p-1 text-sub hover:bg-hover/80 hover:text-main transition-colors"
          title="隐藏横幅"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
};
