/** Confirmation dialogs for group ownership transfer and deletion from the chat menu. */
import React, { useMemo, useState } from 'react';
import { ArrowRightLeft, Trash2, X, Check, Copy } from 'lucide-react';
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
      setErrorMessage(err.message || '群组转让失败');
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
      setErrorMessage(err.message || '删除群组失败');
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
            className="w-full max-w-sm rounded-2xl border border-amber-500/30 bg-surface/95 p-6 shadow-popover backdrop-blur-md animate-in zoom-in-95 duration-150"
          >
            <h3 id="transfer-group-title" className="text-sm font-bold text-main flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-warning" />
              <span>转让对话群</span>
            </h3>
            <p className="mt-2 text-xs leading-5 text-sub">
              转让后，选中的成员将成为群主，你将保留普通成员身份。此操作不可撤销。
            </p>
            {transferCandidates.length === 0 ? (
              <div className="mt-4 rounded-xl border border-amber-500/30 bg-warning/10 p-3 text-xs leading-5 text-warning">
                <p className="font-semibold">当前局域网内暂无其他可转让成员</p>
                <p className="mt-1 text-[11px] text-sub">
                  请确保其他成员已启动并连接至同一局域网下的 LanMind，发现节点后即可选择转让。
                </p>
              </div>
            ) : (
              <>
                <label className="mt-4 block text-xs font-medium text-sub" htmlFor="transfer-group-target">
                  新的群组创建者 (群主)
                </label>
                <div className="mt-1.5">
                  <ThemeSelect
                    ariaLabel="选择新群主"
                    value={transferTargetId}
                    options={[
                      { value: '', label: '请选择新群主', tone: 'slate' },
                      ...transferCandidates.map((user) => {
                        const isAlreadyMember = group.memberIds.includes(user.id);
                        return {
                          value: user.id,
                          label: `${user.nickname} (${user.id})${isAlreadyMember ? ' [现有成员]' : ''}`,
                          tone: isAlreadyMember ? ('emerald' as const) : ('amber' as const),
                        };
                      }),
                    ]}
                    onChange={(val) => setTransferTargetId(val)}
                    disabled={isTransferring}
                  />
                </div>
              </>
            )}
            {errorMessage && <p className="mt-3 text-xs font-semibold text-danger">{errorMessage}</p>}
            <div className="mt-5 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                disabled={isTransferring}
                className="ui-cancel-button rounded-xl px-4 py-2 text-xs font-semibold"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={!transferTargetId || isTransferring}
                className="project-transfer-confirm flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold"
              >
                <ArrowRightLeft className="h-3.5 w-3.5" />
                <span>{isTransferring ? '正在转让...' : '确认转让'}</span>
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
            className="w-full max-w-sm rounded-2xl border border-rose-500/30 bg-surface/95 p-6 shadow-popover shadow-rose-950/30 backdrop-blur-md animate-in zoom-in-95 duration-150"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 border border-rose-500/30 text-danger">
                  <Trash2 className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h3 id="delete-group-title" className="text-sm font-bold text-main">
                    删除群组确认
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-sub">
                    删除后，所有成员将无法再访问此群组及其聊天记录。此操作不可撤销。
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={isDeleting}
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-sub hover:bg-hover hover:text-main transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="关闭删除确认"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4">
              <label className="block text-xs font-medium text-sub" htmlFor="delete-group-name">
                请输入群组名称以确认删除：
              </label>
              <div className="project-delete-name-box">
                <span className="project-delete-name-text select-all">{group.name}</span>
                <button
                  type="button"
                  onClick={handleCopyGroupName}
                  className="project-delete-copy-btn"
                  title="复制群组名称"
                >
                  {isCopiedName ? (
                    <>
                      <Check className="h-3 w-3 text-success" />
                      <span className="text-success">已复制</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      <span>点击复制</span>
                    </>
                  )}
                </button>
              </div>
              <input
                id="delete-group-name"
                type="text"
                autoFocus
                autoComplete="off"
                placeholder={`输入 "${group.name}" 确认`}
                value={deleteConfirmationName}
                onChange={(event) => setDeleteConfirmationName(event.target.value)}
                disabled={isDeleting}
                className="project-delete-input mt-2.5 w-full rounded-xl border border-subtle bg-canvas px-3 py-2 text-xs text-main placeholder-quiet outline-none transition-colors focus:border-rose-500/60 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>

            {errorMessage && (
              <p className="mt-3 text-xs font-semibold text-danger">{errorMessage}</p>
            )}

            <div className="mt-5 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                disabled={isDeleting}
                className="ui-cancel-button rounded-xl px-4 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={!canConfirmDelete || isDeleting}
                className="project-delete-confirm flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>{isDeleting ? '正在删除...' : '确认删除'}</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
};
