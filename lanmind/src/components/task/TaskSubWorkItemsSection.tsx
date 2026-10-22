/**
 * TaskSubWorkItemsSection — 子工作项列表容器区域（Plane/Linear 风格）。
 * 负责子工作项的增删改查聚合、完成度统整与展开状态管理。
 *
 * CALLING SPEC:
 *   <TaskSubWorkItemsSection
 *     value={childTasks}
 *     onChange={setChildTasks}
 *     users={assigneeOptions}
 *     defaultAssignee={assigneeId}
 *     canEdit={canEditTask}
 *     states={states}
 *   />
 */

import React, { useState } from 'react';
import {
  Plus,
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronRight,
  ListTodo,
} from 'lucide-react';
import { ChildTaskDraft, TaskStatus, User, WorkItemState } from '../../types';
import { ThemeSelectOption } from '../ThemeSelect';
import { createId } from '../../utils/createId';
import {
  GROUP_TO_LEGACY_STATUS,
  sortStates,
} from '../../utils/workItemState';
import { tr, useLocale } from '../../i18n';
import { ChildTaskItemCard } from './ChildTaskItemCard';

interface TaskSubWorkItemsSectionProps {
  value: ChildTaskDraft[];
  onChange: (children: ChildTaskDraft[]) => void;
  users: User[];
  defaultAssignee: string;
  canEdit: (id?: string) => boolean;
  states?: WorkItemState[];
}

export const TaskSubWorkItemsSection: React.FC<TaskSubWorkItemsSectionProps> = ({
  value = [],
  onChange,
  users = [],
  defaultAssignee = '',
  canEdit = (_id?: string) => true,
  states = [],
}) => {
  useLocale();
  const [isSectionOpen, setIsSectionOpen] = useState(true);
  const [expandedDraftIds, setExpandedDraftIds] = useState<Set<string>>(new Set());

  const orderedStates = sortStates(states);
  const stateOptions: ThemeSelectOption[] = orderedStates.map((s) => ({
    value: s.id,
    label: s.name,
  }));

  const priorityOptions: ThemeSelectOption[] = [
    { value: 'P1', label: 'P1' },
    { value: 'P2', label: 'P2' },
    { value: 'P3', label: 'P3' },
    { value: 'P4', label: 'P4' },
  ];

  const assigneeOptions: ThemeSelectOption[] = users.map((u) => ({
    value: u.id,
    label: u.nickname || u.username,
  }));

  const completedCount = value.filter(
    (c) =>
      c.status === 'completed' ||
      states.find((s) => s.id === c.stateId)?.group === 'completed',
  ).length;

  const updateChild = (key: string, patch: Partial<ChildTaskDraft>) => {
    onChange(
      value.map((child) =>
        child.draftId === key ? { ...child, ...patch } : child,
      ),
    );
  };

  const handleToggleExpand = (draftId: string) => {
    setExpandedDraftIds((prev) => {
      const next = new Set(prev);
      if (next.has(draftId)) {
        next.delete(draftId);
      } else {
        next.add(draftId);
      }
      return next;
    });
  };

  const handleAdd = () => {
    const draftId = createId();
    const initial =
      orderedStates.find((state) => state.group === 'unstarted' && state.isDefault) ??
      orderedStates.find((state) => state.group === 'unstarted') ??
      orderedStates[0];

    onChange([
      ...value,
      {
        draftId,
        title: '',
        description: '',
        priority: 'P3',
        stateId: initial?.id,
        status: GROUP_TO_LEGACY_STATUS[initial?.group ?? 'unstarted'],
        assigneeId: defaultAssignee,
        dueDate: null,
      },
    ]);
    setExpandedDraftIds((prev) => new Set(prev).add(draftId));
    setIsSectionOpen(true);
  };

  const handleDelete = (draftId: string) => {
    onChange(value.filter((item) => item.draftId !== draftId));
    setExpandedDraftIds((prev) => {
      const next = new Set(prev);
      next.delete(draftId);
      return next;
    });
  };

  return (
    <div className="task-child-editor space-y-2.5">
      {/* 头部：标题 + 展开/折叠 + 完成度徽章 + 新建按钮 */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setIsSectionOpen(!isSectionOpen)}
          aria-expanded={isSectionOpen}
          className="flex items-center gap-2 text-xs font-bold text-main hover:text-sub transition-colors select-none"
        >
          {isSectionOpen ? (
            <ChevronDown className="h-3.5 w-3.5 text-sub" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-sub" />
          )}
          <span className="flex items-center gap-1.5">
            <ListTodo className="h-3.5 w-3.5 text-info" />
            <span>{tr('tasks:childTasksEditor.subWorkItems')}</span>
          </span>
          <span className="rounded-full bg-hover px-2 py-0.5 text-[10px] font-semibold text-sub border border-edge/60">
            {value.length}
          </span>
        </button>

        <div className="flex items-center gap-2.5">
          {value.length > 0 && (
            <div className="flex items-center gap-1.5 rounded-full bg-hover/80 px-2.5 py-0.5 text-[11px] font-medium text-sub border border-edge/60">
              {completedCount === value.length && value.length > 0 ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
              ) : (
                <Circle className="h-3 w-3 text-quiet" />
              )}
              <span>
                {tr('tasks:childTasksEditor.doneCount', {
                  completed: completedCount,
                  total: value.length,
                })}
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={handleAdd}
            className="inline-flex items-center gap-1 rounded-lg border border-subtle bg-surface px-2.5 py-1 text-[11px] font-medium text-sub hover:text-main hover:bg-hover transition-colors shadow-2xs active:scale-95"
          >
            <Plus className="h-3.5 w-3.5 text-info" />
            <span>{tr('tasks:childTasksEditor.addChildTask')}</span>
          </button>
        </div>
      </div>

      {/* 列表项 */}
      {isSectionOpen && value.length > 0 && (
        <div className="space-y-2 pt-1">
          {
            value.map((child, index) => {
              const writable = canEdit(child.id);
              const isDone =
                child.status === 'completed' ||
                states.find((s) => s.id === child.stateId)?.group === 'completed';
              const childState = child.stateId
                ? states.find((s) => s.id === child.stateId)
                : undefined;
              const isExpanded = expandedDraftIds.has(child.draftId);

              return (
                <ChildTaskItemCard
                  key={child.draftId}
                  child={child}
                  index={index}
                  writable={writable}
                  isDone={isDone}
                  childState={childState}
                  stateOptions={stateOptions}
                  priorityOptions={priorityOptions}
                  assigneeOptions={assigneeOptions}
                  users={users}
                  states={states}
                  isExpanded={isExpanded}
                  onToggleExpand={() => handleToggleExpand(child.draftId)}
                  onToggleDone={() => {
                    const completedState = orderedStates.find((s) => s.group === 'completed');
                    const unstartedState = orderedStates.find((s) => s.group === 'unstarted');
                    if (isDone) {
                      updateChild(child.draftId, {
                        status: 'todo',
                        stateId: unstartedState?.id,
                      });
                    } else {
                      updateChild(child.draftId, {
                        status: 'completed',
                        stateId: completedState?.id,
                      });
                    }
                  }}
                  onUpdate={(patch) => updateChild(child.draftId, patch)}
                  onDelete={() => handleDelete(child.draftId)}
                />
              );
            })
          }
        </div>
      )}
    </div>
  );
};
