import React, { useState, useEffect, useMemo } from 'react';
import { tr, useLocale } from '../../i18n';
import { Task, Project, User, Priority, WorkItemState, TaskComment } from '../../types';
import { ApiService } from '../../services/api';
import { IssueIdentifier } from '../workitem/IssueIdentifier';
import { StatePill } from '../workitem/StatePill';
import { TaskTagsEditor } from '../TaskTagsEditor';
import { TaskComments } from '../TaskComments';
import { ChildTasksEditor } from '../ChildTasksEditor';
import { resolveTaskGroup, sortStates } from '../../utils/workItemState';
import { getTaskTagUsage } from '../../utils/taskTags';
import {
  X,
  Maximize2,
  Minimize2,
  ChevronUp,
  ChevronDown,
  Trash2,
} from 'lucide-react';

/**
 * IssuePeekDrawer — 从看板或列表右侧滑出的工作项详情面。
 *
 * CALLING SPEC:
 *   <IssuePeekDrawer
 *     task={task}
 *     isOpen={mode === 'peek'}
 *     states={activeStates}
 *     projects={projects}
 *     users={users}
 *     currentUser={currentUser}
 *     onSaveTask={handleSaveTask}
 *     onClose={...}
 *     visibleTasks={...}
 *     onNavigateTask={...}
 *   />
 *
 * 编辑即时生效：字段失焦或变更后立即保存，不设保存按钮。
 */

interface IssuePeekDrawerProps {
  task: Task | null;
  isOpen: boolean;
  onClose: () => void;
  /** 当前作用域的状态列表。为空时状态选择器退回按状态组展示。 */
  states?: WorkItemState[];
  projects: Project[];
  users: User[];
  currentUser: User;
  onSaveTask: (data: any) => Promise<void>;
  onDeleteTask?: (taskId: string) => void | boolean | Promise<void | boolean>;
  visibleTasks?: Task[];
  onNavigateTask?: (task: Task) => void;
}

export const IssuePeekDrawer: React.FC<IssuePeekDrawerProps> = ({
  task,
  isOpen,
  onClose,
  states = [],
  projects,
  users,
  currentUser,
  onSaveTask,
  onDeleteTask,
  visibleTasks = [],
  onNavigateTask,
}) => {
  useLocale();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [stateId, setStateId] = useState('');
  const [priority, setPriority] = useState<Priority>('P3');
  const [assigneeId, setAssigneeId] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [isFullScreen, setIsFullScreen] = useState(false);

  useEffect(() => {
    if (task) {
      setTitle(task.title || '');
      setDescription(task.description || '');
      setStateId(task.stateId || '');
      setPriority(task.priority || 'P3');
      setAssigneeId(task.assigneeId || currentUser.id);
      setProjectId(task.projectId || null);
      setDueDate(task.dueDate || null);
      setTags(task.tags || []);
    }
  }, [task, currentUser.id]);

  /**
   * 可用的状态选项。
   * 任务所属项目与当前作用域不一致时，状态列表可能为空，此时给出项目内的默认状态兜底。
   */
  const stateOptions = useMemo(() => {
    if (states.length) return sortStates(states);
    return [];
  }, [states]);

  const currentIndex = useMemo(
    () => (task ? visibleTasks.findIndex((item) => item.id === task.id) : -1),
    [task, visibleTasks],
  );
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < visibleTasks.length - 1;

  const handlePrev = () => {
    if (hasPrev && onNavigateTask) {
      onNavigateTask(visibleTasks[currentIndex - 1]);
    }
  };

  const handleNext = () => {
    if (hasNext && onNavigateTask) {
      onNavigateTask(visibleTasks[currentIndex + 1]);
    }
  };

  const [comments, setComments] = useState<TaskComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  const [commentSaving, setCommentSaving] = useState(false);

  useEffect(() => {
    let disposed = false;
    if (task?.id && currentUser?.id) {
      setCommentsLoading(true);
      setCommentsError('');
      ApiService.getTaskComments(task.id, currentUser.id)
        .then((items) => {
          if (!disposed) setComments(items);
        })
        .catch((err) => {
          if (!disposed) setCommentsError(String(err?.message || err));
        })
        .finally(() => {
          if (!disposed) setCommentsLoading(false);
        });
    } else {
      setComments([]);
    }
    return () => { disposed = true; };
  }, [task?.id, currentUser?.id]);

  const handleCreateComment = async (replyToCommentId?: string): Promise<boolean> => {
    if (!task?.id || !commentDraft.trim() || commentSaving) return false;
    setCommentSaving(true);
    try {
      const created = await ApiService.createTaskComment(task.id, commentDraft, currentUser.id, replyToCommentId);
      setComments((prev) => [...prev, created]);
      setCommentDraft('');
      return true;
    } catch (err) {
      setCommentsError(String((err as any)?.message || err));
      return false;
    } finally {
      setCommentSaving(false);
    }
  };

  const handleDeleteComment = async (comment: TaskComment) => {
    if (comment.authorId !== currentUser.id) return;
    try {
      await ApiService.deleteTaskComment(comment.id, currentUser.id);
      setComments((prev) => prev.filter((item) => item.id !== comment.id));
    } catch (err) {
      setCommentsError(String((err as any)?.message || err));
    }
  };

  const handleAutoSave = async (patch: Partial<Task>) => {
    if (!task) return;
    const updated = {
      ...task,
      ...patch,
    };
    await onSaveTask(updated);
  };

  if (!isOpen || !task) return null;

  const currentProject = projects.find((project) => project.id === task.projectId);

  return (
    <aside
      className={`fixed bottom-0 right-0 top-12 z-50 flex flex-col border-l border-edge bg-surface shadow-popover transition-all duration-200 ${
        isFullScreen ? 'w-full' : 'w-[min(720px,100vw)]'
      }`}
      role="dialog"
      aria-label={tr('tasks:issuePeekDrawer.title')}
    >
      {/* 顶部：编号、上下切换、操作 */}
      <header className="flex h-12 items-center justify-between border-b border-edge px-4 text-xs">
        <div className="flex items-center gap-3">
          <IssueIdentifier task={task} project={currentProject} size="md" />
          {visibleTasks.length > 1 && (
            <div className="flex items-center gap-1 border-l border-edge pl-2">
              <button
                type="button"
                onClick={handlePrev}
                disabled={!hasPrev}
                className="rounded p-1 text-quiet transition-colors hover:bg-hover hover:text-main disabled:pointer-events-none disabled:opacity-30"
                title={tr('tasks:issuePeekDrawer.previousWorkItem')}
                aria-label={tr('tasks:issuePeekDrawer.previousWorkItem')}
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={handleNext}
                disabled={!hasNext}
                className="rounded p-1 text-quiet transition-colors hover:bg-hover hover:text-main disabled:pointer-events-none disabled:opacity-30"
                title={tr('tasks:issuePeekDrawer.nextWorkItem')}
                aria-label={tr('tasks:issuePeekDrawer.nextWorkItem')}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-sub">
          {onDeleteTask && (
            <button
              type="button"
              onClick={async () => {
                if (await onDeleteTask(task.id) !== false) onClose();
              }}
              className="rounded p-1.5 text-quiet transition-colors hover:bg-hover hover:text-danger"
              title={tr('tasks:issuePeekDrawer.delete')}
              aria-label={tr('tasks:issuePeekDrawer.delete')}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsFullScreen(!isFullScreen)}
            className="rounded p-1.5 text-quiet transition-colors hover:bg-hover hover:text-main"
            title={isFullScreen ? tr('tasks:issuePeekDrawer.sidePeek') : tr('tasks:issuePeekDrawer.fullScreen')}
            aria-label={isFullScreen ? tr('tasks:issuePeekDrawer.sidePeek') : tr('tasks:issuePeekDrawer.fullScreen')}
          >
            {isFullScreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-quiet transition-colors hover:bg-hover hover:text-main"
            title={tr('tasks:issuePeekDrawer.closeEsc')}
            aria-label={tr('tasks:issuePeekDrawer.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* 左栏：标题、描述、子任务、评论 */}
        <div className="min-w-0 flex-1 space-y-6 overflow-y-auto p-6">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => handleAutoSave({ title })}
            placeholder={tr('tasks:issuePeekDrawer.titlePlaceholder')}
            className="w-full bg-transparent text-lg font-semibold text-main outline-none placeholder:text-placeholder"
          />

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-quiet">
              {tr('tasks:issuePeekDrawer.description')}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => handleAutoSave({ description })}
              placeholder={tr('tasks:issuePeekDrawer.descriptionPlaceholder')}
              rows={5}
              className="w-full resize-none rounded-md border border-edge bg-canvas/50 p-3 text-xs leading-relaxed text-main outline-none placeholder:text-placeholder focus:border-accent/50"
            />
          </div>

          <div className="space-y-2">
            <ChildTasksEditor
              value={(task.subtasks || []) as any}
              onChange={(nextSubtasks) => {
                handleAutoSave({ subtasks: nextSubtasks as any });
              }}
              users={users}
              defaultAssignee={currentUser.id}
              canEdit={() => true}
              states={states}
            />
          </div>

          <div className="border-t border-edge pt-6">
            <TaskComments
              comments={comments}
              users={users}
              currentUserId={currentUser.id}
              loading={commentsLoading}
              error={commentsError}
              draft={commentDraft}
              onDraftChange={setCommentDraft}
              saving={commentSaving}
              onSubmit={handleCreateComment}
              onDelete={handleDeleteComment}
            />
          </div>
        </div>

        {/* 右栏：属性 */}
        <div className="w-64 shrink-0 space-y-5 overflow-y-auto border-l border-edge bg-canvas/40 p-4 text-xs">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-quiet">
            {tr('tasks:issuePeekDrawer.properties')}
          </p>

          {/* 状态 */}
          <div className="space-y-1">
            <label htmlFor="peek-state" className="text-[11px] text-sub">
              {tr('tasks:taskModal.state')}
            </label>
            {stateOptions.length ? (
              <select
                id="peek-state"
                value={stateId}
                onChange={(e) => {
                  const next = e.target.value;
                  setStateId(next);
                  handleAutoSave({ stateId: next });
                }}
                className="w-full rounded-md border border-edge bg-card px-2 py-1.5 text-xs text-main outline-none focus:border-accent/50"
              >
                {stateOptions.map((state) => (
                  <option key={state.id} value={state.id}>
                    {state.name}
                  </option>
                ))}
              </select>
            ) : (
              <StatePill state={null} group={resolveTaskGroup(task)} />
            )}
          </div>

          {/* 优先级 */}
          <div className="space-y-1">
            <label htmlFor="peek-priority" className="text-[11px] text-sub">
              {tr('tasks:taskModal.priority')}
            </label>
            <select
              id="peek-priority"
              value={priority}
              onChange={(e) => {
                const next = e.target.value as Priority;
                setPriority(next);
                handleAutoSave({ priority: next });
              }}
              className="w-full rounded-md border border-edge bg-card px-2 py-1.5 text-xs text-main outline-none focus:border-accent/50"
            >
              <option value="P1">{tr('tasks:listView.p1Urgent')}</option>
              <option value="P2">{tr('tasks:listView.p2High')}</option>
              <option value="P3">{tr('tasks:listView.p3Normal')}</option>
              <option value="P4">{tr('tasks:listView.p4Low')}</option>
            </select>
          </div>

          {/* 负责人 */}
          <div className="space-y-1">
            <label htmlFor="peek-assignee" className="text-[11px] text-sub">
              {tr('tasks:issuePeekDrawer.assignee')}
            </label>
            <select
              id="peek-assignee"
              value={assigneeId}
              onChange={(e) => {
                const next = e.target.value;
                setAssigneeId(next);
                handleAutoSave({ assigneeId: next });
              }}
              className="w-full rounded-md border border-edge bg-card px-2 py-1.5 text-xs text-main outline-none focus:border-accent/50"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nickname}{u.isOnline ? ` · ${tr('tasks:issuePeekDrawer.online')}` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* 所属项目 */}
          <div className="space-y-1">
            <label htmlFor="peek-project" className="text-[11px] text-sub">
              {tr('tasks:issuePeekDrawer.project')}
            </label>
            <select
              id="peek-project"
              value={projectId || ''}
              onChange={(e) => {
                const next = e.target.value ? e.target.value : null;
                setProjectId(next);
                handleAutoSave({ projectId: next });
              }}
              className="w-full rounded-md border border-edge bg-card px-2 py-1.5 text-xs text-main outline-none focus:border-accent/50"
            >
              <option value="">{tr('tasks:kanbanView.personalTask')}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* 截止日期 */}
          <div className="space-y-1">
            <label htmlFor="peek-due" className="text-[11px] text-sub">
              {tr('tasks:taskLayoutPanel.dueDate')}
            </label>
            <input
              id="peek-due"
              type="date"
              value={dueDate ? dueDate.slice(0, 10) : ''}
              onChange={(e) => {
                const next = e.target.value ? e.target.value : null;
                setDueDate(next);
                handleAutoSave({ dueDate: next });
              }}
              className="w-full rounded-md border border-edge bg-card px-2 py-1.5 text-xs text-main outline-none focus:border-accent/50"
            />
          </div>

          {/* 标签 */}
          <div className="space-y-1">
            <label className="text-[11px] text-sub">{tr('tasks:issuePeekDrawer.labels')}</label>
            <TaskTagsEditor
              value={tags}
              suggestions={getTaskTagUsage(visibleTasks)}
              onChange={(nextTags) => {
                setTags(nextTags);
                handleAutoSave({ tags: nextTags });
              }}
            />
          </div>
        </div>
      </div>
    </aside>
  );
};
