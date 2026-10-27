import { wikiPolishClient, type PolishEvent, type PolishRequest } from '../../src/components/wiki/wikiPolish';
import type { Catalog, Connection } from '../../src/components/ai/aiClient';
import { getWorkspaceContext, type WorkspaceContext } from '../../src/utils/workspaceContext';

const connection = (id: string, name: string): Connection => ({
  id, name, providerType: 'ollama', baseUrl: 'http://fixture.invalid', enabled: true, bound: true, revision: 1,
  configRevision: 1, hasCredential: false, referenceCount: 1, parameters: {},
  models: [{ id: `${id}-model`, remoteModelId: 'same-model', displayName: name, enabled: true, missing: false, parameters: {}, capabilities: {} }],
});
const initial = {
  requests: [] as Array<PolishRequest & { scope: WorkspaceContext }>,
  cancellations: [] as string[],
  listeners: new Set<(event: PolishEvent) => void>(),
  catalog: { schemaVersion: 2, connections: [connection('local', 'Local model'), connection('gpu', 'GPU model')],
    defaults: { chat: { connectionId: 'local', modelEntryId: 'local-model' } } } as Catalog,
};
// Vite timestamped imports must observe the same fixture as the mounted page.
const host = window as typeof window & { __wikiPolishFixture?: typeof initial };
export const polishFixture = host.__wikiPolishFixture ||= initial;
export function emitPolish(type: PolishEvent['type'], text = '', code?: string, index = polishFixture.requests.length - 1) {
  const request = polishFixture.requests[index];
  if (!request) throw new Error('No polish request');
  for (const receive of polishFixture.listeners) receive({ requestId: request.requestId, workspaceContext: request.scope,
    type, text, error: code ? { code, message: code } : undefined });
}
export function initializeWikiPolishFixture() {
  if (new URLSearchParams(location.search).get('polish') === 'empty') polishFixture.catalog.connections = [];
  wikiPolishClient.available = () => true;
  wikiPolishClient.catalog = async () => structuredClone(polishFixture.catalog);
  wikiPolishClient.subscribeCatalog = async () => () => {};
  wikiPolishClient.subscribe = async receive => { polishFixture.listeners.add(receive); return () => { polishFixture.listeners.delete(receive); }; };
  wikiPolishClient.start = async request => {
    polishFixture.requests.push({ ...structuredClone(request), scope: structuredClone(getWorkspaceContext()) });
    return { requestId: request.requestId };
  };
  wikiPolishClient.cancel = async id => { polishFixture.cancellations.push(id); };
}
