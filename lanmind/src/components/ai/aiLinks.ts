import { isTauri } from '@tauri-apps/api/core';
import { getWorkspaceContext } from '../../utils/workspaceContext';
import { tr } from '../../i18n';
import type { Conversation } from './aiClient';

export function aiConversationIdFromLink(link: string, checkWorkspace = true): string | null {
  try {
    const url = new URL(link, 'https://lanmind.local/');
    const workspace = url.searchParams.get('workspace');
    if (checkWorkspace && workspace && workspace !== getWorkspaceContext()?.workspaceId) return null;
    if (url.protocol === 'lanmind:' && url.hostname === 'ai' && /^\/[^/]+\/?$/.test(url.pathname)) {
      return decodeURIComponent(url.pathname.replace(/^\/|\/$/g, ''));
    }
    if (/^https?:$/.test(url.protocol) && /^#\/?ai\/[^/]+$/.test(url.hash)) {
      return decodeURIComponent(url.hash.replace(/^#\/?ai\//, ''));
    }
  } catch {
    /* Invalid links remain ordinary text. */
  }
  return null;
}

export function aiConversationReferenceUrl(conversation: Pick<Conversation, 'id'>) {
  const scope = getWorkspaceContext();
  const query = scope ? `?workspace=${encodeURIComponent(scope.workspaceId)}` : '';
  const origin = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : 'http://localhost:3000/';
  const search = typeof window !== 'undefined' ? window.location.search : '';
  return isTauri()
    ? `lanmind://ai/${encodeURIComponent(conversation.id)}${query}`
    : `${origin}${query || search}#/ai/${encodeURIComponent(conversation.id)}`;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

export function aiConversationReferenceMarkdown(conversation: Pick<Conversation, 'title'>, url: string) {
  const title = (conversation.title || '').trim() || tr('ai:conversation.untitled') || '未命名对话';
  return tr('common:aiLinks.ai', {
    value0: title.replace(/\\/g, '\\\\').replace(/([\[\]])/g, '\\$1').replace(/[\r\n]/g, ' '),
    value1: url,
  });
}

export function aiConversationReferenceHtml(conversation: Pick<Conversation, 'title'>, url: string) {
  const title = (conversation.title || '').trim() || tr('ai:conversation.untitled') || '未命名对话';
  return tr('common:aiLinks.aDataLanmindAiTrueHrefStyle', {
    value0: escapeHtml(url),
    value1: escapeHtml(title),
  });
}

export async function copyAIConversationReference(conversation: Pick<Conversation, 'id' | 'title'>) {
  const url = aiConversationReferenceUrl(conversation);
  const plain = aiConversationReferenceMarkdown(conversation, url);
  const html = aiConversationReferenceHtml(conversation, url);
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([plain], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ]);
      return;
    } catch { /* Fallback for hosts supporting only plain text */ }
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(plain);
    return;
  }
  let copied = false;
  const copy = (event: ClipboardEvent) => {
    event.preventDefault();
    event.clipboardData?.setData('text/plain', plain);
    event.clipboardData?.setData('text/html', html);
    copied = Boolean(event.clipboardData);
  };
  document.addEventListener('copy', copy);
  try {
    document.execCommand('copy');
  } finally {
    document.removeEventListener('copy', copy);
  }
  if (!copied) throw new Error(tr('common:taskLinks.clipboardUnavailable'));
}

export function aiConversationReferenceFromPaste(data: DataTransfer): string | null {
  const html = data.getData('text/html');
  if (!html) return null;
  const document = new DOMParser().parseFromString(html, 'text/html');
  const anchor = document.querySelector<HTMLAnchorElement>('a[data-lanmind-ai]');
  const url = anchor?.getAttribute('href');
  if (!anchor || !url || !aiConversationIdFromLink(url)) return null;
  return aiConversationReferenceMarkdown({ title: (anchor.textContent || '').replace(/^\s*(AI 对话|AI Chat)\s*/i, '').trim() }, url);
}

