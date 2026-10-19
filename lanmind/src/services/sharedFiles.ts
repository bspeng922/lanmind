import { isTauri } from '@tauri-apps/api/core';
import { invoke } from './api';

export interface SharedRoot {
  id: string;
  name: string;
  isDirectory: boolean;
  writable: boolean;
  available: boolean;
  localPath?: string;
}
export interface SharedEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
}
export interface ShareProgress {
  workspaceId: string;
  transferId: string;
  name: string;
  received: number;
  total: number;
}
export interface SharedEntryPage { entries: SharedEntry[]; total: number }

function call<T>(request: Record<string, unknown>): Promise<T> {
  if (!isTauri()) return Promise.reject(new Error('SHARE_DESKTOP'));
  return invoke('lan_share', { request });
}

export const SharedFilesApi = {
  localRoots: () => call<SharedRoot[]>({ action: 'localRoots' }),
  add: (path: string) => call<SharedRoot[]>({ action: 'add', path }),
  permission: (shareId: string, writable: boolean) => call<SharedRoot[]>({ action: 'permission', shareId, writable }),
  remove: (shareId: string) => call<SharedRoot[]>({ action: 'remove', shareId }),
  roots: (userId: string) => call<{ roots: SharedRoot[] }>({ action: 'roots', userId }),
  list: (userId: string, shareId: string, path: string, offset = 0) => call<SharedEntryPage>({ action: 'list', userId, shareId, path, offset }),
  mkdir: (userId: string, shareId: string, path: string, name: string) => call<void>({ action: 'mkdir', userId, shareId, path, name }),
  upload: (userId: string, shareId: string, path: string, source: string, transferId: string) => call<void>({ action: 'upload', userId, shareId, path, source, transferId }),
  download: (userId: string, shareId: string, path: string, name: string, directory: boolean, destination: string, transferId: string) => call<void>({ action: 'download', userId, shareId, path, name, directory, destination, transferId }),
  cancel: (transferId: string) => call<void>({ action: 'cancel', transferId }),
};
