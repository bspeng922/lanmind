import { isTauri } from '@tauri-apps/api/core';
import { getWorkspaceContext } from '../../utils/workspaceContext';
import { tr } from '../../i18n';
import type { WikiDocument } from './wikiTypes';

export function wikiIdFromLink(link: string): string | null {
  try {
    const url = new URL(link, 'https://lanmind.local/');
    const workspace = url.searchParams.get('workspace');
    if (workspace && getWorkspaceContext() && workspace !== getWorkspaceContext()?.workspaceId) return null;
    if (url.searchParams.get('wiki')) {
      return decodeURIComponent(url.searchParams.get('wiki')!);
    }
    if (url.searchParams.get('doc')) {
      return decodeURIComponent(url.searchParams.get('doc')!);
    }
    if (url.protocol === 'lanmind:' && url.hostname === 'wiki' && /^\/[^/]+\/?$/.test(url.pathname)) {
      return decodeURIComponent(url.pathname.replace(/^\/|\/$/g, ''));
    }
    if (/^https?:$/.test(url.protocol) && /^#\/?wiki\/[^/]+$/.test(url.hash)) {
      return decodeURIComponent(url.hash.replace(/^#\/?wiki\//, ''));
    }
  } catch { /* Invalid links remain ordinary text. */ }
  return null;
}

export function parseWikiShareLink(link: string): { docId: string; workspaceId?: string } | null {
  try {
    const url = new URL(link, 'https://lanmind.local/');
    const workspaceId = url.searchParams.get('workspace') || undefined;
    const docId = wikiIdFromLink(link);
    if (docId) return { docId, workspaceId };
  } catch { /* ignore */ }
  return null;
}

export function wikiReferenceUrl(doc: Pick<WikiDocument, 'id'>) {
  const scope = getWorkspaceContext();
  const query = scope ? `?workspace=${encodeURIComponent(scope.workspaceId)}` : '';
  const origin = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : 'http://localhost:3000/';
  const search = typeof window !== 'undefined' ? window.location.search : '';
  return isTauri()
    ? `lanmind://wiki/${encodeURIComponent(doc.id)}${query}`
    : `${origin}${query || search}#/wiki/${encodeURIComponent(doc.id)}`;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

export function wikiReferenceMarkdown(doc: Pick<WikiDocument, 'title'>, url: string) {
  const title = (doc.title || '').trim() || tr('wiki:wikiView.untitledPage') || '未命名页面';
  return tr('common:wikiLinks.wiki', {
    value0: title.replace(/\\/g, '\\\\').replace(/([\[\]])/g, '\\$1').replace(/[\r\n]/g, ' '),
    value1: url,
  });
}

export function wikiReferenceHtml(doc: Pick<WikiDocument, 'title'>, url: string) {
  const title = (doc.title || '').trim() || tr('wiki:wikiView.untitledPage') || '未命名页面';
  return tr('common:wikiLinks.aDataLanmindWikiTrueHrefStyle', {
    value0: escapeHtml(url),
    value1: escapeHtml(title),
  });
}

export async function copyWikiReference(doc: Pick<WikiDocument, 'id' | 'title'>) {
  const url = wikiReferenceUrl(doc);
  const plain = wikiReferenceMarkdown(doc, url);
  const html = wikiReferenceHtml(doc, url);
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

export function wikiReferenceFromPaste(data: DataTransfer): string | null {
  const html = data.getData('text/html');
  if (!html) return null;
  const document = new DOMParser().parseFromString(html, 'text/html');
  const anchor = document.querySelector<HTMLAnchorElement>('a[data-lanmind-wiki]');
  const url = anchor?.getAttribute('href');
  if (!anchor || !url || !wikiIdFromLink(url)) return null;
  return wikiReferenceMarkdown({ title: (anchor.textContent || '').replace(/^\s*(文档|Wiki)\s*/i, '').trim() }, url);
}


