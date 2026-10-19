/**
 * ArchivedProjectsModal — 已归档项目列表与管理面板。
 *
 * CALLING SPEC:
 *   <ArchivedProjectsModal
 *     isOpen={boolean}
 *     onClose={() => void}
 *     archivedProjects={Project[]}
 *     currentUser={User}
 *     onRestoreProject={(project: Project) => Promise<void>}
 *     onDeleteProject={(project: Project) => Promise<void>}
 *     onSelectProject={(project: Project) => void}
 *   />
 */

import React, { useMemo, useState } from 'react';
import {
  Archive,
  ArrowUpRight,
  Calendar,
  FolderArchive,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { Project, User } from '../types';

export interface ArchivedProjectsModalProps {
  isOpen: boolean;
  onClose: () => void;
  archivedProjects: Project[];
  currentUser: User;
  onRestoreProject: (project: Project) => Promise<void>;
  onDeleteProject?: (project: Project) => Promise<void>;
  onSelectProject?: (project: Project) => void;
}

export const ArchivedProjectsModal: React.FC<ArchivedProjectsModalProps> = ({
  isOpen,
  onClose,
  archivedProjects = [],
  currentUser,
  onRestoreProject,
  onDeleteProject,
  onSelectProject,
}) => {
  const [search, setSearch] = useState('');
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return archivedProjects;
    return archivedProjects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.identifier && p.identifier.toLowerCase().includes(q)) ||
        (p.description && p.description.toLowerCase().includes(q))
    );
  }, [archivedProjects, search]);

  if (!isOpen) return null;

  const handleRestore = async (project: Project) => {
    setRestoringId(project.id);
    setErrorMessage(null);
    try {
      await onRestoreProject(project);
    } catch (err: any) {
      setErrorMessage(err?.message || '恢复项目失败');
    } finally {
      setRestoringId(null);
    }
  };

  const handleDelete = async (project: Project) => {
    if (!onDeleteProject) return;
    if (!window.confirm(`确定要彻底删除已归档项目「${project.name}」吗？此操作不可逆！`)) {
      return;
    }
    setDeletingId(project.id);
    setErrorMessage(null);
    try {
      await onDeleteProject(project);
    } catch (err: any) {
      setErrorMessage(err?.message || '删除项目失败');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-overlay/50 p-4 backdrop-blur-2xs animate-in fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !restoringId && !deletingId) onClose();
      }}
    >
      <div className="flex h-[75vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-edge bg-surface shadow-popover animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-edge px-6 py-4 bg-canvas/40">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-warning/15 text-warning">
              <FolderArchive className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-main">已归档项目</h3>
                <span className="rounded-full bg-card px-2 py-0.5 text-xs font-mono text-quiet border border-edge/60">
                  {archivedProjects.length}
                </span>
              </div>
              <p className="text-[11px] text-quiet">
                这里存放所有已归档的协作项目。归档项目不展示在左侧常规列表中，您可以随时恢复。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-quiet hover:bg-hover hover:text-main transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="border-b border-edge bg-canvas/20 px-6 py-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-quiet" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索已归档项目名称、标识或描述..."
              className="w-full rounded-xl border border-edge bg-surface pl-9 pr-4 py-2 text-xs text-main placeholder:text-quiet focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        {/* Error message */}
        {errorMessage && (
          <div className="mx-6 mt-3 rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2 text-xs text-danger">
            {errorMessage}
          </div>
        )}

        {/* Projects List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-2.5 scrollbar-thin">
          {filteredProjects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-quiet">
              <Archive className="h-10 w-10 text-quiet/40 mb-3" />
              <div className="text-xs font-semibold">
                {search ? '没有匹配的已归档项目' : '暂无已归档项目'}
              </div>
              <p className="mt-1 text-[11px] text-quiet/70 max-w-xs">
                当您在项目菜单中选择「归档项目」后，项目将会安全保存在此处。
              </p>
            </div>
          ) : (
            filteredProjects.map((project) => {
              const isAdmin =
                project.admins.includes(currentUser.id) ||
                project.createdBy === currentUser.id;
              const isRestoring = restoringId === project.id;
              const isDeleting = deletingId === project.id;

              return (
                <div
                  key={project.id}
                  className="group flex items-center justify-between rounded-xl border border-edge bg-canvas/40 p-4 transition-colors hover:border-accent/40 hover:bg-surface"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <span
                      className="mt-1 h-3 w-3 rounded-full shrink-0"
                      style={{ backgroundColor: project.color }}
                    />
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-main text-xs truncate">
                          {project.name}
                        </span>
                        {project.identifier && (
                          <span className="rounded bg-card px-1.5 py-0.2 font-mono text-[10px] text-quiet border border-edge/60">
                            {project.identifier}
                          </span>
                        )}
                        <span className="rounded-full bg-warning/10 px-2 py-0.2 text-[10px] font-semibold text-warning border border-warning/20">
                          已归档
                        </span>
                      </div>
                      {project.description && (
                        <p className="text-[11px] text-quiet line-clamp-1">
                          {project.description}
                        </p>
                      )}
                      {project.archivedAt && (
                        <div className="flex items-center gap-1.5 text-[10px] text-quiet/70">
                          <Calendar className="h-3 w-3" />
                          <span>归档于 {new Date(project.archivedAt).toLocaleDateString()}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 ml-4">
                    {onSelectProject && (
                      <button
                        type="button"
                        onClick={() => {
                          onSelectProject(project);
                          onClose();
                        }}
                        className="flex items-center gap-1 rounded-lg border border-edge bg-surface px-2.5 py-1.5 text-xs font-semibold text-sub hover:bg-hover hover:text-main transition-colors"
                        title="查看项目详情"
                      >
                        <ArrowUpRight className="h-3.5 w-3.5" />
                        <span>查看</span>
                      </button>
                    )}

                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => handleRestore(project)}
                        disabled={isRestoring || isDeleting}
                        className="flex items-center gap-1.5 rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent hover:text-on-accent transition-colors disabled:opacity-50"
                        title="恢复项目至活跃列表"
                      >
                        {isRestoring ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        <span>恢复项目</span>
                      </button>
                    )}

                    {isAdmin && onDeleteProject && (
                      <button
                        type="button"
                        onClick={() => handleDelete(project)}
                        disabled={isRestoring || isDeleting}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-quiet hover:bg-danger/10 hover:text-danger transition-colors disabled:opacity-50"
                        title="彻底删除项目"
                      >
                        {isDeleting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-edge bg-canvas/40 px-6 py-3">
          <div className="text-[11px] text-quiet">
            恢复后的项目将重新显示在左侧导航栏的项目列表中。
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-edge bg-surface px-4 py-1.5 text-xs font-semibold text-sub hover:bg-hover hover:text-main transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};
