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
  { value: 'P1', label: 'P1 紧急重要', tone: 'rose' },
  { value: 'P2', label: 'P2 重要', tone: 'amber' },
  { value: 'P3', label: 'P3 普通', tone: 'blue' },
  { value: 'P4', label: 'P4 低优', tone: 'slate' },
];

const STATUS_OPTIONS: ThemeSelectOption[] = [
  { value: 'todo', label: '未开始', tone: 'slate' },
  { value: 'in_progress', label: '进行中', tone: 'blue' },
  { value: 'completed', label: '已完成', tone: 'emerald' },
  { value: 'blocked', label: '已阻塞', tone: 'rose' },
  { value: 'abandoned', label: '已放弃', tone: 'slate' },
];

const REMINDER_OPTIONS: ThemeSelectOption[] = [
  { value: 'none', label: '不提醒', tone: 'slate' },
  { value: '0', label: '到期时提醒', tone: 'blue' },
  { value: '5', label: '到期前 5 分钟', tone: 'amber' },
  { value: '10', label: '到期前 10 分钟', tone: 'amber' },
  { value: '15', label: '到期前 15 分钟', tone: 'amber' },
  { value: '30', label: '到期前 30 分钟', tone: 'amber' },
];

const RECURRENCE_OPTIONS: ThemeSelectOption[] = [
  { value: 'none', label: '不重复（单次）', tone: 'slate' },
  { value: 'daily', label: '每天重复 Daily', tone: 'blue' },
  { value: 'weekly', label: '每周重复 Weekly', tone: 'blue' },
  { value: 'monthly', label: '每月重复 Monthly', tone: 'blue' },
  { value: 'yearly', label: '每年重复 Yearly', tone: 'blue' },
];

const WEEKDAY_OPTIONS: Array<{ value: RecurrenceWeekday; label: string }> = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 7, label: '日' },
];

const HOUR_OPTIONS: ThemeSelectOption[] = [
  { value: '', label: '未设置', tone: 'slate' },
  ...Array.from({ length: 24 }, (_, hour) => {
    const value = String(hour).padStart(2, '0');
    return { value, label: `${value} 时`, tone: 'blue' as const };
  }),
];

const MINUTE_OPTIONS: ThemeSelectOption[] = Array.from({ length: 60 }, (_, minute) => {
  const value = String(minute).padStart(2, '0');
  return { value, label: `${value} 分`, tone: 'blue' as const };
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
      if (event.key === 'Escape' && !event.defaultPrevented && !previewAttachment && !document.querySelector('[aria-label="任务信息"]')) onClose();
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
        if (!disposed) setCommentsError('评论暂时无法读取，请稍后重新打开任务。');
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
      setTags(['日常']);
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
    { value: '', label: '个人任务（不归属项目）', tone: 'slate' },
    ...projects.map((project) => ({ value: project.id, label: project.name, tone: 'blue' as const })),
  ];
  const assigneeSelectOptions: ThemeSelectOption[] = assigneeOptions.map((user) => ({
    value: user.id,
    label: `${user.nickname} (${user.id})`,
    tone: user.id === currentUser.id ? 'emerald' : 'blue',
  }));
  const parentTaskOptions: ThemeSelectOption[] = [
    { value: '', label: '不关联主任务', tone: 'slate' },
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
      setCommentsError(error instanceof Error ? error.message : String(error || '评论保存失败'));
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
      setCommentsError(error instanceof Error ? error.message : String(error || '评论删除失败'));
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
      if (file.size > 10 * 1024 * 1024) { setSaveError(`${file.name} 超过 10 MB，未添加`); return; }
      const reader = new FileReader();
      reader.onload = () => setAttachments((current) => [
        ...current,
        { id: `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name: file.name, size: file.size, type: file.type, dataUrl: String(reader.result), addedAt: new Date().toISOString() },
      ]);
      reader.onerror = () => setSaveError(`${file.name} 读取失败，请重新选择`);
      reader.readAsDataURL(file);
    });
    event.target.value = '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || saving) return;
    if (recurrence !== 'none' && !dueDate) {
      setSaveError('循环任务需要设置首次到期日期，完成后会按周期生成下一次任务。');
      return;
    }
    if (startDate && dueDate && startDate > dueDate.slice(0, 10)) {
      setSaveError('开始日期不能晚于到期日期。');
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
      setSaveError(error instanceof Error ? error.message : '保存任务失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-overlay backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4" role="dialog" aria-modal="true" aria-label={taskToEdit ? '编辑任务' : '创建任务'}>
      <div className="task-detail-panel flex h-[90vh] max-h-[820px] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-edge bg-surface shadow-popover">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-edge px-5 py-3.5">
          <h2 className="text-sm font-bold text-main flex items-center gap-2">
            <CheckSquare className="w-4 h-4 text-info" />
            {taskToEdit ? '编辑局域网任务' : '创建新任务'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="ui-modal-close-btn"
            title="关闭 (Esc)"
            aria-label="关闭"
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
                    <span>任务名称 <span className="text-danger">*</span></span>
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="请输入任务标题..."
                    className="w-full rounded-lg border border-subtle bg-canvas px-3 py-2.5 text-sm font-semibold text-main outline-none focus:border-accent/60"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <label className="flex items-center gap-1.5 font-semibold text-sub">
                      <AlignLeft className="h-3.5 w-3.5" />
                      内容
                    </label>
                    <div className="flex rounded-md border border-subtle bg-canvas p-0.5">
                      <button type="button" onClick={() => handleContentModeChange('markdown')} className={`rounded px-2.5 py-1 text-[11px] ${contentMode === 'markdown' ? 'bg-card font-semibold text-main' : 'text-sub hover:text-main'}`}>Markdown</button>
                      <button type="button" onClick={() => handleContentModeChange('checklist')} className={`rounded px-2.5 py-1 text-[11px] ${contentMode === 'checklist' ? 'bg-card font-semibold text-main' : 'text-sub hover:text-main'}`}>检查事项</button>
                    </div>
                  </div>
                  {contentMode === 'markdown' ? (
                    <TaskDescriptionEditor value={description} onChange={updateDescription} attachments={attachments} />
                  ) : (
                    <div className="overflow-hidden rounded-lg border border-subtle bg-canvas">
                      <div className="max-h-64 divide-y divide-edge overflow-y-auto">
                        {subtasks.map((item) => (
                          <div key={item.id} className="flex min-h-10 items-center gap-2 px-3 py-2">
                            <ThemeCheckbox id={`check-${item.id}`} checked={item.completed} onChange={(checked) => updateChecklist(subtasks.map((candidate) => candidate.id === item.id ? { ...candidate, completed: checked } : candidate))} size="sm" ariaLabel={`切换检查事项：${item.title}`} />
                            <input aria-label={`检查事项：${item.title}`} value={item.title} onChange={(event) => updateChecklist(subtasks.map((candidate) => candidate.id === item.id ? { ...candidate, title: event.target.value } : candidate))} className={`min-w-0 flex-1 border-0 bg-transparent text-xs ${item.completed ? 'text-quiet line-through' : 'text-main'}`} />
                            <button type="button" onClick={() => handleRemoveSubtask(item.id)} className="text-quiet hover:text-danger" title="删除检查事项"><Trash2 className="h-3.5 w-3.5" /></button>
                          </div>
                        ))}
                        {subtasks.length === 0 && <div className="px-3 py-6 text-center text-xs text-quiet">暂无检查事项</div>}
                      </div>
                      <div className="flex items-center gap-2 border-t border-edge p-2">
                        <input value={newSubtaskTitle} onChange={(event) => setNewSubtaskTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); handleAddSubtask(); } }} placeholder="输入后按 Enter 添加检查事项" className="min-w-0 flex-1 bg-transparent px-1 py-1.5 text-xs text-main outline-none" />
                        <button type="button" onClick={handleAddSubtask} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-sub hover:bg-hover hover:text-main" title="添加检查事项"><Plus className="h-4 w-4" /></button>
                      </div>
                    </div>
                  )}
                </div>

                {!parentTaskId && <ChildTasksEditor value={childTasks} onChange={setChildTasks} users={assigneeOptions} defaultAssignee={assigneeId || currentUser.id} canEdit={(id) => !id || Boolean(tasks.find((task) => task.id === id && canEditTask(task)))} />}

                <div className="space-y-2 border-t border-edge pt-4" aria-label="任务附件">
                  <label className="flex items-center gap-1.5 font-semibold text-sub"><Paperclip className="h-3.5 w-3.5" />附件 <span className="font-normal text-quiet">单个不超过 10 MB</span></label>
                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-subtle bg-canvas/50 px-3 py-3 text-xs text-sub transition-colors hover:border-accent/60 hover:text-main">
                    <Paperclip className="h-4 w-4" /><span>选择文件</span><input aria-label="添加任务附件" type="file" multiple className="hidden" onChange={handleAttachmentPick} />
                  </label>
                  {attachments.map((file) => (
                    <div key={file.id} className="flex items-center justify-between gap-2 rounded-md border border-edge bg-canvas px-2.5 py-2">
                      <div className="flex min-w-0 items-center gap-2"><FileText className="h-3.5 w-3.5 shrink-0 text-info" /><span className="truncate text-main">{file.name}</span><span className="shrink-0 text-[10px] text-quiet">{formatFileSize(file.size)}</span></div>
                      <div className="flex shrink-0 gap-1">
                        <button type="button" onClick={() => setPreviewAttachment(file)} className="p-1 text-sub hover:text-info" title={`预览 ${file.name}`} aria-label={`预览 ${file.name}`}><Eye className="h-3.5 w-3.5" /></button>
                        <button type="button" onClick={() => setAttachments((current) => current.filter((item) => item.id !== file.id))} className="p-1 text-quiet hover:text-danger" aria-label={`移除 ${file.name}`}><X className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                  ))}
                </div>

                {taskToEdit && (
                  <TaskComments key={taskToEdit.id} comments={comments} users={users} currentUserId={currentUser.id} loading={commentsLoading} error={commentsError} draft={commentDraft} onDraftChange={setCommentDraft} saving={commentSaving} onSubmit={handleCreateComment} onDelete={handleDeleteComment} />
                )}
              </section>

              <aside className="task-detail-properties min-w-0 space-y-3.5 bg-canvas/30 px-3.5 py-4" aria-label="任务属性">
                <h3 className="text-[11px] font-semibold text-quiet">归属与负责人</h3>
                <div>
                  <label className="mb-1 flex items-center gap-1.5 font-semibold text-sub"><Folder className="h-3.5 w-3.5 text-feature" />归属项目</label>
                  <ThemeSelect ariaLabel="选择任务归属项目" value={effectiveProjectId} options={projectOptions} disabled={isProjectScopedCreate || childTasks.length > 0 || Boolean(taskToEdit && tasks.some((task) => task.parentTaskId === taskToEdit.id))} onChange={(nextProjectId) => { setProjectId(nextProjectId); setParentTaskId(''); setIsShared(Boolean(nextProjectId)); const nextProject = projects.find((project) => project.id === nextProjectId); if (nextProject && !nextProject.members.includes(assigneeId) && !nextProject.admins.includes(assigneeId)) setAssigneeId(currentUser.id); }} />
                </div>
                <div>
                  <label className="mb-1 flex items-center gap-1.5 font-semibold text-sub"><UserCheck className="h-3.5 w-3.5 text-success" />负责人</label>
                  <ThemeSelect ariaLabel="选择任务负责人" value={assigneeId} options={assigneeSelectOptions} onChange={setAssigneeId} />
                </div>
                {taskToEdit && <div>
                  <label className="mb-1 flex items-center gap-1.5 font-semibold text-sub"><Link2 className="h-3.5 w-3.5 text-info" />主任务</label>
                  <ThemeSelect ariaLabel="选择关联的主任务" value={parentTaskId} options={parentTaskOptions} disabled={childTasks.length > 0 || Boolean(taskToEdit && tasks.some((task) => task.parentTaskId === taskToEdit.id))} onChange={setParentTaskId} />
                </div>}

                <h3 className="border-t border-edge pt-4 text-[11px] font-semibold text-quiet">状态与优先级</h3>
                <div className="task-detail-property-pair">
                  <div><label className="mb-1 flex items-center gap-1 font-semibold text-sub"><Flag className="h-3.5 w-3.5 text-warning" />优先级</label><ThemeSelect ariaLabel="选择任务优先级" value={priority} options={PRIORITY_OPTIONS} onChange={(value) => setPriority(value as Priority)} /></div>
                  <div><label className="mb-1 flex items-center gap-1 font-semibold text-sub"><Activity className="h-3.5 w-3.5 text-info" />状态</label><ThemeSelect ariaLabel="选择任务状态" value={status} options={STATUS_OPTIONS} onChange={(value) => { const next = value as TaskStatus; setStatus(next); if (next === 'completed') setProgress(100); else if (status === 'completed' && progress === 100) setProgress(0); }} /></div>
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between"><label className="flex items-center gap-1 font-semibold text-sub"><Percent className="h-3.5 w-3.5 text-info" />完成进度</label><span className="font-mono text-[11px] text-main">{progress}%</span></div>
                  <input type="range" min={0} max={100} step={5} value={progress} onChange={(event) => { const next = Number(event.target.value); setProgress(next); if (next === 100) setStatus('completed'); else if (status === 'completed') setStatus(next > 0 ? 'in_progress' : 'todo'); else if (next > 0 && status === 'todo') setStatus('in_progress'); }} className="w-full accent-[var(--accent)]" />
                </div>

                <h3 className="border-t border-edge pt-4 text-[11px] font-semibold text-quiet">时间安排</h3>
                <div className="task-detail-property-pair">
                  <div><label className="mb-1 flex items-center gap-1 font-semibold text-sub"><Calendar className="h-3.5 w-3.5 text-info" />开始日期</label><ThemeDatePicker ariaLabel="选择任务开始日期" value={startDate} onChange={setStartDate} placeholder="未设置" /></div>
                  <div><label className="mb-1 flex items-center gap-1 font-semibold text-sub"><Calendar className="h-3.5 w-3.5 text-info" />到期日期</label><ThemeDatePicker ariaLabel="选择任务到期日期" value={dueDate} onChange={setDueDate} placeholder="未设置" /></div>
                </div>
                <div className="space-y-3">
                  <div><label className="mb-1 flex items-center gap-1 font-semibold text-sub"><Clock3 className="h-3.5 w-3.5 text-info" />到期时间</label><div className="grid grid-cols-2 gap-1"><ThemeSelect ariaLabel="选择到期小时" value={dueHour} options={HOUR_OPTIONS} onChange={(hour) => setDueTime(hour ? `${hour}:${dueMinute}` : '')} disabled={!dueDate} /><ThemeSelect ariaLabel="选择到期分钟" value={dueMinute} options={MINUTE_OPTIONS} onChange={(minute) => setDueTime(`${dueHour}:${minute}`)} disabled={!dueDate || !dueHour} /></div></div>
                  <div><label className="mb-1 flex items-center gap-1 font-semibold text-sub"><Bell className="h-3.5 w-3.5 text-warning" />提醒</label><ThemeSelect ariaLabel="选择任务提醒" value={reminderAdvance} options={REMINDER_OPTIONS} onChange={setReminderAdvance} disabled={!dueDate || !dueTime} /></div>
                </div>

                <div>
                  <label className="mb-1 flex items-center gap-1 font-semibold text-sub"><Repeat className="h-3.5 w-3.5 text-info" />循环 <CircleHelp className="h-3 w-3 text-quiet" /></label>
                  <ThemeSelect ariaLabel="选择循环频率" value={recurrence} options={RECURRENCE_OPTIONS} onChange={(value) => { const next = value as RecurrenceType; setRecurrence(next); setRecurrenceRule(normalizeRecurrenceRule(next, recurrenceRule, combineTaskDueDate(dueDate, dueTime))); }} />
                  {recurrence !== 'none' && recurrenceRule && (
                    <div className="mt-2 space-y-2 rounded-md border border-subtle bg-canvas p-2.5">
                      <div className="flex items-center gap-2 text-[11px] text-sub">每隔 <input type="number" min={1} max={999} value={recurrenceRule.interval} onChange={(event) => setRecurrenceRule({ ...recurrenceRule, interval: Math.max(1, Math.min(999, Number(event.target.value) || 1)) })} className="w-16 rounded border border-subtle bg-input px-2 py-1 text-main outline-none" /> {{ daily: '天', weekly: '周', monthly: '个月', yearly: '年' }[recurrence]}</div>
                      {recurrence === 'weekly' && <div className="grid grid-cols-7 gap-1">{WEEKDAY_OPTIONS.map((option) => { const selected = recurrenceRule.daysOfWeek?.includes(option.value) || false; return <button key={option.value} type="button" data-selected={selected} onClick={() => { const current = recurrenceRule.daysOfWeek || []; const next = selected ? current.filter((day) => day !== option.value) : [...current, option.value].sort((a, b) => a - b); if (next.length) setRecurrenceRule({ ...recurrenceRule, daysOfWeek: next }); }} className="recurrence-weekday rounded border py-1 text-[10px]">{option.label}</button>; })}</div>}
                      {(recurrence === 'monthly' || recurrence === 'yearly') && <div className="flex items-center gap-2 text-[11px] text-sub">{recurrence === 'yearly' && <><input aria-label="循环月份" type="number" min={1} max={12} value={recurrenceRule.monthOfYear || 1} onChange={(event) => setRecurrenceRule({ ...recurrenceRule, monthOfYear: Math.max(1, Math.min(12, Number(event.target.value) || 1)) })} className="w-14 rounded border border-subtle bg-input px-2 py-1 text-main" />月</>}<input aria-label="循环日期" type="number" min={1} max={31} value={recurrenceRule.dayOfMonth || 1} onChange={(event) => setRecurrenceRule({ ...recurrenceRule, dayOfMonth: Math.max(1, Math.min(31, Number(event.target.value) || 1)) })} className="w-14 rounded border border-subtle bg-input px-2 py-1 text-main" />日</div>}
                      <p className="text-[10px] leading-4 text-quiet">{formatRecurrenceLabel(recurrence, { ...recurrenceRule, timeOfDay: dueTime || null }, combineTaskDueDate(dueDate, dueTime))}</p>
                    </div>
                  )}
                </div>

                <h3 className="border-t border-edge pt-4 text-[11px] font-semibold text-quiet">标签与共享</h3>
                <TaskTagsEditor key={taskToEdit?.id || 'new'} value={tags} onChange={setTags} suggestions={tagSuggestions.length ? tagSuggestions : getTaskTagUsage(tasks)} />

                <div className="task-form-shared-panel" data-checked={isShared} onClick={() => setIsShared(!isShared)}>
                  <ThemeCheckbox id="sharedCheck" checked={isShared} onChange={setIsShared} onClick={(event) => event.stopPropagation()} size="sm" ariaLabel="切换任务共享" />
                  <label htmlFor="sharedCheck" className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-[11px] font-medium" onClick={(event) => event.stopPropagation()}><Share2 className="h-3.5 w-3.5 shrink-0 text-feature" /><span>{effectiveProjectId ? '项目成员可见' : '局域网共享'}</span></label>
                </div>
              </aside>
            </div>
            {saveError && <div className="mx-5 mb-3 rounded-md border border-rose-500/40 bg-danger/10 px-3 py-2 text-danger">{saveError}</div>}
          </div>
          <div className="flex flex-shrink-0 items-center justify-end space-x-2 border-t border-edge px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              className="ui-cancel-button px-4 py-2 rounded-md font-semibold"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="theme-btn-primary px-5 py-2 font-bold rounded-md flex items-center justify-center gap-1.5 shadow-panel"
            >
              {saving ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  <span>正在保存...</span>
                </>
              ) : (
                <span>保存任务</span>
              )}
            </button>
          </div>
        </form>
      </div>
      {previewAttachment && <FilePreviewModal name={previewAttachment.name} type={previewAttachment.type} dataUrl={previewAttachment.dataUrl} onClose={() => setPreviewAttachment(null)} />}
    </div>
  );
};
