/**
 * EditGroupModal.tsx — Modal for modifying chat group attributes, transferring ownership, and deleting groups.
 *
 * CALLING SPEC:
 *   <EditGroupModal
 *     isOpen={showEditGroupModal}
 *     onClose={() => setShowEditGroupModal(false)}
 *     group={activeTarget.group}
 *     projects={projects}
 *     users={users}
 *     currentUser={currentUser}
 *     onGroupUpdated={handleGroupUpdated}
 *     onGroupTransferred={handleGroupTransferred}
 *     onGroupDeleted={handleGroupDeleted}
 *   />
 *
 * TOOL CONTRACT:
 *   - Allows group administrators and creators to modify group name, description, avatar, and linked project
 *   - Allows group creator (owner) to transfer ownership to another eligible member
 *   - Allows group creator (owner) to safely delete / dissolve the group with name verification
 *   - Persists changes via ApiService and broadcasts to LAN
 *   - Side effects: Calls onGroupUpdated, onGroupTransferred, onGroupDeleted callbacks
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  Settings,
  Smile,
  FolderKanban,
  FileText,
  Loader2,
  Users,
  Crown,
  AlertCircle,
  ArrowRightLeft,
  Trash2,
  Check,
  Copy,
} from 'lucide-react';
import { LanChatGroup, Project, User } from '../types';
import { ApiService } from '../services/api';
import { isTauri } from '@tauri-apps/api/core';
import { ThemeSelect, ThemeSelectOption } from './ThemeSelect';
import { isGroupCreator } from '../utils/groupPermissions';

export interface EditGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  group: LanChatGroup;
  projects: Project[];
  users?: User[];
  currentUser: User;
  onGroupUpdated: (updatedGroup: LanChatGroup) => void;
  onGroupTransferred?: (updatedGroup: LanChatGroup) => void;
  onGroupDeleted?: (groupId: string) => void;
}

const PRESET_GROUP_ICONS = ['👥', '🚀', '💡', '🛡️', '⚡', '📊', '🌐', '💻', '🎨', '🎯'];

export const EditGroupModal: React.FC<EditGroupModalProps> = ({
  isOpen,
  onClose,
  group,
  projects,
  users = [],
  currentUser,
  onGroupUpdated,
  onGroupTransferred,
  onGroupDeleted,
}) => {
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description || '');
  const [avatar, setAvatar] = useState(group.avatar || '👥');
  const [projectId, setProjectId] = useState(group.projectId || '');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Transfer & Delete confirmation states
  const [isConfirmingTransfer, setIsConfirmingTransfer] = useState(false);
  const [transferTargetId, setTransferTargetId] = useState('');
  const [isTransferring, setIsTransferring] = useState(false);

  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [deleteConfirmationName, setDeleteConfirmationName] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCopiedName, setIsCopiedName] = useState(false);

  // Treat these values as an editing draft. Background sync may replace the
  // group object while the modal is open, but must not discard unsaved input.
  useEffect(() => {
    if (isOpen) {
      setName(group.name);
      setDescription(group.description || '');
      setAvatar(group.avatar || '👥');
      setProjectId(group.projectId || '');
      setErrorMessage(null);
      setIsConfirmingTransfer(false);
      setTransferTargetId('');
      setIsConfirmingDelete(false);
      setDeleteConfirmationName('');
    }
  }, [isOpen, group.id]);

  // Check if current user is admin or creator
  const isAdmin = useMemo(() => {
    if (!group) return false;
    const adminList = Array.isArray(group.adminIds)
      ? group.adminIds
      : group.createdBy
      ? [group.createdBy]
      : [];
    return adminList.includes(currentUser?.id) || group.createdBy === currentUser?.id;
  }, [group, currentUser]);

  const isCreator = useMemo(() => isGroupCreator(group, currentUser?.id), [group, currentUser]);
  const isBusy = isSaving || isDeleting || isTransferring;

  // Build project options for ThemeSelect
  const projectOptions: ThemeSelectOption[] = useMemo(() => {
    const list: ThemeSelectOption[] = [
      { value: '', label: '无关联项目（独立协同群）', tone: 'slate' },
    ];
    (projects || []).forEach((p) => {
      if (!p) return;
      const isMember =
        p.createdBy === currentUser?.id ||
        (Array.isArray(p.admins) && p.admins.includes(currentUser?.id)) ||
        (Array.isArray(p.members) && p.members.includes(currentUser?.id));
      if (isMember) {
        list.push({
          value: p.id,
          label: p.name,
          tone: 'blue',
        });
      }
    });
    return list;
  }, [projects, currentUser]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMessage('群组名称不能为空');
      return;
    }
    if (!isAdmin) {
      setErrorMessage('只有群管理员或创建者可以修改群组属性');
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const updatedGroup: LanChatGroup = {
        ...group,
        name: name.trim(),
        description: description.trim() || undefined,
        avatar,
        projectId: projectId.trim() || undefined,
      };

      if (isTauri()) {
        const saved = await ApiService.updateChatGroupProfile(
          group.id,
          name.trim(),
          description.trim() || undefined,
          avatar,
          projectId.trim() || undefined,
          currentUser.id,
        );
        onGroupUpdated(saved);
      } else {
        onGroupUpdated(updatedGroup);
      }

      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '更新群组资料失败');
    } finally {
      setIsSaving(false);
    }
  };

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
    if (!group || !isCreator || !transferTargetId) return;
    setErrorMessage(null);
    setIsTransferring(true);
    try {
      if (isTauri()) {
        const updated = await ApiService.transferChatGroup(group.id, transferTargetId, currentUser.id);
        if (onGroupTransferred) {
          onGroupTransferred(updated);
        } else {
          onGroupUpdated(updated);
        }
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
        if (onGroupTransferred) {
          onGroupTransferred(updated);
        } else {
          onGroupUpdated(updated);
        }
      }
      setIsConfirmingTransfer(false);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || '群组转让失败');
    } finally {
      setIsTransferring(false);
    }
  };

  const canConfirmDelete = Boolean(group && deleteConfirmationName === group.name);

  const handleDeleteGroup = async () => {
    if (!group || !isCreator || !canConfirmDelete) return;
    setErrorMessage(null);
    setIsDeleting(true);
    try {
      if (isTauri()) {
        await ApiService.deleteChatGroup(group.id, currentUser.id);
      }
      onGroupDeleted?.(group.id);
      setIsConfirmingDelete(false);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || '删除群组失败');
    } finally {
      setIsDeleting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-sm p-4 animate-in fade-in duration-150">
        <div className="flex flex-col w-full max-w-md bg-surface border border-subtle/80 rounded-2xl shadow-popover overflow-hidden animate-in zoom-in-95 duration-150">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-edge bg-canvas/40">
            <div className="flex items-center space-x-2.5">
              <div className="p-2 rounded-xl bg-accent/15 text-accent border border-accent/30">
                <Settings className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-main">群组设置</h3>
                  {isCreator ? (
                    <span className="flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] text-warning font-medium">
                      <Crown className="h-3 w-3" /> 群主
                    </span>
                  ) : isAdmin ? (
                    <span className="flex items-center gap-1 rounded bg-blue-500/15 px-1.5 py-0.5 text-[9px] text-info font-medium">
                      <Crown className="h-3 w-3" /> 管理员
                    </span>
                  ) : null}
                </div>
                <p className="text-[11px] text-sub mt-0.5">
                  修改群组名称、徽标图标、简介及关联项目组
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={isBusy}
              aria-label="关闭群组设置窗口"
              className="p-1.5 rounded-lg text-sub hover:text-main hover:bg-hover transition-colors disabled:opacity-50"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Form Body */}
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {errorMessage && (
              <div className="flex items-center gap-2 p-3 text-xs text-danger bg-rose-500/10 border border-rose-500/20 rounded-xl">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Group Name */}
            <div>
              <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-sub">
                <Users className="h-3.5 w-3.5 text-accent" />
                <span>群组名称 <span className="text-danger">*</span></span>
              </label>
              <input
                type="text"
                required
                disabled={!isAdmin || isBusy}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="请输入群组名称..."
                maxLength={40}
                className="w-full bg-canvas border border-subtle/80 rounded-xl px-3 py-2 text-xs text-main placeholder-quiet focus:outline-none focus:border-accent disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              />
            </div>

            {/* Avatar Icon Selection */}
            <div>
              <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-sub">
                <Smile className="h-3.5 w-3.5 text-warning" />
                <span>选择群组徽标</span>
              </label>
              <div className="flex items-center space-x-2 overflow-x-auto pb-1">
                {PRESET_GROUP_ICONS.map((icon) => (
                  <button
                    key={icon}
                    type="button"
                    disabled={!isAdmin || isBusy}
                    onClick={() => setAvatar(icon)}
                    className={`w-8 h-8 rounded-lg text-sm flex items-center justify-center border transition-all ${
                      avatar === icon
                        ? 'bg-accent/20 border-accent text-accent scale-105'
                        : 'bg-canvas border-edge text-sub hover:border-subtle'
                    } disabled:opacity-60 disabled:cursor-not-allowed`}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </div>

            {/* Linked Project Selection */}
            <div>
              <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-sub">
                <FolderKanban className="h-3.5 w-3.5 text-info" />
                <span>关联项目组</span>
              </label>
              <ThemeSelect
                ariaLabel="选择关联项目组"
                value={projectId}
                options={projectOptions}
                disabled={!isAdmin || isBusy}
                onChange={setProjectId}
              />
            </div>

            {/* Group Description */}
            <div>
              <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-sub">
                <FileText className="h-3.5 w-3.5 text-sub" />
                <span>群组简介 / 宗旨</span>
              </label>
              <textarea
                rows={3}
                disabled={!isAdmin || isBusy}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="填写群组宗旨、讨论主题或协作规范..."
                maxLength={200}
                className="w-full bg-canvas border border-subtle/80 rounded-xl px-3 py-2 text-xs text-main placeholder-quiet focus:outline-none focus:border-accent disabled:opacity-60 disabled:cursor-not-allowed transition-colors resize-none"
              />
            </div>

            {/* Footer Actions */}
            <div className="flex items-center justify-between gap-3 pt-3 border-t border-edge">
              <div className="flex items-center gap-2 flex-nowrap shrink-0">
                {isCreator && (
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMessage(null);
                      setTransferTargetId('');
                      setIsConfirmingTransfer(true);
                    }}
                    disabled={isBusy}
                    className="project-transfer-trigger inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-semibold"
                    title="转让群组给其他成员"
                  >
                    <ArrowRightLeft className="h-3.5 w-3.5" />
                    <span>转让群组</span>
                  </button>
                )}
                {isCreator && (
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMessage(null);
                      setDeleteConfirmationName('');
                      setIsConfirmingDelete(true);
                    }}
                    disabled={isBusy}
                    className="project-delete-trigger inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-semibold shadow-soft disabled:cursor-not-allowed"
                    title="仅群主可解散并删除群组"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>删除群组</span>
                  </button>
                )}
              </div>
              <div className="ml-auto flex items-center space-x-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isBusy}
                  className="ui-cancel-button px-3.5 py-1.5 rounded-xl text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={!isAdmin || isBusy}
                  className="theme-btn-primary px-4 py-1.5 rounded-xl text-xs font-semibold flex items-center space-x-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>保存中...</span>
                    </>
                  ) : (
                    <span>保存修改</span>
                  )}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* Transfer Group Confirmation Dialog */}
      {isConfirmingTransfer && group && (
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
                onClick={() => setIsConfirmingTransfer(false)}
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
      {isConfirmingDelete && group && (
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
                onClick={() => setIsConfirmingDelete(false)}
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
                onClick={() => setIsConfirmingDelete(false)}
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
