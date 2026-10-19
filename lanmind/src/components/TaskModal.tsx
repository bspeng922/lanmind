import { scopedStorageKey } from "../utils/workspaceContext";
/**
 * TaskModal — Task Creation & Editing Dialog
 *
 * CALLING SPEC:
 *   <TaskModal
 *     isOpen={boolean}
 *     onClose={() => void}
 *     taskToEdit={Task | null}
 *     projects={Project[]}
 *     users={User[]}
 *     tasks={Task[]}
 *     currentUser={User}
 *     onSaveTask={async (data) => void}
 *     visibleTasks={Task[]}
 *     onNavigateTask={(task: Task) => void}
 *     onDeleteTask={(taskId: string) => void}
 *     onDuplicateTask={(task: Task) => void}
 *     onOpenTaskActivity={(task: Task) => void}
 *   />
 */
import { localizeMessage } from '../i18n/messages';
import { tr, useLocale } from "../i18n";
import { currentLocale } from '../i18n/core';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Task,
  Project,
  User,
  Priority,
  StateGroup,
  TaskStatus,
  WorkItemState,
  Subtask,
  RecurrenceRule,
  RecurrenceType,
  RecurrenceWeekday,
  TaskAttachment,
  TaskContentMode,
  TaskComment,
  ChildTaskDraft,
} from '../types';
import {
  defaultStateFor,
  legacyStatusToGroup,
  resolveTaskGroup,
} from '../utils/workItemState';
import { Activity } from 'lucide-react';
import { TaskComments } from './TaskComments';
import { TaskActivityTimeline } from './task/TaskActivityTimeline';
import { copyTaskReference, taskReferenceMarkdown, taskReferenceUrl } from '../utils/taskLinks';
import { buildTaskDuplicate } from '../utils/taskDuplicate';
import {
  calculateReminderTime,
  combineTaskDueDate,
  inferReminderMinutes,
  formatLocalTaskDateTime,
  splitTaskDueDate,
} from '../utils/taskDateTime';
import { ThemeSelectOption } from './ThemeSelect';
import {
  alignDueDateToRecurrence,
  normalizeRecurrenceRule,
} from '../utils/recurrence';
import { getTaskTagUsage, TaskTagUsage } from '../utils/taskTags';
import { ApiService } from '../services/api';
import { checklistFromMarkdown, markdownWithChecklist, reconcileTaskChecklist } from '../utils/taskChecklist';
import { FilePreviewModal } from './FilePreviewModal';
import { TaskDetailHeader } from './task/TaskDetailHeader';
import { TaskQuickPropertyChips } from './task/TaskQuickPropertyChips';
import { TaskContentSection } from './task/TaskContentSection';
import { TaskSubWorkItemsSection } from './task/TaskSubWorkItemsSection';
import { TaskPropertiesSidebar } from './task/TaskPropertiesSidebar';
import { stateOptions } from './taskModalOptions';


interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskToEdit?: Task | null;
  projects: Project[];
  users: User[];
  tasks: Task[];
  currentUser: User;
  onSaveTask: (taskData: any) => Promise<void>;
  initialDate?: string;
  initialStatus?: TaskStatus;
  initialProjectId?: string;
  initialTitle?: string;
  initialDescription?: string;
  tagSuggestions?: TaskTagUsage[];
  /** 当前作用域的状态定义。缺失时状态下拉为空，读写退回旧的字面量取值。 */
  states?: WorkItemState[];
  canEditTask?: (task: Task) => boolean;
  visibleTasks?: Task[];
  onNavigateTask?: (task: Task) => void;
  onDeleteTask?: (taskId: string) => void | Promise<void>;
  onDuplicateTask?: (task: Task) => void | Promise<void>;
  onOpenTaskActivity?: (task: Task) => void;
}

export const TaskModal: React.FC<TaskModalProps> = ({
  isOpen,
  onClose,
  taskToEdit,
  projects,
  users,
  tasks,
  currentUser,
  onSaveTask,
  initialDate,
  initialStatus,
  initialProjectId,
  initialTitle,
  initialDescription,
  tagSuggestions = [],
  states = [],
  canEditTask = () => true,
  visibleTasks,
  onNavigateTask,
  onDeleteTask,
  onDuplicateTask,
  onOpenTaskActivity,
}: TaskModalProps) => {
  useLocale();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('P4');
  const [stateId, setStateId] = useState<string>('');
  const [progress, setProgress] = useState(0);
  const [startDate, setStartDate] = useState<string>('');
  const [dueDate, setDueDate] = useState<string>('');
  const [dueTime, setDueTime] = useState<string>('');
  const [reminderAdvance, setReminderAdvance] = useState<string>('0');
  const [recurrence, setRecurrence] = useState<RecurrenceType>('none');
  const [recurrenceRule, setRecurrenceRule] = useState<RecurrenceRule | null>(null);
  const [projectId, setProjectId] = useState<string>('');
  const [parentTaskId, setParentTaskId] = useState<string>('');
  const [contentMode, setContentMode] = useState<TaskContentMode>('markdown');
  const [assigneeId, setAssigneeId] = useState<string>('');
  const [isShared, setIsShared] = useState<boolean>(false);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  const [childTasks, setChildTasks] = useState<ChildTaskDraft[]>([]);
  const [previewAttachment, setPreviewAttachment] = useState<TaskAttachment | null>(null);
  const [commentSaving, setCommentSaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [internalTask, setInternalTask] = useState<Task | null>(taskToEdit || null);

  useEffect(() => {
    setInternalTask(taskToEdit || null);
  }, [taskToEdit]);

  const activeTask = taskToEdit ?? internalTask;
  const [activeDetailTab, setActiveDetailTab] = useState<'comments' | 'activity'>('comments');
  const [activityCount, setActivityCount] = useState<number | null>(null);
  const detailSectionRef = useRef<HTMLDivElement>(null);

  const navigationList = useMemo(() => {
    if (!activeTask) return [];
    if (visibleTasks && visibleTasks.some((t) => t.id === activeTask.id)) {
      return visibleTasks;
    }
    if (activeTask.parentTaskId) {
      return tasks.filter((t) => t.parentTaskId === activeTask.parentTaskId);
    }
    if (activeTask.projectId) {
      return tasks.filter((t) => t.projectId === activeTask.projectId && !t.parentTaskId);
    }
    return tasks.filter((t) => !t.parentTaskId);
  }, [visibleTasks, tasks, activeTask?.id, activeTask?.parentTaskId, activeTask?.projectId]);

  const currentIndex = activeTask ? navigationList.findIndex((t) => t.id === activeTask.id) : -1;
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < navigationList.length - 1;
  const prevTask = hasPrevious ? navigationList[currentIndex - 1] : null;
  const nextTask = hasNext ? navigationList[currentIndex + 1] : null;

  const handleNavigate = (targetTask: Task) => {
    setInternalTask(targetTask);
    onNavigateTask?.(targetTask);
  };

  useEffect(() => {
    if (!isOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !previewAttachment && !document.querySelector(tr("tasks:taskModal.ariaLabelTaskDetails"))) {
        onClose();
      }
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [isOpen, onClose, previewAttachment]);

  useEffect(() => {
    if (!isOpen) return;
    let disposed = false;
    setSaveError('');
    setCommentDraft('');
    setComments([]);
    setCommentsLoading(Boolean(activeTask));
    setCommentsError('');
    setPreviewAttachment(null);
    setChildTasks((activeTask ? tasks.filter((task) => task.parentTaskId === activeTask.id) : []).map((task) => ({
      draftId: task.id, id: task.id, version: task.version, title: task.title, description: reconcileTaskChecklist(task.description || '', task.subtasks || []).description,
      priority: task.priority, status: task.status, assigneeId: task.assigneeId, dueDate: task.dueDate,
    })));
    if (activeTask) {
      const dueParts = splitTaskDueDate(activeTask.dueDate);
      const reminderMinutes = inferReminderMinutes(activeTask.dueDate, activeTask.reminderTime);
      setTitle(activeTask.title);
      const content = reconcileTaskChecklist(activeTask.description || '', activeTask.subtasks || []);
      setDescription(content.description);
      setPriority(activeTask.priority);
      setStateId(activeTask.stateId || defaultStateFor(states, activeTask.projectId ?? null, resolveTaskGroup(activeTask, states))?.id || '');
      setProgress(activeTask.progress ?? (resolveTaskGroup(activeTask, states) === 'completed' ? 100 : 0));
      setStartDate(activeTask.startDate?.slice(0, 10) || '');
      setDueDate(dueParts.date);
      setDueTime(dueParts.time);
      setReminderAdvance(
        reminderMinutes !== null && [0, 5, 10, 15, 30].includes(reminderMinutes)
          ? String(reminderMinutes)
          : 'none'
      );
      setRecurrence(activeTask.recurrence || 'none');
      setRecurrenceRule(
        normalizeRecurrenceRule(
          activeTask.recurrence || 'none',
          activeTask.recurrenceRule,
          activeTask.dueDate
        )
      );
      setProjectId(activeTask.projectId || '');
      setParentTaskId(activeTask.parentTaskId || '');
      setContentMode(activeTask.contentMode || 'markdown');
      setAssigneeId(activeTask.assigneeId || currentUser.id);
      setIsShared(activeTask.isShared || false);
      setSubtasks(content.subtasks);
      setTags(activeTask.tags || []);
      try {
        const stored = JSON.parse(localStorage.getItem(scopedStorageKey(`lanmind_task_attachments:${activeTask.id}`)) || '[]');
        setAttachments(activeTask.attachments?.length ? activeTask.attachments : (Array.isArray(stored) ? stored : []));
      } catch { setAttachments(activeTask.attachments || []); }
      void ApiService.getTaskComments(activeTask.id, currentUser.id).then((nextComments) => {
        if (!disposed) setComments(nextComments);
      }).catch(() => {
        if (!disposed) setCommentsError(tr("tasks:taskModal.couldNotLoadCommentsReopenTheTask"));
      }).finally(() => { if (!disposed) setCommentsLoading(false); });
    } else {
      setTitle(initialTitle || '');
      setDescription(initialDescription || '');
      setPriority('P4');
      const initialGroup = initialStatus ? legacyStatusToGroup(initialStatus) : 'unstarted';
      setStateId(defaultStateFor(states, initialProjectId ?? null, initialGroup)?.id || '');
      setProgress(initialGroup === 'completed' ? 100 : 0);
      setStartDate('');
      setDueDate(initialDate || formatLocalTaskDateTime(new Date(), false));
      setDueTime('');
      setReminderAdvance('0');
      setRecurrence('none');
      setRecurrenceRule(null);
      setProjectId(initialProjectId || '');
      setParentTaskId('');
      setContentMode('markdown');
      setAssigneeId(currentUser.id);
      setIsShared(Boolean(initialProjectId));
      setSubtasks([]);
      setTags([tr("tasks:taskModal.general")]);
      setAttachments([]);
    }
    return () => { disposed = true; };
  }, [activeTask?.id, isOpen, initialDate, initialStatus, initialProjectId, initialTitle, initialDescription, currentUser.id]);

  /**
   * 状态列表可能晚于弹窗打开才就位（异步加载或项目状态变更）。
   * 只在创建态且尚未选中任何状态时补一个默认值，避免覆盖用户的编辑。
   */
  useEffect(() => {
    if (!isOpen || activeTask || stateId || !states?.length) return;
    const fallback = defaultStateFor(states, initialProjectId ?? null, 'unstarted');
    if (fallback) setStateId(fallback.id);
  }, [isOpen, activeTask?.id, stateId, states, initialProjectId]);

  if (!isOpen) return null;

  const isProjectScopedCreate = !activeTask && Boolean(initialProjectId);
  const effectiveProjectId = isProjectScopedCreate ? initialProjectId! : projectId;
  const selectedProject = projects.find((project) => project.id === effectiveProjectId);
  const projectMemberIds = selectedProject
    ? new Set([...selectedProject.members, ...selectedProject.admins])
    : null;
  const assigneeOptions = projectMemberIds
    ? users.filter((user) => projectMemberIds.has(user.id))
    : users;
  const projectOptions: ThemeSelectOption[] = [
    { value: '', label: tr("tasks:taskModal.personalTaskNoProject"), tone: 'slate' },
    ...projects.map((project) => ({ value: project.id, label: project.name, tone: 'blue' as const })),
  ];
  const assigneeSelectOptions: ThemeSelectOption[] = assigneeOptions.map((user) => ({
    value: user.id,
    label: `${user.nickname} (${user.id})`,
    tone: user.id === currentUser.id ? 'emerald' : 'blue',
  }));
  const parentTaskOptions: ThemeSelectOption[] = [
    { value: '', label: tr("tasks:taskModal.noParentTask"), tone: 'slate' },
    ...tasks
      .filter((task) => (
        task.id !== activeTask?.id
        && !task.parentTaskId
        && task.projectId === (effectiveProjectId || null)
        && resolveTaskGroup(task, states) !== 'cancelled'
      ))
      .map((task) => ({ value: task.id, label: task.title, tone: 'blue' as const })),
  ];
  const [dueHour = '', dueMinute = '00'] = dueTime.split(':');

  const selectedStateOptions = stateOptions(states);
  const selectedState = states.find((state) => state.id === stateId);
  /** 当前选中状态所属的状态组。状态定义缺失时回退到反规范化的 stateGroup 或旧 status。 */
  const selectedGroup: StateGroup | undefined = selectedState
    ? selectedState.group
    : activeTask && (!stateId || stateId === activeTask.stateId)
      ? resolveTaskGroup(activeTask, states)
      : undefined;
  /** 某个状态组在当前作用域里的目标状态 id；没有状态定义时返回空字符串。 */
  const targetStateId = (group: StateGroup): string =>
    defaultStateFor(states, effectiveProjectId || null, group)?.id || '';

  /**
   * 选定目标状态组时的进度联动：进入 completed 组补满进度；
   * 从 completed 组移出且进度恰为 100 时清零，其余情况不动进度。
   */
  const applyStateGroup = (group: StateGroup | undefined) => {
    if (group === 'completed') {
      setProgress(100);
      return;
    }
    if (selectedGroup === 'completed' && progress === 100) setProgress(0);
  };

  const handleStateChange = (nextStateId: string) => {
    setStateId(nextStateId);
    applyStateGroup(states.find((state) => state.id === nextStateId)?.group);
  };

  const updateChecklist = (next: Subtask[]) => {
    setDescription(markdownWithChecklist(description, subtasks, next));
    setSubtasks(next);
  };
  const updateDescription = (next: string) => {
    setDescription(next);
    setSubtasks(checklistFromMarkdown(next, subtasks));
  };

  const handleCreateComment = async (replyToCommentId?: string): Promise<boolean> => {
    if (!activeTask || !commentDraft.trim() || commentSaving) return false;
    setCommentSaving(true);
    try {
      const created = await ApiService.createTaskComment(activeTask.id, commentDraft, currentUser.id, replyToCommentId);
      setComments((current) => [...current, created]);
      setCommentsError('');
      setCommentDraft('');
      return true;
    } catch (error) {
      setCommentsError(error instanceof Error ? error.message : String(error || tr("tasks:taskModal.couldNotSaveComment")));
      return false;
    } finally {
      setCommentSaving(false);
    }
  };

  const handleDeleteComment = async (comment: TaskComment) => {
    if (comment.authorId !== currentUser.id) return;
    try {
      await ApiService.deleteTaskComment(comment.id, currentUser.id);
      setComments((current) => current.filter((item) => item.id !== comment.id));
      setCommentsError('');
    } catch (error) {
      setCommentsError(error instanceof Error ? error.message : String(error || tr("tasks:taskModal.couldNotDeleteComment")));
    }
  };

  const handleContentModeChange = (nextMode: TaskContentMode) => {
    if (nextMode === contentMode) return;
    setContentMode(nextMode);
  };

  const handleAttachmentPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []) as File[];
    if (!files.length) return;
    files.forEach((file) => {
      if (file.size > 10 * 1024 * 1024) { setSaveError(tr("tasks:taskModal.exceeds10MbAndWasNotAdded", { value0: file.name })); return; }
      const reader = new FileReader();
      reader.onload = () => setAttachments((current) => [
        ...current,
        { id: `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name: file.name, size: file.size, type: file.type, dataUrl: String(reader.result), addedAt: new Date().toISOString() },
      ]);
      reader.onerror = () => setSaveError(tr("tasks:taskModal.couldNotReadSelectItAgain", { value0: file.name }));
      reader.readAsDataURL(file);
    });
    event.target.value = '';
  };

  const handleCopyLink = async () => {
    if (!activeTask) return;
    try {
      await copyTaskReference(activeTask);
    } catch {
      window.prompt(
        tr("tasks:taskModal.copyTaskLink"),
        taskReferenceMarkdown(activeTask, taskReferenceUrl(activeTask))
      );
    }
  };

  const handleDuplicate = async () => {
    if (!activeTask) return;
    try {
      if (onDuplicateTask) {
        await onDuplicateTask(activeTask);
      } else {
        const copy = buildTaskDuplicate(activeTask, tasks, currentUser.id);
        await ApiService.saveTaskWithChildren(null, copy.task, copy.childTasks, [], currentUser.id);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleViewActivity = () => {
    if (!activeTask) return;
    setActiveDetailTab('activity');
    detailSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleDelete = async () => {
    if (!activeTask) return;
    const confirmed = window.confirm(
      tr("tasks:taskModal.deleteTaskConfirm", { value0: activeTask.title })
    );
    if (!confirmed) return;
    try {
      if (onDeleteTask) {
        await onDeleteTask(activeTask.id);
      } else {
        await ApiService.deleteTask(activeTask.id, currentUser.id);
      }
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  };

  const canEditCurrent = activeTask ? canEditTask(activeTask) : true;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || saving) return;
    if (recurrence !== 'none' && !dueDate) {
      setSaveError(tr("tasks:taskModal.setTheFirstDueDateForA"));
      return;
    }
    if (startDate && dueDate && startDate > dueDate.slice(0, 10)) {
      setSaveError(tr("tasks:taskModal.startDateCannotBeAfterTheDue"));
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const combinedDueDate = combineTaskDueDate(dueDate, dueTime);
      const normalizedRule = normalizeRecurrenceRule(
        recurrence,
        recurrenceRule ? { ...recurrenceRule, timeOfDay: dueTime || null } : null,
        combinedDueDate
      );
      const alignedDueDate = recurrence === 'none'
        ? combinedDueDate
        : alignDueDateToRecurrence(combinedDueDate, recurrence, normalizedRule);
      const reminderMinutes = reminderAdvance === 'none' ? null : Number(reminderAdvance);
      await onSaveTask({
        title,
        description,
        priority,
        stateId: stateId || undefined,
        progress,
        startDate: startDate || null,
        dueDate: alignedDueDate,
        reminderTime: calculateReminderTime(alignedDueDate, reminderMinutes),
        recurrence,
        recurrenceRule: normalizedRule,
        projectId: effectiveProjectId || null,
        parentTaskId: parentTaskId || null,
        contentMode,
        assigneeId: assigneeId || currentUser.id,
        creatorId: activeTask ? activeTask.creatorId : currentUser.id,
        isShared: isProjectScopedCreate ? true : isShared,
        sharedWith: activeTask?.sharedWith || [],
        subtasks,
        tags,
        attachments,
        childTasks: childTasks.filter((child) => {
          const original = tasks.find((task) => task.id === child.id);
          if (original && !canEditTask(original)) return false;
          return !original || ['title', 'description', 'priority', 'status', 'assigneeId', 'dueDate'].some((key) => child[key] !== original[key]);
        }).map((child) => {
          const original = tasks.find((task) => task.id === child.id);
          return { ...child, subtasks: checklistFromMarkdown(child.description, original?.subtasks), progress: child.status === 'completed' ? 100 : original?.status === 'completed' ? 0 : original?.progress || 0 };
        }),
        detachedChildIds: activeTask ? tasks.filter((task) => task.parentTaskId === activeTask.id && !childTasks.some((child) => child.id === task.id)).map((task) => task.id) : [],
      });
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : tr("tasks:taskModal.couldNotSaveTask"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-overlay backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4" role="dialog" aria-modal="true" aria-label={activeTask ? tr("tasks:taskModal.editTask") : tr("tasks:taskModal.createTask")}>
      <div className="task-detail-panel flex h-[92vh] max-h-[860px] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-edge bg-surface shadow-popover">
        <TaskDetailHeader
          project={selectedProject}
          identifier={activeTask?.identifier}
          activeTask={activeTask}
          canEdit={canEditCurrent}
          hasPrevious={hasPrevious}
          hasNext={hasNext}
          onNavigatePrevious={() => prevTask && handleNavigate(prevTask)}
          onNavigateNext={() => nextTask && handleNavigate(nextTask)}
          onCopyLink={handleCopyLink}
          onDuplicate={handleDuplicate}
          onViewActivity={handleViewActivity}
          onDelete={handleDelete}
          onClose={onClose}
        />

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col text-xs">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="grid min-h-full grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px]">
              {/* 左侧主体内容区 */}
              <section className="task-detail-content min-w-0 flex flex-col space-y-4 px-5 py-4 lg:border-r lg:border-edge">
                {/* 显眼的任务标题 */}
                <div className="pb-1">
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder={tr("tasks:taskModal.enterTaskTitle")}
                    className="w-full bg-transparent text-xl sm:text-2xl font-bold text-main placeholder:text-quiet/60 outline-none border-b border-transparent focus:border-subtle transition-colors py-1"
                  />
                </div>

                {/* 快捷属性胶囊行（状态、优先级、责任人、起止日期） */}
                <div className="py-2 border-y border-edge/60">
                  <TaskQuickPropertyChips
                    stateId={stateId}
                    states={states}
                    stateOptions={selectedStateOptions}
                    onStateChange={handleStateChange}
                    priority={priority}
                    onPriorityChange={(p) => setPriority(p)}
                    assigneeId={assigneeId}
                    assigneeOptions={assigneeSelectOptions}
                    users={users}
                    onAssigneeChange={setAssigneeId}
                    startDate={startDate}
                    onStartDateChange={setStartDate}
                    dueDate={dueDate}
                    onDueDateChange={setDueDate}
                  />
                </div>

                {/* 任务描述（Markdown / Checklist 切换） */}
                <TaskContentSection
                  contentMode={contentMode}
                  onContentModeChange={handleContentModeChange}
                  description={description}
                  onDescriptionChange={updateDescription}
                  subtasks={subtasks}
                  onUpdateChecklist={updateChecklist}
                  attachments={attachments}
                />

                {/* 子工作项区块 */}
                {!parentTaskId && (
                  <div className="border-t border-edge/60 pt-3">
                    <TaskSubWorkItemsSection
                      value={childTasks}
                      onChange={setChildTasks}
                      users={assigneeOptions}
                      defaultAssignee={assigneeId || currentUser.id}
                      canEdit={(id) => !id || Boolean(tasks.find((task) => task.id === id && canEditTask(task)))}
                      states={states}
                    />
                  </div>
                )}

                {/* 评论与活动切换区 */}
                {activeTask && (
                  <div ref={detailSectionRef} className="border-t border-edge/60 pt-3">
                    <div className="flex items-center gap-4 mb-3 border-b border-edge/60 pb-1.5">
                      <button
                        type="button"
                        onClick={() => setActiveDetailTab('comments')}
                        className={`text-xs font-semibold pb-1 transition-colors relative flex items-center gap-1.5 ${
                          activeDetailTab === 'comments'
                            ? 'text-accent border-b-2 border-accent'
                            : 'text-sub hover:text-main'
                        }`}
                      >
                        <span>{tr("tasks:taskComments.comment")}</span>
                        <span className="rounded-full bg-card px-1.5 py-0.2 text-[10px] font-medium text-sub">
                          {comments.length}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveDetailTab('activity')}
                        className={`text-xs font-semibold pb-1 transition-colors relative flex items-center gap-1.5 ${
                          activeDetailTab === 'activity'
                            ? 'text-accent border-b-2 border-accent'
                            : 'text-sub hover:text-main'
                        }`}
                      >
                        <Activity className="h-3.5 w-3.5" />
                        <span>{tr("tasks:taskActivityModal.taskActivity")}</span>
                        {typeof activityCount === 'number' && (
                          <span className="rounded-full bg-card px-1.5 py-0.2 text-[10px] font-medium text-sub">
                            {activityCount}
                          </span>
                        )}
                      </button>
                    </div>

                    {activeDetailTab === 'comments' ? (
                      <TaskComments
                        key={activeTask.id}
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
                    ) : (
                      <TaskActivityTimeline
                        key={activeTask.id}
                        task={activeTask}
                        currentUser={currentUser}
                        users={users}
                        states={states}
                        showHeader={false}
                        onCountChange={setActivityCount}
                      />
                    )}
                  </div>
                )}
              </section>

              {/* 右侧属性侧栏 */}
              <TaskPropertiesSidebar
                task={activeTask}
                projectOptions={projectOptions}
                effectiveProjectId={effectiveProjectId}
                onProjectChange={(nextProjectId) => {
                  setProjectId(nextProjectId);
                  setParentTaskId('');
                  setIsShared(Boolean(nextProjectId));
                  const nextProject = projects.find((project) => project.id === nextProjectId);
                  if (nextProject && !nextProject.members.includes(assigneeId) && !nextProject.admins.includes(assigneeId)) {
                    setAssigneeId(currentUser.id);
                  }
                }}
                isProjectDisabled={isProjectScopedCreate || childTasks.length > 0 || Boolean(activeTask && tasks.some((task) => task.parentTaskId === activeTask.id))}
                parentTaskId={parentTaskId}
                parentTaskOptions={parentTaskOptions}
                onParentTaskChange={setParentTaskId}
                isParentTaskDisabled={childTasks.length > 0 || Boolean(activeTask && tasks.some((task) => task.parentTaskId === activeTask.id))}
                progress={progress}
                onProgressChange={(next) => {
                  setProgress(next);
                  if (next === 100) {
                    if (selectedGroup !== 'cancelled') setStateId(targetStateId('completed') || stateId);
                  } else if (selectedGroup === 'completed') {
                    setStateId(targetStateId(next > 0 ? 'started' : 'unstarted') || stateId);
                  } else if (next > 0 && selectedGroup === 'unstarted') {
                    setStateId(targetStateId('started') || stateId);
                  }
                }}
                tags={tags}
                onTagsChange={setTags}
                tagSuggestions={tagSuggestions.length ? tagSuggestions : getTaskTagUsage(tasks)}
                dueDate={dueDate}
                dueTime={dueTime}
                dueHour={dueHour}
                dueMinute={dueMinute}
                onDueHourChange={(hour) => setDueTime(hour ? `${hour}:${dueMinute}` : '')}
                onDueMinuteChange={(minute) => setDueTime(`${dueHour}:${minute}`)}
                reminderAdvance={reminderAdvance}
                onReminderAdvanceChange={setReminderAdvance}
                recurrence={recurrence}
                recurrenceRule={recurrenceRule}
                onRecurrenceChange={(next) => {
                  const type = next as RecurrenceType;
                  setRecurrence(type);
                  setRecurrenceRule(normalizeRecurrenceRule(type, recurrenceRule, combineTaskDueDate(dueDate, dueTime)));
                }}
                attachments={attachments}
                onAttachmentPick={handleAttachmentPick}
                onRemoveAttachment={(id) => setAttachments((current) => current.filter((item) => item.id !== id))}
                onPreviewAttachment={setPreviewAttachment}
                users={users}
                currentUser={currentUser}
              />
            </div>
            {saveError && <div className="mx-5 mb-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-danger">{localizeMessage(saveError)}</div>}
          </div>

          {/* 底部保存与取消按钮 */}
          <div className="flex flex-shrink-0 items-center justify-end space-x-2 border-t border-edge px-5 py-3 bg-surface">
            <button
              type="button"
              onClick={onClose}
              className="ui-cancel-button px-4 py-2 rounded-md font-semibold"
            >
              {tr("tasks:taskModal.cancel")}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="theme-btn-primary px-5 py-2 font-bold rounded-md flex items-center justify-center gap-1.5 shadow-panel"
            >
              {saving ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  <span>{tr("tasks:taskModal.saving")}</span>
                </>
              ) : (
                <span>{tr("tasks:taskModal.saveTask")}</span>
              )}
            </button>
          </div>
        </form>
      </div>

      {previewAttachment && (
        <FilePreviewModal
          name={previewAttachment.name}
          type={previewAttachment.type}
          dataUrl={previewAttachment.dataUrl}
          onClose={() => setPreviewAttachment(null)}
        />
      )}

    </div>
  );
};
