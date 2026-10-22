export interface AskUserOption {
  label: string;
  description?: string;
}

export interface AskUserQuestion {
  question: string;
  options: AskUserOption[];
  multiple: boolean;
}

export interface AskUserRequest {
  question: string;
  questions: AskUserQuestion[];
}

// Textual calls have no persisted tool-call IDs. Present all requests in an
// assistant message as one form so its next reply answers a single submission.
export function combineAskUserRequests(requests: AskUserRequest[]): AskUserRequest {
  return {
    question: requests.map((request) => request.question).filter(Boolean).join('\n\n'),
    questions: requests.flatMap((request) => request.questions),
  };
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function readAskUser(value: unknown): AskUserRequest {
  const args = record(value);
  const questions: AskUserQuestion[] = [];
  if (Array.isArray(args.questions)) {
    for (const item of args.questions) {
      const group = record(item);
      if (typeof group.question !== 'string' || !group.question.trim() || !Array.isArray(group.options)) continue;
      const options = group.options.flatMap((item): AskUserOption[] => {
        const option = record(item);
        if (typeof option.label !== 'string' || !option.label.trim()) return [];
        return [{ label: option.label.trim(), ...(typeof option.description === 'string' ? { description: option.description.trim() } : {}) }];
      });
      if (options.length) questions.push({ question: group.question.trim(), options, multiple: group.multiple === true });
    }
  }
  return { question: typeof args.question === 'string' ? args.question.trim() : '', questions };
}

export function formatAskUserAnswer(request: AskUserRequest, selections: number[][], text: string): string {
  const parts = request.questions.flatMap((group, index) => {
    const selected = group.options.filter((_, option) => selections[index]?.includes(option));
    return selected.length ? [`${group.question}\n${selected.map((option) => `- ${option.label}`).join('\n')}`] : [];
  });
  if (text.trim()) parts.push(text.trim());
  return parts.join('\n\n');
}

export type AskUserContentPart = { type: 'markdown'; text: string } | { type: 'question'; request: AskUserRequest };

function inCode(content: string, offset: number): boolean {
  let fence = '';
  for (const line of content.slice(0, offset).split('\n')) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!match) continue;
    if (!fence) fence = match[1];
    else if (match[1][0] === fence[0] && match[1].length >= fence.length && !match[2].trim()) fence = '';
  }
  if (fence) return true;
  // An inline code example must remain ordinary Markdown, too.
  const line = content.slice(content.lastIndexOf('\n', offset - 1) + 1, offset);
  return (line.match(/`/g)?.length ?? 0) % 2 === 1;
}

const attribute = (attrs: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`).exec(attrs)?.[2];
const decodeEntities = (text: string) => text.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[\da-f]+);/gi, (entity, code: string) => {
  const named: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
  if (!code.startsWith('#')) return named[code.toLowerCase()] ?? entity;
  const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
  return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
});

// Presentation compatibility only. Textual tool markup never executes a tool or grants approval.
export function splitAskUserContent(content: string, streaming = false): AskUserContentPart[] {
  const parts: AskUserContentPart[] = [];
  const blocks = /<[|｜]{2}DSML[|｜]{2}\s+calls\s*>([\s\S]*?)<\/[|｜]{2}DSML[|｜]{2}\s+calls\s*>/g;
  let cursor = 0;
  for (const block of content.matchAll(blocks)) {
    if (inCode(content, block.index!)) continue;
    const calls = [...block[1].matchAll(/<[|｜]{2}DSML[|｜]{2}\s+invoke\b([^>]*)>([\s\S]*?)<\/[|｜]{2}DSML[|｜]{2}\s+invoke\s*>/g)];
    const requests: AskUserRequest[] = [];
    let consumed = '';
    for (const call of calls) {
      consumed += call[0];
      if (attribute(call[1], 'name') !== 'ask_user') break;
      const args: Record<string, unknown> = {};
      for (const param of call[2].matchAll(/<[|｜]{2}DSML[|｜]{2}\s+parameter\b([^>]*)>([\s\S]*?)<\/[|｜]{2}DSML[|｜]{2}\s+parameter\s*>/g)) {
        const name = attribute(param[1], 'name');
        const value = decodeEntities(param[2]);
        if (name === 'question') args.question = value;
        if (name === 'questions') {
          try { args.questions = JSON.parse(value); } catch { /* Preserve the readable question. */ }
        }
      }
      const request = readAskUser(args);
      if (!request.question) break;
      requests.push(request);
    }
    if (!requests.length || requests.length !== calls.length || block[1].replace(/\s/g, '') !== consumed.replace(/\s/g, '')) continue;
    if (block.index! > cursor) parts.push({ type: 'markdown', text: content.slice(cursor, block.index) });
    parts.push(...requests.map((request) => ({ type: 'question' as const, request })));
    cursor = block.index! + block[0].length;
  }
  let tail = content.slice(cursor);
  if (streaming) {
    const incomplete = /<[|｜]{2}DSML[|｜]{2}\s+calls\s*>/.exec(tail);
    if (incomplete && !inCode(content, cursor + incomplete.index) && !tail.slice(incomplete.index).match(/<\/[|｜]{2}DSML[|｜]{2}\s+calls\s*>/)) {
      tail = tail.slice(0, incomplete.index);
    }
  }
  if (tail) parts.push({ type: 'markdown', text: tail });
  return parts;
}
