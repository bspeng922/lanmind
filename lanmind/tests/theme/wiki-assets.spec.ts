import { expect, test } from '@playwright/test';

test('upgrading the attachment cache preserves old records and exports only the selected scope', async ({ page }) => {
    await page.goto('/tests/theme/index.html?view=controls');
    const result = await page.evaluate(async () => {
        const contextPath = '/src/utils/workspaceContext.ts';
        const { setWorkspaceContext, scopedStorageKey } = await import(contextPath);
        const scope = { workspaceId: 'A', userId: 'alice', revision: 1 };
        const selected = scopedStorageKey('wiki-assets', scope);
        const other = scopedStorageKey('wiki-assets', { ...scope, workspaceId: 'B' });
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('lanmind_wiki_assets_v1', 2);
            request.onupgradeneeded = () => {
                request.result.createObjectStore('scoped-assets', { keyPath: 'key' });
                request.result.createObjectStore('assets', { keyPath: 'path' });
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        await new Promise<void>((resolve, reject) => {
            const transaction = db.transaction(['scoped-assets', 'assets'], 'readwrite');
            for (const item of [selected, other]) {
                transaction.objectStore('scoped-assets').put({ key: JSON.stringify([item, 'assets/note.txt']), scope: item, path: 'assets/note.txt', blob: new Blob([item === selected ? 'selected' : 'foreign']) });
            }
            transaction.objectStore('assets').put({ path: 'assets/legacy.txt', blob: new Blob(['legacy']) });
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
        db.close();
        const getAll = IDBObjectStore.prototype.getAll;
        IDBObjectStore.prototype.getAll = function (...args) {
            if (this.name === 'scoped-assets') throw new Error('Do not load blobs from every workspace');
            return getAll.apply(this, args);
        };
        try {
            setWorkspaceContext(scope);
            const assetPath = '/src/components/wiki/wikiAssetStore.ts';
            const assets = await import(assetPath);
            const selectedFiles = await assets.getAllWikiAssets();
            setWorkspaceContext({ ...scope, workspaceId: 'B', revision: 2 });
            const otherFiles = await assets.getAllWikiAssets();
            const pendingExport = assets.getAllWikiAssets();
            setWorkspaceContext({ ...scope, revision: 3 });
            let staleExportRejected = false;
            try { await pendingExport; } catch { staleExportRejected = true; }
            return { selected: await selectedFiles.get('assets/note.txt')?.text(), other: await otherFiles.get('assets/note.txt')?.text(), counts: [selectedFiles.size, otherFiles.size], staleExportRejected };
        } finally {
            IDBObjectStore.prototype.getAll = getAll;
        }
    });
    expect(result).toEqual({ selected: 'selected', other: 'foreign', counts: [1, 1], staleExportRejected: true });
});

test('Wiki attachment caches isolate workspaces and users, release URLs and keep canonical Markdown', async ({ page }) => {
    await page.route('**/api/wiki/assets/**', route => route.fulfill({ json: { ok: true } }));
    await page.route('**/assets/**', route => route.fulfill({ status: 404 }));
    await page.goto('/tests/theme/index.html?view=controls');
    const result = await page.evaluate(async () => {
        const modulePath = '/src/components/wiki/wikiAssetStore.ts';
        const contextPath = '/src/utils/workspaceContext.ts';
        const assets = await import(modulePath);
        const { setWorkspaceContext } = await import(contextPath);
        const scope = { workspaceId: 'A', userId: 'alice', revision: 1 };
        setWorkspaceContext(scope);
        const { assetPath } = await assets.saveWikiAsset(new Blob(['private attachment'], { type: 'text/plain' }), 'note.txt');
        const url = await assets.getWikiAssetUrl(assetPath);
        const canonical = assets.canonicalizeWikiAssetUrls(`[note](${url})`);
        assets.releaseUnusedWikiAssetUrls(true);
        let revoked = false;
        try {
            await fetch(url);
        }
        catch {
            revoked = true;
        }
        setWorkspaceContext({ ...scope, workspaceId: 'B', revision: 2 });
        const otherWorkspace = await assets.getWikiAssetBlob(assetPath);
        setWorkspaceContext({ ...scope, userId: 'bob', revision: 3 });
        const otherUser = await assets.getWikiAssetBlob(assetPath);
        setWorkspaceContext(scope);
        const restored = await (await assets.getWikiAssetBlob(assetPath))?.text();
        history.replaceState(null, '', '?wiki=shared&share=revoked');
        const publicUrl = await assets.getWikiAssetUrl(assetPath);
        const publicExportCount = (await assets.getAllWikiAssets()).size;
        let publicWriteRejected = false;
        try {
            await assets.saveWikiAsset(new Blob(['untrusted']), 'public.txt');
        }
        catch {
            publicWriteRejected = true;
        }
        return { assetPath, canonical, revoked, otherWorkspace, otherUser, restored, publicUrl, publicExportCount, publicWriteRejected };
    });
    expect(result.canonical).toBe(`[note](${result.assetPath})`);
    expect(result.revoked).toBe(true);
    expect(result.otherWorkspace).toBeNull();
    expect(result.otherUser).toBeNull();
    expect(result.restored).toBe('private attachment');
    expect(result.publicUrl).toContain('?share=revoked');
    expect(result.publicUrl).not.toContain('blob:');
    expect(result.publicExportCount).toBe(0);
    expect(result.publicWriteRejected).toBe(true);
});
