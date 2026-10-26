import React, { useState } from 'react';
import { ChevronDown, RotateCw } from 'lucide-react';
import { Task, RecurrenceType, RecurrenceRule, RecurrenceWeekday, User } from '../../types';
import { ThemeSelect, ThemeSelectOption } from '../ThemeSelect';
import { ThemeDatePicker } from '../ThemeDatePicker';
import { TaskTagsEditor } from '../TaskTagsEditor';
import { TaskQuickPropertyChips, TaskQuickPropertyChipsProps, TaskPropertyRow } from './TaskQuickPropertyChips';
import { HOUR_OPTIONS, MINUTE_OPTIONS, REMINDER_OPTIONS, RECURRENCE_OPTIONS } from '../taskModalOptions';
import { formatTaskDateTime } from '../../utils/timeFormat';
import { formatRecurrenceLabel } from '../../utils/recurrence';
import { TaskTagUsage } from '../../utils/taskTags';
import { tr, useLocale } from '../../i18n';

interface TaskPropertiesSidebarProps {
  task?: Task | null;
  mode: 'create' | 'edit';
  quickProperties: TaskQuickPropertyChipsProps;
  projectOptions: ThemeSelectOption[];
  effectiveProjectId?: string | null;
  onProjectChange: (id: string) => void;
  isProjectDisabled: boolean;
  parentTaskId: string;
  parentTaskOptions: ThemeSelectOption[];
  onParentTaskChange: (id: string) => void;
  isParentTaskDisabled: boolean;
  progress: number;
  onProgressChange: (progress: number) => void;
  tags: string[];
  onTagsChange: (tags: string[]) => void;
  tagSuggestions: TaskTagUsage[];
  dueHour: string;
  dueMinute: string;
  onDueHourChange: (hour: string) => void;
  onDueMinuteChange: (minute: string) => void;
  reminderAdvance: string;
  onReminderAdvanceChange: (value: string) => void;
  recurrence: RecurrenceType;
  onRecurrenceChange: (type: RecurrenceType) => void;
  recurrenceRule?: RecurrenceRule | null;
  onRecurrenceRuleChange?: (rule: RecurrenceRule | null) => void;
  advancedOpen: boolean;
  onAdvancedOpenChange: (open: boolean) => void;
  users: User[];
  currentUser: User;
}

const WEEKDAY_NAMES: { day: RecurrenceWeekday; key: string; fullKey: string }[] = [
  { day: 1, key: 'tasks:taskModal.mon', fullKey: 'calendar:recurrence.monday' },
  { day: 2, key: 'tasks:taskModal.tue', fullKey: 'calendar:recurrence.tuesday' },
  { day: 3, key: 'tasks:taskModal.wed', fullKey: 'calendar:recurrence.wednesday' },
  { day: 4, key: 'tasks:taskModal.thu', fullKey: 'calendar:recurrence.thursday' },
  { day: 5, key: 'tasks:taskModal.fri', fullKey: 'calendar:recurrence.friday' },
  { day: 6, key: 'tasks:taskModal.sat', fullKey: 'calendar:recurrence.saturday' },
  { day: 7, key: 'tasks:taskModal.sun', fullKey: 'calendar:recurrence.sunday' },
];

export const TaskPropertiesSidebar: React.FC<TaskPropertiesSidebarProps> = (props: TaskPropertiesSidebarProps) => {
  useLocale();
  const { task, mode, quickProperties, advancedOpen, onAdvancedOpenChange } = props;
  const [metadataOpen, setMetadataOpen] = useState(false);
  const creator = task ? props.users.find((user) => user.id === task.creatorId) : props.currentUser;

  const updateRule = (partial: Partial<RecurrenceRule>) => {
    if (!props.onRecurrenceRuleChange) return;
    const currentRule: RecurrenceRule = props.recurrenceRule || {
      interval: 1,
      timeOfDay: props.dueHour ? `${props.dueHour}:${props.dueMinute}` : null,
    };
    props.onRecurrenceRuleChange({ ...currentRule, ...partial });
  };

  const toggleWeekday = (targetDay: RecurrenceWeekday) => {
    const currentDays = props.recurrenceRule?.daysOfWeek || [];
    const nextDays = currentDays.includes(targetDay)
      ? currentDays.filter((d) => d !== targetDay)
      : [...currentDays, targetDay].sort((a, b) => a - b);
    updateRule({ daysOfWeek: nextDays.length > 0 ? (nextDays as RecurrenceWeekday[]) : [targetDay] });
  };

  const recurrenceSummary = formatRecurrenceLabel(
    props.recurrence,
    props.recurrenceRule,
    quickProperties.dueDate
  );

  const recurrenceRuleForm = props.recurrence !== 'none' && (
    <div className="task-recurrence-rule-box rounded-lg border border-edge/60 bg-surface/60 p-2.5 space-y-2.5 mt-1 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-sub shrink-0 font-medium">{tr('tasks:taskModal.repeatInterval')}</span>
        <span className="text-sub">{tr('tasks:taskModal.everyPrefix')}</span>
        <input
          type="number"
          min={1}
          max={99}
          value={props.recurrenceRule?.interval ?? 1}
          onChange={(e) => updateRule({ interval: Math.max(1, parseInt(e.target.value, 10) || 1) })}
          className="w-14 rounded border border-subtle bg-surface px-2 py-0.5 text-xs text-main text-center outline-none focus:border-accent"
        />
        <span className="text-sub">
          {props.recurrence === 'daily'
            ? tr('tasks:taskModal.unitDays')
            : props.recurrence === 'weekly'
              ? tr('tasks:taskModal.unitWeeks')
              : props.recurrence === 'monthly'
                ? tr('tasks:taskModal.unitMonths')
                : tr('tasks:taskModal.unitYears')}
        </span>
      </div>

      {props.recurrence === 'weekly' && (
        <div className="space-y-1">
          <span className="text-[11px] text-quiet">{tr('tasks:taskModal.repeatWeekdays')}</span>
          <div className="flex items-center gap-1">
            {WEEKDAY_NAMES.map(({ day, key, fullKey }) => {
              const active = (props.recurrenceRule?.daysOfWeek || []).includes(day);
              return (
                <button
                  type="button"
                  key={day}
                  onClick={() => toggleWeekday(day)}
                  className={`flex h-6 w-6 items-center justify-center rounded text-xs font-medium transition-colors ${
                    active
                      ? 'bg-accent text-white shadow-2xs'
                      : 'border border-edge bg-surface text-sub hover:bg-hover hover:text-main'
                  }`}
                  title={tr(fullKey)}
                >
                  {tr(key)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {props.recurrence === 'monthly' && (
        <div className="flex items-center gap-2">
          <span className="text-sub shrink-0 font-medium">{tr('tasks:taskModal.repeatOn')}</span>
          <span className="text-sub">{tr('tasks:taskModal.monthDayPrefix')}</span>
          <input
            type="number"
            min={1}
            max={31}
            value={props.recurrenceRule?.dayOfMonth ?? (quickProperties.dueDate ? parseInt(quickProperties.dueDate.slice(8, 10), 10) : 1)}
            onChange={(e) => updateRule({ dayOfMonth: Math.min(31, Math.max(1, parseInt(e.target.value, 10) || 1)) })}
            className="w-14 rounded border border-subtle bg-surface px-2 py-0.5 text-xs text-main text-center outline-none focus:border-accent"
          />
          <span className="text-sub">{tr('tasks:taskModal.daySuffix')}</span>
        </div>
      )}

      {props.recurrence === 'yearly' && (
        <div className="flex items-center gap-2">
          <span className="text-sub shrink-0 font-medium">{tr('tasks:taskModal.repeatOn')}</span>
          <span className="text-sub">{tr('tasks:taskModal.yearPrefix')}</span>
          <input
            type="number"
            min={1}
            max={12}
            value={props.recurrenceRule?.monthOfYear ?? (quickProperties.dueDate ? parseInt(quickProperties.dueDate.slice(5, 7), 10) : 1)}
            onChange={(e) => updateRule({ monthOfYear: Math.min(12, Math.max(1, parseInt(e.target.value, 10) || 1)) })}
            className="w-12 rounded border border-subtle bg-surface px-1.5 py-0.5 text-xs text-main text-center outline-none focus:border-accent"
          />
          <span className="text-sub">{tr('tasks:taskModal.monthSuffix')}</span>
          <input
            type="number"
            min={1}
            max={31}
            value={props.recurrenceRule?.dayOfMonth ?? (quickProperties.dueDate ? parseInt(quickProperties.dueDate.slice(8, 10), 10) : 1)}
            onChange={(e) => updateRule({ dayOfMonth: Math.min(31, Math.max(1, parseInt(e.target.value, 10) || 1)) })}
            className="w-12 rounded border border-subtle bg-surface px-1.5 py-0.5 text-xs text-main text-center outline-none focus:border-accent"
          />
          <span className="text-sub">{tr('tasks:taskModal.daySuffix')}</span>
        </div>
      )}

      <div className="text-[11px] text-accent flex items-center gap-1.5 font-medium pt-0.5 border-t border-edge/30">
        <RotateCw className="h-3 w-3 shrink-0" />
        <span className="truncate">{recurrenceSummary}</span>
      </div>
    </div>
  );

  const progress = (
    <div className="task-progress-control">
      <input
        type="range"
        aria-label={tr('tasks:taskModal.completionProgress')}
        min={0}
        max={100}
        step={5}
        value={props.progress}
        onChange={(event) => props.onProgressChange(Number(event.target.value))}
      />
      <output>{props.progress}%</output>
    </div>
  );

  const parent = (
    <TaskPropertyRow label={tr('tasks:taskModal.parentTask')}>
      <ThemeSelect
        portal
        searchable
        value={props.parentTaskId}
        options={props.parentTaskOptions}
        onChange={props.onParentTaskChange}
        disabled={props.isParentTaskDisabled}
        ariaLabel={tr('tasks:taskModal.chooseParentTask')}
      />
    </TaskPropertyRow>
  );

  const dueTimeField = (
    <TaskPropertyRow label={tr('tasks:taskModal.dueTime')}>
      <div className="task-time-fields">
        <ThemeSelect
          portal
          value={props.dueHour}
          options={HOUR_OPTIONS}
          onChange={props.onDueHourChange}
          disabled={!quickProperties.dueDate}
          ariaLabel={tr('tasks:taskModal.chooseDueHour')}
        />
        <ThemeSelect
          portal
          value={props.dueMinute}
          options={MINUTE_OPTIONS}
          onChange={props.onDueMinuteChange}
          disabled={!quickProperties.dueDate || !props.dueHour}
          ariaLabel={tr('tasks:taskModal.chooseDueMinute')}
        />
      </div>
    </TaskPropertyRow>
  );

  const reminderField = (
    <TaskPropertyRow label={tr('tasks:taskModal.reminder')}>
      <ThemeSelect
        portal
        value={props.reminderAdvance}
        options={REMINDER_OPTIONS}
        onChange={props.onReminderAdvanceChange}
        disabled={!quickProperties.dueDate}
        ariaLabel={tr('tasks:taskModal.chooseTaskReminder')}
      />
    </TaskPropertyRow>
  );

  const recurrenceField = (
    <TaskPropertyRow label={tr('tasks:taskModal.recurring')}>
      <ThemeSelect
        portal
        value={props.recurrence}
        options={RECURRENCE_OPTIONS}
        onChange={(value) => props.onRecurrenceChange(value as RecurrenceType)}
        ariaLabel={tr('tasks:taskModal.chooseRecurrence')}
      />
    </TaskPropertyRow>
  );

  if (mode === 'create') {
    return (
      <aside className="task-detail-properties task-detail-properties--create" aria-label={tr('tasks:taskModal.taskProperties')}>
        <div className="task-detail-date-fields">
          <label>
            <span>{tr('tasks:taskModal.startDate')}</span>
            <ThemeDatePicker
              value={quickProperties.startDate || ''}
              onChange={quickProperties.onStartDateChange}
              placeholder={tr('tasks:taskEditor.notScheduled')}
              ariaLabel={tr('tasks:taskModal.chooseStartDate')}
            />
          </label>
        </div>

        <div>{dueTimeField}</div>

        <div>{reminderField}</div>

        <div>{recurrenceField}</div>

        {recurrenceRuleForm && (
          <div className="task-property-full">{recurrenceRuleForm}</div>
        )}

        <div>{parent}</div>

        <div>
          <TaskPropertyRow label={tr('tasks:taskModal.completionProgress')}>
            {progress}
          </TaskPropertyRow>
        </div>
      </aside>
    );
  }

  const advancedFields = (
    <div className="task-property-group task-schedule-options">
      {dueTimeField}
      {reminderField}
      {recurrenceField}
      {recurrenceRuleForm}
    </div>
  );

  return (
    <aside className="task-detail-properties task-detail-properties--edit" aria-label={tr('tasks:taskModal.taskProperties')}>
      <section className="task-property-group">
        <h3>{tr('tasks:taskModal.taskProperties')}</h3>
        <TaskQuickPropertyChips {...quickProperties} layout="rows" />
        <TaskPropertyRow label={tr('tasks:taskModal.completionProgress')}>
          {progress}
        </TaskPropertyRow>
      </section>

      <section className="task-property-group task-property-divider">
        <h3>{tr('tasks:taskEditor.location')}</h3>
        <TaskPropertyRow label={tr('tasks:taskModal.project')}>
          <ThemeSelect
            portal
            searchable
            value={props.effectiveProjectId || ''}
            options={props.projectOptions}
            onChange={props.onProjectChange}
            disabled={props.isProjectDisabled}
            ariaLabel={tr('tasks:taskModal.chooseTaskProject')}
          />
        </TaskPropertyRow>
        {parent}
      </section>

      <section className="task-property-group task-property-divider">
        <h3>{tr('tasks:taskModal.schedule')}</h3>
        <div className="task-detail-date-fields">
          <label>
            <span>{tr('tasks:taskModal.startDate')}</span>
            <ThemeDatePicker
              value={quickProperties.startDate || ''}
              onChange={quickProperties.onStartDateChange}
              placeholder={tr('tasks:taskEditor.notScheduled')}
              ariaLabel={tr('tasks:taskModal.chooseStartDate')}
            />
          </label>
          <label>
            <span>{tr('tasks:taskModal.dueDate')}</span>
            <ThemeDatePicker
              value={quickProperties.dueDate || ''}
              onChange={quickProperties.onDueDateChange}
              placeholder={tr('tasks:taskEditor.notScheduled')}
              ariaLabel={tr('tasks:taskModal.chooseDueDate')}
            />
          </label>
        </div>
        <button
          type="button"
          className="task-expand-button"
          aria-expanded={advancedOpen}
          onClick={() => onAdvancedOpenChange(!advancedOpen)}
        >
          <ChevronDown data-open={advancedOpen} className="h-3.5 w-3.5" />
          {tr('tasks:taskEditor.timeAndRepeat')}
        </button>
        <div hidden={!advancedOpen}>{advancedFields}</div>
      </section>

      <section className="task-property-group task-property-divider">
        <h3>{tr('tasks:taskTagsEditor.tags')}</h3>
        <TaskTagsEditor
          compact
          value={props.tags}
          onChange={props.onTagsChange}
          suggestions={props.tagSuggestions}
        />
      </section>

      <section className="task-property-group task-property-divider task-metadata">
        <button
          type="button"
          className="task-expand-button"
          aria-expanded={metadataOpen}
          onClick={() => setMetadataOpen(!metadataOpen)}
        >
          <ChevronDown data-open={metadataOpen} className="h-3.5 w-3.5" />
          {tr('tasks:taskEditor.metadata')}
        </button>
        {metadataOpen && (
          <dl>
            <dt>{tr('tasks:taskEditor.createdBy')}</dt>
            <dd>{creator?.nickname || creator?.username || task?.creatorId}</dd>
            {task?.createdAt && (
              <>
                <dt>{tr('tasks:taskEditor.createdAt')}</dt>
                <dd>{formatTaskDateTime(task.createdAt)}</dd>
              </>
            )}
            {task?.updatedAt && (
              <>
                <dt>{tr('tasks:taskEditor.updatedAt')}</dt>
                <dd>{formatTaskDateTime(task.updatedAt)}</dd>
              </>
            )}
          </dl>
        )}
      </section>
    </aside>
  );
};
