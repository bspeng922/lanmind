import React from 'react';
import { Priority, WorkItemState, User } from '../../types';
import { ThemeSelect, ThemeSelectOption } from '../ThemeSelect';
import { ThemeDatePicker } from '../ThemeDatePicker';
import { PRIORITY_OPTIONS } from '../taskModalOptions';
import { tr, useLocale } from '../../i18n';

export interface TaskQuickPropertyChipsProps {
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
  layout?: 'chips' | 'rows';
  fallbackStateLabel?: string;
}

export const TaskPropertyRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }: { label: string; children: React.ReactNode }) => {
  return <div className="task-property-row"><span className="task-property-label">{label}</span><div className="task-property-value">{children}</div></div>;
};

export function TaskQuickPropertyChips({ stateId, stateOptions, onStateChange, priority, onPriorityChange, assigneeId, assigneeOptions, onAssigneeChange, dueDate, onDueDateChange, layout = 'chips', fallbackStateLabel }: TaskQuickPropertyChipsProps) {
  useLocale();
  const fields = [
    { key: 'status', label: tr('tasks:taskModal.status'), control: <ThemeSelect portal disabled={!stateOptions.length} value={stateId} options={stateOptions.length ? stateOptions : [{ value: '', label: fallbackStateLabel || tr('tasks:childTasksEditor.notStarted') }]} onChange={onStateChange} ariaLabel={tr('tasks:taskModal.chooseTaskStatus')} /> },
    { key: 'priority', label: tr('tasks:taskModal.priority'), control: <ThemeSelect portal value={priority} options={PRIORITY_OPTIONS} onChange={(value) => onPriorityChange(value as Priority)} ariaLabel={tr('tasks:taskModal.chooseTaskPriority')} /> },
    { key: 'assignee', label: tr('tasks:taskModal.assignee'), control: <ThemeSelect portal searchable value={assigneeId} options={assigneeOptions} onChange={onAssigneeChange} ariaLabel={tr('tasks:taskModal.chooseTaskAssignee')} /> },
  ];
  return <div className={`task-quick-properties task-quick-properties--${layout}`}>
    {fields.map(({ key, label, control }) => layout === 'rows'
      ? <TaskPropertyRow key={key} label={label}>{control}</TaskPropertyRow>
      : <div key={key} className={`task-property-chip task-property-chip--${key}`}>{control}</div>)}
    {layout === 'chips' && <div className="task-property-chip task-property-chip--date"><ThemeDatePicker value={dueDate || ''} onChange={onDueDateChange} placeholder={tr('tasks:taskModal.dueDate')} ariaLabel={tr('tasks:taskModal.chooseDueDate')} /></div>}
  </div>;
}
