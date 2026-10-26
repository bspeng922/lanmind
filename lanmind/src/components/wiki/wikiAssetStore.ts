/**
 * wikiAssetStore — Persistent binary storage for Wiki images & attachments.
 *
 * CALLING SPEC:
 *   const { assetPath, fileName } = await saveWikiAsset(file, 'diagram.png');
 *   // assetPath -> "assets/asset_1729012345_diagram.png"
 *
 *   const blob = await getWikiAssetBlob(assetPath);
 *   const url = await getWikiAssetUrl(assetPath);
 *
 * TOOL CONTRACT:
 *   - Uses IndexedDB for reliable, persistent binary blob storage (no 5MB localStorage quota limit)
 *   - Prevents Markdown bloating by replacing multi-megabyte base64 strings with clean "assets/..." references
 *   - Object URLs are automatically cached and managed in-memory
 *   - Works identically across Tauri desktop and Web environments
 */

const DB_NAME = 'lanmind_wiki_assets_v1';
const STORE_NAME = 'assets';
const DB_VERSION = 1;

interface StoredAssetRecord {
  path: string;
  blob: Blob;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: number;
}

const objectUrlCache = new Map<string, string>();

/** Markdown renderers encode filenames; old documents may still contain raw paths. */
function assetPathCandidates(assetPath: string): string[] {
  const path = assetPath.replace(/^(?:\.\.?\/)+/, '');
  try {
    const decoded = decodeURIComponent(path.replace(/%(?![\da-f]{2})/gi, '%25'));
    return [...new Set([path, decoded])];
  } catch {
    return [path];
  }
}

/** Display URLs must never leak into persisted Markdown or version snapshots. */
export function canonicalizeWikiAssetUrls(markdown: string): string {
  let value = markdown;
  for (const [assetPath, objectUrl] of objectUrlCache) {
    if (value.includes(objectUrl)) value = value.split(objectUrl).join(assetPath);
  }
  return value;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this environment'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'path' });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error || new Error('Failed to open IndexedDB'));
    };
  });

  return dbPromise;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i += 8192) {
    const chunk = bytes.subarray(i, Math.min(i + 8192, len));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

export async function persistAssetToBackend(assetPath: string, blob: Blob): Promise<void> {
  const cleanName = assetPath.replace(/^(?:\.\.?\/)+/, '').replace(/^assets\//, '');
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    const { invoke } = await import('@tauri-apps/api/core');
    const { ensureWorkspaceContext } = await import('../../services/api');
    const workspaceContext = await ensureWorkspaceContext();
    const base64 = await blobToBase64(blob);
    await invoke('save_wiki_asset', { name: cleanName, base64Content: base64, workspaceContext });
  } else if (typeof window !== 'undefined') {
    const response = await fetch(`/api/wiki/assets/${encodeURIComponent(cleanName)}`, {
      method: 'POST',
      body: blob,
    });
    if (!response.ok) throw new Error(`附件同步失败 (${response.status}): ${cleanName}`);
  }
}

function isAssetResponse(response: Response): boolean {
  // A missing asset may return the SPA HTML. Real HTML attachments carry Content-Disposition.
  return response.ok && (!/text\/html/i.test(response.headers.get('content-type') || '') || response.headers.has('content-disposition'));
}

/** Explicitly awaited and retryable; browser readers must never upload their cached copies. */
export async function syncAllWikiAssetsToBackend(): Promise<void> {
    const db = await getDb();
    const records = await new Promise<StoredAssetRecord[]>((resolve, reject) => {
      const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    for (const record of records) {
      await persistAssetToBackend(record.path, record.blob);
    }
}

/** A share link is ready only after all local images and attachments can be served by the host. */
export async function syncWikiDocumentAssets(markdown: string): Promise<void> {
  const { renderWikiMarkdown } = await import('./wikiMarkdown');
  const host = document.createElement('div'); host.innerHTML = renderWikiMarkdown(markdown);
  const paths = new Set(Array.from(host.querySelectorAll('img[src],a[href]')).map(node =>
    node.getAttribute(node.tagName === 'IMG' ? 'src' : 'href') || '').filter(path => /^(?:\.\.?\/)*assets\//.test(path)));
  for (const path of paths) {
    const record = await loadWikiAsset(path);
    if (record) await persistAssetToBackend(record.path, record.blob);
    else {
      const response = await fetch('/' + path.replace(/^(?:\.\.?\/)+/, ''));
      if (!isAssetResponse(response)) throw new Error(`附件不存在：${path}`);
    }
  }
}

/** Sanitize file name to avoid invalid characters while preserving Chinese and unicode */
export function sanitizeAssetFileName(raw: string): string {
  return raw
    .trim()
    .replace(/[\\/:*?"<>|\r\n]/g, '_')
    .replace(/\s+/g, '_') || 'file';
}

/**
 * Save an image or attachment into Wiki binary asset storage.
 * Returns the relative path to be inserted into Markdown: "assets/asset_...ext".
 */
export async function saveWikiAsset(
  fileOrBlob: File | Blob,
  originalName?: string
): Promise<{ assetPath: string; fileName: string; sizeBytes: number }> {
  const db = await getDb();
  const rawName = originalName || (fileOrBlob instanceof File ? fileOrBlob.name : 'asset.bin');
  const safeName = sanitizeAssetFileName(rawName);

  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).slice(2, 7);
  const assetKey = `asset_${timestamp}_${randomSuffix}_${safeName}`;
  const assetPath = `assets/${assetKey}`;

  const record: StoredAssetRecord = {
    path: assetPath,
    blob: fileOrBlob,
    fileName: safeName,
    mimeType: fileOrBlob.type || 'application/octet-stream',
    sizeBytes: fileOrBlob.size,
    createdAt: timestamp,
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || new Error('Failed to save asset'));
  });

  // Pre-cache object URL
  const objectUrl = URL.createObjectURL(fileOrBlob);
  objectUrlCache.set(assetPath, objectUrl);

  // Persist to backend storage so LAN users and web viewer can fetch it
  void persistAssetToBackend(assetPath, fileOrBlob).catch(error => console.warn('[wikiAssetStore] Asset upload will be retried before sharing', error));

  return {
    assetPath,
    fileName: safeName,
    sizeBytes: fileOrBlob.size,
  };
}

/**
 * Retrieve the Blob for a stored asset by its path ("assets/...").
 */
async function loadWikiAsset(assetPath: string): Promise<StoredAssetRecord | null> {
  try {
    const db = await getDb();
    for (const path of assetPathCandidates(assetPath)) {
      const record = await new Promise<StoredAssetRecord | null>((resolve, reject) => {
        const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(path);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error || new Error('Failed to read asset'));
      });
      if (record) return record;
    }
    return null;
  } catch (err) {
    console.warn(`[wikiAssetStore] Could not load asset for ${assetPath}:`, err);
    return null;
  }
}

export async function getWikiAssetBlob(assetPath: string): Promise<Blob | null> {
  const local = await loadWikiAsset(assetPath);
  if (local?.blob) return local.blob;

  if (typeof window !== 'undefined') {
    try {
      const cleanPath = assetPath.replace(/^(?:\.\.?\/)+/, '').replace(/^\/+/, '');
      const res = await fetch(`/${cleanPath}`);
      if (isAssetResponse(res)) {
        return await res.blob();
      }
    } catch {
      /* ignore fetch errors */
    }
  }

  return null;
}

/**
 * Get an active Object URL for preview/rendering an asset.
 */
export async function getWikiAssetUrl(assetPath: string): Promise<string | null> {
  for (const path of assetPathCandidates(assetPath)) {
    const cached = objectUrlCache.get(path);
    if (cached) return cached;
  }

  const asset = await loadWikiAsset(assetPath);
  if (asset) {
    const cached = objectUrlCache.get(asset.path);
    if (cached) return cached;
    const url = URL.createObjectURL(asset.blob);
    objectUrlCache.set(asset.path, url);
    return url;
  }

  if (typeof window !== 'undefined') {
    const cleanPath = assetPath.replace(/^(?:\.\.?\/)+/, '').replace(/^\/+/, '');
    const serverUrl = `/${cleanPath}`;

    void fetch(serverUrl)
      .then(async (res) => {
        if (!isAssetResponse(res)) return;
        const blob = await res.blob();
        if (blob && blob.size > 0) {
          const db = await getDb();
          const fileName = cleanPath.split('_').slice(3).join('_') || cleanPath;
          const record: StoredAssetRecord = {
            path: cleanPath,
            blob,
            fileName,
            mimeType: blob.type || 'application/octet-stream',
            sizeBytes: blob.size,
            createdAt: Date.now(),
          };
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).put(record);
          const url = URL.createObjectURL(blob);
          objectUrlCache.set(cleanPath, url);
        }
      })
      .catch(() => {});

    return serverUrl;
  }

  return null;
}

/**
 * Convert a legacy Base64 Data URL into a binary Wiki asset and store it.
 */
export async function convertDataUrlToWikiAsset(
  dataUrl: string,
  defaultName = 'image.png'
): Promise<{ assetPath: string; blob: Blob }> {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid data URL format');
  }
  const mimeType = match[1];
  const base64 = match[2];
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });
  const result = await saveWikiAsset(blob, defaultName);
  return { assetPath: result.assetPath, blob };
}

/**
 * Retrieve all assets from the database (for full export).
 */
export async function getAllWikiAssets(): Promise<Map<string, Blob>> {
  const map = new Map<string, Blob>();
  try {
    const db = await getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const record = cursor.value as StoredAssetRecord;
          map.set(record.path, record.blob);
          cursor.continue();
        } else {
          resolve();
        }
      };
      req.onerror = () => reject(req.error || new Error('Failed to read all assets'));
    });
  } catch (err) {
    console.warn('[wikiAssetStore] getAllWikiAssets error:', err);
  }
  return map;
}
