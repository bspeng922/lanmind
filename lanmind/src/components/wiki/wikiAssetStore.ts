/** Workspace-scoped binary cache. Public viewers always use revocable server URLs. */
import { createId } from '../../utils/createId';
import { getWorkspaceContext, scopedStorageKey } from '../../utils/workspaceContext';
const DB_NAME = 'lanmind_wiki_assets_v1';
const STORE = 'scoped-assets';
interface StoredAssetRecord {
    key: string;
    scope: string;
    path: string;
    blob: Blob;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: number;
}
const objectUrlCache = new Map<string, {
    url: string;
    path: string;
}>();
// Keep only strings after eviction, so old editor callbacks can still canonicalize URLs.
const canonicalUrls = new Map<string, string>();
let dbPromise: Promise<IDBDatabase> | null = null;
let exportsInProgress = 0;
const scopeKey = () => scopedStorageKey('wiki-assets');
const publicShare = () => typeof location !== 'undefined' ? new URLSearchParams(location.search).get('share') : null;
const publicView = () => typeof location !== 'undefined' && ['wiki', 'share'].some(key => new URLSearchParams(location.search).has(key));
const assetKey = (path: string, scope = scopeKey()) => JSON.stringify([scope, path]);
function candidates(path: string): string[] {
    path = path.replace(/^(?:\.\.?\/)+/, '').replace(/^\/+/, '');
    try {
        return [...new Set([path, decodeURIComponent(path.replace(/%(?![\da-f]{2})/gi, '%25'))])];
    }
    catch {
        return [path];
    }
}
function serverUrl(path: string): string {
    const clean = candidates(path).at(-1)!.split('/').map(part => encodeURIComponent(part)).join('/');
    const share = publicShare();
    return `/${clean}${share ? `?share=${encodeURIComponent(share)}` : ''}`;
}
export function canonicalizeWikiAssetUrls(markdown: string): string {
    for (const [url, path] of canonicalUrls)
        if (markdown.includes(url))
            markdown = markdown.split(url).join(path);
    return markdown;
}
function getDb(): Promise<IDBDatabase> {
    if (!dbPromise)
        dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 2);
            req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE))
                req.result.createObjectStore(STORE, { keyPath: 'key' }); };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => { dbPromise = null; reject(req.error); };
        });
    return dbPromise;
}
async function records(scope = scopeKey()): Promise<StoredAssetRecord[]> {
    const db = await getDb();
    return new Promise((resolve, reject) => {
        const req = db.transaction(STORE).objectStore(STORE).getAll();
        req.onsuccess = () => resolve((req.result as StoredAssetRecord[]).filter(r => r.scope === scope));
        req.onerror = () => reject(req.error);
    });
}
async function put(record: StoredAssetRecord): Promise<void> {
    const db = await getDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}
async function load(path: string, scope = scopeKey()): Promise<StoredAssetRecord | null> {
    if (publicView())
        return null;
    const db = await getDb();
    for (const candidate of candidates(path)) {
        const record = await new Promise<StoredAssetRecord | null>((resolve, reject) => {
            const req = db.transaction(STORE).objectStore(STORE).get(assetKey(candidate, scope));
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
        if (record)
            return record;
    }
    // Legacy records are quarantined. Claim only references in the original user's
    // scoped pages/history, never by filename alone or from a public share.
    const context = getWorkspaceContext();
    if (context && context.workspaceId === context.originalWorkspaceId && context?.userId === context?.originalUserId && db.objectStoreNames.contains('assets')) {
        const prefix = scopedStorageKey('', context);
        const texts = Object.keys(localStorage).filter(k => k.startsWith(prefix)).map(k => localStorage.getItem(k) || '');
        for (const candidate of candidates(path)) {
            if (!texts.some(text => text.includes(candidate)))
                continue;
            const legacy = await new Promise<StoredAssetRecord | null>(resolve => {
                const req = db.transaction('assets').objectStore('assets').get(candidate);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => resolve(null);
            });
            if (legacy) {
                const record = { ...legacy, scope, key: assetKey(candidate, scope) };
                await put(record);
                return record;
            }
        }
    }
    return null;
}
function cacheUrl(path: string, blob: Blob, scope: string): string {
    const key = assetKey(path, scope);
    const cached = objectUrlCache.get(key);
    if (cached)
        return cached.url;
    const url = URL.createObjectURL(blob);
    objectUrlCache.set(key, { url, path });
    canonicalUrls.set(url, path);
    return url;
}
/** Release detached preview URLs without interrupting mounted editors or exports. */
export function releaseUnusedWikiAssetUrls(force = false): void {
    if (exportsInProgress || objectUrlCache.size === 0)
        return;
    const mounted = new Set(typeof document === 'undefined' ? [] : Array.from(document.querySelectorAll('[src],[href]')).flatMap(n => [n.getAttribute('src'), n.getAttribute('href')]));
    for (const [key, { url }] of objectUrlCache)
        if (force || !mounted.has(url)) {
            URL.revokeObjectURL(url);
            objectUrlCache.delete(key);
        }
}
if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => releaseUnusedWikiAssetUrls(true));
    window.addEventListener('workspace:invalidated', () => releaseUnusedWikiAssetUrls(true));
    window.setInterval(() => releaseUnusedWikiAssetUrls(), 10000);
}
async function base64(blob: Blob): Promise<string> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
}
export async function persistAssetToBackend(path: string, blob: Blob, scope = scopeKey()): Promise<void> {
    if (publicView())
        throw new Error('Public viewers cannot upload assets');
    if (scope !== scopeKey())
        throw new Error('Workspace changed');
    const name = candidates(path).at(-1)!.replace(/^assets\//, '');
    if ('__TAURI_INTERNALS__' in window) {
        const { invoke } = await import('../../services/api');
        const base64Content = await base64(blob);
        if (scope !== scopeKey())
            throw new Error('Workspace changed');
        await invoke('save_wiki_asset', { name, base64Content });
    }
    else {
        const res = await fetch(`/api/wiki/assets/${encodeURIComponent(name)}`, { method: 'POST', body: blob });
        if (!res.ok)
            throw new Error(`Asset upload failed (${res.status})`);
    }
}
export async function syncWikiDocumentAssets(markdown: string): Promise<void> {
    const scope = scopeKey();
    const { renderWikiMarkdown } = await import('./wikiMarkdown');
    const host = document.createElement('div');
    host.innerHTML = renderWikiMarkdown(markdown);
    const paths = new Set(Array.from(host.querySelectorAll('img[src],a[href]')).map(n => n.getAttribute(n.tagName === 'IMG' ? 'src' : 'href') || '').filter(p => /^(?:\.\.?\/)*assets\//.test(p)));
    for (const path of paths) {
        const record = await load(path, scope);
        if (record)
            await persistAssetToBackend(record.path, record.blob, scope);
        else if (!await getWikiAssetBlob(path))
            throw new Error(`Attachment unavailable: ${path}`);
        if (scope !== scopeKey())
            throw new Error('Workspace changed');
    }
}
export function sanitizeAssetFileName(raw: string): string { return raw.trim().replace(/[\\/:*?"<>|\r\n]/g, '_').replace(/\s+/g, '_') || 'file'; }
export async function saveWikiAsset(blob: File | Blob, originalName?: string): Promise<{
    assetPath: string;
    fileName: string;
    sizeBytes: number;
}> {
    if (publicView())
        throw new Error('Public viewers cannot upload assets');
    const scope = scopeKey();
    const fileName = sanitizeAssetFileName(originalName || (blob instanceof File ? blob.name : 'asset.bin'));
    const path = `assets/asset_${createId()}_${fileName}`;
    await put({ key: assetKey(path, scope), scope, path, blob, fileName, mimeType: blob.type || 'application/octet-stream', sizeBytes: blob.size, createdAt: Date.now() });
    void persistAssetToBackend(path, blob, scope).catch(error => console.warn('Attachment upload will be retried before sharing', error));
    return { assetPath: path, fileName, sizeBytes: blob.size };
}
export async function getWikiAssetBlob(path: string): Promise<Blob | null> {
    const scope = scopeKey();
    try {
        const local = await load(path, scope).catch(() => null);
        if (scope !== scopeKey())
            return null;
        if (local)
            return local.blob;
        if (!publicView() && '__TAURI_INTERNALS__' in window) {
            const { invoke } = await import('../../services/api');
            const data = await invoke<string>('read_wiki_asset', { name: candidates(path).at(-1)!.replace(/^assets\//, '') });
            if (scope !== scopeKey())
                return null;
            const ext = path.split('.').at(-1)?.toLowerCase() || '';
            const mime: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };
            return new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))], { type: mime[ext] || 'application/octet-stream' });
        }
        const res = await fetch(serverUrl(path));
        if (res.ok && scope === scopeKey() && (!/text\/html/i.test(res.headers.get('content-type') || '') || res.headers.has('content-disposition')))
            return await res.blob();
    }
    catch (error) {
        console.warn('Could not load Wiki attachment', error);
    }
    return null;
}
export async function getWikiAssetUrl(path: string): Promise<string | null> {
    // Revocation is checked by the host for every public request; never use IDB.
    if (publicView())
        return serverUrl(path);
    const scope = scopeKey();
    for (const candidate of candidates(path)) {
        const cached = objectUrlCache.get(assetKey(candidate, scope));
        if (cached)
            return cached.url;
    }
    const blob = await getWikiAssetBlob(path);
    if (scope !== scopeKey() || !blob)
        return null;
    return cacheUrl(candidates(path).at(-1)!, blob, scope);
}
export async function convertDataUrlToWikiAsset(dataUrl: string, defaultName = 'image.png'): Promise<{
    assetPath: string;
    blob: Blob;
}> {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match)
        throw new Error('Invalid data URL');
    const blob = new Blob([Uint8Array.from(atob(match[2]), c => c.charCodeAt(0))], { type: match[1] });
    return { assetPath: (await saveWikiAsset(blob, defaultName)).assetPath, blob };
}
export async function getAllWikiAssets(): Promise<Map<string, Blob>> {
    if (publicView())
        return new Map();
    exportsInProgress++;
    try {
        return new Map((await records()).map(r => [r.path, r.blob]));
    }
    finally {
        exportsInProgress--;
    }
}
