import DiffMatchPatch from 'diff-match-patch';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { AI, modelKey, type Catalog, type ModelRef } from '../ai/aiClient';
import type { WorkspaceContext } from '../../utils/workspaceContext';

export type PolishMode = 'document' | 'selection';
export interface PolishRequest {
  requestId: string;
  documentId: string;
  mode: PolishMode;
  title: string;
  content: string;
  instructions: string;
  modelRef: ModelRef;
}
export interface PolishEvent {
  requestId: string;
  workspaceContext: WorkspaceContext;
  type: 'delta' | 'done' | 'cancelled' | 'error';
  text: string;
  error?: { code: string; message: string };
}

/** Kept separate from UI state so the browser fixture can exercise the real workflow. */
export const wikiPolishClient = {
  available: () => isTauri(),
  catalog: () => AI.call<Catalog>('catalog'),
  subscribe: async (receive: (event: PolishEvent) => void) => {
    const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    return getCurrentWebviewWindow().listen<PolishEvent>('wiki://polish', event => receive(event.payload));
  },
  subscribeCatalog: (receive: () => void) => listen('ai://catalog', receive),
  start: (request: PolishRequest) => AI.call<{ requestId: string }>('wiki.polish.start', request),
  cancel: (requestId: string, scope: WorkspaceContext) => invoke('ai_api', {
    action: 'wiki.polish.cancel', payload: { requestId }, workspaceContext: scope,
  }),
};

export function polishModel(catalog: Catalog, remembered = ''): string {
  const keys = catalog.connections.filter(c => c.enabled && c.bound)
    .flatMap(c => c.models.filter(m => m.enabled).map(m => modelKey({ connectionId: c.id, modelEntryId: m.id })));
  return [remembered, modelKey(catalog.defaults.chat), ...keys].find(key => keys.includes(key)) || '';
}

export function polishDiff(before: string, after: string): Array<[number, string]> {
  const diff = new DiffMatchPatch();
  diff.Diff_Timeout = 0.2;
  const parts = diff.diff_main(before, after);
  diff.diff_cleanupSemantic(parts);
  // DMP compares UTF-16 units. Keep emoji surrogate pairs inside the same span.
  for (let index = 0; index < parts.length; index++) {
    if (parts[index][0] !== 0) continue;
    const text = parts[index][1];
    if (/[\uD800-\uDBFF]$/.test(text)) {
      parts[index][1] = text.slice(0, -1);
      for (let next = index + 1; next < parts.length && parts[next][0] !== 0; next++) parts[next][1] = text.slice(-1) + parts[next][1];
    }
    if (/^[\uDC00-\uDFFF]/.test(parts[index][1])) {
      const low = parts[index][1][0];
      parts[index][1] = parts[index][1].slice(1);
      for (let previous = index - 1; previous >= 0 && parts[previous][0] !== 0; previous--) parts[previous][1] += low;
    }
  }
  const isolatedSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  const safeParts: Array<[number, string]> = parts.some(([, text]) => isolatedSurrogate.test(text)) ? [[-1, before], [1, after]] : parts;
  return safeParts.filter(([, text]) => text.length > 0);
}
