export interface WorkspaceContext {
  workspaceId: string;
  userId: string;
  revision: number;
  originalWorkspaceId?: string;
  originalUserId?: string;
}

let context: WorkspaceContext | null = null;
export const getWorkspaceContext = () => context;
export function setWorkspaceContext(value: WorkspaceContext | null) { context = value; }
export function sameWorkspace(left: WorkspaceContext | null, right = context): boolean {
  return !!left && !!right && left.workspaceId === right.workspaceId && left.userId === right.userId && left.revision === right.revision;
}
export function scopedStorageKey(feature: string, scope = context): string {
  return `lanmind:v3:ws:${encodeURIComponent(scope?.workspaceId ?? 'uninitialized')}:user:${encodeURIComponent(scope?.userId ?? 'uninitialized')}:${feature}`;
}

/** Remove every user's cache for the dissolved workspace in this webview. */
export function clearWorkspaceStorage(workspaceId: string, scope = context, storage: Storage = localStorage) {
  const prefix = `lanmind:v3:ws:${encodeURIComponent(workspaceId)}:user:`;
  const legacyFeatures = ['lanmind_wiki_documents_v2', 'lanmind_wiki_documents_v1', 'lanmind_ai_conversations_v1',
    'lanmind_cached_projects', 'lan_chat_messages_v2', 'lan_chat_groups_v2', 'lanmind_import_history',
    'lanmind_export_history', 'lanmind_sent_task_reminders_v2', 'lan_nodes_expanded_units_v1'];
  const legacyPrefixes = ['lanmind_ai_messages_v1:', 'lanmind_task_layout:', 'lanmind_task_pins:',
    'lanmind_sidebar_project_order_v1:', 'lanmind_task_attachments:', 'lanmind_project_files:'];
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((key): key is string => key !== null);
  for (const key of keys) {
    if (key.startsWith(prefix)
      || legacyFeatures.some(feature => key === `${feature}_${workspaceId}`)
      || key.startsWith(`lanmind_ai_messages_v1_${workspaceId}:`)
      || (scope?.originalWorkspaceId === workspaceId && (legacyFeatures.includes(key) || legacyPrefixes.some(prefix => key.startsWith(prefix))))) {
      storage.removeItem(key);
    }
  }
}

/** Legacy data is claimed only by the explicitly recorded original workspace. */
export function migrateWorkspaceStorage(scope: WorkspaceContext, storage: Storage = localStorage) {
  if (scope.originalUserId && scope.userId !== scope.originalUserId) return;
  const marker = scopedStorageKey('legacy-migration', scope);
  if (storage.getItem(marker)) return;
  const features = [
    'lanmind_wiki_documents_v2', 'lanmind_wiki_documents_v1', 'lanmind_ai_conversations_v1',
    'lanmind_cached_projects', 'lan_chat_messages_v2', 'lan_chat_groups_v2',
    'lanmind_import_history', 'lanmind_export_history', 'lanmind_sent_task_reminders_v2',
    'lan_nodes_expanded_units_v1',
  ];
  const prefixes = ['lanmind_ai_messages_v1:', 'lanmind_task_layout:', 'lanmind_task_pins:',
    'lanmind_sidebar_project_order_v1:', 'lanmind_task_attachments:', 'lanmind_project_files:'];
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((key): key is string => !!key);
  for (const key of scope.workspaceId === scope.originalWorkspaceId ? keys : []) {
    if (!features.includes(key) && !prefixes.some(prefix => key.startsWith(prefix))) continue;
    // Keep originals as a recovery snapshot; they are never used as a runtime fallback.
    const target = scopedStorageKey(key, scope);
    const value = storage.getItem(key);
    if (value !== null && storage.getItem(target) === null) storage.setItem(target, value);
  }
  for (const feature of ['lanmind_wiki_documents_v2', 'lanmind_ai_conversations_v1']) {
    const previous = storage.getItem(`${feature}_${scope.workspaceId}`);
    if (previous !== null && storage.getItem(scopedStorageKey(feature, scope)) === null) storage.setItem(scopedStorageKey(feature, scope), previous);
  }
  for (const key of keys.filter(k => k.startsWith(`lanmind_ai_messages_v1_${scope.workspaceId}:`))) {
    storage.setItem(scopedStorageKey(key.replace(`lanmind_ai_messages_v1_${scope.workspaceId}:`, 'lanmind_ai_messages_v1:'), scope), storage.getItem(key)!);
  }
  storage.setItem(marker, '1');
}
