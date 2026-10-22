/**
 * ChildTaskItemCard — 子工作项单条卡片组件。
 * 支持单条子工作项的高效行内展示、Markdown 描述编辑与预览、属性精细化配置（状态/优先级/经办人/截止日期）。
 *
 * CALLING SPEC:
 *   <ChildTaskItemCard
 *     child={ChildTaskDraft}
 *     index={number}
 *     writable={boolean}
 *     isDone={boolean}
 *     childState={WorkItemState | undefined}
 *     stateOptions={ThemeSelectOption[]}
 *     priorityOptions={ThemeSelectOption[]}
 *     assigneeOptions={ThemeSelectOption[]}
 *     users={User[]}
 *     states={WorkItemState[]}
 *     isExpanded={boolean}
 *     onToggleExpand={() => void}
 *     onToggleDone={() => void}
 *     onUpdate={(patch: Partial<ChildTaskDraft>) => void}
 *     onDelete={() => void}
 *   />
 */

import React, { useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Code2,
  Eye,
  FileText,
  Trash2,
} from 'lucide-react';
import { ChildTaskDraft, TaskStatus, User, WorkItemState } from '../../types';
import { PrioritySignal } from '../workitem/PrioritySignal';
import { MemberAvatar } from '../workitem/MemberAvatar';
import { ThemeSelect, ThemeSelectOption } from '../ThemeSelect';
import { ThemeDatePicker } from '../ThemeDatePicker';
import { TaskMarkdown } from '../TaskMarkdown';
import { GROUP_TO_LEGACY_STATUS } from '../../utils/workItemState';
import { tr, useLocale } from '../../i18n';

interface ChildTaskItemCardProps {
  child: ChildTaskDraft;
  index: number;
  writable: boolean;
  isDone: boolean;
  childState?: WorkItemState;
  stateOptions: ThemeSelectOption[];
  priorityOptions: ThemeSelectOption[];
  assigneeOptions: ThemeSelectOption[];
  users: User[];
  states: WorkItemState[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  onToggleDone: () => void;
  onUpdate: (patch: Partial<ChildTaskDraft>) => void;
  onDelete: () => void;
}

export const ChildTaskItemCard: React.FC<ChildTaskItemCardProps> = ({
  child,
  index,
  writable,
  isDone,
  childState,
  stateOptions,
  priorityOptions,
  assigneeOptions,
  users,
  states,
  isExpanded,
  onToggleExpand,
  onToggleDone,
  onUpdate,
  onDelete,
}) => {
  useLocale();
  const [descViewMode, setDescViewMode] = useState<'edit' | 'preview'>('edit');
  const user = users.find((u) => u.id === child.assigneeId);
  const hasDescription = Boolean(child.description && child.description.trim().length > 0);

  return (
    <div
      className={`task-child-item group rounded-xl border transition-all ${
        isDone
          ? 'border-edge/50 bg-canvas/30 opacity-75'
          : 'border-edge bg-card/60 hover:border-subtle hover:bg-card/90 shadow-2xs'
      }`}
    >
      {/* 紧凑行头 */}
      <div className="flex items-center gap-2 p-2">
        {/* 完成状态勾选 */}
        <button
          type="button"
          disabled={!writable}
          onClick={onToggleDone}
          className="shrink-0 p-0.5 text-sub hover:text-main transition-transform active:scale-90"
          aria-label={isDone ? 'Mark as incomplete' : 'Mark as complete'}
        >
          {isDone ? (
            <CheckCircle2 className="h-4 w-4 text-success" />
          ) : (
            <span
              className="block h-3.5 w-3.5 rounded-full border border-sub/40 hover:border-accent transition-colors"
              style={{
                backgroundColor: childState?.color
                  ? `${childState.color}30`
                  : undefined,
                borderColor: childState?.color || undefined,
              }}
            />
          )}
        </button>

        {/* 序号 */}
        <span className="shrink-0 font-mono text-[10px] text-quiet select-none">
          #{index + 1}
        </span>

        {/* 标题输入框 */}
        <input
          type="text"
          required
          disabled={!writable}
          value={child.title}
          aria-label={tr('tasks:taskEditor.childTitle', { index: index + 1 })}
          onChange={(e) => onUpdate({ title: e.target.value })}
          placeholder={tr('tasks:childTasksEditor.enterTitle')}
          className={`min-w-0 flex-1 bg-transparent px-1.5 py-0.5 text-xs text-main placeholder:text-quiet/60 outline-none focus:bg-canvas focus:rounded transition-colors ${
            isDone ? 'line-through text-quiet' : ''
          }`}
        />

        {/* 描述指示标签（有内容时显示，点击快捷展开预览） */}
        {hasDescription && (
          <button
            type="button"
            onClick={onToggleExpand}
            className="hidden sm:inline-flex items-center gap-1 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/20 transition-colors shrink-0"
            title={tr('tasks:childTasksEditor.hasDescription')}
          >
            <FileText className="h-3 w-3" />
            <span>{tr('tasks:childTasksEditor.hasDescription')}</span>
          </button>
        )}

        {/* 优先级小条 */}
        <div className="shrink-0">
          <PrioritySignal priority={child.priority || 'P3'} size="sm" />
        </div>

        {/* 经办人头像 */}
        <div className="shrink-0">
          <MemberAvatar
            user={user}
            name={user?.nickname || user?.username || child.assigneeId || 'Unassigned'}
            size="xs"
          />
        </div>

        {/* 截止时间胶囊 */}
        {child.dueDate && (
          <span className="hidden sm:inline-flex items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5 text-[10px] text-sub shrink-0">
            <Calendar className="h-3 w-3 text-quiet" />
            <span>{child.dueDate.slice(5, 10)}</span>
          </span>
        )}

        {/* 展开/收起属性与描述面板 */}
        <button
          type="button"
          onClick={onToggleExpand}
          className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors shrink-0 ${
            isExpanded
              ? 'bg-hover text-main'
              : 'text-sub hover:bg-hover hover:text-main'
          }`}
          title={
            isExpanded
              ? tr('tasks:childTasksEditor.collapse')
              : tr('tasks:childTasksEditor.properties')
          }
        >
          <span>
            {isExpanded
              ? tr('tasks:childTasksEditor.collapse')
              : tr('tasks:childTasksEditor.properties')}
          </span>
          {isExpanded ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </button>

        {/* 删除子工作项 */}
        {writable && (
          <button
            type="button"
            onClick={onDelete}
            className="rounded p-1 text-quiet opacity-0 group-hover:opacity-100 hover:bg-danger/10 hover:text-danger transition-all shrink-0"
            title={tr('tasks:childTasksEditor.removeChildTask')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* 展开的详情面板：Markdown 描述 + 属性配置 */}
      {isExpanded && (
        <div className="border-t border-edge/60 bg-canvas/40 p-3 space-y-3">
          {/* 子任务描述区（右上角切换编辑/预览图标） */}
          <div className="relative group/desc-box">
            {/* 右上角快捷切换图标 */}
            <button
              type="button"
              onClick={() => setDescViewMode(descViewMode === 'edit' ? 'preview' : 'edit')}
              className="absolute top-2 right-2 z-10 flex h-6 w-6 items-center justify-center rounded-md border border-edge/60 bg-surface/90 text-sub hover:bg-hover hover:text-main shadow-2xs backdrop-blur-xs transition-colors"
              title={descViewMode === 'edit' ? tr('tasks:childTasksEditor.previewMarkdown') : tr('tasks:childTasksEditor.editMarkdown')}
              aria-label={descViewMode === 'edit' ? tr('tasks:childTasksEditor.previewMarkdown') : tr('tasks:childTasksEditor.editMarkdown')}
            >
              {descViewMode === 'edit' ? (
                <Eye className="h-3.5 w-3.5" />
              ) : (
                <Code2 className="h-3.5 w-3.5 text-accent" />
              )}
            </button>

            {descViewMode === 'edit' ? (
              <textarea
                disabled={!writable}
                value={child.description || ''}
                onChange={(e) => onUpdate({ description: e.target.value })}
                rows={3}
                placeholder={tr('tasks:childTasksEditor.descriptionPlaceholder')}
                className="w-full resize-y rounded-lg border border-subtle bg-surface px-2.5 py-2 pr-9 text-xs text-main placeholder:text-quiet/60 outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all font-mono leading-relaxed"
              />
            ) : (
              <div className="rounded-lg border border-subtle bg-surface/70 p-2.5 pr-9 min-h-[70px] max-h-44 overflow-y-auto">
                {hasDescription ? (
                  <TaskMarkdown value={child.description} />
                ) : (
                  <p className="text-xs text-quiet italic py-2">
                    {tr('tasks:childTasksEditor.noDescription')}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* 属性网格：状态 / 优先级 / 经办人 / 截止日期 */}
          <div className="border-t border-edge/50 pt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <div>
              <label className="block text-[10px] font-semibold text-quiet mb-1">
                {tr('tasks:childTasksEditor.status')}
              </label>
              <ThemeSelect portal
                value={child.stateId || child.status}
                options={
                  stateOptions.length
                    ? stateOptions
                    : [
                        { value: 'todo', label: tr('tasks:childTasksEditor.notStarted') },
                        { value: 'completed', label: tr('tasks:childTasksEditor.completed') },
                      ]
                }
                onChange={(next) => {
                  const picked = states.find((s) => s.id === next);
                  onUpdate({
                    stateId: picked?.id,
                    status: picked
                      ? GROUP_TO_LEGACY_STATUS[picked.group]
                      : (next as TaskStatus),
                  });
                }}
                disabled={!writable}
                ariaLabel={tr('tasks:childTasksEditor.status')}
              />
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-quiet mb-1">
                {tr('tasks:childTasksEditor.priority')}
              </label>
              <ThemeSelect portal
                value={child.priority || 'P3'}
                options={priorityOptions}
                onChange={(val) =>
                  onUpdate({ priority: val as ChildTaskDraft['priority'] })
                }
                disabled={!writable}
                ariaLabel={tr('tasks:childTasksEditor.priority')}
              />
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-quiet mb-1">
                {tr('tasks:childTasksEditor.assignee')}
              </label>
              <ThemeSelect portal
                value={child.assigneeId || ''}
                options={assigneeOptions}
                onChange={(val) => onUpdate({ assigneeId: val })}
                disabled={!writable}
                ariaLabel={tr('tasks:childTasksEditor.assignee')}
              />
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-quiet mb-1">
                {tr('tasks:childTasksEditor.dueDate')}
              </label>
              <ThemeDatePicker
                value={child.dueDate?.slice(0, 10) || ''}
                onChange={(dateStr) => onUpdate({ dueDate: dateStr || null })}
                placeholder={tr('tasks:childTasksEditor.notSet')}
                disabled={!writable}
                ariaLabel={tr('tasks:childTasksEditor.dueDate')}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
