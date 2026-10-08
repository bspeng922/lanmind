import { isTauri } from '@tauri-apps/api/core';
import { Task } from '../types';

export function taskIdFromLink(link: string): string | null {
  try {
    const url = new URL(link, 'https://lanmind.local/');
    if (url.protocol === 'lanmind:' && url.hostname === 'task' && /^\/[^/]+\/?$/.test(url.pathname)) {
      return decodeURIComponent(url.pathname.replace(/^\/|\/$/g, ''));
    }
    if (/^https?:$/.test(url.protocol) && /^#task\/[^/]+$/.test(url.hash)) return decodeURIComponent(url.hash.slice(6));
  } catch { /* Invalid or incomplete links are ordinary text. */ }
  return null;
}

export function taskReferenceUrl(task: Pick<Task, 'id'>) {
  return isTauri() ? `lanmind://task/${encodeURIComponent(task.id)}`
    : `${window.location.origin}${window.location.pathname}${window.location.search}#task/${encodeURIComponent(task.id)}`;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

export function taskReferenceMarkdown(task: Pick<Task, 'title'>, url: string) {
  return `[任务：${task.title.replace(/\\/g, '\\\\').replace(/([\[\]])/g, '\\$1').replace(/[\r\n]/g, ' ')}](${url})`;
}

export function taskReferenceHtml(task: Pick<Task, 'title'>, url: string) {
  return `<a data-lanmind-task="true" href="${escapeHtml(url)}" style="display:inline-block;border:1px solid #cbd5e1;border-radius:4px;padding:3px 7px;color:#2563eb;background:#f1f5f9;text-decoration:none;font-size:13px"><span style="font-size:11px;color:#64748b">任务</span> ${escapeHtml(task.title)}</a>`;
}

export async function copyTaskReference(task: Pick<Task, 'id' | 'title'>) {
  const url = taskReferenceUrl(task);
  const plain = taskReferenceMarkdown(task, url);
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([plain], { type: 'text/plain' }),
        'text/html': new Blob([taskReferenceHtml(task, url)], { type: 'text/html' }),
      })]);
      return;
    } catch { /* Some clipboard hosts support only plain text. */ }
  }
  if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(plain); return; }
  let copied = false;
  const copy = (event: ClipboardEvent) => {
    event.preventDefault();
    event.clipboardData?.setData('text/plain', plain);
    event.clipboardData?.setData('text/html', taskReferenceHtml(task, url));
    copied = Boolean(event.clipboardData);
  };
  document.addEventListener('copy', copy);
  try { document.execCommand('copy'); } finally { document.removeEventListener('copy', copy); }
  if (!copied) throw new Error('剪贴板不可用');
}

export function taskReferenceFromPaste(data: DataTransfer): string | null {
  const html = data.getData('text/html');
  if (!html) return null;
  const document = new DOMParser().parseFromString(html, 'text/html');
  const anchor = document.querySelector<HTMLAnchorElement>('a[data-lanmind-task]');
  const url = anchor?.getAttribute('href');
  if (!anchor || !url || !taskIdFromLink(url)) return null;
  return taskReferenceMarkdown({ title: (anchor.textContent || '').replace(/^\s*任务\s*/, '').trim() }, url);
}
