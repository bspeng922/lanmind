/**
 * ReportTaskList — Renders matched period tasks with summary metrics and task cards.
 *
 * CALLING SPEC:
 *   <ReportTaskList
 *     tasks={tasks}
 *     projects={projects}
 *     currentUser={currentUser}
 *     title="周期任务清单"
 *     dateRangeLabel="2026-09-23 ~ 2026-09-23"
 *     emptyMessage="当前周期内暂无任务记录"
 *   />
 */

import React, { useMemo } from 'react';
import { Project, ReportSourceTask, Task, User } from '../types';
import { calculateTaskStats, TASK_STATUS_META } from '../utils/reportDateRange';
import { AlertCircle, Calendar, CheckCircle2, Clock, ListChecks } from 'lucide-react';

export interface ReportTaskListProps {
  tasks: Array<Task | ReportSourceTask>;
  projects: Project[];
  currentUser: User;
  title?: string;
  dateRangeLabel?: string;
  emptyMessage?: string;
  emptyHint?: string;
  testId?: string;
}

export const ReportTaskList: React.FC<ReportTaskListProps> = ({
  tasks,
  projects,
  currentUser,
  title,
  dateRangeLabel,
  emptyMessage = '本次汇报没有匹配的原始任务',
  emptyHint = '您可以尝试调整左侧的统计周期、起止日期或项目范围。',
  testId = 'report-source-tasks',
}) => {
  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );

  const stats = useMemo(() => calculateTaskStats(tasks), [tasks]);

  if (tasks.length === 0) {
    return (
      <div className="flex min-h-[360px] flex-1 flex-col items-center justify-center px-6 py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-edge/60 bg-surface/80 text-quiet">
          <ListChecks className="h-6 w-6" />
        </div>
        <p className="mt-4 text-sm font-medium text-main">{emptyMessage}</p>
        <p className="mt-1.5 max-w-sm text-xs leading-5 text-quiet">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-4 sm:px-8 sm:py-6">
      {/* Header & Metric summary pills */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-edge/60 pb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-main">{title || '原始工作任务'}</h2>
            {dateRangeLabel && (
              <span className="rounded bg-surface px-2 py-0.5 text-[11px] font-mono text-quiet">
                {dateRangeLabel}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="inline-flex items-center gap-1 rounded border border-edge bg-surface/70 px-2 py-0.5 text-sub">
            <span className="font-semibold text-main">{stats.total}</span>
            <span>总计</span>
          </span>
          <span className="inline-flex items-center gap-1 rounded border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-success">
            <CheckCircle2 className="h-3 w-3" />
            <span className="font-semibold">{stats.completed}</span>
            <span>已完成</span>
          </span>
          <span className="inline-flex items-center gap-1 rounded border border-sky-500/25 bg-sky-500/10 px-2 py-0.5 text-info">
            <Clock className="h-3 w-3" />
            <span className="font-semibold">{stats.inProgress}</span>
            <span>进行中</span>
          </span>
          {stats.blocked > 0 && (
            <span className="inline-flex items-center gap-1 rounded border border-rose-500/25 bg-rose-500/10 px-2 py-0.5 text-danger">
              <AlertCircle className="h-3 w-3" />
              <span className="font-semibold">{stats.blocked}</span>
              <span>阻塞</span>
            </span>
          )}
          {stats.todo > 0 && (
            <span className="inline-flex items-center gap-1 rounded border border-subtle bg-surface/70 px-2 py-0.5 text-sub">
              <span className="font-semibold">{stats.todo}</span>
              <span>待处理</span>
            </span>
          )}
        </div>
      </div>

      {/* Task items list */}
      <ul className="divide-y divide-edge border-y border-edge" data-testid={testId}>
        {tasks.map((task) => {
          const status = TASK_STATUS_META[task.status] || {
            label: task.status,
            className: 'border-subtle text-sub',
          };
          const projectName = task.projectId
            ? projectNames.get(task.projectId) || task.projectId
            : '个人任务';
          const assignee =
            task.assigneeId === currentUser.id
              ? `${currentUser.nickname} (我)`
              : task.assigneeId || '未指定';

          return (
            <li key={task.id} className="py-4 first:pt-3 last:pb-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold leading-5 text-main">{task.title}</h3>
                    <span
                      className={`border px-1.5 py-0.5 text-[10px] font-medium ${status.className}`}
                    >
                      {status.label}
                    </span>
                    <span className="border border-subtle px-1.5 py-0.5 text-[10px] font-medium text-sub">
                      {task.priority}
                    </span>
                  </div>

                  {task.description && (
                    <p className="mt-1.5 text-xs leading-5 text-sub line-clamp-2">
                      {task.description}
                    </p>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-quiet">
                    <span className="font-medium text-sub">{projectName}</span>
                    <span>负责人：{assignee}</span>
                    <span>更新：{task.updatedAt?.slice(0, 10)}</span>
                    {task.dueDate && (
                      <span className="inline-flex items-center gap-1 text-sub">
                        <Calendar className="h-3 w-3 text-quiet" />
                        <span>截止：{task.dueDate.slice(0, 10)}</span>
                      </span>
                    )}
                  </div>

                  {task.tags && task.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {task.tags.map((tag) => (
                        <span key={tag} className="bg-card px-1.5 py-0.5 text-[10px] text-sub">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
