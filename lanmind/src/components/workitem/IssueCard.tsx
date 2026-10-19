import React from 'react';
import { AlertCircle, Calendar } from 'lucide-react';
import { tr, useLocale } from '../../i18n';
import type { Project, Task, User, WorkItemState } from '../../types';
import { formatTaskDueDate } from '../../utils/taskDateTime';
import { isCancelled, isCompleted } from '../../utils/workItemState';
import { IssueIdentifier } from './IssueIdentifier';
import { LabelPill } from './LabelPill';
import { MemberAvatar } from './MemberAvatar';
import { PrioritySignal } from './PrioritySignal';
import { StatePill } from './StatePill';

interface IssueCardProps {
  task: Task;
  project?: Project;
  assignee?: User;
  /** 项目状态定义，用于把 stateId 还原成状态名与颜色。 */
  states?: WorkItemState[];
  /** 该任务对应的状态定义。缺省时按 id 在 states 里查找。 */
  state?: WorkItemState | null;
  onClick?: () => void;
  className?: string;
  isDragging?: boolean;
}

/**
 * 看板卡片。只负责展示，不持有状态。
 *
 * 逾期判断走状态组而不是旧的 status 字面量：状态模型迁移后
 * completed / cancelled 只是组，具体状态名由项目自定义。
 */
export const IssueCard: React.FC<IssueCardProps> = ({
  task,
  project,
  assignee,
  states,
  state,
  onClick,
  className = '',
  isDragging = false,
}) => {
  useLocale();
  const resolvedState = state ?? states?.find((item) => item.id === task.stateId) ?? null;

  const isOverdue = Boolean(
    task.dueDate &&
    !isCompleted(task, states) &&
    !isCancelled(task, states) &&
    new Date(task.dueDate) < new Date()
  );

  const formattedDueDate = task.dueDate ? formatTaskDueDate(task.dueDate) : null;
  const primaryTag = task.tags && task.tags.length > 0 ? task.tags[0] : null;
  const extraTagsCount = task.tags && task.tags.length > 1 ? task.tags.length - 1 : 0;

  return (
    <div
      onClick={onClick}
      className={`group relative flex flex-col justify-between gap-2.5 rounded-lg border border-edge bg-card p-3 text-left shadow-soft transition-all hover:border-subtle hover:shadow-panel select-none ${
        isDragging ? 'opacity-40 scale-[0.98]' : ''
      } ${className}`}
    >
      {/* Top identifier row */}
      <div className="flex items-center gap-2">
        {project?.color && (
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: project.color }}
            title={project.name}
          />
        )}
        <IssueIdentifier task={task} project={project} size="sm" />
        <StatePill state={resolvedState} group={task.stateGroup} size="sm" className="ml-auto" />
      </div>

      {/* Task title */}
      <h3 className="text-xs font-semibold leading-snug text-main line-clamp-2">
        {task.title}
      </h3>

      {/* Bottom metadata row */}
      <div className="flex items-center justify-between gap-1.5 pt-1 text-xs text-sub">
        <div className="flex items-center gap-2 min-w-0 overflow-hidden">
          {/* Assignee Avatar */}
          <MemberAvatar user={assignee} size="sm" showPresence={true} />

          {/* Primary Tag Pill */}
          {primaryTag && <LabelPill label={primaryTag} size="xs" />}
          {extraTagsCount > 0 && (
            <span className="text-[10px] text-quiet font-medium">+{extraTagsCount}</span>
          )}

          {/* Due date */}
          {formattedDueDate && (
            <span
              className={`inline-flex items-center gap-1 text-[11px] font-medium shrink-0 ${
                isOverdue ? 'text-danger' : 'text-sub'
              }`}
              title={isOverdue ? tr('tasks:listView.overdue') : tr('tasks:taskLayoutPanel.dueDate')}
            >
              {isOverdue ? (
                <AlertCircle className="w-3 h-3 stroke-[2.2] shrink-0" />
              ) : (
                <Calendar className="w-3 h-3 stroke-[1.8] shrink-0" />
              )}
              <span>{formattedDueDate}</span>
            </span>
          )}
        </div>

        {/* Priority signal bars */}
        <PrioritySignal priority={task.priority} size="sm" />
      </div>
    </div>
  );
};
