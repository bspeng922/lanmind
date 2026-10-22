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
import React, { useState, useEffect, useMemo, useRef, useId } from 'react';
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
  TaskAttachment,
  TaskContentMode,
  TaskComment,
  ChildTaskDraft,
} from '../types';
import {
  defaultStateFor,
  legacyStatusToGroup,
  resolveTaskGroup,
  resolveTaskStateName,
} from '../utils/workItemState';
import { Activity, ChevronDown, MessageSquare, SlidersHorizontal } from 'lucide-react';
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
import { ThemeSelect, ThemeSelectOption } from './ThemeSelect';
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
import { TaskAttachmentsSection } from './task/TaskAttachmentsSection';
import { TaskTagsEditor } from './TaskTagsEditor';
import { stateOptions, REMINDER_OPTIONS } from './taskModalOptions';

const resizeTitleField = (field: HTMLTextAreaElement) => {
  field.style.height = 'auto';
  const borderHeight = field.offsetHeight - field.clientHeight;
  field.style.height = `${Math.min(field.scrollHeight + borderHeight, 144)}px`;
};

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
  onDeleteTask?: (taskId: string) => void | boolean | Promise<void | boolean>;
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [mobileView, setMobileView] = useState<'details' | 'properties'>('details');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const panelId = useId();

  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [mobileView]);

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => titleRef.current?.focus());
    return () => { cancelAnimationFrame(frame); previousFocus?.focus(); };
  }, [isOpen]);

  useEffect(() => {
    const field = titleRef.current;
    if (!field) return;
    resizeTitleField(field);
  }, [title, isOpen, mobileView]);

  useEffect(() => {
    const field = titleRef.current;
    if (!isOpen || !field) return;
    let lastWidth = 0;
    const observer = new ResizeObserver(() => {
      if (!field.clientWidth || field.clientWidth === lastWidth) return;
      lastWidth = field.clientWidth;
      resizeTitleField(field);
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [isOpen]);

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
    setMobileView('details');
    setActiveDetailTab('comments');
    setActivityCount(null);
    setAdvancedOpen(Boolean(activeTask && (splitTaskDueDate(activeTask.dueDate).time || activeTask.reminderTime || activeTask.recurrence && activeTask.recurrence !== 'none')));
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
        reminderMinutes !== null && REMINDER_OPTIONS.some((option) => option.value === String(reminderMinutes))
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

  const isProjectScopedCreate = !activeTask && Boolean(initialProjectId);
  const effectiveProjectId = isProjectScopedCreate ? initialProjectId! : projectId;
  const scopedStates = useMemo(() => {
    if (effectiveProjectId) {
      const matched = states.filter((s) => s.projectId === effectiveProjectId);
      if (matched.length) return matched;
    }
    const personal = states.filter((s) => !s.projectId);
    if (personal.length) return personal;
    return states;
  }, [states, effectiveProjectId]);

  if (!isOpen) return null;

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
    label: user.nickname || user.username || user.id,
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

  const selectedStateOptions = stateOptions(scopedStates);
  const selectedState = scopedStates.find((state) => state.id === stateId) || states.find((state) => state.id === stateId);
  /** 当前选中状态所属的状态组。状态定义缺失时回退到反规范化的 stateGroup 或旧 status。 */
  const selectedGroup: StateGroup | undefined = selectedState
    ? selectedState.group
    : activeTask && (!stateId || stateId === activeTask.stateId)
      ? resolveTaskGroup(activeTask, scopedStates)
      : undefined;
  /** 某个状态组在当前作用域里的目标状态 id；没有状态定义时返回空字符串。 */
  const targetStateId = (group: StateGroup): string =>
    defaultStateFor(scopedStates, effectiveProjectId || null, group)?.id || '';

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
    applyStateGroup(scopedStates.find((state) => state.id === nextStateId)?.group || states.find((state) => state.id === nextStateId)?.group);
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
    setMobileView('details');
    requestAnimationFrame(() => detailSectionRef.current?.scrollIntoView({ block: 'nearest' }));
  };

  const handleDelete = async () => {
    if (!activeTask) return;
    try {
      if (onDeleteTask) {
        if (await onDeleteTask(activeTask.id) === false) return;
      } else {
        if (!window.confirm(tr('tasks:taskModal.deleteTaskConfirm', { value0: activeTask.title }))) return;
        await ApiService.taskRecycle('trash', { id: activeTask.id, expectedVersion: activeTask.version, legacyAttachments: { [activeTask.id]: attachments } }, currentUser.id);
        localStorage.removeItem(scopedStorageKey(`lanmind_task_attachments:${activeTask.id}`));
      }
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  };

  const canEditCurrent = activeTask ? canEditTask(activeTask) : true;

  const revealSchedule = (field: 'start' | 'due') => {
    setAdvancedOpen(true);
    if (activeTask) setMobileView('properties');
    requestAnimationFrame(() => {
      const host = dialogRef.current as HTMLDivElement | null;
      const label = tr(field === 'due' ? 'tasks:taskModal.chooseDueDate' : 'tasks:taskModal.chooseStartDate');
      Array.from(host?.querySelectorAll<HTMLButtonElement>('.theme-date-picker-trigger') || []).find((button) => button.getAttribute('aria-label') === label)?.focus();
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || saving) return;
    if (recurrence !== 'none' && !dueDate) {
      setSaveError(tr("tasks:taskModal.setTheFirstDueDateForA"));
      revealSchedule('due');
      return;
    }
    if (startDate && dueDate && startDate > dueDate.slice(0, 10)) {
      setSaveError(tr("tasks:taskModal.startDateCannotBeAfterTheDue"));
      revealSchedule('start');
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

  const quickProperties = {
    stateId, states: scopedStates, stateOptions: selectedStateOptions, onStateChange: handleStateChange,
    fallbackStateLabel: activeTask ? resolveTaskStateName(activeTask, scopedStates) : undefined,
    priority, onPriorityChange: setPriority, assigneeId, assigneeOptions: assigneeSelectOptions,
    users, onAssigneeChange: setAssigneeId, startDate, onStartDateChange: (date: string | null) => setStartDate(date || ''),
    dueDate, onDueDateChange: (date: string | null) => setDueDate(date || ''),
  };
  const projectDisabled = isProjectScopedCreate || childTasks.length > 0 || Boolean(activeTask && tasks.some((task) => task.parentTaskId === activeTask.id));
  const changeProject = (nextProjectId: string) => {
    setProjectId(nextProjectId);
    setParentTaskId('');
    setIsShared(Boolean(nextProjectId));
    const nextProject = projects.find((project) => project.id === nextProjectId);
    if (nextProject && !nextProject.members.includes(assigneeId) && !nextProject.admins.includes(assigneeId)) setAssigneeId(currentUser.id);
    const targetStates = nextProjectId ? states.filter((s) => s.projectId === nextProjectId) : states.filter((s) => !s.projectId);
    if (targetStates.length > 0) {
      const fallbackState = defaultStateFor(targetStates, nextProjectId || null, selectedGroup || 'unstarted') || targetStates[0];
      if (fallbackState) setStateId(fallbackState.id);
    }
  };
  const properties = <TaskPropertiesSidebar
    key={activeTask?.id || 'create'}
    task={activeTask} mode={activeTask ? 'edit' : 'create'} quickProperties={quickProperties}
    projectOptions={projectOptions} effectiveProjectId={effectiveProjectId} onProjectChange={changeProject} isProjectDisabled={projectDisabled}
    parentTaskId={parentTaskId} parentTaskOptions={parentTaskOptions} onParentTaskChange={setParentTaskId}
    isParentTaskDisabled={childTasks.length > 0 || Boolean(activeTask && tasks.some((task) => task.parentTaskId === activeTask.id))}
    progress={progress} onProgressChange={(next) => {
      setProgress(next);
      if (next === 100) {
        if (selectedGroup !== 'cancelled') setStateId(targetStateId('completed') || stateId);
      } else if (selectedGroup === 'completed') {
        setStateId(targetStateId(next > 0 ? 'started' : 'unstarted') || stateId);
      } else if (next > 0 && selectedGroup === 'unstarted') setStateId(targetStateId('started') || stateId);
    }}
    tags={tags} onTagsChange={setTags} tagSuggestions={tagSuggestions.length ? tagSuggestions : getTaskTagUsage(tasks)}
    dueHour={dueHour} dueMinute={dueMinute}
    onDueHourChange={(hour) => setDueTime(hour ? `${hour}:${dueMinute}` : '')}
    onDueMinuteChange={(minute) => setDueTime(`${dueHour}:${minute}`)}
    reminderAdvance={reminderAdvance} onReminderAdvanceChange={setReminderAdvance}
    recurrence={recurrence} onRecurrenceChange={(type) => {
      setRecurrence(type);
      setRecurrenceRule(normalizeRecurrenceRule(type, recurrenceRule, combineTaskDueDate(dueDate, dueTime)));
    }}
    recurrenceRule={recurrenceRule}
    onRecurrenceRuleChange={setRecurrenceRule}
    advancedOpen={advancedOpen} onAdvancedOpenChange={setAdvancedOpen} users={users} currentUser={currentUser}
  />;

  return (
    <div className="task-editor-overlay">
      <div ref={dialogRef} className={`task-detail-panel task-detail-panel--${activeTask ? 'edit' : 'create'}`} role="dialog" aria-modal="true" aria-label={activeTask ? tr('tasks:taskModal.editTask') : tr('tasks:taskModal.createTask')}
        onKeyDown={(event) => {
          if (event.key !== 'Tab' || document.querySelector('.filter-select-menu')) return;
          const host = event.currentTarget as HTMLDivElement;
          const focusable = Array.from(host.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]')).filter((element) => element.getClientRects().length > 0);
          const first = focusable[0], last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }}>
        <TaskDetailHeader project={selectedProject} identifier={activeTask?.identifier} activeTask={activeTask} canEdit={canEditCurrent}
          hasPrevious={hasPrevious} hasNext={hasNext} onNavigatePrevious={() => prevTask && handleNavigate(prevTask)} onNavigateNext={() => nextTask && handleNavigate(nextTask)}
          onCopyLink={handleCopyLink} onDuplicate={handleDuplicate} onViewActivity={handleViewActivity} onDelete={handleDelete} onClose={onClose} />
        {activeTask && <div className="task-mobile-tabs" role="tablist" aria-label={tr('tasks:taskEditor.sections')}>
          {(['details', 'properties'] as const).map((view) => <button type="button" key={view} id={`${panelId}-${view}-tab`} role="tab" aria-selected={mobileView === view} aria-controls={`${panelId}-${view}`} tabIndex={mobileView === view ? 0 : -1}
            onClick={() => setMobileView(view)} onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === 'Home' ? 'details' : event.key === 'End' ? 'properties' : view === 'details' ? 'properties' : 'details';
              setMobileView(next);
              document.getElementById(`${panelId}-${next}-tab`)?.focus();
            }}>{view === 'details' ? tr('tasks:taskEditor.details') : tr('tasks:taskModal.taskProperties')}</button>)}
        </div>}
        <form onSubmit={handleSubmit} className="task-editor-form" onInvalidCapture={(event) => {
          if ((event.target as HTMLElement).closest('.task-detail-content')) {
            setMobileView('details');
            const field = event.target as HTMLElement;
            requestAnimationFrame(() => field.focus());
          }
        }}>
          <div ref={bodyRef} className="task-editor-body" data-view={mobileView}>
            <section id={`${panelId}-details`} className="task-detail-content" aria-labelledby={activeTask ? `${panelId}-details-tab` : undefined}>
              <textarea ref={titleRef} rows={1} required aria-label={tr('tasks:taskEditor.title')} value={title}
                onChange={(event) => setTitle(event.target.value.replace(/[\r\n]+/g, ' '))}
                onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); dialogRef.current?.querySelector<HTMLTextAreaElement>('.task-description-input')?.focus(); } }}
                placeholder={tr('tasks:taskModal.enterTaskTitle')} className="task-title-input" />
              <TaskContentSection key={activeTask?.id || 'create'} contentMode={contentMode} onContentModeChange={handleContentModeChange}
                description={description} onDescriptionChange={updateDescription} subtasks={subtasks} onUpdateChecklist={updateChecklist} attachments={attachments} />
              <TaskAttachmentsSection attachments={attachments} onPick={handleAttachmentPick} onRemove={(id) => setAttachments((current) => current.filter((file) => file.id !== id))} onPreview={setPreviewAttachment} />
              {!activeTask && <div className="task-create-properties"><TaskQuickPropertyChips {...quickProperties} /><TaskTagsEditor compact value={tags} onChange={setTags} suggestions={tagSuggestions.length ? tagSuggestions : getTaskTagUsage(tasks)} />
                <button type="button" className="task-expand-button task-create-more" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(!advancedOpen)}><SlidersHorizontal className="h-3.5 w-3.5" />{tr('tasks:taskEditor.moreSettings')}<ChevronDown data-open={advancedOpen} className="h-3.5 w-3.5" /></button>
                <div className="task-create-advanced" hidden={!advancedOpen}>{properties}</div>
              </div>}
              {!parentTaskId && <div className="task-content-divider"><TaskSubWorkItemsSection key={activeTask?.id || 'create'} value={childTasks} onChange={setChildTasks} users={assigneeOptions} defaultAssignee={assigneeId || currentUser.id}
                canEdit={(id) => !id || Boolean(tasks.find((task) => task.id === id && canEditTask(task)))} states={scopedStates} /></div>}
              {activeTask && <div ref={detailSectionRef} className="task-discussion task-content-divider">
                <div className="task-discussion-tabs" role="tablist" aria-label={tr('tasks:taskEditor.discussion')} onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                  event.preventDefault();
                  const next = event.key === 'Home' ? 'comments' : event.key === 'End' ? 'activity' : activeDetailTab === 'comments' ? 'activity' : 'comments';
                  setActiveDetailTab(next);
                  document.getElementById(`${panelId}-${next}-tab`)?.focus();
                }}>
                  <button type="button" role="tab" id={`${panelId}-comments-tab`} aria-selected={activeDetailTab === 'comments'} aria-controls={`${panelId}-discussion`} onClick={() => setActiveDetailTab('comments')}><MessageSquare className="h-3.5 w-3.5" />{tr('tasks:taskComments.comment')}<span className="task-section-count">{comments.length}</span></button>
                  <button type="button" role="tab" id={`${panelId}-activity-tab`} aria-selected={activeDetailTab === 'activity'} aria-controls={`${panelId}-discussion`} onClick={() => setActiveDetailTab('activity')}><Activity className="h-3.5 w-3.5" />{tr('tasks:taskActivityModal.taskActivity')}{typeof activityCount === 'number' && <span className="task-section-count">{activityCount}</span>}</button>
                </div>
                <div id={`${panelId}-discussion`} role="tabpanel" aria-labelledby={`${panelId}-${activeDetailTab}-tab`}>
                  <div hidden={activeDetailTab !== 'comments'}><TaskComments key={activeTask.id} embedded comments={comments} users={users} currentUserId={currentUser.id} loading={commentsLoading} error={commentsError}
                    draft={commentDraft} onDraftChange={setCommentDraft} saving={commentSaving} onSubmit={handleCreateComment} onDelete={handleDeleteComment} /></div>
                  {activeDetailTab === 'activity' && <TaskActivityTimeline key={activeTask.id} task={activeTask} currentUser={currentUser} users={users} states={states} showHeader={false} onCountChange={setActivityCount} />}
                </div>
              </div>}
            </section>
            {activeTask && <div id={`${panelId}-properties`} className="task-properties-panel" aria-labelledby={`${panelId}-properties-tab`}>{properties}</div>}
          </div>
          {saveError && <div className="task-save-error" role="alert">{localizeMessage(saveError)}</div>}
          <footer className="task-editor-footer">
            {!activeTask && <div className="task-create-project"><ThemeSelect portal searchable value={effectiveProjectId || ''} options={projectOptions} disabled={projectDisabled} onChange={changeProject} ariaLabel={tr('tasks:taskModal.chooseTaskProject')} /></div>}
            <div className="task-footer-actions"><button type="button" onClick={onClose} className="ui-cancel-button">{tr('tasks:taskModal.cancel')}</button>
              <button type="submit" disabled={saving || !canEditCurrent} className="theme-btn-primary">{saving ? <><span className="task-save-spinner" />{tr('tasks:taskModal.saving')}</> : activeTask ? tr('tasks:taskEditor.saveChanges') : tr('tasks:taskModal.createTask')}</button>
            </div>
          </footer>
        </form>
      </div>
      {previewAttachment && <FilePreviewModal name={previewAttachment.name} type={previewAttachment.type} dataUrl={previewAttachment.dataUrl} onClose={() => setPreviewAttachment(null)} />}
    </div>
  );
};
