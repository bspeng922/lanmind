import React, { useState, useEffect } from 'react';
import { Project, User } from '../types';
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
  FileText,
  Palette,
  ArrowRightLeft,
  Copy,
  Pipette,
} from 'lucide-react';
import { ThemeSelect, ThemeSelectOption } from './ThemeSelect';

const PRESET_PROJECT_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#6366f1', '#06b6d4'];
const isValidHex = (hex: string) => /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(hex);

interface ProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectToEdit?: Project | null;
  users: User[];
  currentUser: User;
  onProjectSaved: () => void | Promise<void>;
  onProjectDeleted: (projectId: string) => void | Promise<void>;
}

export const ProjectModal: React.FC<ProjectModalProps> = ({
  isOpen,
  onClose,
  projectToEdit,
  users,
  currentUser,
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
      <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl overflow-y-auto max-h-[90vh]">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            {projectToEdit ? (
              <UserCog className="w-4 h-4 text-blue-400" />
            ) : (
              <FolderPlus className="w-4 h-4 text-blue-400" />
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
            <label className="mb-1 flex items-center gap-1.5 font-semibold text-slate-400">
              <Folder className="h-3.5 w-3.5 text-blue-400" />
              <span>项目名称 <span className="text-rose-400">*</span></span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如: 2026年二季度营销复盘及 PPT..."
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Project Description */}
          <div>
            <label className="mb-1 flex items-center gap-1.5 font-semibold text-slate-400">
              <FileText className="h-3.5 w-3.5 text-slate-400" />
              <span>项目描述</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="项目的核心目标、范围及主要产出物..."
              className="w-full h-16 bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-blue-500 resize-none"
            />
          </div>

          {/* Color Tag Picker */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="flex items-center gap-1.5 font-semibold text-slate-400">
                <Palette className="h-3.5 w-3.5 text-pink-400" />
                <span>项目主题标识色</span>
              </label>
              <span className="font-mono text-[10px] text-slate-500 uppercase tracking-wider">
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
                        ? 'border-white scale-110 shadow-lg ring-2 ring-blue-500/50'
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
                    className="w-3 h-3 rounded-full border border-white/60 shadow-sm"
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
                      className="w-6 h-6 rounded-lg border border-white/40 shadow-sm transition-transform group-hover:scale-110"
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
                  <Palette className="w-3.5 h-3.5 text-pink-400" />
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
          <div className="space-y-2 pt-2 border-t border-slate-800">
            <div className="flex items-center justify-between">
              <label className="text-slate-200 font-bold flex items-center gap-1.5">
                <Shield className="w-4 h-4 text-indigo-400" />
                项目成员与权限 (项目管理员可管理成员)
              </label>
              {!isProjectAdmin && (
                <span className="text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                  只读 (仅管理员可修改)
                </span>
              )}
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2 max-h-48 overflow-y-auto">
              {users.map((u) => {
                const isMember = members.includes(u.id);
                const isAdmin = admins.includes(u.id);
                const isCreator = projectToEdit?.createdBy === u.id;
                const isCurrentUser = currentUser.id === u.id;
                const roleLabel = isCreator ? '项目创建者' : isAdmin ? '项目管理员' : isMember ? '普通成员' : '未加入';

                return (
                  <div key={u.id} className="flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-800">
                    <div>
                      <div className="font-semibold text-slate-200">{u.nickname}</div>
                      <div className="text-[10px] text-slate-500">{u.id}</div>
                      <div className={`text-[10px] ${isCreator ? 'text-amber-300' : isAdmin ? 'text-indigo-300' : 'text-slate-500'}`}>{roleLabel}</div>
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
                            : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
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
                            : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                        }`}
                      >
                        <ShieldCheck className="w-3 h-3" />
                        <span>{isAdmin ? '项目管理员' : '设为管理员'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {errorMsg && (
            <p className="text-rose-400 text-xs font-semibold bg-rose-950/30 p-2 rounded-lg border border-rose-500/30">
              {errorMsg}
            </p>
          )}

          <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-800">
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
                  className="project-delete-trigger inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-semibold shadow-sm disabled:cursor-not-allowed"
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
                className="theme-btn-primary px-5 py-2 font-bold rounded-xl shadow-lg disabled:cursor-wait"
              >
                {isSaving ? '正在保存...' : '保存项目设置'}
              </button>
            </div>
          </div>
          </form>
        </div>
      </div>

      {isConfirmingTransfer && projectToEdit && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="transfer-project-title">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleTransferProject();
            }}
            className="w-full max-w-sm rounded-2xl border border-amber-500/30 bg-slate-900/95 p-6 shadow-2xl backdrop-blur-md"
          >
            <h3 id="transfer-project-title" className="text-sm font-bold text-white">转让项目</h3>
            <p className="mt-2 text-xs leading-5 text-slate-400">转让后，选中的成员将成为项目创建者，你将保留普通成员身份。此操作不可撤销。</p>
            {transferCandidates.length === 0 ? (
              <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-950/25 p-3 text-xs leading-5 text-amber-300">
                <p className="font-semibold">当前局域网内暂未发现其他成员</p>
                <p className="mt-1 text-[11px] text-slate-400">请确保其他成员已启动并连接至同一局域网下的 LanMind，发现节点后即可选择转让。</p>
              </div>
            ) : (
              <>
                <label className="mt-4 block text-xs font-medium text-slate-300" htmlFor="transfer-target">新的项目创建者</label>
                <div className="mt-1.5">
                  <ThemeSelect
                    ariaLabel="选择新项目创建者"
                    value={transferTargetId}
                    options={[
                      { value: '', label: '请选择新项目创建者', tone: 'slate' },
                      ...transferCandidates.map((user) => {
                        const isAlreadyMember = members.includes(user.id) || (projectToEdit?.members.includes(user.id) ?? false);
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
            {errorMsg && <p className="mt-3 text-xs font-semibold text-rose-400">{errorMsg}</p>}
            <div className="mt-5 flex justify-end gap-2.5">
              <button type="button" onClick={() => setIsConfirmingTransfer(false)} disabled={isTransferring} className="ui-cancel-button rounded-xl px-4 py-2 text-xs font-semibold">取消</button>
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

      {isConfirmingDelete && projectToEdit && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-project-title"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleDeleteProject();
            }}
            className="w-full max-w-sm rounded-2xl border border-rose-500/30 bg-slate-900/95 p-6 shadow-2xl shadow-rose-950/30 backdrop-blur-md"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400">
                  <Trash2 className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h3 id="delete-project-title" className="text-sm font-bold text-white">
                    删除项目确认
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    删除后，所有成员将无法再访问此项目及其关联任务。此操作不可撤销。
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsConfirmingDelete(false)}
                disabled={isDeleting}
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="关闭删除确认"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4">
              <label className="block text-xs font-medium text-slate-300" htmlFor="delete-project-name">
                请输入项目名称以确认删除：
              </label>
              <div className="project-delete-name-box">
                <span className="project-delete-name-text select-all">{projectToEdit.name}</span>
                <button
                  type="button"
                  onClick={handleCopyProjectName}
                  className="project-delete-copy-btn"
                  title="复制项目名称"
                >
                  {isCopiedName ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" />
                      <span className="text-emerald-300">已复制</span>
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
                id="delete-project-name"
                type="text"
                autoFocus
                autoComplete="off"
                placeholder={`输入 "${projectToEdit.name}" 确认`}
                value={deleteConfirmationName}
                onChange={(event) => setDeleteConfirmationName(event.target.value)}
                disabled={isDeleting}
                className="project-delete-input mt-2.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 outline-none transition-colors focus:border-rose-500 focus:ring-1 focus:ring-rose-500/50 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>

            {errorMsg && (
              <p className="mt-3 text-xs font-semibold text-rose-400">{errorMsg}</p>
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
