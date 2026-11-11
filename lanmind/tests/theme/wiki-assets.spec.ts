import { expect, test } from '@playwright/test';
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
