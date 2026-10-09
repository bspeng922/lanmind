import { localizeMessage } from '../i18n/messages';
import { tr, useLocale } from "../i18n";
/**
 * GroupAnnouncementModal.tsx — Group Announcement management and viewing modal.
 *
 * CALLING SPEC:
 *   <GroupAnnouncementModal
 *     isOpen={boolean}
 *     onClose={() => void}
 *     group={LanChatGroup}
 *     currentUserId={string}
 *     currentUserDisplayName={string}
 *     groupMembers={User[]}
 *     announcements={LanGroupAnnouncement[]}
 *     canManage={boolean}
 *     onSaveAnnouncement={(announcement: Partial<LanGroupAnnouncement>) => Promise<void>}
 *     onDeleteAnnouncement={(id: string) => Promise<void>}
 *     onPinAnnouncement={(id: string, pinned: boolean) => Promise<void>}
 *     onViewReadReceipts={(announcement: LanGroupAnnouncement) => void}
 *   />
 */

import React, { useState } from 'react';
import {
  Megaphone,
  Pin,
  PinOff,
  Trash2,
  Plus,
  X,
  Clock,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { LanChatGroup, LanGroupAnnouncement, User } from '../types';
import { formatMessageDisplayTime } from '../utils/chatTime';

interface GroupAnnouncementModalProps {
  isOpen: boolean;
  onClose: () => void;
  group: LanChatGroup | null;
  currentUserId: string;
  currentUserDisplayName: string;
  groupMembers: User[];
  announcements: LanGroupAnnouncement[];
  canManage: boolean;
  onSaveAnnouncement: (announcement: Partial<LanGroupAnnouncement>) => Promise<void>;
  onDeleteAnnouncement: (id: string) => Promise<void>;
  onPinAnnouncement: (id: string, pinned: boolean) => Promise<void>;
  onViewReadReceipts: (announcement: LanGroupAnnouncement) => void;
}

export const GroupAnnouncementModal: React.FC<GroupAnnouncementModalProps> = ({
  isOpen,
  onClose,
  group,
  currentUserId,
  currentUserDisplayName,
  groupMembers,
  announcements,
  canManage,
  onSaveAnnouncement,
  onDeleteAnnouncement,
  onPinAnnouncement,
  onViewReadReceipts,
}) => {
  useLocale();
  const [isCreating, setIsCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [pinned, setPinned] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  if (!isOpen || !group) return null;

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMessage(tr("chat:groupAnnouncementModal.enterAnAnnouncementTitle"));
      return;
    }
    if (!content.trim()) {
      setErrorMessage(tr("chat:groupAnnouncementModal.enterAnnouncementContent"));
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      await onSaveAnnouncement({
        groupId: group.id,
        title: title.trim(),
        content: content.trim(),
        pinned,
        authorId: currentUserId,
        authorName: currentUserDisplayName || tr("chat:groupAnnouncementModal.administrator"),
        createdAt: new Date().toISOString(),
        readBy: [currentUserId],
      });
      setTitle('');
      setContent('');
      setPinned(false);
      setIsCreating(false);
    } catch (err: any) {
      setErrorMessage(err?.message || tr("chat:groupAnnouncementModal.couldNotPostAnnouncement"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const getReadSummary = (announcement: LanGroupAnnouncement) => {
    const eligibleCount = Math.max(0, groupMembers.filter((m) => m.id !== announcement.authorId).length);
    if (eligibleCount === 0) return { text: tr("chat:groupAnnouncementModal.visibleOnlyToYou"), allRead: true };

    const readSet = new Set(announcement.readBy || []);
    const readCount = groupMembers.filter(
      (m) => m.id !== announcement.authorId && readSet.has(m.id),
    ).length;
    const unreadCount = eligibleCount - readCount;

    if (unreadCount <= 0) {
      return { text: tr("chat:groupAnnouncementModal.everyoneHasRead"), allRead: true, readCount, unreadCount: 0 };
    }
    return { text: tr("chat:groupAnnouncementModal.unread", { value0: unreadCount }), allRead: false, readCount, unreadCount };
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-subtle/80 bg-surface shadow-popover backdrop-blur-md flex flex-col max-h-[85vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-edge px-5 py-3.5 bg-surface/90">
          <div className="flex items-center space-x-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-warning border border-amber-500/20">
              <Megaphone className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-main flex items-center space-x-2">
                <span>{tr("chat:groupAnnouncementModal.groupAnnouncements")}</span>
                <span className="text-xs font-normal text-sub">({group.name})</span>
              </h3>
              <p className="text-[11px] text-sub">
                {canManage ? tr("chat:groupAnnouncementModal.ownersAndAdministratorsCanPostPinAnd") : tr("chat:groupAnnouncementModal.membersCanViewAnnouncementsAndReadStatus")}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {canManage && !isCreating && (
              <button
                type="button"
                onClick={() => {
                  setIsCreating(true);
                  setErrorMessage('');
                }}
                className="flex items-center space-x-1 rounded-md bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 px-2.5 py-1.5 text-xs font-medium text-warning transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{tr("chat:groupAnnouncementModal.postAnnouncement")}</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded p-1 text-sub hover:bg-hover hover:text-main"
              title={tr("chat:groupAnnouncementModal.close")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Create Announcement Form */}
          {isCreating && (
            <form
              onSubmit={handleCreateSubmit}
              className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-warning flex items-center space-x-1.5">
                  <Megaphone className="w-3.5 h-3.5" />
                  <span>{tr("chat:groupAnnouncementModal.newAnnouncement")}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="text-sub hover:text-main text-xs"
                >
                  {tr("chat:groupAnnouncementModal.cancel")}</button>
              </div>

              {errorMessage && (
                <div className="flex items-center space-x-1.5 text-xs text-danger bg-rose-500/10 border border-rose-500/20 p-2 rounded">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{localizeMessage(errorMessage)}</span>
                </div>
              )}

              <div>
                <input
                  type="text"
                  placeholder={tr("chat:groupAnnouncementModal.announcementTitle")}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={100}
                  className="w-full rounded-lg border border-subtle bg-surface/90 px-3 py-2 text-xs text-main placeholder-quiet focus:border-amber-500/60 focus:outline-none"
                />
              </div>

              <div>
                <textarea
                  placeholder={tr("chat:groupAnnouncementModal.announcementContent")}
                  rows={4}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="w-full rounded-lg border border-subtle bg-surface/90 px-3 py-2 text-xs text-main placeholder-quiet focus:border-amber-500/60 focus:outline-none resize-none"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center space-x-2 text-xs text-sub cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={pinned}
                    onChange={(e) => setPinned(e.target.checked)}
                    className="rounded border-subtle bg-surface text-warning focus:ring-amber-500/50"
                  />
                  <span>{tr("chat:groupAnnouncementModal.pinThisAnnouncement")}</span>
                </label>

                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => setIsCreating(false)}
                    className="rounded-lg border border-subtle bg-card/80 px-3 py-1.5 text-xs text-sub hover:bg-hover"
                  >
                    {tr("chat:groupAnnouncementModal.cancel")}</button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="theme-btn-primary rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
                  >
                    {isSubmitting ? tr("chat:groupAnnouncementModal.posting") : tr("chat:groupAnnouncementModal.post")}
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* Announcement List */}
          {announcements.length === 0 ? (
            <div className="py-12 text-center">
              <Megaphone className="mx-auto h-10 w-10 text-quiet stroke-[1.5] mb-2" />
              <p className="text-xs text-sub font-medium">{tr("chat:groupAnnouncementModal.noAnnouncements")}</p>
              {canManage && (
                <p className="text-[11px] text-quiet mt-1">{tr("chat:groupAnnouncementModal.usePostAnnouncementToNotifyAllGroup")}</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {announcements.map((ann) => {
                const readStatus = getReadSummary(ann);
                const isPinned = !!ann.pinned;

                return (
                  <div
                    key={ann.id}
                    className={`rounded-xl border transition-all ${
                      isPinned
                        ? 'border-amber-500/40 bg-gradient-to-br from-amber-500/10 via-surface to-surface'
                        : 'border-edge bg-surface/60 hover:border-subtle'
                    } p-4 space-y-2.5`}
                  >
                    {/* Item Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center space-x-2 min-w-0">
                        {isPinned && (
                          <span className="inline-flex items-center space-x-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-warning border border-amber-500/30 shrink-0">
                            <Pin className="h-2.5 w-2.5 fill-warning" />
                            <span>{tr("chat:groupAnnouncementModal.pin")}</span>
                          </span>
                        )}
                        <h4 className="text-sm font-semibold text-main truncate">
                          {ann.title}
                        </h4>
                      </div>

                      {/* Action buttons (Manage only) */}
                      {canManage && (
                        <div className="flex items-center space-x-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => onPinAnnouncement(ann.id, !isPinned)}
                            className={`p-1.5 rounded text-xs transition-colors ${
                              isPinned
                                ? 'text-warning hover:bg-amber-500/20'
                                : 'text-sub hover:bg-hover hover:text-main'
                            }`}
                            title={isPinned ? tr("chat:groupAnnouncementModal.unpin") : tr("chat:groupAnnouncementModal.pinAnnouncement")}
                          >
                            {isPinned ? (
                              <PinOff className="h-3.5 w-3.5" />
                            ) : (
                              <Pin className="h-3.5 w-3.5" />
                            )}
                          </button>

                          {deleteConfirmId === ann.id ? (
                            <div className="flex items-center space-x-1 bg-danger/10 border border-rose-800/80 rounded px-1.5 py-0.5 animate-fadeIn">
                              <span className="text-[10px] text-danger">{tr("chat:groupAnnouncementModal.delete")}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  onDeleteAnnouncement(ann.id);
                                  setDeleteConfirmId(null);
                                }}
                                className="text-[10px] text-danger hover:underline font-bold"
                              >
                                {tr("chat:groupAnnouncementModal.yes")}</button>
                              <button
                                type="button"
                                onClick={() => setDeleteConfirmId(null)}
                                className="text-[10px] text-sub hover:text-main"
                              >
                                {tr("chat:groupAnnouncementModal.no")}</button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmId(ann.id)}
                              className="p-1.5 rounded text-sub hover:bg-rose-500/15 hover:text-danger transition-colors"
                              title={tr("chat:groupAnnouncementModal.deleteAnnouncement")}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="text-xs text-sub whitespace-pre-wrap leading-relaxed break-words bg-canvas/40 p-3 rounded-lg border border-edge/50">
                      {ann.content}
                    </div>

                    {/* Item Footer */}
                    <div className="flex items-center justify-between text-[11px] text-sub pt-1">
                      <div className="flex items-center space-x-2">
                        <span>{ann.authorName}</span>
                        <span>•</span>
                        <span>{formatMessageDisplayTime(ann.createdAt)}</span>
                      </div>

                      {/* Read receipts button */}
                      <button
                        type="button"
                        onClick={() => onViewReadReceipts(ann)}
                        className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full transition-colors cursor-pointer ${
                          readStatus.allRead
                            ? 'text-success bg-emerald-500/10 hover:bg-emerald-500/20'
                            : 'text-warning bg-amber-500/10 hover:bg-amber-500/20'
                        }`}
                        title={tr("chat:groupAnnouncementModal.viewWhoHasReadThisAnnouncement")}
                      >
                        {readStatus.allRead ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : (
                          <Clock className="w-3 h-3" />
                        )}
                        <span>{readStatus.text}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex justify-between items-center border-t border-edge px-5 py-3 bg-surface/60">
          <div className="text-[11px] text-quiet">{tr("chat:groupAnnouncementModal.announcements", { value0: announcements.length })}</div>
          <button
            onClick={onClose}
            className="rounded-lg border border-subtle bg-card px-4 py-1.5 text-xs text-main hover:bg-hover"
          >
            {tr("chat:groupAnnouncementModal.close")}</button>
        </div>
      </div>
    </div>
  );
};
