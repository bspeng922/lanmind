import React, { useEffect, useState } from 'react';
import { Task, Project, User, Priority, TaskStatus } from '../types';
import { expandTaskOccurrences, formatRecurrenceLabel } from '../utils/recurrence';
import { formatTaskDueDate, parseTaskDateTime } from '../utils/taskDateTime';
import { ThemeSelect, ThemeSelectOption } from './ThemeSelect';
import {
  CheckCircle2,
  Circle,
  AlertOctagon,
  Clock,
  User as UserIcon,
  Plus,
  Filter,
  Trash2,
  Edit2,
  Folder,
  Tag,
  ChevronDown,
  ChevronUp,
  Share2,
  CheckSquare,
  Repeat,
  Calendar,
  X,
  UserCog,
} from 'lucide-react';
import { ProjectFilesPanel } from './ProjectFilesPanel';
import { FilePreviewModal } from './FilePreviewModal';
import { downloadFile, formatFileSize } from '../utils/fileTransfer';

const PRIORITY_FILTER_OPTIONS: ThemeSelectOption[] = [
  { value: 'ALL', label: '全部优先级' },
  { value: 'P1', label: 'P1（紧急重要）', tone: 'rose' },
  { value: 'P2', label: 'P2（重要）', tone: 'amber' },
  { value: 'P3', label: 'P3（普通）', tone: 'blue' },
  { value: 'P4', label: 'P4（低优）', tone: 'slate' },
];

const STATUS_FILTER_OPTIONS: ThemeSelectOption[] = [
  { value: 'ALL', label: '全部未完成状态' },
  { value: 'todo', label: '未开始', tone: 'slate' },
  { value: 'in_progress', label: '进行中', tone: 'blue' },
  { value: 'blocked', label: '已阻塞', tone: 'rose' },
];

interface ListViewProps {
  tasks: Task[];
  projects: Project[];
  users: User[];
  currentUser: User;
  onUpdateTask: (id: string, updates: Partial<Task>) => void;
  onDeleteTask: (id: string) => void;
  onOpenCreateTask: () => void;
  onOpenEditTask: (task: Task) => void;
  searchQuery: string;
  selectedProjectId: string | null;
  dateFilter?: string | null;
  onClearDateFilter?: () => void;
  onOpenManageProject?: (project: Project) => void;
  onOpenProjectFiles?: (project: Project) => void;
}

export const ListView: React.FC<ListViewProps> = ({
  tasks,
  projects,
  users,
  currentUser,
  onUpdateTask,
  onDeleteTask,
  onOpenCreateTask,
  onOpenEditTask,
  searchQuery,
  selectedProjectId,
  dateFilter = null,
  onClearDateFilter,
  onOpenManageProject,
  onOpenProjectFiles,
}) => {
  const [priorityFilter, setPriorityFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [showCompleted, setShowCompleted] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [filesProject, setFilesProject] = useState<Project | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<any | null>(null);

  useEffect(() => {
    if (dateFilter) setShowCompleted(true);
  }, [dateFilter]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const isProjectAdmin = selectedProject
    ? selectedProject.admins.includes(currentUser.id) || selectedProject.createdBy === currentUser.id
    : false;

  // Filter tasks logic
  const filteredTasks = tasks.filter((t) => {
    // Search query
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchTitle = t.title.toLowerCase().includes(q);
      const matchDesc = t.description?.toLowerCase().includes(q);
      const matchTags = (t.tags || []).some((tag) => tag.toLowerCase().includes(q));
      if (!matchTitle && !matchDesc && !matchTags) return false;
    }

    // Selected Project Filter
    if (selectedProjectId) {
      if (t.projectId !== selectedProjectId) return false;
    }

    if (dateFilter) {
      const matchesDate = t.dueDate?.slice(0, 10) === dateFilter
        || expandTaskOccurrences(t, dateFilter, dateFilter).length > 0;
      if (!matchesDate) return false;
    }

    // Priority Filter
    if (priorityFilter !== 'ALL' && t.priority !== priorityFilter) {
      return false;
    }

    // Status Filter
    if (!showCompleted && t.status === 'completed') {
      return false;
    }
    if (statusFilter !== 'ALL' && t.status !== statusFilter) {
      return false;
    }

    return true;
  });

  const getPriorityBadge = (p: Priority) => {
    switch (p) {
      case 'P1':
        return <span className="px-2 py-0.5 text-[10px] font-bold bg-rose-500/10 text-rose-500 border border-rose-500/30 rounded">P1 紧急</span>;
      case 'P2':
        return <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/30 rounded">P2 重要</span>;
      case 'P3':
        return <span className="px-2 py-0.5 text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/30 rounded">P3 普通</span>;
      case 'P4':
        return <span className="px-2 py-0.5 text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700 rounded">P4 低优</span>;
    }
  };

  const getStatusIcon = (status: TaskStatus, interactive = true) => {
    const interactionClass = interactive
      ? 'cursor-pointer hover:scale-110 transition-transform'
      : 'cursor-not-allowed opacity-60';
    switch (status) {
      case 'completed':
        return <CheckCircle2 className={`h-5 w-5 text-emerald-500 ${interactionClass}`} />;
      case 'in_progress':
        return <Clock className={`h-5 w-5 text-blue-400 ${interactionClass} ${interactive ? 'animate-pulse' : ''}`} />;
      case 'blocked':
        return <AlertOctagon className={`h-5 w-5 text-rose-500 ${interactionClass}`} />;
      default:
        return <Circle className={`h-5 w-5 text-slate-500 ${interactionClass} ${interactive ? 'hover:text-blue-400' : ''}`} />;
    }
  };

  const handleToggleStatus = (task: Task) => {
    const statusCycle: Record<TaskStatus, TaskStatus> = {
      todo: 'in_progress',
      in_progress: 'completed',
      completed: 'todo',
      blocked: 'in_progress',
    };
    onUpdateTask(task.id, { status: statusCycle[task.status] });
  };

  const handleToggleSubtask = (task: Task, subtaskId: string) => {
    const updatedSubtasks = (task.subtasks || []).map((s) => (s.id === subtaskId ? { ...s, completed: !s.completed } : s));
    onUpdateTask(task.id, { subtasks: updatedSubtasks });
  };

  const getTaskAttachments = (task: Task) => {
    if (task.attachments?.length) return task.attachments;
    try {
      const saved = JSON.parse(localStorage.getItem(`lanmind_task_attachments:${task.id}`) || '[]');
      return Array.isArray(saved) ? saved : [];
    } catch { return []; }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 text-slate-100 overflow-hidden">
      {/* Selected Project Header Banner */}
      {selectedProject && (
        <div className="bg-slate-900 border-b border-slate-800 p-4 flex flex-wrap items-center justify-between gap-3 shadow-md">
          <div className="flex items-center space-x-3">
            <Folder
              className="w-5 h-5 flex-shrink-0"
              style={{ color: selectedProject.color || '#3b82f6' }}
            />
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-slate-100">{selectedProject.name}</h2>
                <span className="text-[10px] bg-slate-800 border border-slate-700 text-slate-300 px-2 py-0.5 rounded font-mono">
                  局域网项目
                </span>
                {isProjectAdmin && (
                  <span className="project-admin-badge text-[10px] px-2 py-0.5 rounded font-bold">
                    项目管理员
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {selectedProject.description || '暂无项目描述'}
              </p>
            </div>
          </div>

          {/* Project Members List & Manage Button */}
          <div className="flex items-center space-x-3">
            <div className="flex items-center -space-x-1.5 overflow-hidden">
              {selectedProject.members.map((mId) => {
                const u = users.find((usr) => usr.id === mId);
                const isAdmin = selectedProject.admins.includes(mId);
                return (
                  <div
                    key={mId}
                    className={`project-member-avatar w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-transform hover:scale-105 ${
                      isAdmin ? 'project-member-avatar-admin' : ''
                    }`}
                    title={`${u?.nickname || mId} (${isAdmin ? '管理员' : '成员'})`}
                  >
                    {u?.avatar || (u?.nickname ? u.nickname.charAt(0) : 'U')}
                  </div>
                );
              })}
            </div>

            {isProjectAdmin && onOpenManageProject && (
              <button
                type="button"
                onClick={() => onOpenManageProject(selectedProject)}
                className="project-manage-btn"
                title="项目权限与属性管理"
                aria-label="项目权限与属性管理"
              >
                <UserCog className="project-manage-icon" />
                <span>项目权限与属性管理</span>
              </button>
            )}
            <button type="button" onClick={() => onOpenProjectFiles ? onOpenProjectFiles(selectedProject) : setFilesProject(selectedProject)} className="project-manage-btn" title="打开项目文件">
                <Folder className="project-manage-icon" />
                <span>项目文件</span>
            </button>
          </div>
        </div>
      )}

      {/* Top Filter Bar */}
      <div className="bg-slate-900/60 border-b border-slate-800/80 p-3.5 flex flex-wrap items-center justify-between gap-3 backdrop-blur-sm">
        <div className="flex items-center space-x-2.5 flex-wrap gap-y-2">
          <div className="flex items-center space-x-1.5 text-xs text-slate-400 font-medium">
            <Filter className="w-3.5 h-3.5 text-blue-400" />
            <span>筛选:</span>
          </div>

          <ThemeSelect
            ariaLabel="按优先级筛选"
            value={priorityFilter}
            options={PRIORITY_FILTER_OPTIONS}
            onChange={setPriorityFilter}
            width={142}
          />

          <ThemeSelect
            ariaLabel="按任务状态筛选"
            value={statusFilter}
            options={STATUS_FILTER_OPTIONS}
            onChange={setStatusFilter}
            width={156}
          />

          <label className="flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-slate-700/80 bg-slate-800/60 px-2.5 text-xs text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800">
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={(event) => setShowCompleted(event.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-950 text-emerald-500 focus:ring-1 focus:ring-emerald-500"
            />
            <span>显示已完成</span>
          </label>

          {dateFilter && (
            <button
              type="button"
              onClick={onClearDateFilter}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-blue-500/40 bg-blue-500/10 px-2.5 text-xs font-medium text-blue-300 transition-colors hover:bg-blue-500/20"
              title="清除日期筛选"
            >
              <Calendar className="h-3.5 w-3.5" />
              <span>{dateFilter} 的任务</span>
              <X className="h-3.5 w-3.5" />
            </button>
          )}

          <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400 bg-slate-800/40 px-2.5 py-1 rounded-lg border border-slate-700/40">
            <span>共 <strong className="text-slate-200">{filteredTasks.length}</strong> 项</span>
            <span className="text-slate-600">·</span>
            <span className="text-emerald-400">已完成 {tasks.filter(t => t.status === 'completed').length}</span>
          </div>
        </div>

        {/* Add Task Button */}
        <button
          onClick={onOpenCreateTask}
          className="theme-btn-primary px-3.5 py-1.5 text-xs font-semibold"
        >
          <Plus className="w-4 h-4" />
          <span>新建任务</span>
        </button>
      </div>

      {/* Task List Items Container */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
        {filteredTasks.length === 0 ? (
          <div className="text-center py-16 theme-glow-card rounded-2xl max-w-md mx-auto my-10 p-8 flex flex-col items-center border border-dashed border-slate-700/60 shadow-lg">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3 shadow-inner"
              style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}
            >
              <CheckSquare className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-slate-300">暂无符合条件的任务</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-xs leading-relaxed">
              您可以使用顶部搜索框调整筛选条件，或者直接创建新任务开启协同。
            </p>
            <button
              onClick={onOpenCreateTask}
              className="theme-btn-primary px-4 py-1.5 text-xs font-semibold mt-4"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>新建第一个任务</span>
            </button>
          </div>
        ) : (
          filteredTasks.map((task) => {
            const project = projects.find((p) => p.id === task.projectId);
            const assignee = users.find((u) => u.id === task.assigneeId);
            const isExpanded = expandedTaskId === task.id;
            const canEdit = Boolean(
              task.creatorId === currentUser.id ||
                task.assigneeId === currentUser.id ||
                (task.projectId &&
                  task.isShared &&
                  Boolean(
                    project &&
                      (project.createdBy === currentUser.id ||
                        project.admins.includes(currentUser.id) ||
                        project.members.includes(currentUser.id)),
                  )) ||
                (!task.isShared && task.sharedWith.includes(currentUser.id)),
            );

            const subtasks = task.subtasks || [];
            const tags = task.tags || [];
            const completedSubCount = subtasks.filter((s) => s.completed).length;
            const totalSubCount = subtasks.length;
            const attachments = getTaskAttachments(task);

            return (
              <div
                key={task.id}
                className={`theme-glow-card rounded-xl p-3.5 transition-all ${
                  task.status === 'completed'
                    ? 'border-slate-800/60 bg-slate-900/40 opacity-75'
                    : task.status === 'blocked'
                    ? 'border-rose-500/30 bg-rose-950/10'
                    : 'border-slate-800'
                }`}
              >
                {/* Task Row Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start space-x-3 flex-1 min-w-0">
                    {/* Status Check Toggle */}
                    <div
                      className={`pt-0.5 ${canEdit ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
                      onClick={() => canEdit && handleToggleStatus(task)}
                      title={canEdit ? '切换任务状态' : '当前任务只读'}
                    >
                      {getStatusIcon(task.status, canEdit)}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                        <span
                          className={`text-sm font-medium ${
                            task.status === 'completed' ? 'line-through text-slate-400' : 'text-slate-100'
                          }`}
                        >
                          {task.title}
                        </span>

                        {getPriorityBadge(task.priority)}

                        {project && (
                          <span
                            className="px-2 py-0.5 text-[10px] rounded font-medium flex items-center space-x-1"
                            style={{ backgroundColor: `${project.color}20`, color: project.color }}
                          >
                            <Folder className="w-3 h-3" />
                            <span>{project.name}</span>
                          </span>
                        )}

                        {task.isShared && (
                          <span className="px-1.5 py-0.5 text-[10px] bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded flex items-center space-x-1">
                            <Share2 className="w-3 h-3" />
                            <span>{task.projectId ? '项目组共享' : '局域网共享'}</span>
                          </span>
                        )}
                        {task.isShared && !canEdit && (
                          <span className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                            只读
                          </span>
                        )}

                        {task.recurrence && task.recurrence !== 'none' && (
                          <span className="px-1.5 py-0.5 text-[10px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded flex items-center space-x-1 font-medium">
                            <Repeat className="w-3 h-3 text-cyan-400" />
                            <span>{formatRecurrenceLabel(task.recurrence, task.recurrenceRule, task.dueDate)}</span>
                          </span>
                        )}
                      </div>

                      {/* Description Preview */}
                      {task.description && (
                        <p className="text-xs text-slate-400 mt-1 line-clamp-2">{task.description}</p>
                      )}

                      {/* Tags & Subtask Meter */}
                      <div className="flex items-center space-x-4 mt-2 text-[11px] text-slate-400 flex-wrap gap-y-1">
                        {task.dueDate && (
                          <span
                            className={`flex items-center space-x-1 font-mono ${
                              (parseTaskDateTime(task.dueDate)?.getTime() || 0) < Date.now() && task.status !== 'completed'
                                ? 'text-rose-400 font-bold'
                                : 'text-slate-400'
                            }`}
                          >
                            <Clock className="w-3 h-3" />
                            <span>到期: {formatTaskDueDate(task.dueDate)}</span>
                          </span>
                        )}

                        {assignee && (
                          <span className="flex items-center space-x-1">
                            <UserIcon className="w-3 h-3 text-blue-400" />
                            <span>指派人: {assignee.nickname}</span>
                          </span>
                        )}

                        {totalSubCount > 0 && (
                          <span className="flex items-center space-x-1 text-slate-400">
                            <CheckSquare className="w-3 h-3 text-emerald-400" />
                            <span>
                              子任务: {completedSubCount}/{totalSubCount}
                            </span>
                          </span>
                        )}

                        {tags.map((tg) => (
                          <span key={tg} className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded border border-slate-700/60">
                            #{tg}
                          </span>
                        ))}
                        {attachments.length > 0 && (
                          <span className="flex items-center space-x-1 text-slate-400"><span className="text-blue-400">📎</span><span>{attachments.length} 个附件</span></span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions Right */}
                  <div className="flex items-center space-x-1.5">
                    <button
                      onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                      className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors"
                      title={isExpanded ? '收起详情' : '展开子任务'}
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                    {canEdit && (
                      <>
                        <button
                          onClick={() => onOpenEditTask(task)}
                          className="p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-blue-400"
                          title="编辑任务"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => onDeleteTask(task.id)}
                          className="p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-rose-400"
                          title="删除任务"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Subtask Accordion Detail Panel */}
                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-slate-800/80 bg-slate-950/60 p-3 rounded-lg space-y-2">
                    <div className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                      <span>子任务清单 ({completedSubCount}/{totalSubCount})</span>
                      {totalSubCount > 0 && (
                        <div className="w-32 bg-slate-800 h-1.5 rounded-full overflow-hidden">
                          <div
                            className="bg-emerald-500 h-full transition-all duration-300"
                            style={{ width: `${(completedSubCount / totalSubCount) * 100}%` }}
                          />
                        </div>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      {subtasks.map((st) => (
                        <div
                          key={st.id}
                          onClick={() => canEdit && handleToggleSubtask(task, st.id)}
                          className={`flex items-center space-x-2 rounded p-1.5 text-xs text-slate-300 transition-colors ${
                            canEdit ? 'cursor-pointer hover:bg-slate-900' : 'cursor-not-allowed opacity-70'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={st.completed}
                            onChange={() => {}}
                            className="rounded border-slate-700 bg-slate-800 text-blue-600 focus:ring-0 cursor-pointer"
                          />
                          <span className={st.completed ? 'line-through text-slate-500' : 'text-slate-200'}>
                            {st.title}
                          </span>
                        </div>
                      ))}
                    </div>
                    {attachments.length > 0 && (
                      <div className="mt-3 border-t border-slate-800/80 pt-3">
                        <div className="mb-2 text-xs font-semibold text-slate-300">附件 ({attachments.length})</div>
                        <div className="space-y-1.5">
                          {attachments.map((file: any) => (
                            <div
                              key={file.id}
                              className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-2 text-xs text-slate-300 transition-colors hover:border-slate-700"
                            >
                              <button
                                type="button"
                                onClick={() => setPreviewAttachment(file)}
                                className="min-w-0 truncate text-left font-mono hover:text-blue-300 transition-colors"
                                title="点击在线预览"
                              >
                                {file.name}
                              </button>
                              <div className="ml-2 flex flex-shrink-0 items-center gap-2.5">
                                <span className="text-[10px] text-slate-500 font-mono">
                                  {formatFileSize(file.size)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => downloadFile(file.dataUrl, file.name)}
                                  className="text-[10px] font-medium text-blue-400 hover:text-blue-300 hover:underline transition-colors"
                                  title="下载此附件"
                                >
                                  下载
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      {filesProject && <ProjectFilesPanel project={filesProject} users={users} currentUser={currentUser} onClose={() => setFilesProject(null)} />}
      {previewAttachment && <FilePreviewModal name={previewAttachment.name} type={previewAttachment.type} dataUrl={previewAttachment.dataUrl} onClose={() => setPreviewAttachment(null)} />}
    </div>
  );
};
