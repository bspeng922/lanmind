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

import React, { useState } from 'react';
import { AlignLeft, Plus, Trash2 } from 'lucide-react';
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

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-1.5 font-semibold text-sub">
          <AlignLeft className="h-3.5 w-3.5" />
          <span>{tr('tasks:taskModal.content')}</span>
        </label>
        <div className="flex rounded-md border border-subtle bg-canvas p-0.5">
          <button
            type="button"
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
      </div>

      {contentMode === 'markdown' ? (
        <TaskDescriptionEditor
          value={description}
          onChange={onDescriptionChange}
          attachments={attachments}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-subtle bg-canvas">
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
              <div className="px-3 py-6 text-center text-xs text-quiet">
                {tr('tasks:taskModal.noChecklistItems')}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 border-t border-edge p-2 bg-canvas/40">
            <input
              value={newSubtaskTitle}
              onChange={(e) => setNewSubtaskTitle(e.target.value)}
              onKeyDown={(e) => {
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
