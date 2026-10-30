/**
 * AllDayRow.tsx — Sticky all-day task lane above the time grid with undated tasks capsule.
 *
 * CALLING SPEC:
 *   <AllDayRow
 *     days={days}
 *     allDayTasksByDate={allDayTasksByDate}
 *     projects={projects}
 *     states={states}
 *     onTaskClick={(task, rect) => ...}
 *     onCreateTask={(dateStr) => ...}
 *     unscheduledCount={undated.length}
 *     onToggleUndated={() => ...}
 *   />
 */

import React from 'react';
import { Task, Project, WorkItemState } from '../../types';
import { tr } from '../../i18n';
import { getTaskEventStyle } from '../../utils/calendarTokens';
import { isCompleted } from '../../utils/workItemState';
import { PriorityFlag } from '../PriorityFlag';

interface AllDayRowProps {
  days: { dateStr: string; dateObj: Date }[];
  allDayTasksByDate: Map<string, Task[]>;
  projects?: Project[];
  states?: WorkItemState[];
  onTaskClick: (task: Task, rect: DOMRect) => void;
  onCreateTask: (dateStr: string) => void;
  unscheduledCount?: number;
  showUndated?: boolean;
  onToggleUndated?: () => void;
  compact?: boolean;
}

export function AllDayRow({
  days,
  allDayTasksByDate,
  projects = [],
  states = [],
  onTaskClick,
  onCreateTask,
  unscheduledCount = 0,
  showUndated = false,
  onToggleUndated,
  compact = false,
}: AllDayRowProps) {
  // Find maximum number of all-day chips in any visible day
  let maxChips = 1;
  for (const day of days) {
    const list = allDayTasksByDate.get(day.dateStr) || [];
    if (list.length > maxChips) maxChips = list.length;
  }

  const rowHeight = Math.max(34, 12 + maxChips * 24);

  return (
    <div
      className="flex w-full shrink-0 border-b border-edge bg-surface/90 select-none overflow-hidden"
      style={{ minHeight: `${rowHeight}px` }}
    >
      {/* Left Axis: All-Day Label & Undated Capsule Button (Per Decision 3) */}
      <div className="sticky left-0 z-20 flex w-14 shrink-0 flex-col items-center justify-center border-r border-edge bg-surface/95 px-1 py-1">
        <span className="text-[10px] font-semibold text-sub">{tr('calendar:calendarView.allDay', { defaultValue: '全天' })}</span>
        {unscheduledCount > 0 && onToggleUndated && (
          <button
            type="button"
            onClick={onToggleUndated}
            title={tr('tasks:taskLayoutPanel.noDueDate', { count: unscheduledCount })}
            className={`mt-1 flex items-center justify-center rounded-full px-1.5 py-0.5 text-[9px] font-bold transition-colors ${
              showUndated
                ? 'bg-accent text-on-accent'
                : 'bg-card text-sub hover:bg-hover hover:text-main border border-subtle'
            }`}
          >
            {unscheduledCount}
          </button>
        )}
      </div>

      {/* Columns for each day */}
      <div className="flex flex-1 min-w-0">
        {days.map((day) => {
          const tasks = allDayTasksByDate.get(day.dateStr) || [];
          return (
            <div
              key={day.dateStr}
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  onCreateTask(day.dateStr);
                }
              }}
              className="flex flex-1 min-w-0 flex-col gap-1 border-r border-edge/60 p-1 last:border-r-0 hover:bg-hover/30 transition-colors"
            >
              {tasks.map((task) => {
                const project = projects.find((p) => p.id === task.projectId);
                const style = getTaskEventStyle(task, project?.color);
                const completed = isCompleted(task, states);

                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onTaskClick(task, e.currentTarget.getBoundingClientRect());
                    }}
                    style={{
                      backgroundColor: style.background,
                      color: style.color,
                      borderColor: style.borderColor,
                    }}
                    className={`flex h-5 w-full shrink-0 items-center gap-1 truncate rounded border px-1.5 text-left text-[11px] font-medium outline-none transition-all hover:brightness-95 active:scale-[0.98] ${
                      completed ? 'line-through opacity-70' : ''
                    }`}
                  >
                    <span
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: style.dotColor }}
                    />
                    <span className="truncate">{task.title}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

