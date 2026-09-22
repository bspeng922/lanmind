import { Task } from '../types';

export interface TaskTagUsage {
  tag: string;
  count: number;
}

/**
 * Counts tags across tasks and keeps the first-seen order for equal counts.
 * A tag is counted once per task so malformed duplicate entries do not skew
 * the popularity ranking.
 */
export function getTaskTagUsage(tasks: Array<Pick<Task, 'tags'>>): TaskTagUsage[] {
  const counts = new Map<string, { count: number; firstSeen: number }>();
  let nextFirstSeen = 0;

  for (const task of tasks) {
    const tagsInTask = new Set(
      (Array.isArray(task.tags) ? task.tags : [])
        .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
        .filter(Boolean),
    );

    for (const tag of tagsInTask) {
      const current = counts.get(tag);
      if (current) {
        current.count += 1;
      } else {
        counts.set(tag, { count: 1, firstSeen: nextFirstSeen++ });
      }
    }
  }

  return Array.from(counts, ([tag, usage]) => ({ tag, count: usage.count }))
    .sort((left, right) => {
      const countDifference = right.count - left.count;
      if (countDifference !== 0) return countDifference;
      return counts.get(left.tag)!.firstSeen - counts.get(right.tag)!.firstSeen;
    });
}
