/**
 * TaskQuickPropertyChips — 任务标题下方的快捷属性工具条（Plane/Linear 风格）。
 * 集中管理工作项的状态、优先级、经办人、开始日期与截止日期。
 *
 * CALLING SPEC:
 *   <TaskQuickPropertyChips
 *     stateId={stateId}
 *     states={states}
 *     stateOptions={stateOptions}
 *     onStateChange={handleStateChange}
 *     priority={priority}
 *     onPriorityChange={setPriority}
 *     assigneeId={assigneeId}
 *     assigneeOptions={assigneeSelectOptions}
 *     users={users}
 *     onAssigneeChange={setAssigneeId}
 *     startDate={startDate}
 *     onStartDateChange={setStartDate}
 *     dueDate={dueDate}
 *     onDueDateChange={setDueDate}
 *   />
 */

import React from 'react';
import { Calendar, User as UserIcon, Flag, CircleDot } from 'lucide-react';
import { Priority, WorkItemState, User } from '../../types';
import { ThemeSelect, ThemeSelectOption } from '../ThemeSelect';
import { ThemeDatePicker } from '../ThemeDatePicker';
import { tr, useLocale } from '../../i18n';

interface TaskQuickPropertyChipsProps {
  stateId: string;
  states: WorkItemState[];
  stateOptions: ThemeSelectOption[];
  onStateChange: (stateId: string) => void;
  priority: Priority;
  onPriorityChange: (priority: Priority) => void;
  assigneeId: string;
  assigneeOptions: ThemeSelectOption[];
  users: User[];
  onAssigneeChange: (assigneeId: string) => void;
  startDate?: string | null;
  onStartDateChange: (date: string | null) => void;
  dueDate?: string | null;
  onDueDateChange: (date: string | null) => void;
}

export const TaskQuickPropertyChips: React.FC<TaskQuickPropertyChipsProps> = ({
  stateId,
  states,
  stateOptions,
  onStateChange,
  priority,
  onPriorityChange,
  assigneeId,
  assigneeOptions,
  users,
  onAssigneeChange,
  startDate,
  onStartDateChange,
  dueDate,
  onDueDateChange,
}) => {
  useLocale();

  const priorityOptions: ThemeSelectOption[] = [
    { value: 'P1', label: `P1 - ${tr('tasks:listView.urgent')}` },
    { value: 'P2', label: `P2 - ${tr('tasks:listView.high')}` },
    { value: 'P3', label: `P3 - ${tr('tasks:listView.normal')}` },
    { value: 'P4', label: `P4 - ${tr('tasks:listView.low')}` },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 py-1">
      {/* 状态胶囊 */}
      <div className="inline-flex items-center min-w-[120px] max-w-[170px]">
        {stateOptions.length > 0 ? (
          <ThemeSelect
            value={stateId}
            options={stateOptions}
            onChange={onStateChange}
            ariaLabel={tr('tasks:taskModal.chooseTaskStatus')}
          />
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-canvas/60 px-2.5 py-1 text-xs text-sub">
            <span className="h-2 w-2 rounded-full bg-sub/60" />
            <span>{tr('tasks:childTasksEditor.notStarted')}</span>
          </span>
        )}
      </div>

      {/* 优先级胶囊 */}
      <div className="min-w-[110px] max-w-[150px]">
        <ThemeSelect
          value={priority}
          options={priorityOptions}
          onChange={(val) => onPriorityChange(val as Priority)}
          ariaLabel={tr('tasks:taskModal.chooseTaskPriority')}
        />
      </div>

      {/* 经办人胶囊 */}
      <div className="min-w-[130px] max-w-[200px]">
        <ThemeSelect
          value={assigneeId}
          options={assigneeOptions}
          onChange={onAssigneeChange}
          ariaLabel={tr('tasks:taskModal.chooseTaskAssignee')}
        />
      </div>

      {/* 分隔点（大屏幕上美化视觉断句） */}
      <div className="hidden lg:block h-4 w-[1px] bg-edge/60 mx-0.5" />

      {/* 开始日期 */}
      <div className="w-[128px]">
        <ThemeDatePicker
          value={startDate || ''}
          onChange={onStartDateChange}
          placeholder={tr('tasks:taskModal.startDate')}
          ariaLabel={tr('tasks:taskModal.chooseStartDate')}
        />
      </div>

      {/* 截止日期 */}
      <div className="w-[128px]">
        <ThemeDatePicker
          value={dueDate || ''}
          onChange={onDueDateChange}
          placeholder={tr('tasks:taskModal.dueDate')}
          ariaLabel={tr('tasks:taskModal.chooseDueDate')}
        />
      </div>
    </div>
  );
};
