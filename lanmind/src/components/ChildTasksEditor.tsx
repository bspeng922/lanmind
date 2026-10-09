import { tr, useLocale } from "../i18n";
import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Link2, Plus, X } from 'lucide-react';
import { ChildTaskDraft, User } from '../types';
import { ThemeSelect } from './ThemeSelect';
import { ThemeDatePicker } from './ThemeDatePicker';
import { createId } from '../utils/createId';

interface ChildTasksEditorProps {
  value: ChildTaskDraft[];
  onChange: (children: ChildTaskDraft[]) => void;
  users: User[];
  defaultAssignee: string;
  canEdit: (id?: string) => boolean;
}

export const ChildTasksEditor: React.FC<ChildTasksEditorProps> = ({ value, onChange, users, defaultAssignee, canEdit }: ChildTasksEditorProps) => {
  useLocale();
  const [expanded, setExpanded] = useState<string | null>(null);
  const update = (key: string, patch: Partial<ChildTaskDraft>) => onChange(value.map((child) => child.draftId === key ? { ...child, ...patch } : child));
  return <section className="task-child-editor space-y-2 border-t border-edge pt-4" aria-label={tr("tasks:childTasksEditor.editChildTasks")}>
    <div className="flex items-center justify-between gap-2"><h3 className="flex items-center gap-1.5 text-xs font-semibold text-sub"><Link2 className="h-3.5 w-3.5" />{tr("tasks:childTasksEditor.childTasks")}<span className="font-normal text-quiet">{value.length}</span></h3>
      <button type="button" onClick={() => { const draftId = createId(); onChange([...value, { draftId, title: '', description: '', priority: 'P4', status: 'todo', assigneeId: defaultAssignee, dueDate: null }]); setExpanded(draftId); }} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-info hover:bg-hover" aria-label={tr("tasks:childTasksEditor.addChildTask")}><Plus className="h-3.5 w-3.5" />{tr("tasks:childTasksEditor.addChildTask")}</button>
    </div>
    {value.map((child, index) => {
      const writable = canEdit(child.id);
      const open = expanded === child.draftId;
      return <div key={child.draftId} className="border-b border-edge pb-2" data-child-id={child.id || child.draftId}>
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${child.status === 'completed' ? 'bg-success' : child.status === 'blocked' ? 'bg-danger' : 'bg-info'}`} />
          <input aria-label={tr("tasks:childTasksEditor.childTaskName", { value0: index + 1 })} required value={child.title} disabled={!writable} onChange={(event) => update(child.draftId, { title: event.target.value })} placeholder={tr("tasks:childTasksEditor.childTaskName2")} className="min-w-0 flex-1 rounded-md border border-subtle bg-canvas px-2.5 py-2 text-xs text-main" />
          <button type="button" onClick={() => setExpanded(open ? null : child.draftId)} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-sub hover:bg-hover" title={open ? tr("tasks:childTasksEditor.collapseChildTaskProperties") : tr("tasks:childTasksEditor.editChildTaskProperties")} aria-label={open ? tr("tasks:childTasksEditor.collapseChildTaskProperties") : tr("tasks:childTasksEditor.editChildTaskProperties")}>{open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}</button>
          {writable && <button type="button" onClick={() => onChange(value.filter((item) => item.draftId !== child.draftId))} title={child.id ? tr("tasks:childTasksEditor.detachChildTask") : tr("tasks:childTasksEditor.removeChildTask")} aria-label={child.id ? tr("tasks:childTasksEditor.detachChildTask") : tr("tasks:childTasksEditor.removeChildTask")} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-quiet hover:bg-hover hover:text-danger"><X className="h-3.5 w-3.5" /></button>}
        </div>
        {open && <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-[11px] text-sub"><span>{tr("tasks:childTasksEditor.status")}</span><ThemeSelect portal ariaLabel={tr("tasks:childTasksEditor.childTaskStatus", { value0: index + 1 })} disabled={!writable} value={child.status} options={[{ value: 'todo', label: tr("tasks:childTasksEditor.notStarted") }, { value: 'in_progress', label: tr("tasks:childTasksEditor.inProgress") }, { value: 'blocked', label: tr("tasks:childTasksEditor.blocked") }, { value: 'completed', label: tr("tasks:childTasksEditor.completed") }, { value: 'abandoned', label: tr("tasks:childTasksEditor.abandoned") }]} onChange={(status) => update(child.draftId, { status: status as ChildTaskDraft['status'] })} /></label>
          <label className="space-y-1 text-[11px] text-sub"><span>{tr("tasks:childTasksEditor.priority")}</span><ThemeSelect portal ariaLabel={tr("tasks:childTasksEditor.childTaskPriority", { value0: index + 1 })} disabled={!writable} value={child.priority} options={['P1', 'P2', 'P3', 'P4'].map((value) => ({ value, label: value }))} onChange={(priority) => update(child.draftId, { priority: priority as ChildTaskDraft['priority'] })} /></label>
          <label className="space-y-1 text-[11px] text-sub"><span>{tr("tasks:childTasksEditor.assignee")}</span><ThemeSelect portal ariaLabel={tr("tasks:childTasksEditor.childTaskAssignee", { value0: index + 1 })} disabled={!writable} value={child.assigneeId} options={users.map((user) => ({ value: user.id, label: user.nickname }))} onChange={(assigneeId) => update(child.draftId, { assigneeId })} /></label>
          <label className="space-y-1 text-[11px] text-sub"><span>{tr("tasks:childTasksEditor.dueDate")}</span><ThemeDatePicker ariaLabel={tr("tasks:childTasksEditor.childTaskDueDate", { value0: index + 1 })} disabled={!writable} value={child.dueDate?.slice(0, 10) || ''} onChange={(dueDate) => update(child.draftId, { dueDate: dueDate || null })} placeholder={tr("tasks:childTasksEditor.notSet")} /></label>
          <label className="space-y-1 text-[11px] text-sub sm:col-span-2"><span>{tr("tasks:childTasksEditor.taskContent")}</span><textarea aria-label={tr("tasks:childTasksEditor.childTaskContent", { value0: index + 1 })} disabled={!writable} value={child.description} onChange={(event) => update(child.draftId, { description: event.target.value })} rows={3} className="w-full resize-y rounded-md border border-subtle bg-canvas px-2.5 py-2 text-xs text-main" /></label>
        </div>}
      </div>;
    })}
    {!value.length && <p className="text-[11px] text-quiet">{tr("tasks:childTasksEditor.noChildTasks")}</p>}
  </section>;
};
