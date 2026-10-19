/**
 * TaskPropertiesSidebar — 任务详情右侧属性侧栏（Plane/Linear 风格）。
 * 模块化组织项目归属、标签与进度、排期与提醒、附件与元数据。
 *
 * CALLING SPEC:
 *   <TaskPropertiesSidebar
 *     task={task}
 *     projectOptions={projectOptions}
 *     effectiveProjectId={effectiveProjectId}
 *     onProjectChange={handleProjectChange}
 *     isProjectDisabled={isProjectDisabled}
 *     parentTaskId={parentTaskId}
 *     parentTaskOptions={parentTaskOptions}
 *     onParentTaskChange={setParentTaskId}
 *     isParentTaskDisabled={isParentTaskDisabled}
 *     progress={progress}
 *     onProgressChange={handleProgressChange}
 *     tags={tags}
 *     onTagsChange={setTags}
 *     tagSuggestions={tagSuggestions}
 *     dueDate={dueDate}
 *     dueTime={dueTime}
 *     dueHour={dueHour}
 *     dueMinute={dueMinute}
 *     onDueHourChange={handleDueHourChange}
 *     onDueMinuteChange={handleDueMinuteChange}
 *     reminderAdvance={reminderAdvance}
 *     onReminderAdvanceChange={setReminderAdvance}
 *     recurrence={recurrence}
 *     recurrenceRule={recurrenceRule}
 *     onRecurrenceChange={handleRecurrenceChange}
 *     attachments={attachments}
 *     onAttachmentPick={handleAttachmentPick}
 *     onRemoveAttachment={handleRemoveAttachment}
 *     onPreviewAttachment={setPreviewAttachment}
 *     users={users}
 *     currentUser={currentUser}
 *   />
 */

import React from 'react';
import {
  Folder,
  Link2,
  Percent,
  Clock3,
  Bell,
  Repeat,
  Paperclip,
  Eye,
  X,
  FileText,
  Tag,
  User as UserIcon,
} from 'lucide-react';
import {
  Task,
  TaskAttachment,
  RecurrenceType,
  RecurrenceRule,
  User,
} from '../../types';
import { ThemeSelect, ThemeSelectOption } from '../ThemeSelect';
import { TaskTagsEditor } from '../TaskTagsEditor';
import { formatTaskDate, formatTaskDateTime } from '../../utils/timeFormat';
import { MemberAvatar } from '../workitem/MemberAvatar';
import { formatFileSize } from '../../utils/fileTransfer';
import { TaskTagUsage } from '../../utils/taskTags';
import { tr, useLocale } from '../../i18n';

interface TaskPropertiesSidebarProps {
  task?: Task | null;
  projectOptions: ThemeSelectOption[];
  effectiveProjectId?: string | null;
  onProjectChange: (projectId: string) => void;
  isProjectDisabled?: boolean;
  parentTaskId?: string;
  parentTaskOptions: ThemeSelectOption[];
  onParentTaskChange: (parentId: string) => void;
  isParentTaskDisabled?: boolean;
  progress: number;
  onProgressChange: (progress: number) => void;
  tags: string[];
  onTagsChange: (tags: string[]) => void;
  tagSuggestions?: TaskTagUsage[];
  dueDate?: string | null;
  dueTime?: string;
  dueHour?: string;
  dueMinute?: string;
  onDueHourChange?: (hour: string) => void;
  onDueMinuteChange?: (minute: string) => void;
  reminderAdvance: string;
  onReminderAdvanceChange: (advance: string) => void;
  recurrence: RecurrenceType;
  recurrenceRule: RecurrenceRule | null;
  onRecurrenceChange: (type: RecurrenceType) => void;
  attachments: TaskAttachment[];
  onAttachmentPick: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveAttachment: (id: string) => void;
  onPreviewAttachment?: (file: TaskAttachment) => void;
  users: User[];
  currentUser: User;
  timezone?: string | null;
}

const HOUR_OPTIONS: ThemeSelectOption[] = Array.from({ length: 24 }, (_, i) => ({
  value: String(i).padStart(2, '0'),
  label: `${String(i).padStart(2, '0')}:00`,
}));

const MINUTE_OPTIONS: ThemeSelectOption[] = ['00', '15', '30', '45'].map((m) => ({
  value: m,
  label: `${m} 分`,
}));

export const TaskPropertiesSidebar: React.FC<TaskPropertiesSidebarProps> = ({
  task,
  projectOptions,
  effectiveProjectId,
  onProjectChange,
  isProjectDisabled = false,
  parentTaskId = '',
  parentTaskOptions,
  onParentTaskChange,
  isParentTaskDisabled = false,
  progress,
  onProgressChange,
  tags,
  onTagsChange,
  tagSuggestions = [],
  dueDate,
  dueTime,
  dueHour = '09',
  dueMinute = '00',
  onDueHourChange,
  onDueMinuteChange,
  reminderAdvance,
  onReminderAdvanceChange,
  recurrence,
  recurrenceRule,
  onRecurrenceChange,
  attachments,
  onAttachmentPick,
  onRemoveAttachment,
  onPreviewAttachment,
  users,
  currentUser,
  timezone,
}) => {
  useLocale();

  const reminderOptions: ThemeSelectOption[] = [
    { value: 'none', label: '不提醒' },
    { value: '0', label: '准时' },
    { value: '5', label: '提前 5 分钟' },
    { value: '15', label: '提前 15 分钟' },
    { value: '30', label: '提前 30 分钟' },
    { value: '60', label: '提前 1 小时' },
    { value: '1440', label: '提前 1 天' },
  ];

  const recurrenceOptions: ThemeSelectOption[] = [
    { value: 'none', label: '不重复' },
    { value: 'daily', label: '每天' },
    { value: 'weekly', label: '每周' },
    { value: 'monthly', label: '每月' },
    { value: 'yearly', label: '每年' },
  ];

  const creatorUser = task ? users.find((u) => u.id === task.creatorId) : currentUser;

  return (
    <aside className="task-detail-properties min-w-0 space-y-4 bg-canvas/30 px-4 py-4 lg:w-[290px] shrink-0 border-t lg:border-t-0 lg:border-l border-edge/80">
      <div className="flex items-center justify-between border-b border-edge/60 pb-2">
        <h3 className="text-xs font-bold text-main">{tr('tasks:taskModal.taskProperties')}</h3>
        {task?.updatedAt && (
          <span className="text-[10px] text-quiet">
            {formatTaskDate(task.updatedAt, timezone)}
          </span>
        )}
      </div>

      {/* 1. 项目归属与层级结构（置于顶部，明确任务归属） */}
      <div className="space-y-3">
        <h4 className="text-[11px] font-semibold text-quiet uppercase tracking-wider flex items-center gap-1.5">
          <Folder className="h-3 w-3 text-feature" />
          <span>{tr('tasks:taskModal.projectAndAssignee')}</span>
        </h4>

        {/* 所属项目 */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-sub">
            {tr('tasks:taskModal.project')}
          </label>
          <ThemeSelect
            value={effectiveProjectId || ''}
            options={projectOptions}
            disabled={isProjectDisabled}
            onChange={onProjectChange}
            ariaLabel={tr('tasks:taskModal.chooseTaskProject')}
          />
        </div>

        {/* 父工作项 */}
        {parentTaskOptions.length > 0 && (
          <div>
            <label className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-sub">
              <Link2 className="h-3 w-3 text-info" />
              <span>{tr('tasks:taskModal.parentTask')}</span>
            </label>
            <ThemeSelect
              value={parentTaskId}
              options={parentTaskOptions}
              disabled={isParentTaskDisabled}
              onChange={onParentTaskChange}
              ariaLabel={tr('tasks:taskModal.chooseParentTask')}
            />
          </div>
        )}
      </div>

      {/* 2. 标签与进度 */}
      <div className="space-y-3 border-t border-edge/60 pt-3">
        <h4 className="text-[11px] font-semibold text-quiet uppercase tracking-wider flex items-center gap-1.5">
          <Tag className="h-3 w-3 text-accent" />
          <span>{tr('tasks:taskTagsEditor.tags')} & {tr('tasks:taskModal.completionProgress')}</span>
        </h4>

        {/* 标签 */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-sub">
            {tr('tasks:taskTagsEditor.tags')}
          </label>
          <TaskTagsEditor
            value={tags}
            onChange={onTagsChange}
            suggestions={tagSuggestions}
          />
        </div>

        {/* 完成进度 */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="flex items-center gap-1 text-[11px] font-semibold text-sub">
              <Percent className="h-3 w-3 text-info" />
              <span>{tr('tasks:taskModal.completionProgress')}</span>
            </label>
            <span className="rounded bg-muted/60 px-1.5 py-0.2 font-mono text-[10px] text-main">
              {progress}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={progress}
            onChange={(e) => onProgressChange(Number(e.target.value))}
            className="w-full accent-[var(--accent)]"
          />
        </div>
      </div>

      {/* 3. 时间具体时刻、提醒与重复 */}
      <div className="space-y-3 border-t border-edge/60 pt-3">
        <h4 className="text-[11px] font-semibold text-quiet uppercase tracking-wider flex items-center gap-1.5">
          <Clock3 className="h-3 w-3 text-info" />
          <span>{tr('tasks:taskModal.schedule')}</span>
        </h4>

        {/* 截止时刻 */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-sub">
            {tr('tasks:taskModal.dueTime')}
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            <ThemeSelect
              value={dueHour}
              options={HOUR_OPTIONS}
              onChange={(hour) => onDueHourChange?.(hour)}
              disabled={!dueDate}
              ariaLabel={tr('tasks:taskModal.chooseDueHour')}
            />
            <ThemeSelect
              value={dueMinute}
              options={MINUTE_OPTIONS}
              onChange={(minute) => onDueMinuteChange?.(minute)}
              disabled={!dueDate || !dueHour}
              ariaLabel={tr('tasks:taskModal.chooseDueMinute')}
            />
          </div>
        </div>

        {/* 提醒 */}
        <div>
          <label className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-sub">
            <Bell className="h-3 w-3 text-warning" />
            <span>{tr('tasks:taskModal.reminder')}</span>
          </label>
          <ThemeSelect
            value={reminderAdvance}
            options={reminderOptions}
            onChange={onReminderAdvanceChange}
            disabled={!dueDate}
            ariaLabel={tr('tasks:taskModal.chooseTaskReminder')}
          />
        </div>

        {/* 循环规律 */}
        <div>
          <label className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-sub">
            <Repeat className="h-3 w-3 text-info" />
            <span>{tr('tasks:taskModal.recurring')}</span>
          </label>
          <ThemeSelect
            value={recurrence}
            options={recurrenceOptions}
            onChange={(val) => onRecurrenceChange(val as RecurrenceType)}
            ariaLabel={tr('tasks:taskModal.chooseRecurrence')}
          />
        </div>
      </div>

      {/* 4. 附件上传 */}
      <div className="space-y-2 border-t border-edge/60 pt-3">
        <div className="flex items-center justify-between">
          <h4 className="text-[11px] font-semibold text-quiet uppercase tracking-wider flex items-center gap-1.5">
            <Paperclip className="h-3 w-3 text-sub" />
            <span>{tr('tasks:taskModal.attachments')}</span>
            <span className="rounded-full bg-hover px-1.5 py-0.2 text-[9px] text-quiet">
              {attachments.length}
            </span>
          </h4>
          <label className="cursor-pointer text-[11px] font-medium text-info hover:underline inline-flex items-center gap-0.5">
            + {tr('tasks:taskModal.chooseFiles')}
            <input
              type="file"
              multiple
              className="hidden"
              onChange={onAttachmentPick}
            />
          </label>
        </div>

        <div className="space-y-1.5 max-h-36 overflow-y-auto">
          {attachments.map((file) => (
            <div
              key={file.id}
              className="flex items-center justify-between gap-1.5 rounded-lg border border-edge/70 bg-card/60 px-2.5 py-1.5 text-[11px] shadow-2xs hover:bg-card/90 transition-colors"
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 shrink-0 text-info" />
                <span className="truncate text-main font-medium">{file.name}</span>
                <span className="shrink-0 text-[9px] text-quiet font-mono">
                  {formatFileSize(file.size)}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {onPreviewAttachment && (
                  <button
                    type="button"
                    onClick={() => onPreviewAttachment(file)}
                    className="p-1 text-sub hover:text-info rounded hover:bg-hover transition-colors"
                    title={tr('tasks:taskModal.preview', { value0: file.name })}
                  >
                    <Eye className="h-3 w-3" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(file.id)}
                  className="p-1 text-quiet hover:text-danger rounded hover:bg-danger/10 transition-colors"
                  title={tr('tasks:taskModal.remove', { value0: file.name })}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
          {attachments.length === 0 && (
            <p className="text-[11px] text-quiet italic py-1">
              {tr('tasks:taskDescriptionEditor.noImageAttachments') || '无附件'}
            </p>
          )}
        </div>
      </div>

      {/* 5. 元信息 Metadata */}
      <div className="space-y-2 border-t border-edge/60 pt-3 text-[11px] text-sub">
        <h4 className="text-[11px] font-semibold text-quiet uppercase tracking-wider flex items-center gap-1.5">
          <UserIcon className="h-3 w-3 text-quiet" />
          <span>元信息</span>
        </h4>
        <div className="flex items-center gap-2">
          <span className="text-quiet shrink-0">创建者:</span>
          <div className="flex items-center gap-1.5 truncate">
            <MemberAvatar user={creatorUser} name={creatorUser?.nickname || 'User'} size="xs" />
            <span className="truncate font-medium text-main">
              {creatorUser?.nickname || creatorUser?.username || '用户'}
            </span>
          </div>
        </div>
        {task?.createdAt && (
          <div className="flex items-center gap-2">
            <span className="text-quiet shrink-0">创建于:</span>
            <span className="truncate font-mono text-[10px] text-sub">
              {formatTaskDateTime(task.createdAt, timezone)}
            </span>
          </div>
        )}
        {task?.updatedAt && (
          <div className="flex items-center gap-2">
            <span className="text-quiet shrink-0">更新于:</span>
            <span className="truncate font-mono text-[10px] text-sub">
              {formatTaskDateTime(task.updatedAt, timezone)}
            </span>
          </div>
        )}
      </div>
    </aside>
  );
};
