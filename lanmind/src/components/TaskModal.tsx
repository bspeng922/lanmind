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
} from '../types';
import {
  X,
  Plus,
  Trash2,
  Calendar,
  UserCheck,
  Folder,
  Tag,
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
} from 'lucide-react';
import {
  calculateReminderTime,
  combineTaskDueDate,
  inferReminderMinutes,
  formatLocalTaskDateTime,
  splitTaskDueDate,
} from '../utils/taskDateTime';
import { ThemeSelect, ThemeSelectOption } from './ThemeSelect';
import { ThemeDatePicker } from './ThemeDatePicker';
import { ThemeCheckbox } from './ThemeCheckbox';
import {
  alignDueDateToRecurrence,
  formatRecurrenceLabel,
  normalizeRecurrenceRule,
} from '../utils/recurrence';
import { formatFileSize } from '../utils/fileTransfer';
import { TaskTagUsage } from '../utils/taskTags';

const PRIORITY_OPTIONS: ThemeSelectOption[] = [
  { value: 'P1', label: 'P1（紧急重要）', tone: 'rose' },
  { value: 'P2', label: 'P2（重要）', tone: 'amber' },
  { value: 'P3', label: 'P3（普通）', tone: 'blue' },
  { value: 'P4', label: 'P4（低优）', tone: 'slate' },
];

const STATUS_OPTIONS: ThemeSelectOption[] = [
  { value: 'todo', label: '未开始 Todo', tone: 'slate' },
  { value: 'in_progress', label: '进行中 In Progress', tone: 'blue' },
  { value: 'completed', label: '已完成 Completed', tone: 'emerald' },
  { value: 'blocked', label: '已阻塞 Blocked', tone: 'rose' },
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

const MAX_TAG_SUGGESTIONS = 12;

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskToEdit?: Task | null;
  projects: Project[];
  users: User[];
  currentUser: User;
  onSaveTask: (taskData: any) => Promise<void>;
  initialDate?: string;
  initialStatus?: TaskStatus;
  initialProjectId?: string;
  initialTitle?: string;
  tagSuggestions?: TaskTagUsage[];
}

export const TaskModal: React.FC<TaskModalProps> = ({
  isOpen,
  onClose,
  taskToEdit,
  projects,
  users,
  currentUser,
  onSaveTask,
  initialDate,
  initialStatus,
  initialProjectId,
  initialTitle,
  tagSuggestions = [],
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('P4');
  const [status, setStatus] = useState<TaskStatus>('todo');
  const [dueDate, setDueDate] = useState<string>('');
  const [dueTime, setDueTime] = useState<string>('');
  const [reminderAdvance, setReminderAdvance] = useState<string>('0');
  const [recurrence, setRecurrence] = useState<RecurrenceType>('none');
  const [recurrenceRule, setRecurrenceRule] = useState<RecurrenceRule | null>(null);
  const [projectId, setProjectId] = useState<string>('');
  const [assigneeId, setAssigneeId] = useState<string>('');
  const [isShared, setIsShared] = useState<boolean>(false);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setSaveError('');
    setNewSubtaskTitle('');
    setTagInput('');
    if (taskToEdit) {
      const dueParts = splitTaskDueDate(taskToEdit.dueDate);
      const reminderMinutes = inferReminderMinutes(taskToEdit.dueDate, taskToEdit.reminderTime);
      setTitle(taskToEdit.title);
      setDescription(taskToEdit.description || '');
      setPriority(taskToEdit.priority);
      setStatus(taskToEdit.status);
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
      setAssigneeId(taskToEdit.assigneeId || currentUser.id);
      setIsShared(taskToEdit.isShared || false);
      setSubtasks(taskToEdit.subtasks || []);
      setTags(taskToEdit.tags || []);
      try {
        const stored = JSON.parse(localStorage.getItem(`lanmind_task_attachments:${taskToEdit.id}`) || '[]');
        setAttachments(Array.isArray(stored) ? stored : (taskToEdit.attachments || []));
      } catch { setAttachments(taskToEdit.attachments || []); }
    } else {
      setTitle(initialTitle || '');
      setDescription('');
      setPriority('P4');
      setStatus(initialStatus || 'todo');
      setDueDate(initialDate || formatLocalTaskDateTime(new Date(), false));
      setDueTime('');
      setReminderAdvance('0');
      setRecurrence('none');
      setRecurrenceRule(null);
      setProjectId(initialProjectId || '');
      setAssigneeId(currentUser.id);
      setIsShared(Boolean(initialProjectId));
      setSubtasks([]);
      setTags(['日常']);
      setAttachments([]);
    }
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
  const [dueHour = '', dueMinute = '00'] = dueTime.split(':');

  const handleAddSubtask = () => {
    if (!newSubtaskTitle.trim()) return;
    setSubtasks([
      ...subtasks,
      { id: 'sub-' + Date.now().toString(36), title: newSubtaskTitle.trim(), completed: false },
    ]);
    setNewSubtaskTitle('');
  };

  const handleRemoveSubtask = (id: string) => {
    setSubtasks(subtasks.filter((s) => s.id !== id));
  };

  const handleAddTag = () => {
    const nextTag = tagInput.trim();
    if (!nextTag) return;
    if (!tags.includes(nextTag)) {
      setTags([...tags, nextTag]);
    }
    setTagInput('');
  };

  const handleAddSuggestedTag = (tag: string) => {
    if (tags.includes(tag)) return;
    setTags((current) => [...current, tag]);
  };

  const handleRemoveTag = (tg: string) => {
    setTags(tags.filter((t) => t !== tg));
  };

  const availableTagSuggestions = tagSuggestions
    .filter(({ tag }) => !tags.includes(tag))
    .slice(0, MAX_TAG_SUGGESTIONS);

  const handleAttachmentPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []) as File[];
    if (!files.length) return;
    files.forEach((file) => {
      if (file.size > 10 * 1024 * 1024) return;
      const reader = new FileReader();
      reader.onload = () => setAttachments((current) => [
        ...current,
        { id: `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name: file.name, size: file.size, type: file.type, dataUrl: String(reader.result), addedAt: new Date().toISOString() },
      ]);
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
        dueDate: alignedDueDate,
        reminderTime: calculateReminderTime(alignedDueDate, reminderMinutes),
        recurrence,
        recurrenceRule: normalizedRule,
        projectId: effectiveProjectId || null,
        assigneeId: assigneeId || currentUser.id,
        creatorId: taskToEdit ? taskToEdit.creatorId : currentUser.id,
        isShared: isProjectScopedCreate ? true : isShared,
        sharedWith: [],
        subtasks,
        tags,
        attachments,
      });
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '保存任务失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-overlay backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="flex h-[90vh] max-h-[760px] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-edge bg-surface shadow-popover">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-edge px-6 py-4">
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
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {/* Title */}
          <div>
            <label className="mb-1 flex items-center gap-1.5 font-semibold text-sub">
              <FileText className="h-3.5 w-3.5 text-info" />
              <span>任务名称 <span className="text-danger">*</span></span>
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="请输入任务标题..."
              className="w-full bg-canvas border border-subtle rounded-xl px-3 py-2 text-main focus:outline-none focus:border-accent/50"
            />
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 flex items-center gap-1.5 font-semibold text-sub">
              <AlignLeft className="h-3.5 w-3.5 text-sub" />
              <span>详细描述</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="输入任务说明、细节或背景..."
              className="w-full h-20 bg-canvas border border-subtle rounded-xl p-2.5 text-main focus:outline-none focus:border-accent/50 resize-none"
            />
          </div>

          {/* Priority, status, due time, reminder and recurrence */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 flex items-center gap-1.5 font-semibold text-sub">
                <Flag className="h-3.5 w-3.5 text-warning" />
                <span>优先级</span>
              </label>
              <ThemeSelect
                ariaLabel="选择任务优先级"
                value={priority}
                options={PRIORITY_OPTIONS}
                onChange={(value) => setPriority(value as Priority)}
              />
            </div>

            <div>
              <label className="mb-1 flex items-center gap-1.5 font-semibold text-sub">
                <Activity className="h-3.5 w-3.5 text-info" />
                <span>进度状态</span>
              </label>
              <ThemeSelect
                ariaLabel="选择任务进度状态"
                value={status}
                options={STATUS_OPTIONS}
                onChange={(value) => setStatus(value as TaskStatus)}
              />
            </div>

            <div>
              <label className="mb-1 flex items-center gap-1 font-semibold text-sub">
                <Calendar className="h-3.5 w-3.5 text-info" />
                <span>到期日期</span>
              </label>
              <ThemeDatePicker
                ariaLabel="选择任务到期日期"
                value={dueDate}
                onChange={setDueDate}
                placeholder="选择到期日期"
              />
            </div>

            <div>
              <label className="mb-1 flex items-center gap-1 font-semibold text-sub">
                <Clock3 className="h-3.5 w-3.5 text-info" />
                <span>到期时间</span>
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                <ThemeSelect
                  ariaLabel="选择任务到期小时"
                  value={dueHour}
                  options={HOUR_OPTIONS}
                  onChange={(hour) => setDueTime(hour ? `${hour}:${dueMinute}` : '')}
                  disabled={!dueDate}
                />
                <ThemeSelect
                  ariaLabel="选择任务到期分钟"
                  value={dueMinute}
                  options={MINUTE_OPTIONS}
                  onChange={(minute) => setDueTime(`${dueHour}:${minute}`)}
                  disabled={!dueDate || !dueHour}
                />
              </div>
            </div>

            <div>
              <label className="mb-1 flex items-center gap-1 font-semibold text-sub">
                <Bell className="h-3.5 w-3.5 text-warning" />
                <span>到期提醒</span>
              </label>
              <ThemeSelect
                ariaLabel="选择任务提醒时间"
                value={reminderAdvance}
                options={REMINDER_OPTIONS}
                onChange={setReminderAdvance}
                disabled={!dueDate || !dueTime}
              />
            </div>

            <div>
              <label className="block text-sub font-semibold mb-1 flex items-center gap-1">
                <Repeat className="w-3.5 h-3.5 text-info" />
                <span>循环任务</span>
                <span
                  className="group relative inline-flex cursor-help"
                  tabIndex={0}
                  aria-label="循环任务说明"
                >
                  <CircleHelp className="h-3.5 w-3.5 text-quiet transition-colors group-hover:text-info group-focus:text-info" />
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute bottom-full right-0 z-40 mb-2 w-56 rounded-md border border-subtle bg-canvas px-2.5 py-2 text-[11px] font-normal leading-5 text-main opacity-0 shadow-popover transition-opacity group-hover:opacity-100 group-focus:opacity-100"
                  >
                    完成当前任务后，将按此周期生成下一次任务并更新到期日期。
                  </span>
                </span>
              </label>
              <ThemeSelect
                ariaLabel="选择循环任务频率"
                value={recurrence}
                options={RECURRENCE_OPTIONS}
                onChange={(value) => {
                  const nextRecurrence = value as RecurrenceType;
                  setRecurrence(nextRecurrence);
                  setRecurrenceRule(
                    normalizeRecurrenceRule(
                      nextRecurrence,
                      recurrenceRule,
                      combineTaskDueDate(dueDate, dueTime)
                    )
                  );
                  if (nextRecurrence !== 'none' && !dueDate) {
                    setSaveError('循环任务需要设置首次到期日期，完成后会按周期生成下一次任务。');
                  } else {
                    setSaveError('');
                  }
                }}
              />
            </div>
          </div>

          {recurrence !== 'none' && recurrenceRule && (
            <div className="recurrence-config space-y-3 rounded-xl border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <label className="recurrence-config-label font-semibold" htmlFor="recurrence-interval">
                  每隔
                </label>
                <input
                  id="recurrence-interval"
                  type="number"
                  min={1}
                  max={999}
                  value={recurrenceRule.interval}
                  onChange={(event) => {
                    const interval = Math.max(1, Math.min(999, Number(event.target.value) || 1));
                    setRecurrenceRule({ ...recurrenceRule, interval });
                  }}
                  className="recurrence-config-input w-20 rounded-lg border px-2.5 py-1.5 focus:outline-none"
                />
                <span className="recurrence-config-label">
                  {{ daily: '天', weekly: '周', monthly: '个月', yearly: '年' }[recurrence]}
                </span>
              </div>

              {recurrence === 'weekly' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="recurrence-config-label font-semibold">执行星期</span>
                    <button
                      type="button"
                      onClick={() => setRecurrenceRule({ ...recurrenceRule, daysOfWeek: [1, 2, 3, 4, 5] })}
                      className="recurrence-weekday-preset rounded-md border px-2 py-1 text-[11px]"
                    >
                      周一至周五
                    </button>
                  </div>
                  <div className="grid grid-cols-7 gap-1.5">
                    {WEEKDAY_OPTIONS.map((option) => {
                      const selected = recurrenceRule.daysOfWeek?.includes(option.value) || false;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={selected}
                          data-selected={selected}
                          onClick={() => {
                            const current = recurrenceRule.daysOfWeek || [];
                            const next = selected
                              ? current.filter((day) => day !== option.value)
                              : [...current, option.value].sort((left, right) => left - right);
                            if (next.length > 0) {
                              setRecurrenceRule({ ...recurrenceRule, daysOfWeek: next });
                            }
                          }}
                          className="recurrence-weekday rounded-lg border py-1.5 font-semibold"
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {recurrence === 'monthly' && (
                <label className="recurrence-config-label flex items-center gap-2 font-semibold">
                  每个周期的
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={recurrenceRule.dayOfMonth || 1}
                    onChange={(event) => setRecurrenceRule({
                      ...recurrenceRule,
                      dayOfMonth: Math.max(1, Math.min(31, Number(event.target.value) || 1)),
                    })}
                    className="recurrence-config-input w-20 rounded-lg border px-2.5 py-1.5 focus:outline-none"
                  />
                  号
                </label>
              )}

              {recurrence === 'yearly' && (
                <div className="recurrence-config-label flex flex-wrap items-center gap-2 font-semibold">
                  每个周期的
                  <input
                    aria-label="循环月份"
                    type="number"
                    min={1}
                    max={12}
                    value={recurrenceRule.monthOfYear || 1}
                    onChange={(event) => setRecurrenceRule({
                      ...recurrenceRule,
                      monthOfYear: Math.max(1, Math.min(12, Number(event.target.value) || 1)),
                    })}
                    className="recurrence-config-input w-20 rounded-lg border px-2.5 py-1.5 focus:outline-none"
                  />
                  月
                  <input
                    aria-label="循环日期"
                    type="number"
                    min={1}
                    max={31}
                    value={recurrenceRule.dayOfMonth || 1}
                    onChange={(event) => setRecurrenceRule({
                      ...recurrenceRule,
                      dayOfMonth: Math.max(1, Math.min(31, Number(event.target.value) || 1)),
                    })}
                    className="recurrence-config-input w-20 rounded-lg border px-2.5 py-1.5 focus:outline-none"
                  />
                  日
                </div>
              )}

              <div className="recurrence-summary rounded-lg border px-3 py-2 text-[11px]">
                {formatRecurrenceLabel(
                  recurrence,
                  { ...recurrenceRule, timeOfDay: dueTime || null },
                  combineTaskDueDate(dueDate, dueTime)
                )}
                <span className="recurrence-summary-hint ml-2">保存时会自动校正为最近匹配日期</span>
              </div>
            </div>
          )}

          {/* Project & Assignee */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 flex items-center gap-1.5 font-semibold text-sub">
                <Folder className="h-3.5 w-3.5 text-feature" />
                <span>归属项目</span>
              </label>
              <ThemeSelect
                ariaLabel="选择任务归属项目"
                value={effectiveProjectId}
                options={projectOptions}
                disabled={isProjectScopedCreate}
                onChange={(nextProjectId) => {
                  setProjectId(nextProjectId);
                  setIsShared(Boolean(nextProjectId));
                  const nextProject = projects.find((project) => project.id === nextProjectId);
                  if (
                    nextProject &&
                    !nextProject.members.includes(assigneeId) &&
                    !nextProject.admins.includes(assigneeId)
                  ) {
                    setAssigneeId(currentUser.id);
                  }
                }}
              />
            </div>

            <div>
              <label className="mb-1 flex items-center gap-1.5 font-semibold text-sub">
                <UserCheck className="h-3.5 w-3.5 text-success" />
                <span>指派给</span>
              </label>
              <ThemeSelect
                ariaLabel="选择任务负责人"
                value={assigneeId}
                options={assigneeSelectOptions}
                onChange={setAssigneeId}
              />
            </div>
          </div>

          {/* Shared Toggle */}
          <div
            className="task-form-shared-panel"
            data-checked={isShared}
            onClick={() => setIsShared(!isShared)}
          >
            <ThemeCheckbox
              id="sharedCheck"
              checked={isShared}
              onChange={setIsShared}
              onClick={(e) => e.stopPropagation()}
              size="md"
              ariaLabel={
                effectiveProjectId
                  ? '项目组共享（项目成员均可查看；关闭后仅创建者和负责人可查看）'
                  : '开启局域网共享（允许其他节点在线用户查看该个人任务）'
              }
            />
            <label
              htmlFor="sharedCheck"
              className="flex items-center gap-1.5 text-xs font-medium cursor-pointer flex-1 min-w-0 select-none"
              onClick={(e) => e.stopPropagation()}
            >
              <Share2 className="w-3.5 h-3.5 text-feature flex-shrink-0" />
              <span className="truncate">
                {effectiveProjectId
                  ? '项目组共享（项目成员均可查看；关闭后仅创建者和负责人可查看）'
                  : '开启局域网共享（允许其他节点在线用户查看该个人任务）'}
              </span>
            </label>
          </div>

          {/* Subtasks Section */}
          <div className="space-y-2">
            <label className="flex items-center gap-1.5 font-semibold text-sub">
              <ListChecks className="h-3.5 w-3.5 text-info" />
              <span>子任务清单 ({subtasks.length})</span>
            </label>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={newSubtaskTitle}
                onChange={(e) => setNewSubtaskTitle(e.target.value)}
                placeholder="添加子任务步骤..."
                className="flex-1 bg-canvas border border-subtle rounded-xl px-3 py-1.5 text-main focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAddSubtask}
                className="bg-card hover:bg-hover text-main px-3 py-1.5 rounded-xl font-semibold"
              >
                添加
              </button>
            </div>

            <div className="space-y-1 max-h-28 overflow-y-auto">
              {subtasks.map((st) => (
                <div key={st.id} className="flex items-center justify-between bg-canvas/60 p-2 rounded-lg border border-edge">
                  <span className="text-sub">{st.title}</span>
                  <button type="button" onClick={() => handleRemoveSubtask(st.id)} className="text-quiet hover:text-danger">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Multiple attachments */}
          <div className="space-y-2">
            <label className="flex items-center gap-1.5 font-semibold text-sub">
              <Paperclip className="h-3.5 w-3.5 text-info" />
              <span>附件</span><span className="text-[10px] font-normal text-quiet">可多选，单个不超过 10 MB</span>
            </label>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-subtle bg-canvas/50 px-3 py-3 text-xs text-sub transition-colors hover:border-blue-500/60 hover:text-info">
              <Paperclip className="h-4 w-4" /><span>选择多个文件</span>
              <input type="file" multiple className="hidden" onChange={handleAttachmentPick} />
            </label>
            {attachments.length > 0 && <div className="space-y-1.5">
              {attachments.map((file) => <div key={file.id} className="flex items-center justify-between rounded-lg border border-edge bg-canvas/60 px-2.5 py-2 text-xs">
                <div className="flex min-w-0 items-center gap-2"><FileText className="h-3.5 w-3.5 flex-shrink-0 text-info" /><span className="truncate text-main">{file.name}</span><span className="flex-shrink-0 text-[10px] text-quiet">{formatFileSize(file.size)}</span></div>
                <button type="button" onClick={() => setAttachments((current) => current.filter((item) => item.id !== file.id))} className="ml-2 text-quiet hover:text-danger" aria-label={`移除 ${file.name}`}><X className="h-3.5 w-3.5" /></button>
              </div>)}
            </div>}
          </div>

          {/* Tags Section */}
          <div className="space-y-2">
            <label className="flex items-center gap-1.5 font-semibold text-sub">
              <Tag className="h-3.5 w-3.5 text-warning" />
              <span>标签</span>
            </label>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="按 Enter 添加标签..."
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                className="flex-1 bg-canvas border border-subtle rounded-xl px-3 py-1.5 text-main focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAddTag}
                className="bg-card hover:bg-hover text-main px-3 py-1.5 rounded-xl font-semibold"
              >
                添加
              </button>
            </div>

            {!taskToEdit && availableTagSuggestions.length > 0 && (
              <div className="space-y-1">
                <span className="text-[11px] text-quiet">常用标签</span>
                <div className="flex max-h-14 flex-wrap gap-1.5 overflow-hidden">
                  {availableTagSuggestions.map(({ tag, count }) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => handleAddSuggestedTag(tag)}
                      title={`已使用 ${count} 次`}
                      className="max-w-full truncate rounded-md border border-subtle bg-canvas px-2 py-0.5 text-left text-[11px] text-sub transition-colors hover:border-accent/50 hover:bg-hover hover:text-main"
                    >
                      #{tag}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-1.5">
              {tags.map((tg) => (
                <span key={tg} className="bg-card text-sub px-2 py-0.5 rounded-md flex items-center space-x-1">
                  <span>#{tg}</span>
                  <button type="button" onClick={() => handleRemoveTag(tg)} className="hover:text-danger">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Submit Actions */}
          {saveError && (
            <div className="rounded-lg border border-rose-500/40 bg-danger/10 px-3 py-2 text-danger">
              {saveError}
            </div>
          )}
          </div>
          <div className="flex flex-shrink-0 items-center justify-end space-x-2 border-t border-edge px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="ui-cancel-button px-4 py-2 rounded-xl font-semibold"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="theme-btn-primary px-5 py-2 font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-panel"
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
    </div>
  );
};
