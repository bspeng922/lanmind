import { localizeMessage } from '../i18n/messages';
import { tr, useLocale } from "../i18n";
import React, { useState, useEffect } from 'react';
import {
  Task,
  Project,
  User,
  Priority,
  TaskStatus,
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
  X,
  Plus,
  Trash2,
  Calendar,
  UserCheck,
  Folder,
  Share2,
  CheckSquare,
  Repeat,
  Bell,
  Clock3,
  FileText,
  AlignLeft,
  Flag,
  Activity,
  ListChecks,
  CircleHelp,
  Paperclip,
  Link2,
  Percent,
  Eye,
} from 'lucide-react';
import { TaskComments } from './TaskComments';
import {
  calculateReminderTime,
  combineTaskDueDate,
  inferReminderMinutes,
  formatLocalTaskDateTime,
  splitTaskDueDate,
} from '../utils/taskDateTime';
import { ThemeSelect as BaseThemeSelect, ThemeSelectOption, ThemeSelectProps } from './ThemeSelect';
import { ThemeDatePicker } from './ThemeDatePicker';
import { ThemeCheckbox } from './ThemeCheckbox';
import {
  alignDueDateToRecurrence,
  formatRecurrenceLabel,
  normalizeRecurrenceRule,
} from '../utils/recurrence';
import { formatFileSize } from '../utils/fileTransfer';
import { getTaskTagUsage, TaskTagUsage } from '../utils/taskTags';
import { TaskTagsEditor } from './TaskTagsEditor';
import { TaskDescriptionEditor } from './TaskDescriptionEditor';
import { ApiService } from '../services/api';
import { ChildTasksEditor } from './ChildTasksEditor';
import { checklistFromMarkdown, markdownWithChecklist, reconcileTaskChecklist } from '../utils/taskChecklist';
import { FilePreviewModal } from './FilePreviewModal';
import { TaskMarkdown } from './TaskMarkdown';
import { createId } from '../utils/createId';

const ThemeSelect: React.FC<ThemeSelectProps> = (props: ThemeSelectProps) => <BaseThemeSelect {...props} portal />;

const PRIORITY_OPTIONS: ThemeSelectOption[] = [
  { value: 'P1', get label() { return tr("tasks:taskModal.p1Urgent"); }, tone: 'rose', indicator: 'flag' },
  { value: 'P2', get label() { return tr("tasks:taskModal.p2High"); }, tone: 'amber', indicator: 'flag' },
  { value: 'P3', get label() { return tr("tasks:taskModal.p3Normal"); }, tone: 'blue', indicator: 'flag' },
  { value: 'P4', get label() { return tr("tasks:taskModal.p4Low"); }, tone: 'slate', indicator: 'flag' },
];

const STATUS_OPTIONS: ThemeSelectOption[] = [
  { value: 'todo', get label() { return tr("tasks:taskModal.notStarted"); }, tone: 'slate' },
  { value: 'in_progress', get label() { return tr("tasks:taskModal.inProgress"); }, tone: 'blue' },
  { value: 'completed', get label() { return tr("tasks:taskModal.completed"); }, tone: 'emerald' },
  { value: 'blocked', get label() { return tr("tasks:taskModal.blocked"); }, tone: 'rose' },
  { value: 'abandoned', get label() { return tr("tasks:taskModal.abandoned"); }, tone: 'slate' },
];

const REMINDER_OPTIONS: ThemeSelectOption[] = [
  { value: 'none', get label() { return tr("tasks:taskModal.noReminder"); }, tone: 'slate' },
  { value: '0', get label() { return tr("tasks:taskModal.atDueTime"); }, tone: 'blue' },
  { value: '5', get label() { return tr("tasks:taskModal.5MinutesBefore"); }, tone: 'amber' },
  { value: '10', get label() { return tr("tasks:taskModal.10MinutesBefore"); }, tone: 'amber' },
  { value: '15', get label() { return tr("tasks:taskModal.15MinutesBefore"); }, tone: 'amber' },
  { value: '30', get label() { return tr("tasks:taskModal.30MinutesBefore"); }, tone: 'amber' },
];

const RECURRENCE_OPTIONS: ThemeSelectOption[] = [
  { value: 'none', get label() { return tr("tasks:taskModal.doesNotRepeat"); }, tone: 'slate' },
  { value: 'daily', get label() { return tr("tasks:taskModal.daily"); }, tone: 'blue' },
  { value: 'weekly', get label() { return tr("tasks:taskModal.weekly"); }, tone: 'blue' },
  { value: 'monthly', get label() { return tr("tasks:taskModal.monthly"); }, tone: 'blue' },
  { value: 'yearly', get label() { return tr("tasks:taskModal.yearly"); }, tone: 'blue' },
];

const WEEKDAY_OPTIONS: Array<{ value: RecurrenceWeekday; label: string }> = [
  { value: 1, get label() { return tr("tasks:taskModal.mon"); } },
  { value: 2, get label() { return tr("tasks:taskModal.tue"); } },
  { value: 3, get label() { return tr("tasks:taskModal.wed"); } },
  { value: 4, get label() { return tr("tasks:taskModal.thu"); } },
  { value: 5, get label() { return tr("tasks:taskModal.fri"); } },
  { value: 6, get label() { return tr("tasks:taskModal.sat"); } },
  { value: 7, get label() { return tr("tasks:taskModal.sun"); } },
];

const HOUR_OPTIONS: ThemeSelectOption[] = [
  { value: '', get label() { return tr("tasks:taskModal.notSet"); }, tone: 'slate' },
  ...Array.from({ length: 24 }, (_, hour) => {
    const value = String(hour).padStart(2, '0');
    return { value, label: tr("tasks:taskModal.h", { value0: value }), tone: 'blue' as const };
  }),
];

const MINUTE_OPTIONS: ThemeSelectOption[] = Array.from({ length: 60 }, (_, minute) => {
  const value = String(minute).padStart(2, '0');
  return { value, label: tr("tasks:taskModal.min", { value0: value }), tone: 'blue' as const };
});


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
  tagSuggestions?: TaskTagUsage[];
  canEditTask?: (task: Task) => boolean;
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
  tagSuggestions = [],
  canEditTask = () => true,
}: TaskModalProps) => {
  useLocale();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('P4');
  const [status, setStatus] = useState<TaskStatus>('todo');
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
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
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

  useEffect(() => {
    if (!isOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !previewAttachment && !document.querySelector(tr("tasks:taskModal.ariaLabelTaskDetails"))) onClose();
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
    setCommentsLoading(Boolean(taskToEdit));
    setCommentsError('');
    setPreviewAttachment(null);
    setChildTasks((taskToEdit ? tasks.filter((task) => task.parentTaskId === taskToEdit.id) : []).map((task) => ({
      draftId: task.id, id: task.id, version: task.version, title: task.title, description: reconcileTaskChecklist(task.description || '', task.subtasks || []).description,
      priority: task.priority, status: task.status, assigneeId: task.assigneeId, dueDate: task.dueDate,
    })));
    setNewSubtaskTitle('');
    if (taskToEdit) {
      const dueParts = splitTaskDueDate(taskToEdit.dueDate);
      const reminderMinutes = inferReminderMinutes(taskToEdit.dueDate, taskToEdit.reminderTime);
      setTitle(taskToEdit.title);
      const content = reconcileTaskChecklist(taskToEdit.description || '', taskToEdit.subtasks || []);
      setDescription(content.description);
      setPriority(taskToEdit.priority);
      setStatus(taskToEdit.status);
      setProgress(taskToEdit.progress ?? (taskToEdit.status === 'completed' ? 100 : 0));
      setStartDate(taskToEdit.startDate?.slice(0, 10) || '');
      setDueDate(dueParts.date);
      setDueTime(dueParts.time);
      setReminderAdvance(
        reminderMinutes !== null && [0, 5, 10, 15, 30].includes(reminderMinutes)
          ? String(reminderMinutes)
          : 'none'
      );
      setRecurrence(taskToEdit.recurrence || 'none');
      setRecurrenceRule(
        normalizeRecurrenceRule(
          taskToEdit.recurrence || 'none',
          taskToEdit.recurrenceRule,
          taskToEdit.dueDate
        )
      );
      setProjectId(taskToEdit.projectId || '');
      setParentTaskId(taskToEdit.parentTaskId || '');
      setContentMode(taskToEdit.contentMode || 'markdown');
      setAssigneeId(taskToEdit.assigneeId || currentUser.id);
      setIsShared(taskToEdit.isShared || false);
      setSubtasks(content.subtasks);
      setTags(taskToEdit.tags || []);
      try {
        const stored = JSON.parse(localStorage.getItem(`lanmind_task_attachments:${taskToEdit.id}`) || '[]');
        setAttachments(taskToEdit.attachments?.length ? taskToEdit.attachments : (Array.isArray(stored) ? stored : []));
      } catch { setAttachments(taskToEdit.attachments || []); }
      void ApiService.getTaskComments(taskToEdit.id, currentUser.id).then((nextComments) => {
        if (!disposed) setComments(nextComments);
      }).catch(() => {
        if (!disposed) setCommentsError(tr("tasks:taskModal.couldNotLoadCommentsReopenTheTask"));
      }).finally(() => { if (!disposed) setCommentsLoading(false); });
    } else {
      setTitle(initialTitle || '');
      setDescription('');
      setPriority('P4');
      setStatus(initialStatus || 'todo');
      setProgress(initialStatus === 'completed' ? 100 : 0);
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
  }, [taskToEdit?.id, isOpen, initialDate, initialStatus, initialProjectId, currentUser.id]);

  if (!isOpen) return null;

  const isProjectScopedCreate = !taskToEdit && Boolean(initialProjectId);
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
        task.id !== taskToEdit?.id
        && !task.parentTaskId
        && task.projectId === (effectiveProjectId || null)
        && task.status !== 'abandoned'
      ))
      .map((task) => ({ value: task.id, label: task.title, tone: 'blue' as const })),
  ];
  const [dueHour = '', dueMinute = '00'] = dueTime.split(':');

  const handleAddSubtask = () => {
    if (!newSubtaskTitle.trim()) return;
    updateChecklist([
      ...subtasks,
      { id: createId(), title: newSubtaskTitle.trim(), completed: false },
    ]);
    setNewSubtaskTitle('');
  };

  const handleRemoveSubtask = (id: string) => {
    updateChecklist(subtasks.filter((s) => s.id !== id));
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
    if (!taskToEdit || !commentDraft.trim() || commentSaving) return false;
    setCommentSaving(true);
    try {
      const created = await ApiService.createTaskComment(taskToEdit.id, commentDraft, currentUser.id, replyToCommentId);
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
        status,
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
        creatorId: taskToEdit ? taskToEdit.creatorId : currentUser.id,
        isShared: isProjectScopedCreate ? true : isShared,
        sharedWith: taskToEdit?.sharedWith || [],
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
        detachedChildIds: taskToEdit ? tasks.filter((task) => task.parentTaskId === taskToEdit.id && !childTasks.some((child) => child.id === task.id)).map((task) => task.id) : [],
      });
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : tr("tasks:taskModal.couldNotSaveTask"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-overlay backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4" role="dialog" aria-modal="true" aria-label={taskToEdit ? tr("tasks:taskModal.editTask") : tr("tasks:taskModal.createTask")}>
      <div className="task-detail-panel flex h-[90vh] max-h-[820px] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-edge bg-surface shadow-popover">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-edge px-5 py-3.5">
          <h2 className="text-sm font-bold text-main flex items-center gap-2">
            <CheckSquare className="w-4 h-4 text-info" />
            {taskToEdit ? tr("tasks:taskModal.editTask2") : tr("tasks:taskModal.createTask2")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="ui-modal-close-btn"
            title={tr("tasks:taskModal.closeEsc")}
            aria-label={tr("tasks:taskModal.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col text-xs">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="grid min-h-full grid-cols-1 lg:grid-cols-[minmax(0,1fr)_276px]">
              <section className="task-detail-content min-w-0 space-y-4 px-4 py-4 sm:px-5 lg:border-r lg:border-edge">
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 font-semibold text-sub">
                    <FileText className="h-3.5 w-3.5 text-info" />
                    <span>{tr("tasks:taskModal.taskName")}<span className="text-danger">*</span></span>
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder={tr("tasks:taskModal.enterTaskTitle")}
                    className="w-full rounded-lg border border-subtle bg-canvas px-3 py-2.5 text-sm font-semibold text-main outline-none focus:border-accent/60"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <label className="flex items-center gap-1.5 font-semibold text-sub">
                      <AlignLeft className="h-3.5 w-3.5" />
                      {tr("tasks:taskModal.content")}</label>
                    <div className="flex rounded-md border border-subtle bg-canvas p-0.5">
                      <button type="button" onClick={() => handleContentModeChange('markdown')} className={`rounded px-2.5 py-1 text-[11px] ${contentMode === 'markdown' ? 'bg-card font-semibold text-main' : 'text-sub hover:text-main'}`}>Markdown</button>
                      <button type="button" onClick={() => handleContentModeChange('checklist')} className={`rounded px-2.5 py-1 text-[11px] ${contentMode === 'checklist' ? 'bg-card font-semibold text-main' : 'text-sub hover:text-main'}`}>{tr("tasks:taskModal.checklist")}</button>
                    </div>
                  </div>
                  {contentMode === 'markdown' ? (
                    <TaskDescriptionEditor value={description} onChange={updateDescription} attachments={attachments} />
                  ) : (
                    <div className="overflow-hidden rounded-lg border border-subtle bg-canvas">
                      <div className="max-h-64 divide-y divide-edge overflow-y-auto">
                        {subtasks.map((item) => (
                          <div key={item.id} className="flex min-h-10 items-center gap-2 px-3 py-2">
                            <ThemeCheckbox id={`check-${item.id}`} checked={item.completed} onChange={(checked) => updateChecklist(subtasks.map((candidate) => candidate.id === item.id ? { ...candidate, completed: checked } : candidate))} size="sm" ariaLabel={tr("tasks:taskModal.toggleChecklistItem", { value0: item.title })} />
                            <input aria-label={tr("tasks:taskModal.checklistItem", { value0: item.title })} value={item.title} onChange={(event) => updateChecklist(subtasks.map((candidate) => candidate.id === item.id ? { ...candidate, title: event.target.value } : candidate))} className={`min-w-0 flex-1 border-0 bg-transparent text-xs ${item.completed ? 'text-quiet line-through' : 'text-main'}`} />
                            <button type="button" onClick={() => handleRemoveSubtask(item.id)} className="text-quiet hover:text-danger" title={tr("tasks:taskModal.deleteChecklistItem")}><Trash2 className="h-3.5 w-3.5" /></button>
                          </div>
                        ))}
                        {subtasks.length === 0 && <div className="px-3 py-6 text-center text-xs text-quiet">{tr("tasks:taskModal.noChecklistItems")}</div>}
                      </div>
                      <div className="flex items-center gap-2 border-t border-edge p-2">
                        <input value={newSubtaskTitle} onChange={(event) => setNewSubtaskTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); handleAddSubtask(); } }} placeholder={tr("tasks:taskModal.typeAndPressEnterToAddAn")} className="min-w-0 flex-1 bg-transparent px-1 py-1.5 text-xs text-main outline-none" />
                        <button type="button" onClick={handleAddSubtask} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-sub hover:bg-hover hover:text-main" title={tr("tasks:taskModal.addChecklistItem")}><Plus className="h-4 w-4" /></button>
                      </div>
                    </div>
                  )}
                </div>

                {!parentTaskId && <ChildTasksEditor value={childTasks} onChange={setChildTasks} users={assigneeOptions} defaultAssignee={assigneeId || currentUser.id} canEdit={(id) => !id || Boolean(tasks.find((task) => task.id === id && canEditTask(task)))} />}

                <div className="space-y-2 border-t border-edge pt-4" aria-label={tr("tasks:taskModal.taskAttachments")}>
                  <label className="flex items-center gap-1.5 font-semibold text-sub"><Paperclip className="h-3.5 w-3.5" />{tr("tasks:taskModal.attachments")}<span className="font-normal text-quiet">{tr("tasks:taskModal.upTo10MbEach")}</span></label>
                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-subtle bg-canvas/50 px-3 py-3 text-xs text-sub transition-colors hover:border-accent/60 hover:text-main">
                    <Paperclip className="h-4 w-4" /><span>{tr("tasks:taskModal.chooseFiles")}</span><input aria-label={tr("tasks:taskModal.addTaskAttachments")} type="file" multiple className="hidden" onChange={handleAttachmentPick} />
                  </label>
                  {attachments.map((file) => (
                    <div key={file.id} className="flex items-center justify-between gap-2 rounded-md border border-edge bg-canvas px-2.5 py-2">
                      <div className="flex min-w-0 items-center gap-2"><FileText className="h-3.5 w-3.5 shrink-0 text-info" /><span className="truncate text-main">{file.name}</span><span className="shrink-0 text-[10px] text-quiet">{formatFileSize(file.size)}</span></div>
                      <div className="flex shrink-0 gap-1">
                        <button type="button" onClick={() => setPreviewAttachment(file)} className="p-1 text-sub hover:text-info" title={tr("tasks:taskModal.preview", { value0: file.name })} aria-label={tr("tasks:taskModal.preview", { value0: file.name })}><Eye className="h-3.5 w-3.5" /></button>
                        <button type="button" onClick={() => setAttachments((current) => current.filter((item) => item.id !== file.id))} className="p-1 text-quiet hover:text-danger" aria-label={tr("tasks:taskModal.remove", { value0: file.name })}><X className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                  ))}
                </div>

                {taskToEdit && (
                  <TaskComments key={taskToEdit.id} comments={comments} users={users} currentUserId={currentUser.id} loading={commentsLoading} error={commentsError} draft={commentDraft} onDraftChange={setCommentDraft} saving={commentSaving} onSubmit={handleCreateComment} onDelete={handleDeleteComment} />
                )}
              </section>

              <aside className="task-detail-properties min-w-0 space-y-3.5 bg-canvas/30 px-3.5 py-4" aria-label={tr("tasks:taskModal.taskProperties")}>
                <h3 className="text-[11px] font-semibold text-quiet">{tr("tasks:taskModal.projectAndAssignee")}</h3>
                <div>
                  <label className="mb-1 flex items-center gap-1.5 font-semibold text-sub"><Folder className="h-3.5 w-3.5 text-feature" />{tr("tasks:taskModal.project")}</label>
                  <ThemeSelect ariaLabel={tr("tasks:taskModal.chooseTaskProject")} value={effectiveProjectId} options={projectOptions} disabled={isProjectScopedCreate || childTasks.length > 0 || Boolean(taskToEdit && tasks.some((task) => task.parentTaskId === taskToEdit.id))} onChange={(nextProjectId) => { setProjectId(nextProjectId); setParentTaskId(''); setIsShared(Boolean(nextProjectId)); const nextProject = projects.find((project) => project.id === nextProjectId); if (nextProject && !nextProject.members.includes(assigneeId) && !nextProject.admins.includes(assigneeId)) setAssigneeId(currentUser.id); }} />
                </div>
                <div>
                  <label className="mb-1 flex items-center gap-1.5 font-semibold text-sub"><UserCheck className="h-3.5 w-3.5 text-success" />{tr("tasks:taskModal.assignee")}</label>
                  <ThemeSelect ariaLabel={tr("tasks:taskModal.chooseTaskAssignee")} value={assigneeId} options={assigneeSelectOptions} onChange={setAssigneeId} />
                </div>
                {taskToEdit && <div>
                  <label className="mb-1 flex items-center gap-1.5 font-semibold text-sub"><Link2 className="h-3.5 w-3.5 text-info" />{tr("tasks:taskModal.parentTask")}</label>
                  <ThemeSelect ariaLabel={tr("tasks:taskModal.chooseParentTask")} value={parentTaskId} options={parentTaskOptions} disabled={childTasks.length > 0 || Boolean(taskToEdit && tasks.some((task) => task.parentTaskId === taskToEdit.id))} onChange={setParentTaskId} />
                </div>}

                <h3 className="border-t border-edge pt-4 text-[11px] font-semibold text-quiet">{tr("tasks:taskModal.statusAndPriority")}</h3>
                <div className="task-detail-property-pair">
                  <div><label className="mb-1 flex items-center gap-1 font-semibold text-sub"><Flag className="h-3.5 w-3.5 text-warning" />{tr("tasks:taskModal.priority")}</label><ThemeSelect ariaLabel={tr("tasks:taskModal.chooseTaskPriority")} value={priority} options={PRIORITY_OPTIONS} onChange={(value) => setPriority(value as Priority)} /></div>
                  <div><label className="mb-1 flex items-center gap-1 font-semibold text-sub"><Activity className="h-3.5 w-3.5 text-info" />{tr("tasks:taskModal.status")}</label><ThemeSelect ariaLabel={tr("tasks:taskModal.chooseTaskStatus")} value={status} options={STATUS_OPTIONS} onChange={(value) => { const next = value as TaskStatus; setStatus(next); if (next === 'completed') setProgress(100); else if (status === 'completed' && progress === 100) setProgress(0); }} /></div>
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between"><label className="flex items-center gap-1 font-semibold text-sub"><Percent className="h-3.5 w-3.5 text-info" />{tr("tasks:taskModal.completionProgress")}</label><span className="font-mono text-[11px] text-main">{progress}%</span></div>
                  <input type="range" min={0} max={100} step={5} value={progress} onChange={(event) => { const next = Number(event.target.value); setProgress(next); if (next === 100) setStatus('completed'); else if (status === 'completed') setStatus(next > 0 ? 'in_progress' : 'todo'); else if (next > 0 && status === 'todo') setStatus('in_progress'); }} className="w-full accent-[var(--accent)]" />
                </div>

                <h3 className="border-t border-edge pt-4 text-[11px] font-semibold text-quiet">{tr("tasks:taskModal.schedule")}</h3>
                <div className="task-detail-date-fields space-y-2">
                  <div><label className="mb-1 flex items-center gap-1 font-semibold text-sub"><Calendar className="h-3.5 w-3.5 text-info" />{tr("tasks:taskModal.startDate")}</label><ThemeDatePicker ariaLabel={tr("tasks:taskModal.chooseStartDate")} value={startDate} onChange={setStartDate} placeholder={tr("tasks:taskModal.notSet")} /></div>
                  <div><label className="mb-1 flex items-center gap-1 font-semibold text-sub"><Calendar className="h-3.5 w-3.5 text-info" />{tr("tasks:taskModal.dueDate")}</label><ThemeDatePicker ariaLabel={tr("tasks:taskModal.chooseDueDate")} value={dueDate} onChange={setDueDate} placeholder={tr("tasks:taskModal.notSet")} /></div>
                </div>
                <div className="space-y-3">
                  <div><label className="mb-1 flex items-center gap-1 font-semibold text-sub"><Clock3 className="h-3.5 w-3.5 text-info" />{tr("tasks:taskModal.dueTime")}</label><div className="grid grid-cols-2 gap-1"><ThemeSelect ariaLabel={tr("tasks:taskModal.chooseDueHour")} value={dueHour} options={HOUR_OPTIONS} onChange={(hour) => setDueTime(hour ? `${hour}:${dueMinute}` : '')} disabled={!dueDate} /><ThemeSelect ariaLabel={tr("tasks:taskModal.chooseDueMinute")} value={dueMinute} options={MINUTE_OPTIONS} onChange={(minute) => setDueTime(`${dueHour}:${minute}`)} disabled={!dueDate || !dueHour} /></div></div>
                  <div><label className="mb-1 flex items-center gap-1 font-semibold text-sub"><Bell className="h-3.5 w-3.5 text-warning" />{tr("tasks:taskModal.reminder")}</label><ThemeSelect ariaLabel={tr("tasks:taskModal.chooseTaskReminder")} value={reminderAdvance} options={REMINDER_OPTIONS} onChange={setReminderAdvance} disabled={!dueDate || !dueTime} /></div>
                </div>

                <div>
                  <label className="mb-1 flex items-center gap-1 font-semibold text-sub"><Repeat className="h-3.5 w-3.5 text-info" />{tr("tasks:taskModal.recurring")}<CircleHelp className="h-3 w-3 text-quiet" /></label>
                  <ThemeSelect ariaLabel={tr("tasks:taskModal.chooseRecurrence")} value={recurrence} options={RECURRENCE_OPTIONS} onChange={(value) => { const next = value as RecurrenceType; setRecurrence(next); setRecurrenceRule(normalizeRecurrenceRule(next, recurrenceRule, combineTaskDueDate(dueDate, dueTime))); }} />
                  {recurrence !== 'none' && recurrenceRule && (
                    <div className="mt-2 space-y-2 rounded-md border border-subtle bg-canvas p-2.5">
                      <div className="flex items-center gap-2 text-[11px] text-sub">{tr("tasks:taskModal.every")}<input type="number" min={1} max={999} value={recurrenceRule.interval} onChange={(event) => setRecurrenceRule({ ...recurrenceRule, interval: Math.max(1, Math.min(999, Number(event.target.value) || 1)) })} className="w-16 rounded border border-subtle bg-input px-2 py-1 text-main outline-none" /> {{ daily: tr("tasks:taskModal.days"), weekly: tr("tasks:taskModal.weeks"), monthly: tr("tasks:taskModal.months"), yearly: tr("tasks:taskModal.years") }[recurrence]}</div>
                      {recurrence === 'weekly' && <div className="grid grid-cols-7 gap-1">{WEEKDAY_OPTIONS.map((option) => { const selected = recurrenceRule.daysOfWeek?.includes(option.value) || false; return <button key={option.value} type="button" data-selected={selected} onClick={() => { const current = recurrenceRule.daysOfWeek || []; const next = selected ? current.filter((day) => day !== option.value) : [...current, option.value].sort((a, b) => a - b); if (next.length) setRecurrenceRule({ ...recurrenceRule, daysOfWeek: next }); }} className="recurrence-weekday rounded border py-1 text-[10px]">{option.label}</button>; })}</div>}
                      {(recurrence === 'monthly' || recurrence === 'yearly') && <div className="flex items-center gap-2 text-[11px] text-sub">{recurrence === 'yearly' && <><input aria-label={tr("tasks:taskModal.recurrenceMonth")} type="number" min={1} max={12} value={recurrenceRule.monthOfYear || 1} onChange={(event) => setRecurrenceRule({ ...recurrenceRule, monthOfYear: Math.max(1, Math.min(12, Number(event.target.value) || 1)) })} className="w-14 rounded border border-subtle bg-input px-2 py-1 text-main" />{tr("tasks:taskModal.month")}</>}<input aria-label={tr("tasks:taskModal.recurrenceDay")} type="number" min={1} max={31} value={recurrenceRule.dayOfMonth || 1} onChange={(event) => setRecurrenceRule({ ...recurrenceRule, dayOfMonth: Math.max(1, Math.min(31, Number(event.target.value) || 1)) })} className="w-14 rounded border border-subtle bg-input px-2 py-1 text-main" />{tr("tasks:taskModal.sun")}</div>}
                      <p className="text-[10px] leading-4 text-quiet">{formatRecurrenceLabel(recurrence, { ...recurrenceRule, timeOfDay: dueTime || null }, combineTaskDueDate(dueDate, dueTime))}</p>
                    </div>
                  )}
                </div>

                <h3 className="border-t border-edge pt-4 text-[11px] font-semibold text-quiet">{tr("tasks:taskModal.tagsAndSharing")}</h3>
                <TaskTagsEditor key={taskToEdit?.id || 'new'} value={tags} onChange={setTags} suggestions={tagSuggestions.length ? tagSuggestions : getTaskTagUsage(tasks)} />

                <div className="task-form-shared-panel" data-checked={isShared} onClick={() => setIsShared(!isShared)}>
                  <ThemeCheckbox id="sharedCheck" checked={isShared} onChange={setIsShared} onClick={(event) => event.stopPropagation()} size="sm" ariaLabel={tr("tasks:taskModal.toggleTaskSharing")} />
                  <label htmlFor="sharedCheck" className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-[11px] font-medium" onClick={(event) => event.stopPropagation()}><Share2 className="h-3.5 w-3.5 shrink-0 text-feature" /><span>{effectiveProjectId ? tr("tasks:taskModal.visibleToProjectMembers") : tr("tasks:taskModal.sharedOverLan")}</span></label>
                </div>
              </aside>
            </div>
            {saveError && <div className="mx-5 mb-3 rounded-md border border-rose-500/40 bg-danger/10 px-3 py-2 text-danger">{localizeMessage(saveError)}</div>}
          </div>
          <div className="flex flex-shrink-0 items-center justify-end space-x-2 border-t border-edge px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              className="ui-cancel-button px-4 py-2 rounded-md font-semibold"
            >
              {tr("tasks:taskModal.cancel")}</button>
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
      {previewAttachment && <FilePreviewModal name={previewAttachment.name} type={previewAttachment.type} dataUrl={previewAttachment.dataUrl} onClose={() => setPreviewAttachment(null)} />}
    </div>
  );
};
