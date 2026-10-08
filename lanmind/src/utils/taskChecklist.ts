import { marked, Tokens } from 'marked';
import { Subtask } from '../types';
import { createId } from './createId';

interface ChecklistLine { start: number; end: number; prefix: string; suffix: string; title: string; completed: boolean }

function checklistLines(markdown: string): ChecklistLine[] {
  const positions: number[] = [];
  let normalized = '';
  for (let index = 0; index < markdown.length; index += 1) {
    positions.push(index);
    if (markdown[index] === '\r') {
      normalized += '\n';
      if (markdown[index + 1] === '\n') index += 1;
    } else normalized += markdown[index];
  }
  positions.push(markdown.length);
  const lines: ChecklistLine[] = [];
  let cursor = 0;
  for (const block of marked.lexer(normalized)) {
    let start = normalized.indexOf(block.raw, cursor);
    if (start < 0) start = normalized.indexOf(block.raw.trimEnd(), cursor);
    if (start < 0) continue;
    cursor = start + block.raw.length;
    if (block.type !== 'list') continue;
    let itemCursor = start;
    marked.walkTokens([block], (token) => {
      if (token.type !== 'list_item') return;
      const item = token as Tokens.ListItem;
      const itemStart = normalized.indexOf(item.raw, itemCursor);
      if (itemStart < start || itemStart >= cursor) return;
      const firstLine = normalized.slice(itemStart).split('\n', 1)[0];
      const match = firstLine.match(/^(\s*(?:[-+*]|\d+[.)])\s+)\[([ xX])\](\s+)(.*)$/);
      if (!match) return;
      lines.push({ start: positions[itemStart], end: positions[itemStart + firstLine.length], prefix: match[1], suffix: match[3], title: match[4], completed: match[2].toLowerCase() === 'x' });
      itemCursor = itemStart + firstLine.length;
    });
  }
  return lines.sort((a, b) => a.start - b.start);
}

export function checklistFromMarkdown(markdown: string, previous: Subtask[] = []): Subtask[] {
  const unused = new Set(previous.map((item) => item.id));
  const lines = checklistLines(markdown);
  const matched = lines.map((line) => {
    const existing = previous.find((item) => unused.has(item.id) && item.title === line.title);
    if (existing) unused.delete(existing.id);
    return existing;
  });
  return lines.map((line, index) => {
    const existing = matched[index] || (previous[index] && unused.has(previous[index].id) ? previous[index] : undefined);
    if (existing) unused.delete(existing.id);
    return { id: existing?.id || createId(), title: line.title, completed: line.completed };
  });
}

export function markdownWithChecklist(markdown: string, previous: Subtask[], next: Subtask[]): string {
  const lines = checklistLines(markdown);
  const current = checklistFromMarkdown(markdown, previous);
  const inserted = new Set<string>();
  let result = '';
  let cursor = 0;
  for (const [index, line] of lines.entries()) {
    result += markdown.slice(cursor, line.start);
    const item = next.find((candidate) => candidate.id === current[index].id);
    if (item) {
      inserted.add(item.id);
      result += `${line.prefix}[${item.completed ? 'x' : ' '}]${line.suffix}${item.title.replace(/\r?\n/g, ' ')}`;
    }
    cursor = line.end;
  }
  result += markdown.slice(cursor);
  const added = next.filter((item) => !inserted.has(item.id));
  if (added.length) {
    result += `${result && !result.endsWith('\n') ? '\n' : ''}${lines.length === 0 && result.trim() ? '\n' : ''}`
      + added.map((item) => `- [${item.completed ? 'x' : ' '}] ${item.title.replace(/\r?\n/g, ' ')}`).join('\n');
  }
  return result;
}

export function reconcileTaskChecklist(description: string, subtasks: Subtask[]) {
  const parsed = checklistFromMarkdown(description, subtasks);
  if (parsed.length || !subtasks.length) return { description, subtasks: parsed };
  return { description: markdownWithChecklist(description, [], subtasks), subtasks };
}
