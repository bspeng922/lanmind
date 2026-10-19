import { getWorkspaceContext } from '../../utils/workspaceContext';

export function wikiIdFromLink(link: string): string | null {
  try {
    const url = new URL(link, 'https://lanmind.local/');
    const workspace = url.searchParams.get('workspace');
    if (workspace && workspace !== getWorkspaceContext()?.workspaceId) return null;
    if (url.protocol === 'lanmind:' && url.hostname === 'wiki' && /^\/[^/]+\/?$/.test(url.pathname)) {
      return decodeURIComponent(url.pathname.replace(/^\/|\/$/g, ''));
    }
    if (/^https?:$/.test(url.protocol) && /^#\/?wiki\/[^/]+$/.test(url.hash)) {
      return decodeURIComponent(url.hash.replace(/^#\/?wiki\//, ''));
    }
  } catch { /* Invalid links remain ordinary text. */ }
  return null;
}
