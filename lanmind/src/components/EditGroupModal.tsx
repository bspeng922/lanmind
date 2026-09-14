/**
 * EditGroupModal.tsx — Modal for modifying chat group attributes.
 *
 * CALLING SPEC:
 *   <EditGroupModal
 *     isOpen={showEditGroupModal}
 *     onClose={() => setShowEditGroupModal(false)}
 *     group={activeTarget.group}
 *     projects={projects}
 *     currentUser={currentUser}
 *     onGroupUpdated={handleGroupUpdated}
 *   />
 *
 * TOOL CONTRACT:
 *   - Allows group administrators and creators to modify group name, description, avatar, and linked project
 *   - Persists changes via ApiService.updateChatGroupProfile and broadcasts to LAN
 *   - Side effects: Calls onGroupUpdated callback on successful update
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
} from 'lucide-react';
import { LanChatGroup, Project, User } from '../types';
import { ApiService } from '../services/api';
import { isTauri } from '@tauri-apps/api/core';
import { ThemeSelect, ThemeSelectOption } from './ThemeSelect';

export interface EditGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  group: LanChatGroup;
  projects: Project[];
  currentUser: User;
  onGroupUpdated: (updatedGroup: LanChatGroup) => void;
}

const PRESET_GROUP_ICONS = ['👥', '🚀', '💡', '🛡️', '⚡', '📊', '🌐', '💻', '🎨', '🎯'];

export const EditGroupModal: React.FC<EditGroupModalProps> = ({
  isOpen,
  onClose,
  group,
  projects,
  currentUser,
  onGroupUpdated,
}) => {
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description || '');
  const [avatar, setAvatar] = useState(group.avatar || '👥');
  const [projectId, setProjectId] = useState(group.projectId || '');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Sync state whenever group changes or modal opens
  useEffect(() => {
    if (isOpen) {
      setName(group.name);
      setDescription(group.description || '');
      setAvatar(group.avatar || '👥');
      setProjectId(group.projectId || '');
      setErrorMessage(null);
    }
  }, [isOpen, group]);

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

  if (!isOpen) return null;

  return (
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
                {isAdmin && (
                  <span className="flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] text-warning font-medium">
                    <Crown className="h-3 w-3" /> 管理员
                  </span>
                )}
              </div>
              <p className="text-[11px] text-sub mt-0.5">
                修改群组名称、徽标图标、简介及关联项目组
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭群组设置窗口"
            className="p-1.5 rounded-lg text-sub hover:text-main hover:bg-hover transition-colors"
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
              disabled={!isAdmin || isSaving}
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
                  disabled={!isAdmin || isSaving}
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
              disabled={!isAdmin || isSaving}
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
              disabled={!isAdmin || isSaving}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="填写群组宗旨、讨论主题或协作规范..."
              maxLength={200}
              className="w-full bg-canvas border border-subtle/80 rounded-xl px-3 py-2 text-xs text-main placeholder-quiet focus:outline-none focus:border-accent disabled:opacity-60 disabled:cursor-not-allowed transition-colors resize-none"
            />
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end space-x-2 pt-2 border-t border-edge">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-3.5 py-1.5 rounded-xl border border-subtle hover:bg-hover text-sub text-xs font-medium transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!isAdmin || isSaving}
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
        </form>
      </div>
    </div>
  );
};
