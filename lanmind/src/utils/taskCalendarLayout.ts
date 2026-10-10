import { Task } from '../types';
import { expandTaskOccurrences, TaskOccurrence } from './recurrence';
import { compareTasks, matchesTaskDate, matchesTaskFields, ProjectLayout } from './taskLayout';

export function selectCalendarTasks(tasks: Task[], layout: ProjectLayout, search: string, start: string, end: string, now = new Date()) {
  const candidates = tasks.filter((task) => matchesTaskFields(task, layout, search));
  const tasksByDate = new Map<string, TaskOccurrence[]>();
  for (const task of candidates) {
    for (const occurrence of expandTaskOccurrences(task, start, end)) {
      if (!matchesTaskDate({ ...task, dueDate: occurrence.dueDate }, layout.dateFilter, now)) continue;
      const items = tasksByDate.get(occurrence.dateKey) || [];
      items.push(occurrence);
      tasksByDate.set(occurrence.dateKey, items);
    }
  }
  for (const items of tasksByDate.values()) {
    items.sort((a, b) => compareTasks({ ...a.task, dueDate: a.dueDate }, { ...b.task, dueDate: b.dueDate }, layout));
  }
  const undated = candidates.filter((task) => !task.dueDate && matchesTaskDate(task, layout.dateFilter, now))
    .sort((a, b) => compareTasks(a, b, layout));
  return { tasksByDate, undated };
}
