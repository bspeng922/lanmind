import React, { useState, useEffect, useMemo } from 'react';
import { LocalDirectory, Project, User } from '../types';
import { ApiService } from '../services/api';
import {
  X,
  FolderPlus,
  ShieldCheck,
  UserPlus,
  UserCog,
  Trash2,
  Check,
  Shield,
  Folder,
  FolderTree,
  FileText,
  Palette,
  ArrowRightLeft,
  Copy,
  Pipette,
  Users,
} from 'lucide-react';
import { ProjectTransferDialog, ProjectDeleteDialog } from './ProjectConfirmModals';
import { GroupedMemberSelector, SelectableGroup } from './GroupedMemberSelector';

const PRESET_PROJECT_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#6366f1', '#06b6d4'];
const isValidHex = (hex: string) => /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(hex);

interface ProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectToEdit?: Project | null;
  users: User[];
  currentUser: User;
  localDirectory?: LocalDirectory;
  onProjectSaved: () => void | Promise<void>;
  onProjectDeleted: (projectId: string) => void | Promise<void>;
}

export const ProjectModal: React.FC<ProjectModalProps> = ({
  isOpen,
  onClose,
  projectToEdit,
  users,
  currentUser,
  localDirectory = { units: [], members: [] },
  onProjectSaved,
  onProjectDeleted,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [members, setMembers] = useState<string[]>([]);
  const [admins, setAdmins] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [memberSource, setMemberSource] = useState<'people' | 'org'>('people');
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [deleteConfirmationName, setDeleteConfirmationName] = useState('');
  const [isConfirmingTransfer, setIsConfirmingTransfer] = useState(false);
  const [transferTargetId, setTransferTargetId] = useState('');
  const [isTransferring, setIsTransferring] = useState(false);
  const [isCopiedName, setIsCopiedName] = useState(false);
  const projectId = projectToEdit?.id;
  const currentUserId = currentUser.id;

  useEffect(() => {
    if (!isOpen) return;

    if (projectToEdit) {
      const initialColor = projectToEdit.color || '#3b82f6';
      setName(projectToEdit.name);
      setDescription(projectToEdit.description || '');
      setColor(initialColor);
      setIsCustomMode(!PRESET_PROJECT_COLORS.includes(initialColor.toLowerCase()));
      setMembers(projectToEdit.members || []);
      setAdmins(projectToEdit.admins || []);
    } else {
      setName('');
      setDescription('');
      setColor('#3b82f6');
      setIsCustomMode(false);
      setMembers([currentUser.id]);
      setAdmins([currentUser.id]);
    }
    setMemberSource('people');
    setMemberSearchQuery('');
    setErrorMsg('');
    setIsSaving(false);
    setIsDeleting(false);
    setIsConfirmingDelete(false);
    setDeleteConfirmationName('');
    setIsConfirmingTransfer(false);
    setTransferTargetId('');
    setIsTransferring(false);
    setIsCopiedName(false);
  }, [projectId, isOpen, currentUserId]);

  const orgSelectableGroups: SelectableGroup[] = useMemo(() => {
    return localDirectory.units.map((unit) => {
      const directMemberIds = localDirectory.members
        .filter((m) => m.orgUnitId === unit.id)
        .map((m) => m.userId)
        .filter((id) => users.some((u) => u.id === id));
      return {
        id: unit.id,
        name: unit.name,
        parentId: unit.parentId || null,
        icon: <FolderTree className="w-3.5 h-3.5 text-accent shrink-0" />,
        memberUserIds: directMemberIds,
      };
    });
  }, [localDirectory.units, localDirectory.members, users]);

  if (!isOpen) return null;

  const isProjectAdmin = projectToEdit
    ? projectToEdit.admins.includes(currentUser.id) || projectToEdit.createdBy === currentUser.id
    : true;
  const isProjectCreator = projectToEdit?.createdBy === currentUser.id;
  const isBusy = isSaving || isDeleting || isTransferring;
  const transferCandidates = users.filter((user) => user.id !== currentUser.id);

  const handleToggleMember = (userId: string) => {
    if (!isProjectAdmin) return;
    if (members.includes(userId)) {
      setMembers(members.filter((m) => m !== userId));
      setAdmins(admins.filter((a) => a !== userId));
    } else {
      setMembers([...members, userId]);
    }
  };

  const handleToggleAdmin = (userId: string) => {
    if (!isProjectAdmin) return;
    if (admins.includes(userId)) {
      setAdmins(admins.filter((a) => a !== userId));
    } else {
      if (!members.includes(userId)) {
        setMembers([...members, userId]);
      }
      setAdmins([...admins, userId]);
    }
  };

  const normalizedMemberQuery = memberSearchQuery.trim().toLowerCase();
  const filteredUsers = users.filter((u) => {
    if (!normalizedMemberQuery) return true;
    return [u.nickname, u.username, u.id, u.ip].some((val) => val && val.toLowerCase().includes(normalizedMemberQuery));
  });

  const isCustomSelected = isCustomMode || !PRESET_PROJECT_COLORS.includes(color.toLowerCase());

  const handleHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.trim();
    if (!val.startsWith('#')) {
      val = '#' + val;
    }
    val = val.slice(0, 7);
    if (/^#[0-9A-Fa-f]*$/.test(val)) {
      setColor(val);
      setIsCustomMode(true);
    }
  };

  const handleHexBlur = () => {
    if (!isValidHex(color)) {
      setColor('#3b82f6');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setErrorMsg('');
    setIsSaving(true);
    const finalColor = isValidHex(color) ? color : '#3b82f6';

    try {
      if (projectToEdit) {
        await ApiService.updateProject(
          projectToEdit.id,
          { name, description, color: finalColor, members, admins },
          currentUser.id
        );
      } else {
        await ApiService.createProject(
          {
            name,
            description,
            color: finalColor,
            createdBy: currentUser.id,
            admins: [currentUser.id],
            members: Array.from(new Set([currentUser.id, ...members])),
          },
          currentUser.id
        );
      }
      await onProjectSaved();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || '仅项目管理员具备此权限');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteProject = async () => {
    if (
      !projectToEdit ||
      !isProjectCreator ||
      deleteConfirmationName !== projectToEdit.name
    ) return;
    setErrorMsg('');
    setIsDeleting(true);
    try {
      await ApiService.deleteProject(projectToEdit.id, currentUser.id);
      await onProjectDeleted(projectToEdit.id);
      setIsConfirmingDelete(false);
      onClose();
    } catch (error: any) {
      setErrorMsg(error.message || '删除项目失败');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleTransferProject = async () => {
    if (!projectToEdit || !isProjectCreator || !transferTargetId) return;
    setErrorMsg('');
    setIsTransferring(true);
    try {
      await ApiService.transferProject(projectToEdit.id, transferTargetId, currentUser.id);
      await onProjectSaved();
      setIsConfirmingTransfer(false);
      onClose();
    } catch (error: any) {
      setErrorMsg(error.message || '项目转让失败');
    } finally {
      setIsTransferring(false);
    }
  };

  const handleCopyProjectName = async () => {
    if (!projectToEdit?.name) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(projectToEdit.name);
      } else {
        throw new Error('Clipboard API unavailable');
      }
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = projectToEdit.name;
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

  const canConfirmDelete = Boolean(
    projectToEdit && deleteConfirmationName === projectToEdit.name,
  );

  return (
    <>
      <div className="fixed inset-0 bg-overlay backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-surface border border-edge rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-popover overflow-y-auto max-h-[90vh]">
          <div className="flex items-center justify-between pb-3 border-b border-edge">
          <h2 className="text-sm font-bold text-main flex items-center gap-2">
            {projectToEdit ? (
              <UserCog className="w-4 h-4 text-info" />
            ) : (
              <FolderPlus className="w-4 h-4 text-info" />
            )}
            {projectToEdit ? '局域网项目权限与属性管理' : '新建局域网协同项目'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            className="ui-modal-close-btn disabled:cursor-not-allowed disabled:opacity-50"
            title="关闭 (Esc)"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Project Name */}
          <div>
            <label className="mb-1 flex items-center gap-1.5 font-semibold text-sub">
              <Folder className="h-3.5 w-3.5 text-info" />
              <span>项目名称 <span className="text-danger">*</span></span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如: 2026年二季度营销复盘及 PPT..."
              className="w-full bg-canvas border border-subtle rounded-xl px-3 py-2 text-main focus:outline-none focus:border-accent/50"
            />
          </div>

          {/* Project Description */}
          <div>
            <label className="mb-1 flex items-center gap-1.5 font-semibold text-sub">
              <FileText className="h-3.5 w-3.5 text-sub" />
              <span>项目描述</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="项目的核心目标、范围及主要产出物..."
              className="w-full h-16 bg-canvas border border-subtle rounded-xl p-2.5 text-main focus:outline-none focus:border-accent/50 resize-none"
            />
          </div>

          {/* Color Tag Picker */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="flex items-center gap-1.5 font-semibold text-sub">
                <Palette className="h-3.5 w-3.5 text-feature" />
                <span>项目主题标识色</span>
              </label>
              <span className="font-mono text-[10px] text-quiet uppercase tracking-wider">
                {color}
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {PRESET_PROJECT_COLORS.map((c) => {
                const isSelected = !isCustomSelected && color.toLowerCase() === c.toLowerCase();
                return (
                  <button
                    type="button"
                    key={c}
                    onClick={() => {
                      setColor(c);
                      setIsCustomMode(false);
                    }}
                    className={`w-6 h-6 rounded-full border-2 transition-all ${
                      isSelected
                        ? 'border-white scale-110 shadow-panel ring-2 ring-blue-500/50'
                        : 'border-transparent opacity-80 hover:opacity-100 hover:scale-105'
                    }`}
                    style={{ backgroundColor: c }}
                    title={`推荐色 ${c}`}
                  />
                );
              })}

              {/* 自定义颜色按钮：点击直接唤起系统色盘 */}
              <label
                className={`project-custom-color-btn relative inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold cursor-pointer select-none transition-all ${
                  isCustomSelected
                    ? 'project-custom-color-btn-active'
                    : 'project-custom-color-btn-inactive'
                }`}
                title="点击自定义色盘选择颜色"
              >
                <Pipette className="w-3.5 h-3.5" />
                <span>自定义</span>
                {isCustomSelected && (
                  <span
                    className="w-3 h-3 rounded-full border border-white/60 shadow-soft"
                    style={{ backgroundColor: color }}
                  />
                )}
                <input
                  type="color"
                  value={isValidHex(color) ? color : '#3b82f6'}
                  onChange={(e) => {
                    setColor(e.target.value);
                    setIsCustomMode(true);
                  }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  title="打开颜色选择器"
                />
              </label>
            </div>

            {/* 自定义色盘与色值控制面板 */}
            {isCustomSelected && (
              <div className="project-custom-color-panel mt-2.5 flex items-center justify-between gap-3 p-2.5 rounded-xl">
                <div className="flex items-center gap-2.5 min-w-0">
                  <label className="relative flex items-center cursor-pointer group" title="点击重新打开色盘挑选颜色">
                    <span
                      className="w-6 h-6 rounded-lg border border-white/40 shadow-soft transition-transform group-hover:scale-110"
                      style={{
                        backgroundColor: color,
                        boxShadow: `0 0 10px ${color}66`,
                      }}
                    />
                    <input
                      type="color"
                      value={isValidHex(color) ? color : '#3b82f6'}
                      onChange={(e) => {
                        setColor(e.target.value);
                        setIsCustomMode(true);
                      }}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                  </label>
                  <span className="text-[11px] font-medium project-custom-color-text shrink-0">
                    自定义标识色：
                  </span>
                  <div className="flex items-center">
                    <input
                      type="text"
                      value={color.toUpperCase()}
                      onChange={handleHexChange}
                      onBlur={handleHexBlur}
                      maxLength={7}
                      placeholder="#3B82F6"
                      className="project-custom-hex-input w-24 rounded-lg px-2 py-1 text-xs font-mono font-bold uppercase outline-none transition-colors"
                    />
                  </div>
                </div>

                <label
                  className="project-custom-open-picker relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer select-none transition-all shrink-0"
                  title="点击打开调色盘"
                >
                  <Palette className="w-3.5 h-3.5 text-feature" />
                  <span>打开色盘</span>
                  <input
                    type="color"
                    value={isValidHex(color) ? color : '#3b82f6'}
                    onChange={(e) => {
                      setColor(e.target.value);
                      setIsCustomMode(true);
                    }}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                </label>
              </div>
            )}
          </div>

          {/* Project Members & Admin Management */}
          <div className="space-y-2 pt-2 border-t border-edge">
            <div className="flex items-center justify-between">
              <label className="text-main font-bold flex items-center gap-1.5">
                <Shield className="w-4 h-4 text-feature" />
                项目成员与权限 (项目管理员可管理成员)
              </label>
              {!isProjectAdmin && (
                <span className="text-[10px] text-warning bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                  只读 (仅管理员可修改)
                </span>
              )}
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="flex rounded-lg border border-edge bg-canvas p-0.5" role="tablist" aria-label="成员添加来源">
                <button
                  type="button"
                  onClick={() => setMemberSource('people')}
                  className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    memberSource === 'people' ? 'bg-accent text-on-accent' : 'text-sub hover:bg-hover'
                  }`}
                >
                  <Users className="w-3 h-3" />
                  <span>人员 ({users.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMemberSource('org')}
                  className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    memberSource === 'org' ? 'bg-accent text-on-accent' : 'text-sub hover:bg-hover'
                  }`}
                >
                  <FolderTree className="w-3 h-3" />
                  <span>本地组织 ({localDirectory.units.length})</span>
                </button>
              </div>
              <input
                value={memberSearchQuery}
                onChange={(e) => setMemberSearchQuery(e.target.value)}
                placeholder={
                  memberSource === 'org'
                    ? '搜索本地组织与人员...'
                    : '搜索姓名/账号/IP...'
                }
                className="w-48 rounded-lg border border-subtle bg-canvas px-2.5 py-1 text-xs text-main outline-none placeholder-quiet focus:border-accent"
              />
            </div>

            {memberSource === 'org' ? (
              <GroupedMemberSelector
                groups={orgSelectableGroups}
                users={users}
                selectedUserIds={members}
                disabledUserIds={[projectToEdit?.createdBy || currentUser.id]}
                onToggleUser={handleToggleMember}
                onUpdateSelection={(newSelected) => {
                  if (!isProjectAdmin) return;
                  const ownerId = projectToEdit?.createdBy || currentUser.id;
                  const finalized = Array.from(new Set([ownerId, ...newSelected]));
                  setMembers(finalized);
                  setAdmins((aPrev) => aPrev.filter((id) => finalized.includes(id)));
                }}
                searchQuery={memberSearchQuery}
                emptyText={
                  localDirectory.units.length === 0
                    ? '暂无本地组织，可前往右侧栏「管理本地组织目录」配置'
                    : '未找到匹配的本地组织'
                }
                maxHeightClass="max-h-52"
                readOnly={!isProjectAdmin}
                currentUserId={currentUser.id}
                creatorId={projectToEdit?.createdBy || currentUser.id}
                adminIds={admins}
              />
            ) : (
              <div className="bg-canvas border border-edge rounded-xl p-3 space-y-2 max-h-48 overflow-y-auto">
                {filteredUsers.length === 0 ? (
                  <div className="py-6 text-center text-xs text-quiet">未找到匹配的成员</div>
                ) : (
                  filteredUsers.map((u) => {
                    const isMember = members.includes(u.id);
                    const isAdmin = admins.includes(u.id);
                    const isCreator = projectToEdit?.createdBy === u.id;
                    const isCurrentUser = currentUser.id === u.id;
                    const roleLabel = isCreator ? '项目创建者' : isAdmin ? '项目管理员' : isMember ? '普通成员' : '未加入';

                    return (
                      <div key={u.id} className="flex items-center justify-between p-2 rounded-lg bg-surface border border-edge">
                        <div>
                          <div className="font-semibold text-main">{u.nickname}</div>
                          <div className="text-[10px] text-quiet">{u.id}</div>
                          <div className={`text-[10px] ${isCreator ? 'text-warning' : isAdmin ? 'text-feature' : 'text-quiet'}`}>{roleLabel}</div>
                        </div>

                        <div className="flex items-center space-x-2">
                          {/* Toggle Member */}
                          <button
                            type="button"
                            disabled={!isProjectAdmin || isCurrentUser || isCreator}
                            onClick={() => handleToggleMember(u.id)}
                            data-active={isMember}
                            className={`project-permission-action px-2 py-1 text-[10px] font-semibold rounded ${
                              isMember
                                ? 'bg-blue-600 hover:bg-blue-500'
                                : 'bg-card text-sub hover:bg-hover'
                            }`}
                          >
                            {isMember ? '已加入' : '加入'}
                          </button>

                          {/* Toggle Admin */}
                          <button
                            type="button"
                            disabled={!isProjectAdmin || isCurrentUser || isCreator}
                            onClick={() => handleToggleAdmin(u.id)}
                            data-active={isAdmin}
                            className={`project-permission-action px-2 py-1 text-[10px] font-semibold rounded flex items-center gap-1 ${
                              isAdmin
                                ? 'bg-indigo-600 hover:bg-indigo-500'
                                : 'bg-card text-sub hover:bg-hover'
                            }`}
                          >
                            <ShieldCheck className="w-3 h-3" />
                            <span>{isAdmin ? '项目管理员' : '设为管理员'}</span>
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {errorMsg && (
            <p className="text-danger text-xs font-semibold bg-danger/10 p-2 rounded-lg border border-rose-500/30">
              {errorMsg}
            </p>
          )}

          <div className="flex items-center justify-between gap-3 pt-3 border-t border-edge">
            <div className="flex items-center gap-2 flex-nowrap shrink-0">
              {isProjectCreator && (
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg('');
                    setTransferTargetId('');
                    setIsConfirmingTransfer(true);
                  }}
                  disabled={isBusy}
                  className="project-transfer-trigger inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-semibold"
                  title="转让项目给其他成员"
                >
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                  <span>转让项目</span>
                </button>
              )}
              {isProjectCreator && (
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg('');
                    setDeleteConfirmationName('');
                    setIsConfirmingDelete(true);
                  }}
                  disabled={isBusy}
                  className="project-delete-trigger inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-semibold shadow-soft disabled:cursor-not-allowed"
                  title="仅项目创建者可执行删除操作"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>删除项目</span>
                </button>
              )}
            </div>
            <div className="ml-auto flex items-center space-x-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isBusy}
                className="ui-cancel-button px-4 py-2 rounded-xl font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isBusy}
                className="theme-btn-primary px-5 py-2 font-bold rounded-xl shadow-panel disabled:cursor-wait"
              >
                {isSaving ? '正在保存...' : '保存项目设置'}
              </button>
            </div>
          </div>
          </form>
        </div>
      </div>

      {projectToEdit && (
        <>
          <ProjectTransferDialog
            isOpen={isConfirmingTransfer}
            onClose={() => setIsConfirmingTransfer(false)}
            project={projectToEdit}
            transferCandidates={transferCandidates}
            members={members}
            transferTargetId={transferTargetId}
            onTransferTargetChange={setTransferTargetId}
            onConfirmTransfer={handleTransferProject}
            isTransferring={isTransferring}
            errorMsg={errorMsg}
          />

          <ProjectDeleteDialog
            isOpen={isConfirmingDelete}
            onClose={() => setIsConfirmingDelete(false)}
            project={projectToEdit}
            deleteConfirmationName={deleteConfirmationName}
            onDeleteConfirmationNameChange={setDeleteConfirmationName}
            onConfirmDelete={handleDeleteProject}
            isDeleting={isDeleting}
            errorMsg={errorMsg}
            isCopiedName={isCopiedName}
            onCopyProjectName={handleCopyProjectName}
          />
        </>
      )}
    </>
  );
};
