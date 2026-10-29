import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useSyncExternalStore } from 'react';
import { tr } from '../../../src/i18n';

export interface VaultStatus { configured: boolean; locked: boolean; sessionVersion: number; idleMinutes: number }
export interface VaultFolder { id: string; name: string; parentId: string | null }
export interface PasswordPolicy { length: number; uppercase: boolean; lowercase: boolean; digits: boolean; symbols: boolean; symbolChars: string; avoidAmbiguous: boolean }
export interface VaultEntry {
  id: string; revision: number; kind: 'login' | 'ssh'; name: string; folderId: string | null; favorite: boolean;
  urls: string[]; username: string; password: string; notes: string; publicKey: string; privateKey: string; keyPassphrase: string;
  fingerprint: string; algorithm: string; createdAt: string; updatedAt: string; deletedAt: string | null; sourceShareId: string | null;
}
export type VaultEntrySummary = Omit<VaultEntry, 'password' | 'privateKey' | 'keyPassphrase' | 'publicKey' | 'notes' | 'sourceShareId'>;
export interface VaultList { entries: VaultEntrySummary[]; folders: VaultFolder[]; policy: PasswordPolicy; idleMinutes: number }
export interface RecipientKey { version: number; userId: string; keyId: string; publicKey: string; fingerprint: string; signature: string; knownFingerprint?: string }
export const defaultPolicy: PasswordPolicy = { length: 20, uppercase: true, lowercase: true, digits: true, symbols: true, symbolChars: '!@#$%^&*()-_=+[]{};:,.?', avoidAmbiguous: true };
export const blankEntry = (folderId: string | null = null): VaultEntry => ({ id: '', revision: 0, kind: 'login', name: '', folderId, favorite: false, urls: [], username: '', password: '', notes: '', publicKey: '', privateKey: '', keyPassphrase: '', fingerprint: '', algorithm: '', createdAt: '', updatedAt: '', deletedAt: null, sourceShareId: null });
export type Transport = (action: string, payload: Record<string, unknown>, version: number) => Promise<any>;
export class VaultClient {
  private status: VaultStatus = { configured: false, locked: true, sessionVersion: 0, idleMinutes: 5 };
  private subscribers = new Set<() => void>();
  private changes = new Set<() => void>();
  private initialization?: Promise<void>;
  constructor(private transport: Transport = (action, payload, version) => invoke('vault_api', { action, payload, sessionVersion: version }), private desktop = true) {}
  snapshot = () => this.status;
  subscribe = (fn: () => void) => { this.subscribers.add(fn); return () => { this.subscribers.delete(fn); }; };
  onChanged = (fn: () => void) => { this.changes.add(fn); return () => { this.changes.delete(fn); }; };
  private publish(status: VaultStatus) {
    if (status.sessionVersion < this.status.sessionVersion) return;
    this.status = status; this.subscribers.forEach(fn => fn());
  }
  initialize() {
    return this.initialization ??= (async () => {
      if (this.desktop && !isTauri()) throw new Error('desktopOnly');
      const disposers: Array<() => void> = [];
      try {
        if (this.desktop) {
          disposers.push(await listen<VaultStatus>('vault://state', event => this.publish(event.payload)));
          disposers.push(await listen('vault://changed', () => this.changes.forEach(fn => fn())));
        }
        this.publish(await this.transport('status', {}, this.status.sessionVersion));
      } catch (error) { disposers.forEach(dispose => dispose()); this.initialization = undefined; throw error; }
    })();
  }
  async call<T = any>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
    const before = this.status.sessionVersion;
    try {
      const result = await this.transport(action, payload, before);
      if (['create', 'unlock', 'lock', 'activity', 'status', 'destroy'].includes(action)) this.publish(result);
      else if (before !== this.status.sessionVersion || this.status.locked) throw new Error('VAULT_LOCKED');
      if (['save', 'delete', 'restore', 'purge', 'move', 'saveFolder', 'deleteFolder', 'settings', 'import', 'saveShare', 'toggleFavorite'].includes(action)) this.changes.forEach(fn => fn());
      return result;
    } catch (error) {
      if (String(error).includes('VAULT_LOCKED')) this.publish(await this.transport('status', {}, before));
      throw error;
    }
  }
}
export const vaultClient = new VaultClient();
export function useVault(client: VaultClient = vaultClient) { return useSyncExternalStore(client.subscribe, client.snapshot); }
export function vaultError(cause: unknown): string {
  const code = cause instanceof Error ? cause.message : String(cause);
  if (code === 'desktopOnly') return tr('vault:desktopOnly');
  if (code === 'mismatch') return tr('vault:mismatch');
  const key = `vault:errors.${code}`;
  const value = tr(key);
  return value === key || value === `errors.${code}` ? tr('vault:errors.unknown') : value;
}
export function folderPath(folders: VaultFolder[], id: string): string {
  const parts: string[] = []; const visited = new Set<string>();
  while (id && !visited.has(id)) {
    visited.add(id); const folder = folders.find(f => f.id === id); if (!folder) break;
    parts.unshift(folder.name); id = folder.parentId || '';
  }
  return parts.join(' / ');
}
export function descendants(folders: VaultFolder[], id: string): Set<string> {
  const result = new Set([id]);
  for (let i = 0; i < folders.length; i++) for (const f of folders) if (f.parentId && result.has(f.parentId)) result.add(f.id);
  return result;
}
