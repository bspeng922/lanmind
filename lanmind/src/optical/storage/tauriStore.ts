import { opticalApi } from '../../services/opticalApi';
import type { OpticalObjectStore, OpticalStorageEstimate } from './objectStore';

export class TauriObjectStore implements OpticalObjectStore {
  readonly persistent = true;
  private constructor(private readonly cacheId: string) {}

  static async open(): Promise<TauriObjectStore | undefined> {
    if (!opticalApi.available()) return undefined;
    const cacheId = 'desktop-optical';
    if (!await opticalApi.loadCache(cacheId)) await opticalApi.createCache(cacheId);
    return new TauriObjectStore(cacheId);
  }

  async estimate(): Promise<OpticalStorageEstimate> {
    return {};
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    await opticalApi.writeCache(this.cacheId, key, bytes);
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    return opticalApi.readCache(this.cacheId, key);
  }

  async keys(prefix: string): Promise<string[]> {
    return opticalApi.keysCache(this.cacheId, prefix);
  }

  async delete(key: string): Promise<void> {
    await opticalApi.deleteCache(this.cacheId, key);
  }

  async clear(prefix: string): Promise<void> {
    for (const key of await this.keys(prefix)) await this.delete(key);
  }
}
