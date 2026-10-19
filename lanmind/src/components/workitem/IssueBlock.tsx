import React from 'react';
import { AlertCircle, Calendar, ChevronRight } from 'lucide-react';
import { tr, useLocale } from '../../i18n';
import type { Project, Task, User, WorkItemState } from '../../types';
import { formatTaskDueDate } from '../../utils/taskDateTime';
import { isCancelled, isCompleted } from '../../utils/workItemState';
import { IssueIdentifier } from './IssueIdentifier';
import { LabelPill } from './LabelPill';
import { MemberAvatar } from './MemberAvatar';
import { PrioritySignal } from './PrioritySignal';
import { StatePill } from './StatePill';

interface IssueBlockProps {
  task: Task;
  project?: Project;
  assignee?: User;
  /** 项目状态定义，用于把 stateId 还原成状态名与颜色。 */
  states?: WorkItemState[];
  /** 该任务对应的状态定义。缺省时按 id 在 states 里查找。 */
  state?: WorkItemState | null;
  hasChildren?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: (e: React.MouseEvent) => void;
  nestingLevel?: number;
  onClick?: () => void;
  className?: string;
}

/**
 * 列表视图的一行。与 IssueCard 共用同一套状态解析：逾期判断同样走状态组，
 * 不再比较旧的 status 字面量。
 */
export const IssueBlock: React.FC<IssueBlockProps> = ({
  task,
  project,
  assignee,
  states,
  state,
  hasChildren = false,
  isExpanded = false,
  onToggleExpand,
  nestingLevel = 0,
  onClick,
  className = '',
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
      style={{ paddingLeft: nestingLevel > 0 ? `${nestingLevel * 28 + 12}px` : '12px' }}
      className={`group flex items-center justify-between gap-3 h-11 border-b border-subtle/60 hover:bg-hover px-3 cursor-pointer select-none transition-colors ${className}`}
    >
      {/* Left section: expand chevron, identifier, state, title */}
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        {/* Child nesting expand arrow */}
        {hasChildren ? (
          <button
            type="button"
            onClick={onToggleExpand}
            aria-expanded={isExpanded}
            className="p-0.5 rounded text-quiet hover:text-main transition-colors"
          >
            <ChevronRight
              className={`w-3.5 h-3.5 transition-transform duration-150 ${
                isExpanded ? 'rotate-90' : ''
              }`}
            />
          </button>
        ) : nestingLevel > 0 ? (
          <span className="w-3.5 h-3.5 shrink-0" />
        ) : null}

        {/* Project color indicator */}
        {project?.color && (
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: project.color }}
            title={project.name}
          />
        )}

        {/* Short Issue ID */}
        <IssueIdentifier task={task} project={project} size="sm" className="shrink-0" />

        <StatePill state={resolvedState} group={task.stateGroup} showLabel={false} size="sm" className="shrink-0" />

        {/* Title */}
        <span className="text-xs font-medium text-main truncate group-hover:text-info transition-colors">
          {task.title}
        </span>
      </div>

      {/* Right metadata controls: Assignee, Tags, Due Date, Priority */}
      <div className="flex items-center gap-3 shrink-0 text-xs text-sub">
        {/* Assignee Avatar */}
        <MemberAvatar user={assignee} size="sm" showPresence={true} />

        {/* Label Tag */}
        {primaryTag && <LabelPill label={primaryTag} size="xs" />}
        {extraTagsCount > 0 && (
          <span className="text-[10px] text-quiet font-medium">+{extraTagsCount}</span>
        )}

        {/* Due date */}
        {formattedDueDate && (
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-medium ${
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

        {/* Priority Signal */}
        <PrioritySignal priority={task.priority} size="sm" />
      </div>
    </div>
  );
};
