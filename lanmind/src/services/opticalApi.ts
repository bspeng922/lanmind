import { invoke, isTauri } from '@tauri-apps/api/core';

export interface OpticalSourceInfo { sourceId: string; size: number; }
export interface OpticalOutputResult { bytes: number; sha256: string; }

function bytes(value: Uint8Array): number[] { return Array.from(value); }

export const opticalApi = {
  available(): boolean { return isTauri(); },
  openSource(path: string): Promise<OpticalSourceInfo> {
    return invoke<OpticalSourceInfo>('optical_source_open', { path });
  },
  readSourceRange(sourceId: string, offset: number, length: number): Promise<Uint8Array> {
    if (length > 4 * 1024 * 1024) throw new Error('CHUNK_TOO_LARGE');
    return invoke<number[]>('optical_source_read_range', { sourceId, offset, length }).then((value) => new Uint8Array(value));
  },
  closeSource(sourceId: string): Promise<void> {
    return invoke('optical_source_close', { sourceId });
  },
  createCache(sessionId?: string): Promise<string> {
    return invoke<string>('optical_cache_create', { sessionId });
  },
  loadCache(sessionId: string): Promise<boolean> {
    return invoke<boolean>('optical_cache_load', { sessionId });
  },
  readCache(cacheId: string, key: string): Promise<Uint8Array | undefined> {
    return invoke<number[] | null>('optical_cache_read', { cacheId, key }).then((value) => value ? new Uint8Array(value) : undefined);
  },
  writeCache(cacheId: string, key: string, value: Uint8Array): Promise<void> {
    if (value.byteLength > 4 * 1024 * 1024) throw new Error('CHUNK_TOO_LARGE');
    return invoke('optical_cache_write', { cacheId, key, bytes: bytes(value) }).then(() => invoke('optical_cache_commit', { cacheId, key }));
  },
  deleteCache(cacheId: string, key?: string): Promise<void> {
    return invoke('optical_cache_delete', { cacheId, key });
  },
  keysCache(cacheId: string, prefix: string): Promise<string[]> {
    return invoke<string[]>('optical_cache_keys', { cacheId, prefix });
  },
  beginOutput(targetPath: string): Promise<string> {
    return invoke<{ outputId: string }>('optical_output_begin', { targetPath }).then((value) => value.outputId);
  },
  writeOutput(outputId: string, value: Uint8Array): Promise<void> {
    if (value.byteLength > 4 * 1024 * 1024) throw new Error('CHUNK_TOO_LARGE');
    return invoke('optical_output_write', { outputId, bytes: bytes(value) });
  },
  finalizeOutput(outputId: string): Promise<OpticalOutputResult> {
    return invoke<OpticalOutputResult>('optical_output_finalize', { outputId });
  },
  abortOutput(outputId: string): Promise<void> {
    return invoke('optical_output_abort', { outputId });
  },
};
