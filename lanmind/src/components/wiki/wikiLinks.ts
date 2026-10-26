import { getWorkspaceContext } from '../../utils/workspaceContext';

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

