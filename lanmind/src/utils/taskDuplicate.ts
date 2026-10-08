import { ChildTaskDraft, Task } from '../types';
import { createId } from './createId';
import { markdownWithChecklist, reconcileTaskChecklist } from './taskChecklist';

function attachmentCopies(task: Task) {
  let files = task.attachments || [];
  if (!files.length && typeof localStorage !== 'undefined') {
    try {
      const stored = JSON.parse(localStorage.getItem(`lanmind_task_attachments:${task.id}`) || '[]');
      if (Array.isArray(stored)) files = stored;
    } catch { /* Ignore legacy attachment caches that are not valid JSON. */ }
  }
  return files.map((file) => ({ originalId: file.id, copy: { ...file, id: createId() } }));
}

function copyFields(source: Task, currentUserId: string): Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'version'> {
  const content = reconcileTaskChecklist(source.description || '', source.subtasks || []);
  const resetChecks = content.subtasks.map((item) => ({ ...item, completed: false }));
  const attachments = attachmentCopies(source);
  const attachmentIds = new Map(attachments.map(({ originalId, copy }) => [encodeURIComponent(originalId), encodeURIComponent(copy.id)]));
  const description = markdownWithChecklist(content.description, content.subtasks, resetChecks)
    .replace(/lanmind-attachment:([^\s)>"']+)/g, (reference, id: string) => attachmentIds.has(id) ? `lanmind-attachment:${attachmentIds.get(id)}` : reference);
  return {
    title: source.title,
    description,
    priority: source.priority,
    status: 'todo',
    progress: 0,
    startDate: source.startDate || null,
    dueDate: source.dueDate,
    recurrence: source.recurrence || 'none',
    recurrenceRule: source.recurrenceRule || null,
    reminderTime: source.reminderTime || null,
    creatorId: currentUserId,
    assigneeId: source.assigneeId,
    projectId: source.projectId,
    parentTaskId: null,
    contentMode: source.contentMode || 'markdown',
    isShared: source.isShared,
    sharedWith: [...(source.sharedWith || [])],
    subtasks: resetChecks.map((item) => ({ ...item, id: createId() })),
    attachments: attachments.map(({ copy }) => copy),
    tags: [...(source.tags || [])],
  };
}

/** Copies form a new family. Original task, checklist and attachment IDs are never reused. */
export function buildTaskDuplicate(source: Task, tasks: Task[], currentUserId: string) {
  const task = { ...copyFields(source, currentUserId), title: `${source.title}（副本）` };
  const childTasks: ChildTaskDraft[] = tasks.filter((candidate) => candidate.parentTaskId === source.id)
    .map((child) => ({ ...copyFields(child, currentUserId), draftId: createId() }));
  return { task, childTasks };
}
