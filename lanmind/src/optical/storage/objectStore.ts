export interface OpticalObjectStore {
  readonly persistent: boolean;
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  delete(key: string): Promise<void>;
  clear(prefix?: string): Promise<void>;
}

export class MemoryObjectStore implements OpticalObjectStore {
  readonly persistent = false;
  private readonly values = new Map<string, Uint8Array>();
  async put(key: string, bytes: Uint8Array): Promise<void> { this.values.set(key, bytes.slice()); }
  async get(key: string): Promise<Uint8Array | undefined> { return this.values.get(key)?.slice(); }
  async delete(key: string): Promise<void> { this.values.delete(key); }
  async clear(prefix = ''): Promise<void> {
    for (const key of this.values.keys()) if (key.startsWith(prefix)) this.values.delete(key);
  }
}

function validKey(key: string): string {
  if (!/^[a-zA-Z0-9._/-]{1,240}$/.test(key)) throw new Error('invalid object store key');
  return key;
}

class OpfsObjectStore implements OpticalObjectStore {
  readonly persistent = true;
  private constructor(private readonly root: FileSystemDirectoryHandle) {}

  static async open(): Promise<OpfsObjectStore | undefined> {
    const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!storage || typeof storage.getDirectory !== 'function') return undefined;
    try {
      return new OpfsObjectStore(await storage.getDirectory());
    } catch { return undefined; }
  }

  private async file(key: string, create: boolean): Promise<FileSystemFileHandle> {
    const parts = validKey(key).split('/');
    let directory = this.root;
    for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part, { create });
    return directory.getFileHandle(parts.at(-1)!, { create });
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const handle = await this.file(key, true);
    const writable = await handle.createWritable();
    try { await writable.write(bytes); } finally { await writable.close(); }
  }
  async get(key: string): Promise<Uint8Array | undefined> {
    try { return new Uint8Array(await (await this.file(key, false)).getFile().then((file) => file.arrayBuffer()) as ArrayBuffer); }
    catch (error) { if ((error as DOMException).name === 'NotFoundError') return undefined; throw error; }
  }
  async delete(key: string): Promise<void> {
    const parts = validKey(key).split('/');
    let directory = this.root;
    for (const part of parts.slice(0, -1)) {
      try { directory = await directory.getDirectoryHandle(part); } catch { return; }
    }
    try { await directory.removeEntry(parts.at(-1)!); } catch (error) { if ((error as DOMException).name !== 'NotFoundError') throw error; }
  }
  async clear(prefix = ''): Promise<void> {
    // OPFS directory iteration is intentionally scoped to the caller's prefix.
    const parts = prefix ? validKey(prefix).split('/').filter(Boolean) : [];
    let directory = this.root;
    for (const part of parts) {
      try { directory = await directory.getDirectoryHandle(part); } catch { return; }
    }
    const entries = (directory as FileSystemDirectoryHandle & { entries?: () => AsyncIterableIterator<[string, FileSystemHandle]> }).entries;
    if (entries) for await (const [name] of entries.call(directory)) await directory.removeEntry(name, { recursive: true });
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
  private transact(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<any> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('objects', mode);
      const request = action(transaction.objectStore('objects'));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onerror = () => reject(transaction.error);
    });
  }
  async put(key: string, bytes: Uint8Array): Promise<void> { await this.transact('readwrite', (store) => store.put(bytes, validKey(key))); }
  async get(key: string): Promise<Uint8Array | undefined> { const value = await this.transact('readonly', (store) => store.get(validKey(key))); return value ? new Uint8Array(value) : undefined; }
  async delete(key: string): Promise<void> { await this.transact('readwrite', (store) => store.delete(validKey(key))); }
  async clear(prefix = ''): Promise<void> {
    const keys = await this.transact('readonly', (store) => store.getAllKeys()) as IDBValidKey[];
    for (const key of keys) if (String(key).startsWith(prefix)) await this.delete(String(key));
  }
}

export async function createOpticalObjectStore(): Promise<OpticalObjectStore> {
  const opfs = await OpfsObjectStore.open();
  if (opfs) return opfs;
  const indexed = await IndexedDbObjectStore.open();
  return indexed ?? new MemoryObjectStore();
}
