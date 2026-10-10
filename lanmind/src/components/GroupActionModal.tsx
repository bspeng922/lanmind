import { localizeMessage } from '../i18n/messages';
import { tr, useLocale } from "../i18n";
/** Confirmation dialogs for group ownership transfer and deletion from the chat menu. */
import React, { useMemo, useState } from 'react';
import { ArrowRightLeft, Trash2, X, Check, Copy, AlertTriangle, Users, AlertCircle } from 'lucide-react';
import { isTauri } from '@tauri-apps/api/core';
import { LanChatGroup, Project, User } from '../types';
import { ApiService } from '../services/api';
import { ThemeSelect } from './ThemeSelect';
import { canTransferOrDeleteGroup } from '../utils/groupPermissions';

export type GroupAction = 'transfer' | 'delete';

interface GroupActionModalProps {
  action: GroupAction;
  onClose: () => void;
  group: LanChatGroup;
  projects: Project[];
  users: User[];
  currentUser: User;
  isProjectReadOnly: boolean;
  onGroupTransferred: (updatedGroup: LanChatGroup) => void;
  onGroupDeleted: (groupId: string) => void;
}

export const GroupActionModal: React.FC<GroupActionModalProps> = ({
  action, onClose, group, projects, users, currentUser, isProjectReadOnly,
  onGroupTransferred, onGroupDeleted,
}) => {
  useLocale();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transferTargetId, setTransferTargetId] = useState('');
  const [isTransferring, setIsTransferring] = useState(false);
  const [deleteConfirmationName, setDeleteConfirmationName] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCopiedName, setIsCopiedName] = useState(false);
  const canManage = canTransferOrDeleteGroup({ group, userId: currentUser.id, isProjectReadOnly });

  // Build candidate members for group transfer
  const transferCandidates = useMemo(() => {
    return (users || []).filter((u) => {
      if (!u || u.id === currentUser?.id) return false;
      // If group is linked to a project, candidate must belong to the project
      if (group.projectId) {
        const proj = (projects || []).find((p) => p.id === group.projectId);
        if (proj) {
          const belongs =
            proj.createdBy === u.id ||
            (Array.isArray(proj.admins) && proj.admins.includes(u.id)) ||
            (Array.isArray(proj.members) && proj.members.includes(u.id));
          if (!belongs) return false;
        }
      }
      return true;
    });
  }, [users, currentUser?.id, group.projectId, projects]);

  const handleCopyGroupName = async () => {
    if (!group?.name) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(group.name);
      } else {
        throw new Error('Clipboard API unavailable');
      }
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = group.name;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }
    setIsCopiedName(true);
    setTimeout(() => setIsCopiedName(false), 2000);
  };

  const handleTransferGroup = async () => {
    if (!canManage || !transferTargetId || isTransferring) return;
    setErrorMessage(null);
    setIsTransferring(true);
    try {
      if (isTauri()) {
        const updated = await ApiService.transferChatGroup(group.id, transferTargetId, currentUser.id);
        onGroupTransferred(updated);
      } else {
        const updated: LanChatGroup = {
          ...group,
          createdBy: transferTargetId,
          memberIds: Array.from(new Set([...group.memberIds, transferTargetId])),
          adminIds: Array.from(
            new Set([
              ...(group.adminIds || []).filter((id) => id !== currentUser.id),
              transferTargetId,
            ]),
          ),
        };
        onGroupTransferred(updated);
      }
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || tr("chat:groupActionModal.couldNotTransferGroupOwnership"));
    } finally {
      setIsTransferring(false);
    }
  };

  const canConfirmDelete = Boolean(group && deleteConfirmationName === group.name);

  const handleDeleteGroup = async () => {
    if (!canManage || !canConfirmDelete || isDeleting) return;
    setErrorMessage(null);
    setIsDeleting(true);
    try {
      if (isTauri()) {
        await ApiService.deleteChatGroup(group.id, currentUser.id);
      }
      onGroupDeleted(group.id);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || tr("chat:groupActionModal.couldNotDeleteGroup"));
    } finally {
      setIsDeleting(false);
    }
  };

  if (!canManage) return null;

  return (
    <>
      {/* Transfer Group Confirmation Dialog */}
      {action === 'transfer' && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay p-4 backdrop-blur-sm animate-in fade-in duration-150"
          role="dialog"
          aria-modal="true"
          aria-labelledby="transfer-group-title"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleTransferGroup();
            }}
            className="w-full max-w-md rounded-2xl border border-amber-500/30 bg-surface/95 p-6 shadow-popover backdrop-blur-md animate-in zoom-in-95 duration-150"
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 border border-amber-500/30 text-warning">
                  <ArrowRightLeft className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h3 id="transfer-group-title" className="text-sm font-bold text-main">
                    {tr("chat:groupActionModal.transferGroupOwnership")}
                  </h3>
                  <p className="mt-0.5 text-xs text-sub">
                    {group.name}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={isTransferring}
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-sub hover:bg-hover hover:text-main transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                aria-label={tr("chat:groupActionModal.cancel")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Target Group Info Card */}
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-edge/80 bg-canvas/60 p-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface text-base">
                {group.avatar || '👥'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-main truncate">{group.name}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-quiet">
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    <span>{group.memberIds?.length || 1} 成员</span>
                  </span>
                </div>
              </div>
            </div>

            {/* Warning Callout */}
            <div className="mt-3.5 flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-5 text-warning">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-warning" />
              <div>
                <p className="font-medium">{tr("chat:groupActionModal.theSelectedMemberBecomesTheOwnerYou")}</p>
              </div>
            </div>

            {transferCandidates.length === 0 ? (
              <div className="mt-3.5 rounded-xl border border-edge bg-surface/70 p-3.5 text-center text-xs text-sub">
                <p className="font-semibold text-main">{tr("chat:groupActionModal.noOtherLanMembersAreAvailable")}</p>
                <p className="mt-1 text-[11px] text-quiet">
                  {tr("chat:groupActionModal.otherMembersMustRunLanmindOnThe")}
                </p>
              </div>
            ) : (
              <div className="mt-4">
                <label className="block text-xs font-semibold text-sub" htmlFor="transfer-group-target">
                  {tr("chat:groupActionModal.newGroupOwner")}
                </label>
                <div className="mt-1.5">
                  <ThemeSelect
                    ariaLabel={tr("chat:groupActionModal.chooseANewOwner")}
                    value={transferTargetId}
                    options={[
                      { value: '', label: tr("chat:groupActionModal.selectANewOwner"), tone: 'slate' },
                      ...transferCandidates.map((user) => {
                        const isAlreadyMember = group.memberIds.includes(user.id);
                        return {
                          value: user.id,
                          label: `${user.nickname} (${user.id})${isAlreadyMember ? tr("chat:groupActionModal.currentMember") : ''}`,
                          tone: isAlreadyMember ? ('emerald' as const) : ('amber' as const),
                        };
                      }),
                    ]}
                    onChange={(val) => setTransferTargetId(val)}
                    disabled={isTransferring}
                  />
                </div>
              </div>
            )}

            {errorMessage && (
              <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-danger">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span>{localizeMessage(errorMessage)}</span>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2.5 border-t border-edge/60 pt-4">
              <button
                type="button"
                onClick={onClose}
                disabled={isTransferring}
                className="ui-cancel-button rounded-xl px-4 py-2 text-xs font-semibold"
              >
                {tr("chat:groupActionModal.cancel")}
              </button>
              <button
                type="submit"
                disabled={!transferTargetId || isTransferring}
                className="project-transfer-confirm flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold transition-all"
              >
                <ArrowRightLeft className="h-3.5 w-3.5" />
                <span>{isTransferring ? tr("chat:groupActionModal.transferring") : tr("chat:groupActionModal.transferOwnership")}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Group Confirmation Dialog */}
      {action === 'delete' && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay p-4 backdrop-blur-sm animate-in fade-in duration-150"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-group-title"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleDeleteGroup();
            }}
            className="w-full max-w-md rounded-2xl border border-rose-500/35 bg-surface/95 p-6 shadow-popover shadow-rose-950/25 backdrop-blur-md animate-in zoom-in-95 duration-150"
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-500 dark:text-rose-400">
                  <Trash2 className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h3 id="delete-group-title" className="text-sm font-bold text-main">
                    {tr("chat:groupActionModal.deleteGroup")}
                  </h3>
                  <p className="mt-0.5 text-xs text-rose-500/90 dark:text-rose-400/90 font-medium">
                    不可撤销的危险操作
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={isDeleting}
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-sub hover:bg-hover hover:text-main transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                aria-label={tr("chat:groupActionModal.closeDeleteConfirmation")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Target Group Info Card */}
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-edge/80 bg-canvas/60 p-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface text-base">
                {group.avatar || '👥'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-main truncate">{group.name}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-quiet">
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    <span>{group.memberIds?.length || 1} 成员</span>
                  </span>
                </div>
              </div>
            </div>

            {/* Warning Notice Callout */}
            <div className="mt-3.5 flex items-start gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs leading-5 text-rose-600 dark:text-rose-300">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-rose-500" />
              <div>
                <p className="font-semibold">{tr("chat:groupActionModal.allMembersWillLoseAccessToThis")}</p>
                <p className="mt-0.5 text-[11px] opacity-90">群内所有聊天记录、群公告及共享文件索引都将被永久清除。</p>
              </div>
            </div>

            {/* Confirmation input section */}
            <div className="mt-4">
              <label className="block text-xs font-semibold text-sub" htmlFor="delete-group-name">
                {tr("chat:groupActionModal.typeTheGroupNameToConfirmDeletion")}
              </label>
              <div className="project-delete-name-box">
                <span className="project-delete-name-text select-all">{group.name}</span>
                <button
                  type="button"
                  onClick={handleCopyGroupName}
                  className="project-delete-copy-btn"
                  title={tr("chat:groupActionModal.copyGroupName")}
                >
                  {isCopiedName ? (
                    <>
                      <Check className="h-3 w-3 text-success" />
                      <span className="text-success">{tr("chat:groupActionModal.copied")}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      <span>{tr("chat:groupActionModal.clickToCopy")}</span>
                    </>
                  )}
                </button>
              </div>
              <input
                id="delete-group-name"
                type="text"
                autoFocus
                autoComplete="off"
                placeholder={tr("chat:groupActionModal.typeToConfirm", { value0: group.name })}
                value={deleteConfirmationName}
                onChange={(event) => setDeleteConfirmationName(event.target.value)}
                disabled={isDeleting}
                className="project-delete-input mt-2.5 w-full rounded-xl border border-subtle bg-canvas px-3 py-2 text-xs text-main placeholder-quiet outline-none transition-colors focus:border-rose-500 focus:ring-1 focus:ring-rose-500/30 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>

            {errorMessage && (
              <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-danger">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span>{localizeMessage(errorMessage)}</span>
              </div>
            )}

            {/* Action buttons */}
            <div className="mt-6 flex items-center justify-end gap-2.5 border-t border-edge/60 pt-4">
              <button
                type="button"
                onClick={onClose}
                disabled={isDeleting}
                className="ui-cancel-button rounded-xl px-4 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              >
                {tr("chat:groupActionModal.cancel")}
              </button>
              <button
                type="submit"
                disabled={!canConfirmDelete || isDeleting}
                className="project-delete-confirm flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white shadow-md shadow-rose-950/30 border border-rose-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 className="h-3.5 w-3.5 text-white" />
                <span>{isDeleting ? tr("chat:groupActionModal.deleting") : tr("chat:groupActionModal.delete")}</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
};
