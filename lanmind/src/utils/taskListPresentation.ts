import { marked, type Token } from 'marked';
import { parseTaskDateTime, splitTaskDueDate } from './taskDateTime';

/** Keep saved time precision and include the year when it differs from the current year. */
export function formatTaskListDate(value: string | null | undefined, now = new Date()): string {
  const { date, time } = splitTaskDueDate(value);
  if (!date) return '';
  const label = date.startsWith(`${now.getFullYear()}-`) ? date.slice(5).replace('-', '/') : date.replaceAll('-', '/');
  return time ? `${label} ${time}` : label;
}

/** Summarize prose without leaking Markdown URLs or repeating checklist items. */
export function taskDescriptionPreview(markdown: string): string {
  const text = (tokens: Token[]): string => tokens.map((token) => {
    if (['html', 'image', 'code', 'codespan', 'space', 'hr', 'table'].includes(token.type)) {
      return token.type === 'codespan' ? token.text : ' ';
    }
    if (token.type === 'list') return `${token.items.filter((item) => !item.task).map((item) => text(item.tokens)).join(' ')} `;
    if ('tokens' in token && Array.isArray(token.tokens)) return text(token.tokens) + (['paragraph', 'heading', 'blockquote'].includes(token.type) ? ' ' : '');
    return 'text' in token && typeof token.text === 'string' ? token.text : ' ';
  }).join('');
  return text(marked.lexer(markdown)).replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ({
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  }[entity] || entity)).replace(/\s+/g, ' ').trim();
}

/** All-day tasks remain current for their entire local calendar day. */
export function isTaskOverdue(dueDate: string | null | undefined, now = new Date()): boolean {
  const parts = splitTaskDueDate(dueDate);
  const parsed = parseTaskDateTime(dueDate);
  if (!parsed) return false;
  if (parts.time) return parsed.getTime() < now.getTime();
  const dayEnd = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate() + 1);
  return dayEnd.getTime() <= now.getTime();
}
