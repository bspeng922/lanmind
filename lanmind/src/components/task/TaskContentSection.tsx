/**
 * TaskContentSection — 任务描述与检查项编辑区（支持 Markdown 与 Checklist 切换）。
 *
 * CALLING SPEC:
 *   <TaskContentSection
 *     contentMode={contentMode}
 *     onContentModeChange={setContentMode}
 *     description={description}
 *     onDescriptionChange={updateDescription}
 *     subtasks={subtasks}
 *     onUpdateChecklist={updateChecklist}
 *     attachments={attachments}
 *   />
 */

import React, { useState, useRef } from 'react';
import { ListChecks, Plus, Trash2 } from 'lucide-react';
import { Subtask, TaskAttachment, TaskContentMode } from '../../types';
import { TaskDescriptionEditor } from '../TaskDescriptionEditor';
import { ThemeCheckbox } from '../ThemeCheckbox';
import { createId } from '../../utils/createId';
import { tr, useLocale } from '../../i18n';

interface TaskContentSectionProps {
  contentMode: TaskContentMode;
  onContentModeChange: (mode: TaskContentMode) => void;
  description: string;
  onDescriptionChange: (desc: string) => void;
  subtasks: Subtask[];
  onUpdateChecklist: (subtasks: Subtask[]) => void;
  attachments: TaskAttachment[];
}

export const TaskContentSection: React.FC<TaskContentSectionProps> = ({
  contentMode,
  onContentModeChange,
  description,
  onDescriptionChange,
  subtasks,
  onUpdateChecklist,
  attachments,
}) => {
  useLocale();
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const newSubtaskInputRef = useRef<HTMLInputElement>(null);

  const handleAddSubtask = () => {
    if (!newSubtaskTitle.trim()) return;
    onUpdateChecklist([
      ...subtasks,
      { id: createId(), title: newSubtaskTitle.trim(), completed: false },
    ]);
    setNewSubtaskTitle('');
  };

  const handleRemoveSubtask = (id: string) => {
    onUpdateChecklist(subtasks.filter((s) => s.id !== id));
  };

  const handleToggleSubtask = (id: string, completed: boolean) => {
    onUpdateChecklist(
      subtasks.map((candidate) =>
        candidate.id === id ? { ...candidate, completed } : candidate
      )
    );
  };

  const handleRenameSubtask = (id: string, title: string) => {
    onUpdateChecklist(
      subtasks.map((candidate) =>
        candidate.id === id ? { ...candidate, title } : candidate
      )
    );
  };

  const modeControls = (
        <div className="task-content-modes" aria-label={tr('tasks:taskModal.content')}>
          <button
            type="button"
            aria-pressed={contentMode === 'markdown'}
            onClick={() => onContentModeChange('markdown')}
            className={`rounded px-2.5 py-1 text-[11px] transition-colors ${
              contentMode === 'markdown'
                ? 'bg-card font-semibold text-main'
                : 'text-sub hover:text-main'
            }`}
          >
            Markdown
          </button>
          <button
            type="button"
            aria-pressed={contentMode === 'checklist'}
            onClick={() => onContentModeChange('checklist')}
            className={`rounded px-2.5 py-1 text-[11px] transition-colors ${
              contentMode === 'checklist'
                ? 'bg-card font-semibold text-main'
                : 'text-sub hover:text-main'
            }`}
          >
            {tr('tasks:taskModal.checklist')}
          </button>
        </div>
  );
  return (
    <div className="task-content-section">
      {contentMode === 'markdown' ? (
        <TaskDescriptionEditor
          value={description}
          onChange={onDescriptionChange}
          attachments={attachments}
          toolbarStart={modeControls}
        />
      ) : (
        <div className="task-checklist-editor overflow-hidden rounded-lg border border-subtle bg-canvas">
          <div className="task-editor-toolbar">{modeControls}<span className="task-section-count">{subtasks.filter((item) => item.completed).length}/{subtasks.length}</span></div>
          <div className="max-h-64 divide-y divide-edge overflow-y-auto">
            {subtasks.map((item) => (
              <div
                key={item.id}
                className="flex min-h-10 items-center gap-2 px-3 py-2"
              >
                <ThemeCheckbox
                  id={`check-${item.id}`}
                  checked={item.completed}
                  onChange={(checked) => handleToggleSubtask(item.id, checked)}
                  size="sm"
                  ariaLabel={tr('tasks:taskModal.toggleChecklistItem', {
                    value0: item.title,
                  })}
                />
                <input
                  aria-label={tr('tasks:taskModal.checklistItem', {
                    value0: item.title,
                  })}
                  value={item.title}
                  onChange={(e) => handleRenameSubtask(item.id, e.target.value)}
                  className={`min-w-0 flex-1 border-0 bg-transparent text-xs ${
                    item.completed ? 'text-quiet line-through' : 'text-main'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => handleRemoveSubtask(item.id)}
                  className="text-quiet hover:text-danger p-1 transition-colors"
                  title={tr('tasks:taskModal.deleteChecklistItem')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {subtasks.length === 0 && (
              <div
                onClick={() => newSubtaskInputRef.current?.focus()}
                className="px-4 py-8 text-center cursor-pointer hover:bg-hover/20 transition-colors group/empty select-none"
              >
                <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-subtle/40 text-quiet group-hover/empty:bg-accent/10 group-hover/empty:text-accent transition-colors">
                  <ListChecks className="h-5 w-5" />
                </div>
                <div className="text-xs font-medium text-sub group-hover/empty:text-main">
                  {tr('tasks:taskModal.noChecklistItems')}
                </div>
                <p className="mt-1 text-[11px] text-quiet">
                  在下方输入框中输入检查项内容，按 Enter 键即可添加并跟踪完成进度
                </p>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 border-t border-edge p-2 bg-canvas/40">
            <input
              ref={newSubtaskInputRef}
              value={newSubtaskTitle}
              onChange={(e) => setNewSubtaskTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddSubtask();
                }
              }}
              placeholder={tr('tasks:taskModal.typeAndPressEnterToAddAn')}
              className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-xs text-main outline-none placeholder:text-quiet/60"
            />
            <button
              type="button"
              onClick={handleAddSubtask}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-sub hover:bg-hover hover:text-main transition-colors"
              title={tr('tasks:taskModal.addChecklistItem')}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
