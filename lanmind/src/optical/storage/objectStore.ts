export interface OpticalStorageEstimate {
  usage?: number;
  quota?: number;
  available?: number;
}

export interface OpticalObjectStore {
  readonly persistent: boolean;
  estimate(): Promise<OpticalStorageEstimate>;
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  keys(prefix: string): Promise<string[]>;
  delete(key: string): Promise<void>;
  clear(prefix: string): Promise<void>;
}

const DEFAULT_MEMORY_BUDGET = 64 * 1024 * 1024;

export class MemoryObjectStore implements OpticalObjectStore {
  readonly persistent = false;
  private readonly values = new Map<string, Uint8Array>();
  private usedBytes = 0;

  constructor(private readonly byteBudget = DEFAULT_MEMORY_BUDGET) {
    if (!Number.isSafeInteger(byteBudget) || byteBudget <= 0) throw new RangeError('invalid memory store budget');
  }

  async estimate(): Promise<OpticalStorageEstimate> {
    return { usage: this.usedBytes, quota: this.byteBudget, available: this.byteBudget - this.usedBytes };
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    validKey(key);
    const previous = this.values.get(key)?.byteLength ?? 0;
    const next = this.usedBytes - previous + bytes.byteLength;
    if (next > this.byteBudget) throw new Error('MEMORY_STORE_LIMIT');
    this.values.set(key, bytes.slice());
    this.usedBytes = next;
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    return this.values.get(validKey(key))?.slice();
  }

  async keys(prefix: string): Promise<string[]> {
    validPrefix(prefix);
    return Array.from(this.values.keys()).filter((key) => key.startsWith(prefix)).sort();
  }

  async delete(key: string): Promise<void> {
    key = validKey(key);
    const previous = this.values.get(key);
    if (previous) this.usedBytes -= previous.byteLength;
    this.values.delete(key);
  }

  async clear(prefix: string): Promise<void> {
    validPrefix(prefix);
    for (const key of await this.keys(prefix)) await this.delete(key);
  }
}

function validKey(key: string): string {
  if (!/^[a-zA-Z0-9._/-]{1,240}$/.test(key) || key.startsWith('/') || key.endsWith('/') || key.includes('//') || key.split('/').includes('..')) {
    throw new Error('invalid object store key');
  }
  return key;
}

function validPrefix(prefix: string): string {
  if (!prefix || !/^[a-zA-Z0-9._/-]{1,240}$/.test(prefix) || prefix.startsWith('/') || prefix.includes('//') || prefix.split('/').includes('..')) {
    throw new Error('invalid object store prefix');
  }
  return prefix;
}

class OpfsObjectStore implements OpticalObjectStore {
  readonly persistent = true;
  private constructor(private readonly root: FileSystemDirectoryHandle) {}

  static async open(): Promise<OpfsObjectStore | undefined> {
    const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!storage || typeof storage.getDirectory !== 'function') return undefined;
    try {
      return new OpfsObjectStore(await storage.getDirectory());
    } catch {
      return undefined;
    }
  }

  async estimate(): Promise<OpticalStorageEstimate> {
    const value = await navigator.storage.estimate();
    return { usage: value.usage, quota: value.quota, available: value.quota !== undefined && value.usage !== undefined ? Math.max(0, value.quota - value.usage) : undefined };
  }

  private async directory(parts: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
    let directory = this.root;
    for (const part of parts) directory = await directory.getDirectoryHandle(part, { create });
    return directory;
  }

  private async file(key: string, create: boolean): Promise<FileSystemFileHandle> {
    const parts = validKey(key).split('/');
    const directory = await this.directory(parts.slice(0, -1), create);
    return directory.getFileHandle(parts.at(-1)!, { create });
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const handle = await this.file(key, true);
    const writable = await handle.createWritable();
    try {
      await writable.write(bytes);
      await writable.close();
    } catch (error) {
      try { await writable.abort(); } catch { /* preserve the original failure */ }
      throw error;
    }
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    try {
      const file = await (await this.file(key, false)).getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch (error) {
      if ((error as DOMException).name === 'NotFoundError') return undefined;
      throw error;
    }
  }

  async keys(prefix: string): Promise<string[]> {
    prefix = validPrefix(prefix);
    const root = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    const parts = root.split('/');
    let directory: FileSystemDirectoryHandle;
    try {
      directory = await this.directory(parts, false);
    } catch (error) {
      if ((error as DOMException).name === 'NotFoundError') return [];
      throw error;
    }
    const output: string[] = [];
    const walk = async (handle: FileSystemDirectoryHandle, path: string): Promise<void> => {
      const entries = (handle as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries;
      for await (const [name, entry] of entries.call(handle)) {
        const child = `${path}/${name}`;
        if (entry.kind === 'directory') await walk(entry as FileSystemDirectoryHandle, child);
        else output.push(child);
      }
    };
    await walk(directory, root);
    return output.sort();
  }

  async delete(key: string): Promise<void> {
    const parts = validKey(key).split('/');
    let directory: FileSystemDirectoryHandle;
    try {
      directory = await this.directory(parts.slice(0, -1), false);
    } catch (error) {
      if ((error as DOMException).name === 'NotFoundError') return;
      throw error;
    }
    try {
      await directory.removeEntry(parts.at(-1)!);
    } catch (error) {
      if ((error as DOMException).name !== 'NotFoundError') throw error;
    }
  }

  async clear(prefix: string): Promise<void> {
    prefix = validPrefix(prefix);
    const root = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    const parts = root.split('/');
    const parent = await this.directory(parts.slice(0, -1), false).catch(() => undefined);
    if (!parent) return;
    try {
      await parent.removeEntry(parts.at(-1)!, { recursive: true });
    } catch (error) {
      if ((error as DOMException).name !== 'NotFoundError') throw error;
    }
  }
}

class IndexedDbObjectStore implements OpticalObjectStore {
  readonly persistent = true;
  private constructor(private readonly db: IDBDatabase) {}

  static open(): Promise<IndexedDbObjectStore | undefined> {
    if (typeof indexedDB === 'undefined') return Promise.resolve(undefined);
    return new Promise((resolve) => {
      const request = indexedDB.open('lanmind-optical-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('objects');
      request.onsuccess = () => resolve(new IndexedDbObjectStore(request.result));
      request.onerror = () => resolve(undefined);
    });
  }

  async estimate(): Promise<OpticalStorageEstimate> {
    const value = await navigator.storage?.estimate?.() ?? {};
    return { usage: value.usage, quota: value.quota, available: value.quota !== undefined && value.usage !== undefined ? Math.max(0, value.quota - value.usage) : undefined };
  }

  private transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('objects', mode);
      const request = action(transaction.objectStore('objects'));
      let result: T;
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(transaction.error ?? new Error('INDEXED_DB_ABORTED'));
      transaction.onerror = () => reject(transaction.error ?? new Error('INDEXED_DB_FAILED'));
    });
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    await this.transact('readwrite', (store) => store.put(bytes.slice(), validKey(key)));
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    const value = await this.transact('readonly', (store) => store.get(validKey(key)));
    return value ? new Uint8Array(value as ArrayBuffer) : undefined;
  }

  async keys(prefix: string): Promise<string[]> {
    prefix = validPrefix(prefix);
    const keys = await this.transact('readonly', (store) => store.getAllKeys());
    return (keys as IDBValidKey[]).map(String).filter((key) => key.startsWith(prefix)).sort();
  }

  async delete(key: string): Promise<void> {
    await this.transact('readwrite', (store) => store.delete(validKey(key)));
  }

  async clear(prefix: string): Promise<void> {
    prefix = validPrefix(prefix);
    for (const key of await this.keys(prefix)) await this.delete(key);
  }
}

export async function createOpticalObjectStore(): Promise<OpticalObjectStore> {
  const { TauriObjectStore } = await import('./tauriStore');
  const tauri = await TauriObjectStore.open();
  if (tauri) return tauri;
  const opfs = await OpfsObjectStore.open();
  if (opfs) return opfs;
  const indexed = await IndexedDbObjectStore.open();
  return indexed ?? new MemoryObjectStore();
}
