import { ApiService } from '../../services/api';
import { sameWorkspace, type WorkspaceContext } from '../../utils/workspaceContext';
import type { WikiDocument, WikiState } from './wikiTypes';

export const WIKI_SAVE_EVENT = 'wiki:save-result';
interface SaveQueue {
  base: WikiDocument[];
  tail: Promise<void>;
  pending: number;
  error: string;
}
const queues = new Map<string, SaveQueue>();
export function wikiSaveError(key: string) {
  try { return queues.get(key)?.error || localStorage.getItem(`${key}:save-error`) || ''; }
  catch { return queues.get(key)?.error || ''; }
}
export function wikiSaveBlocked(key: string) {
  const q = queues.get(key);
  return !!q?.pending || !!wikiSaveError(key);
}
export function rememberWikiBaseline(key: string, documents: WikiDocument[]) {
  if (!wikiSaveBlocked(key)) queues.set(key, { base: structuredClone(documents), tail: Promise.resolve(), pending: 0, error: '' });
}
export function resetWikiQueue(key: string) {
  queues.delete(key);
  try { localStorage.removeItem(`${key}:save-error`); } catch { /* In-memory recovery still works. */ }
}
// View metadata and server timestamps must never trigger a document write.
export const wikiDocumentFields = (doc: WikiDocument) => JSON.stringify({
  id: doc.id, title: doc.title, content: doc.content, parentId: doc.parentId,
  projectId: doc.projectId, sortOrder: doc.sortOrder, isLocked: !!doc.isLocked,
  icon: doc.icon,
  tags: doc.tags ?? [],
});
export function enqueueWikiSave(key: string, state: WikiState, previous: WikiDocument[], scope: WorkspaceContext) {
  let q = queues.get(key);
  if (!q) { q = { base: structuredClone(previous), tail: Promise.resolve(), pending: 0, error: wikiSaveError(key) }; queues.set(key, q); }
  const queue = q;
  const desired = structuredClone(state);
  queue.pending++;
  window.dispatchEvent(new CustomEvent(WIKI_SAVE_EVENT, { detail: { key, pending: true } }));
  queue.tail = queue.tail.then(async () => {
    if (!sameWorkspace(scope)) return;
    if (queue.error || wikiSaveError(key)) throw new Error(queue.error || wikiSaveError(key));
    const changes = desired.documents.filter(doc => {
      const before = queue.base.find(old => old.id === doc.id);
      return !before || wikiDocumentFields(before) !== wikiDocumentFields(doc);
    }).map(document => ({ document, expectedVersion: queue.base.find(old => old.id === document.id)?.version ?? null }));
    const deletions = queue.base.filter(old => !desired.documents.some(doc => doc.id === old.id))
      .map(old => ({ id: old.id, expectedVersion: old.version ?? null }));
    const result = await ApiService.saveWikiChanges({ changes, deletions, view: {
      initialized: true, selectedId: desired.selectedId, expandedIds: desired.expandedIds,
      favorites: desired.documents.filter(doc => doc.favorite).map(doc => doc.id),
    } }, scope);
    if (!sameWorkspace(scope)) return;
    queue.base = desired.documents.map(doc => result.documents.find(saved => saved.id === doc.id) ?? queue.base.find(old => old.id === doc.id) ?? doc);
    window.dispatchEvent(new CustomEvent(WIKI_SAVE_EVENT, { detail: { key, documents: result.documents, pending: queue.pending > 1 } }));
  }).catch(error => {
    queue.error = error instanceof Error ? error.message : String(error);
    // Keep a recoverable copy even after a later refresh/restart.
    try { localStorage.setItem(`${key}:conflict-draft`, JSON.stringify(desired)); localStorage.setItem(`${key}:save-error`, queue.error); } catch { /* The live editor still has the draft. */ }
    window.dispatchEvent(new CustomEvent(WIKI_SAVE_EVENT, { detail: { key, error: queue.error, pending: queue.pending > 1 } }));
  }).finally(() => { queue.pending--; });
  return queue.tail;
}
