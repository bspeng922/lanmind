import { tr } from './core';
import { resources } from './resources';
import errorPatterns from './error-patterns.json';

export interface MessageDescriptor { code: string; params?: Record<string, string>; error?: string }
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
type Pattern = { code: string; regex: RegExp; names: string[] };
const exact = new Map<string, string>();
const patterns: Pattern[] = [];

function add(code: string, template: string) {
  const names: string[] = [];
  let offset = 0;
  let expression = '^';
  for (const match of template.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) {
    expression += escapeRegex(template.slice(offset, match.index)) + '([\\s\\S]*?)';
    names.push(match[1]); offset = match.index! + match[0].length;
  }
  if (!names.length) { exact.set(template, code); return; }
  expression += escapeRegex(template.slice(offset)) + '$';
  if (template.replace(/\{\{.*?\}\}/g, '').trim().length < 4) return;
  patterns.push({ code, regex: new RegExp(expression), names });
}
function flatten(data: object, prefix: string) {
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') add(`${prefix}${key}`, value);
    else if (value && typeof value === 'object') flatten(value, `${prefix}${key}.`);
  }
}
// Only use this adapter for system messages. Never apply it to user content.
for (const locale of Object.values(resources)) {
  for (const [namespace, data] of Object.entries(locale)) flatten(data, `${namespace}:`);
}
for (const { key, source } of errorPatterns) {
  let index = 0;
  add(key, source.replace(/\{(\w*?)\}/g, (_, name) => `{{${name || `arg${index++}`}}}`));
}

export function describeMessage(message: string): MessageDescriptor | undefined {
  const code = exact.get(message);
  if (code) return { code };
  for (const pattern of patterns) {
    const match = pattern.regex.exec(message);
    if (match) return { code: pattern.code, params: Object.fromEntries(pattern.names.map((name, i) => [name, match[i + 1]])) };
  }
  return undefined;
}

export function localizeMessage(message: string | MessageDescriptor): string {
  if (typeof message === 'string' && message.startsWith('Error: ')) return localizeMessage(message.slice(7));
  const descriptor = typeof message === 'string' ? describeMessage(message) : message;
  if (!descriptor) return String(message);
  const translated = tr(descriptor.code, descriptor.params);
  return translated === descriptor.code ? descriptor.error || (typeof message === 'string' ? message : tr('errors:unknown')) : translated;
}

export function localizedError(value: unknown): Error {
  const raw = value instanceof Error ? value.message : typeof value === 'string' ? value
    : value && typeof value === 'object' && 'error' in value ? String(value.error) : tr('errors:unknown');
  const descriptor = value && typeof value === 'object' && 'code' in value && typeof value.code === 'string'
    ? value as MessageDescriptor : describeMessage(raw);
  const error = new Error(raw);
  Object.defineProperty(error, 'message', { configurable: true, get: () => localizeMessage(descriptor || raw) });
  return error;
}
