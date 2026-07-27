import React, { useState, useEffect } from 'react';
import { Project, User } from '../types';
import { ApiService } from '../services/api';
import {
  X,
  FolderPlus,
  ShieldCheck,
  UserPlus,
  Trash2,
  Check,
  Shield,
  Folder,
  FileText,
  Palette,
} from 'lucide-react';

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
  const [members, setMembers] = useState<string[]>([]);
  const [admins, setAdmins] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [deleteConfirmationName, setDeleteConfirmationName] = useState('');
  const projectId = projectToEdit?.id;
  const currentUserId = currentUser.id;

  useEffect(() => {
    if (!isOpen) return;

    if (projectToEdit) {
      setName(projectToEdit.name);
      setDescription(projectToEdit.description || '');
      setColor(projectToEdit.color || '#3b82f6');
      setMembers(projectToEdit.members || []);
      setAdmins(projectToEdit.admins || []);
    } else {
      setName('');
      setDescription('');
      setColor('#3b82f6');
      setMembers([currentUser.id]);
      setAdmins([currentUser.id]);
    }
    setErrorMsg('');
    setIsSaving(false);
    setIsDeleting(false);
    setIsConfirmingDelete(false);
    setDeleteConfirmationName('');
  }, [projectId, isOpen, currentUserId]);

  if (!isOpen) return null;

  const isProjectAdmin = projectToEdit
    ? projectToEdit.admins.includes(currentUser.id) || projectToEdit.createdBy === currentUser.id
    : true;
  const isProjectCreator = projectToEdit?.createdBy === currentUser.id;
  const isBusy = isSaving || isDeleting;

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setErrorMsg('');
    setIsSaving(true);

    try {
      if (projectToEdit) {
        await ApiService.updateProject(
          projectToEdit.id,
          { name, description, color, members, admins },
          currentUser.id
        );
      } else {
        await ApiService.createProject(
          {
            name,
            description,
            color,
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

  const colorsList = ['#3b82f6', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#6366f1', '#06b6d4'];

  const canConfirmDelete = Boolean(
    projectToEdit && deleteConfirmationName === projectToEdit.name,
  );

  return (
    <>
      <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl overflow-y-auto max-h-[90vh]">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <FolderPlus className="w-4 h-4 text-blue-400" />
            {projectToEdit ? '局域网项目权限与属性管理' : '新建局域网协同项目'}
          </h2>
          <button
            onClick={onClose}
            disabled={isBusy}
            className="p-1 hover:bg-slate-800 text-slate-400 rounded disabled:cursor-not-allowed disabled:opacity-50"
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
            <label className="mb-1 flex items-center gap-1.5 font-semibold text-slate-400">
              <Palette className="h-3.5 w-3.5 text-pink-400" />
              <span>项目主题标识色</span>
            </label>
            <div className="flex items-center space-x-2">
              {colorsList.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-6 h-6 rounded-full border-2 transition-transform ${
                    color === c ? 'border-white scale-110 shadow-lg' : 'border-transparent opacity-80 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
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

                return (
                  <div key={u.id} className="flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-800">
                    <div>
                      <div className="font-semibold text-slate-200">{u.nickname}</div>
                      <div className="text-[10px] text-slate-500">{u.id}</div>
                    </div>

                    <div className="flex items-center space-x-2">
                      {/* Toggle Member */}
                      <button
                        type="button"
                        disabled={!isProjectAdmin}
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
                        disabled={!isProjectAdmin}
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
            <div className="flex-shrink-0">
              {isProjectCreator && (
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg('');
                    setDeleteConfirmationName('');
                    setIsConfirmingDelete(true);
                  }}
                  disabled={isBusy}
                  className="project-delete-trigger flex items-center gap-1.5 rounded-lg px-3 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  删除项目
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
            className="w-full max-w-sm rounded-lg border border-rose-500/30 bg-slate-900 p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 id="delete-project-title" className="flex items-center gap-2 text-sm font-bold text-white">
                  <Trash2 className="h-4 w-4 flex-shrink-0 text-rose-400" />
                  删除项目
                </h3>
                <p className="mt-2 text-xs leading-5 text-slate-400">
                  删除后，所有成员将无法再访问此项目及其关联任务。此操作不可撤销。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsConfirmingDelete(false)}
                disabled={isDeleting}
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="关闭删除确认"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <label className="mt-4 block text-xs font-semibold text-slate-300" htmlFor="delete-project-name">
              请输入项目名称以确认
            </label>
            <div className="mt-1 break-all text-xs font-semibold text-rose-300">
              {projectToEdit.name}
            </div>
            <input
              id="delete-project-name"
              type="text"
              autoFocus
              autoComplete="off"
              value={deleteConfirmationName}
              onChange={(event) => setDeleteConfirmationName(event.target.value)}
              disabled={isDeleting}
              className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
            />

            {errorMsg && (
              <p className="mt-3 text-xs font-semibold text-rose-400">{errorMsg}</p>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsConfirmingDelete(false)}
                disabled={isDeleting}
                className="ui-cancel-button rounded-lg px-4 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={!canConfirmDelete || isDeleting}
                className="project-delete-confirm flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {isDeleting ? '正在删除...' : '确认删除'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
};
