/**
 * TaskDetailHeader — 工作项详情顶栏与面包屑导航。
 *
 * CALLING SPEC:
 *   <TaskDetailHeader
 *     project={project}
 *     identifier={identifier}
 *     activeTask={activeTask}
 *     canEdit={canEdit}
 *     hasPrevious={hasPrevious}
 *     hasNext={hasNext}
 *     onNavigatePrevious={onNavigatePrevious}
 *     onNavigateNext={onNavigateNext}
 *     onCopyLink={onCopyLink}
 *     onDuplicate={onDuplicate}
 *     onViewActivity={onViewActivity}
 *     onDelete={onDelete}
 *     onClose={onClose}
 *   />
 */

import React from 'react';
import {
  Folder,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  X,
  Sparkles,
} from 'lucide-react';
import { Project, Task } from '../../types';
import { TaskModalMoreMenu } from '../TaskModalMoreMenu';
import { IssueIdentifier } from '../workitem/IssueIdentifier';
import { tr, useLocale } from '../../i18n';

interface TaskDetailHeaderProps {
  project?: Project | null;
  identifier?: string;
  activeTask?: Task | null;
  canEdit?: boolean;
  hasPrevious?: boolean;
  hasNext?: boolean;
  onNavigatePrevious?: () => void;
  onNavigateNext?: () => void;
  onCopyLink?: () => void;
  onDuplicate?: () => void;
  onViewActivity?: () => void;
  onDelete?: () => void;
  onClose: () => void;
}

export const TaskDetailHeader: React.FC<TaskDetailHeaderProps> = ({
  project,
  identifier,
  activeTask,
  canEdit = true,
  hasPrevious = false,
  hasNext = false,
  onNavigatePrevious,
  onNavigateNext,
  onCopyLink,
  onDuplicate,
  onViewActivity,
  onDelete,
  onClose,
}) => {
  useLocale();

  return (
    <div className="relative z-40 flex flex-shrink-0 items-center justify-between border-b border-edge/80 bg-surface/80 px-4 py-3 backdrop-blur-xs sm:px-6">
      {/* 左侧：Linear/Plane 风格面包屑 */}
      <div className="flex min-w-0 items-center gap-1.5 text-xs text-sub">
        {project ? (
          <div className="flex items-center gap-1.5 font-medium text-main">
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: project.color || 'var(--accent)' }}
            />
            <span className="truncate max-w-[140px] sm:max-w-[200px]">{project.name}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 font-medium text-sub">
            <Folder className="h-3.5 w-3.5 text-feature" />
            <span>{tr('tasks:kanbanView.personalTask') || '个人任务'}</span>
          </div>
        )}

        <ChevronRight className="h-3.5 w-3.5 text-quiet shrink-0" />
        <span className="text-quiet shrink-0">{tr('common:header.lanTaskManagement') || 'Work items'}</span>

        {identifier && (
          <>
            <ChevronRight className="h-3.5 w-3.5 text-quiet shrink-0" />
            <IssueIdentifier identifier={identifier} className="shrink-0 text-xs font-semibold" />
          </>
        )}
      </div>

      {/* 右侧：上下翻页导航与快捷操作 */}
      <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
        {activeTask && (
          <>
            <button
              type="button"
              onClick={onNavigatePrevious}
              disabled={!hasPrevious}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-sub transition-colors hover:bg-hover hover:text-main disabled:opacity-30 disabled:cursor-not-allowed"
              title={tr('tasks:taskModal.previousTask')}
              aria-label={tr('tasks:taskModal.previousTask')}
            >
              <ChevronUp className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onNavigateNext}
              disabled={!hasNext}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-sub transition-colors hover:bg-hover hover:text-main disabled:opacity-30 disabled:cursor-not-allowed"
              title={tr('tasks:taskModal.nextTask')}
              aria-label={tr('tasks:taskModal.nextTask')}
            >
              <ChevronDown className="h-4 w-4" />
            </button>
            {onCopyLink && onDuplicate && onViewActivity && onDelete && (
              <TaskModalMoreMenu
                task={activeTask}
                canEdit={canEdit}
                onCopyLink={onCopyLink}
                onDuplicate={onDuplicate}
                onViewActivity={onViewActivity}
                onDelete={onDelete}
              />
            )}
          </>
        )}
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-sub transition-colors hover:bg-hover hover:text-main"
          title={tr('tasks:taskModal.closeEsc')}
          aria-label={tr('tasks:taskModal.close')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
