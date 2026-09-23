/**
 * CreateGroupModal.tsx — Modal for creating project & LAN collaborative chat groups.
 *
 * CALLING SPEC:
 *   <CreateGroupModal
 *     isOpen={isCreateGroupOpen}
 *     onClose={() => setIsCreateGroupOpen(false)}
 *     currentUser={currentUser}
 *     users={users}
 *     projects={projects}
 *     localDirectory={localDirectory}
 *     canUserCreateGroup={canUserCreateGroup}
 *     onGroupCreated={(newGroup, systemMessage) => handleGroupCreated(newGroup, systemMessage)}
 *   />
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Users,
  FolderKanban,
  Smile,
  FileText,
  Search,
} from 'lucide-react';
import { User, LanChatGroup, LanChatMessage, Project, LocalDirectory } from '../types';
import { ApiService } from '../services/api';
import { isTauri } from '@tauri-apps/api/core';
import { ThemeSelect, ThemeSelectOption } from './ThemeSelect';
import { ThemeCheckbox } from './ThemeCheckbox';
import { GroupedMemberSelector, SelectableGroup } from './GroupedMemberSelector';

export interface CreateGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  users: User[];
  projects?: Project[];
  localDirectory?: LocalDirectory;
  canUserCreateGroup: boolean;
  onGroupCreated: (newGroup: LanChatGroup, initialSystemMessage: LanChatMessage) => void;
}

const PRESET_GROUP_ICONS = ['👥', '🚀', '⚡', '💡', '📁', '⚙️', '📦', '🎯', '🔥', '📊'];

export const CreateGroupModal: React.FC<CreateGroupModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  users = [],
  projects = [],
  localDirectory,
  canUserCreateGroup,
  onGroupCreated,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [avatar, setAvatar] = useState('👥');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([currentUser.id]);
  const [searchQuery, setSearchQuery] = useState('');
  const [memberSource, setMemberSource] = useState<'people' | 'org'>('people');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const safeLocalDirectory: LocalDirectory = useMemo(() => {
    return localDirectory || { units: [], members: [] };
  }, [localDirectory]);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setName('');
      setDescription('');
      setAvatar('👥');
      setSelectedProjectId('');
      setSelectedMemberIds([currentUser.id]);
      setSearchQuery('');
      setMemberSource('people');
      setIsSubmitting(false);
      setErrorMessage(null);
    }
  }, [isOpen, currentUser.id]);

  // Accessible / creatable projects
  const accessibleProjects = useMemo(() => {
    return (projects || []).filter(
      (project) =>
        project &&
        (project.createdBy === currentUser.id ||
          (Array.isArray(project.admins) && project.admins.includes(currentUser.id)) ||
          (Array.isArray(project.members) && project.members.includes(currentUser.id))),
    );
  }, [projects, currentUser.id]);

  const creatableProjects = useMemo(() => {
    return accessibleProjects.filter(
      (project) =>
        currentUser.role === 'admin' ||
        project.createdBy === currentUser.id ||
        (Array.isArray(project.admins) && project.admins.includes(currentUser.id)),
    );
  }, [accessibleProjects, currentUser.id, currentUser.role]);

  const selectedProject = useMemo(() => {
    return accessibleProjects.find((project) => project.id === selectedProjectId);
  }, [accessibleProjects, selectedProjectId]);

  const selectedProjectMemberIds = useMemo(() => {
    if (!selectedProject) return null;
    return new Set([
      selectedProject.createdBy,
      ...(Array.isArray(selectedProject.admins) ? selectedProject.admins : []),
      ...(Array.isArray(selectedProject.members) ? selectedProject.members : []),
    ]);
  }, [selectedProject]);

  const selectableGroupUsers = useMemo(() => {
    return selectedProjectMemberIds
      ? (users || []).filter((user) => selectedProjectMemberIds.has(user.id))
      : (users || []);
  }, [users, selectedProjectMemberIds]);

  const projectSelectOptions: ThemeSelectOption[] = useMemo(() => [
    { value: '', label: '不关联特定项目（通用组）', tone: 'slate' },
    ...creatableProjects.map((project) => ({
      value: project.id,
      label: project.name,
      tone: 'blue' as const,
    })),
  ], [creatableProjects]);

  const orgSelectableGroups: SelectableGroup[] = useMemo(() => {
    return safeLocalDirectory.units.map((unit) => {
      const directMemberIds = safeLocalDirectory.members
        .filter((m) => m.orgUnitId === unit.id)
        .map((m) => m.userId)
        .filter((id) => selectableGroupUsers.some((u) => u.id === id));
      return {
        id: unit.id,
        name: unit.name,
        parentId: unit.parentId || null,
        icon: <FolderKanban className="w-3.5 h-3.5 text-accent shrink-0" />,
        memberUserIds: directMemberIds,
      };
    });
  }, [safeLocalDirectory.units, safeLocalDirectory.members, selectableGroupUsers]);

  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const visibleSelectableGroupUsers = useMemo(() => {
    return selectableGroupUsers.filter((user) => {
      if (!normalizedSearchQuery) return true;
      return [user.nickname, user.username, user.deviceId, user.ip]
        .filter(Boolean)
        .some((value) => value.toLocaleLowerCase().includes(normalizedSearchQuery));
    });
  }, [selectableGroupUsers, normalizedSearchQuery]);

  const handleToggleMember = (userId: string) => {
    setSelectedMemberIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  };

  const handleSelectAllMembers = () => {
    const selectableIds = selectableGroupUsers.map((user) => user.id);
    if (selectableIds.every((id) => selectedMemberIds.includes(id))) {
      setSelectedMemberIds([currentUser.id]);
    } else {
      setSelectedMemberIds(selectableIds);
    }
  };

  const handleProjectChange = (projectId: string) => {
    setSelectedProjectId(projectId);
    const project = accessibleProjects.find((item) => item.id === projectId);
    if (!project) return;
    const projectMemberIds = new Set([project.createdBy, ...project.admins, ...project.members]);
    setSelectedMemberIds((current) =>
      Array.from(new Set([currentUser.id, ...current.filter((id) => projectMemberIds.has(id))])),
    );
    if (!name) {
      setName(`项目: ${project.name}`);
      setDescription(project.description || '');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canUserCreateGroup) {
      setErrorMessage('非群创建者和群管理员无法创建群聊天');
      return;
    }
    if (!name.trim()) return;

    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const allowedMemberIds = selectedProjectMemberIds;
      const ensuredMemberIds = Array.from(
        new Set([
          currentUser.id,
          ...selectedMemberIds.filter((id) => !allowedMemberIds || allowedMemberIds.has(id)),
        ]),
      );

      const newGroup: LanChatGroup = {
        id: `group-${Date.now()}`,
        name: name.trim(),
        description: description.trim() || '局域网私密协同群组',
        avatar,
        memberIds: ensuredMemberIds,
        adminIds: [currentUser.id],
        createdBy: currentUser.id,
        createdAt: new Date().toISOString(),
        projectId: selectedProjectId || undefined,
      };

      const savedGroup = isTauri() ? await ApiService.saveChatGroup(newGroup) : newGroup;

      const systemMsg: LanChatMessage = {
        id: `msg-${Date.now()}`,
        senderId: currentUser.id,
        senderName: currentUser.nickname,
        senderAvatar: currentUser.avatar,
        groupId: savedGroup.id,
        type: 'text',
        content: `🎉 ${currentUser.nickname} 创建了项目群组《${newGroup.name}》，共 ${ensuredMemberIds.length} 名成员已加入频道！`,
        timestamp: new Date().toISOString(),
      };

      const savedSystemMessage = isTauri() ? await ApiService.sendChatMessage(systemMsg) : systemMsg;
      onGroupCreated(savedGroup, savedSystemMessage);
      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '创建群组失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-md p-3 sm:p-5 overflow-hidden animate-in fade-in duration-150">
      <div className="lan-chat-submodal bg-surface border border-subtle rounded-2xl max-w-xl w-full max-h-[92vh] flex flex-col shadow-popover animate-in zoom-in-95 duration-150 overflow-hidden">
        {/* Pinned Header */}
        <div className="flex-shrink-0 flex items-center justify-between border-b border-edge px-5 py-3.5 bg-canvas/40">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-accent/15 text-accent rounded-xl border border-accent/20">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-main">创建项目与局域网协同群组</h3>
              <p className="text-[11px] text-sub">建立专属项目群组并挑选局域网协同成员</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-sub hover:text-main rounded-lg hover:bg-hover transition-colors"
            aria-label="关闭创建群组弹窗"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form
          id="create-group-form"
          onSubmit={handleSubmit}
          className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4 custom-scrollbar"
        >
          {errorMessage && (
            <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-danger">
              {errorMessage}
            </p>
          )}

          {/* Group Name */}
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-sub">
              <Users className="h-3.5 w-3.5 text-info" />
              <span>群组名称 <span className="text-danger">*</span></span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如: 前端与 AI 专项攻坚组"
              className="w-full bg-canvas border border-subtle rounded-xl px-3 py-2 text-xs text-main placeholder-quiet focus:outline-none focus:border-accent/50 transition-colors"
            />
          </div>

          {/* Project Association Dropdown */}
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-sub">
              <FolderKanban className="h-3.5 w-3.5 text-accent" />
              <span>关联项目组（可选）</span>
            </label>
            <ThemeSelect
              ariaLabel="选择群组关联项目"
              value={selectedProjectId}
              options={projectSelectOptions}
              onChange={handleProjectChange}
            />
          </div>

          {/* Group Avatar Picker */}
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
                  onClick={() => setAvatar(icon)}
                  className={`w-8 h-8 rounded-lg text-sm flex items-center justify-center border transition-all ${
                    avatar === icon
                      ? 'bg-accent/20 border-accent text-accent scale-105 shadow-soft'
                      : 'bg-canvas border-edge text-sub hover:border-subtle hover:text-main'
                  }`}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>

          {/* Group Description */}
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-sub">
              <FileText className="h-3.5 w-3.5 text-sub" />
              <span>群组宗旨 / 简介</span>
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="例如: 用于分享架构设计图与后端性能优化报告"
              className="w-full bg-canvas border border-subtle rounded-xl px-3 py-2 text-xs text-main placeholder-quiet focus:outline-none focus:border-accent/50 transition-colors"
            />
          </div>

          {/* Member Selection List */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-sub">
                <Users className="h-3.5 w-3.5 text-success" />
                <span>选择初始群成员 ({selectedMemberIds.length} 人)</span>
              </label>
              <button
                type="button"
                onClick={handleSelectAllMembers}
                className="btn-select-all text-[11px] text-accent hover:underline font-semibold"
              >
                {selectableGroupUsers.length > 0 && selectableGroupUsers.every((user) => selectedMemberIds.includes(user.id))
                  ? '反选'
                  : '全选'}
              </button>
            </div>

            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-sub" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索要加入的人员..."
                className="w-full rounded-lg border border-subtle bg-canvas py-1.5 pl-8 pr-3 text-xs text-main outline-none placeholder-quiet focus:border-accent"
                aria-label="搜索初始群成员"
              />
            </div>

            <div className="mb-2 flex rounded-lg border border-edge bg-canvas p-0.5" role="tablist" aria-label="初始成员来源">
              <button
                type="button"
                role="tab"
                aria-selected={memberSource === 'people'}
                onClick={() => setMemberSource('people')}
                className={`flex-1 rounded-md px-2 py-1 text-xs font-semibold transition-all ${
                  memberSource === 'people'
                    ? 'bg-accent text-on-accent shadow-soft'
                    : 'text-sub hover:bg-hover'
                }`}
              >
                人员 ({visibleSelectableGroupUsers.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={memberSource === 'org'}
                onClick={() => setMemberSource('org')}
                className={`flex-1 rounded-md px-2 py-1 text-xs font-semibold transition-all ${
                  memberSource === 'org'
                    ? 'bg-accent text-on-accent shadow-soft'
                    : 'text-sub hover:bg-hover'
                }`}
              >
                本地组织 ({safeLocalDirectory.units.length})
              </button>
            </div>

            {memberSource === 'org' ? (
              <GroupedMemberSelector
                groups={orgSelectableGroups}
                users={selectableGroupUsers}
                selectedUserIds={selectedMemberIds}
                disabledUserIds={[currentUser.id]}
                onToggleUser={(userId) => handleToggleMember(userId)}
                onUpdateSelection={(newIds) => {
                  const finalized = Array.from(new Set([currentUser.id, ...newIds]));
                  setSelectedMemberIds(finalized);
                }}
                searchQuery={searchQuery}
                emptyText="暂无匹配的本地组织"
                maxHeightClass="max-h-56"
                currentUserId={currentUser.id}
                creatorId={currentUser.id}
              />
            ) : (
              <div className="member-list-box max-h-56 overflow-y-auto space-y-1 bg-canvas/80 border border-edge rounded-xl p-2 custom-scrollbar">
                {visibleSelectableGroupUsers.length === 0 ? (
                  <div className="py-6 text-center text-xs text-quiet">暂无匹配的人员</div>
                ) : (
                  visibleSelectableGroupUsers.map((u) => {
                    const isChecked = selectedMemberIds.includes(u.id);
                    const isSelf = u.id === currentUser.id;

                    return (
                      <div
                        key={u.id}
                        onClick={() => handleToggleMember(u.id)}
                        className="member-item flex items-center justify-between p-2 rounded-lg hover:bg-hover/80 cursor-pointer text-xs transition-colors"
                      >
                        <div className="flex items-center space-x-2">
                          <ThemeCheckbox
                            checked={isChecked}
                            onChange={() => handleToggleMember(u.id)}
                            size="sm"
                            ariaLabel={`选择成员：${u.nickname}`}
                          />
                          <span className="member-item-title text-main font-medium">{u.nickname}</span>
                          {isSelf && (
                            <span className="member-item-owner text-[9px] bg-blue-500/20 text-info px-1.5 py-0.5 rounded font-medium">
                              我 (群主)
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-quiet font-mono">{u.ip || u.id}</span>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </form>

        {/* Pinned Footer */}
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-3.5 border-t border-edge bg-canvas/40">
          <div className="text-xs text-sub">
            已选择 <span className="font-semibold text-accent">{selectedMemberIds.length}</span> 位成员
          </div>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="ui-cancel-button px-4 py-2 rounded-xl text-xs transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              form="create-group-form"
              disabled={!name.trim() || isSubmitting}
              className="btn-confirm-group theme-btn-primary disabled:opacity-40 font-bold px-4 py-2 rounded-xl text-xs transition-all shadow-soft"
            >
              {isSubmitting ? '正在创建...' : '确认创建群组'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
