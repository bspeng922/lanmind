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

  return {
    assetPath,
    fileName: safeName,
    sizeBytes: fileOrBlob.size,
  };
}

/**
 * Retrieve the Blob for a stored asset by its path ("assets/...").
 */
export async function getWikiAssetBlob(assetPath: string): Promise<Blob | null> {
  const cleanPath = assetPath.replace(/^[./]+/, '').replace(/^assets\//, 'assets/');
  try {
    const db = await getDb();
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(cleanPath);
      req.onsuccess = () => {
        const result = req.result as StoredAssetRecord | undefined;
        resolve(result?.blob || null);
      };
      req.onerror = () => reject(req.error || new Error('Failed to read asset'));
    });
  } catch (err) {
    console.warn(`[wikiAssetStore] Could not load blob for ${cleanPath}:`, err);
    return null;
  }
}

/**
 * Get an active Object URL for preview/rendering an asset.
 */
export async function getWikiAssetUrl(assetPath: string): Promise<string | null> {
  const cleanPath = assetPath.replace(/^[./]+/, '').replace(/^assets\//, 'assets/');
  if (objectUrlCache.has(cleanPath)) {
    return objectUrlCache.get(cleanPath)!;
  }

  const blob = await getWikiAssetBlob(cleanPath);
  if (!blob) return null;

  const url = URL.createObjectURL(blob);
  objectUrlCache.set(cleanPath, url);
  return url;
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
