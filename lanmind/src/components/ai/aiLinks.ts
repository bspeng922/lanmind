import { getWorkspaceContext } from '../../utils/workspaceContext';

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
