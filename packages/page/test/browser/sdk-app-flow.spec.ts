import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Service-worker-owned fetches bypass Playwright's route interception in WebKit.
// PWA registration/upgrades are covered separately by pwa-upgrade.spec.ts.
test.use({ serviceWorkers: 'block' });

test('the optional OCR runtime remains importable on demand', async ({ page }) => {
    const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8')) as Record<string, { file: string }>;
    const runtime = Object.entries(manifest).find(([key]) => key.includes('@paddleocr/paddleocr-js/dist/index.mjs'));
    expect(runtime).toBeDefined();
    await page.goto('/pwa-cache-cleanup-v3.txt');
    const available = await page.evaluate(async url => {
        const { PaddleOCR } = await import(url);
        return typeof PaddleOCR.create === 'function';
    }, `/${runtime![1].file}`);
    expect(available).toBe(true);
});

test('a fresh direct reader link fetches its chapter and displays a decoded page', async ({ page }) => {
    const image = await readFile('../sdk/test/fixtures/720x1016-2.png');
    const album = { id: '123', name: 'Direct reader fixture', images: [], description: null, totalViews: '1', likes: '1', series: [], seriesID: '', author: ['Fixture'], tags: [], works: [], actors: [] };
    const photo = { id: '123', name: album.name, scrambleId: 1, images: [{ name: '001.png', url: 'http://backend.test/images/001.png' }] };
    const paths = new Set<string>();
    const errors: string[] = [];
    const scripts = new Set<string>();
    const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8')) as Record<string, { file: string }>;
    const ocrFiles = Object.entries(manifest).filter(([key]) => /paddleocr|onnxruntime/.test(key)).map(([, chunk]) => chunk.file);
    page.on('request', request => {
        if (request.resourceType() === 'script') scripts.add(new URL(request.url()).pathname.slice(1));
    });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://backend.test/**', async route => {
        const path = new URL(route.request().url()).pathname;
        paths.add(path);
        const headers = { 'Access-Control-Allow-Origin': '*' };
        if (path === '/images/001.png') return route.fulfill({ contentType: 'image/png', headers, body: image });
        const result = path === '/album/123' ? album : path === '/photo/123' ? photo : null;
        await route.fulfill({ status: result ? 200 : 404, headers, json: result });
    });

    await page.goto('/reader/123');
    await expect(page.locator('[data-reader-root]')).toBeVisible();
    await expect.poll(() => page.locator('[data-reader-root] img').evaluateAll(images => images.some(image => image.complete && image.naturalWidth === 720 && image.naturalHeight === 1016))).toBe(true);
    expect(paths.has('/photo/123')).toBe(true);
    expect(paths.has('/images/001.png')).toBe(true);
    expect(errors).toEqual([]);
    expect([...scripts].filter(script => ocrFiles.includes(script))).toEqual([]);
});

test('fresh search, detail and reader process upstream images through the SDK worker', async ({ page }) => {
    const image = await readFile('../sdk/test/fixtures/720x1016-2.png');
    const album = { id: '123', name: 'SDK migration fixture', images: ['001.png'], description: null, totalViews: '123', likes: '7', series: [], seriesID: '', author: ['Fixture'], tags: ['SDK'], works: [], actors: [] };
    const photo = { id: '123', name: album.name, scrambleId: 1, images: [{ name: '001.png', url: 'http://backend.test/images/001.png' }] };
    const paths = new Set<string>();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://backend.test/**', async route => {
        const path = new URL(route.request().url()).pathname;
        paths.add(path);
        const headers = { 'Access-Control-Allow-Origin': '*' };
        if (path === '/images/001.png') return route.fulfill({ contentType: 'image/png', headers, body: image });
        const result = path === '/search' ? { search_query: 'sdk', total: '1', content: [{ id: album.id, name: album.name, author: 'Fixture' }] }
            : path === '/batch-album' ? [{ albumId: album.id, album, photo }]
            : path === '/album/123' ? album : path === '/photo/123' ? photo : null;
        await route.fulfill({ status: result ? 200 : 404, headers, json: result });
    });
    await page.goto('/');
    await page.getByPlaceholder('搜索内容...').fill('sdk');
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    const card = page.locator('[data-album-id="123"]');
    await expect(card).toBeVisible();
    await expect.poll(() => card.locator('img').evaluateAll(images => images.some(image => image.complete && image.naturalWidth === 720))).toBe(true);
    await card.click();
    await expect(page.getByText('浏览 123', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '在线观看', exact: true }).click();
    await expect(page.locator('[data-reader-root]')).toBeVisible();
    await expect.poll(() => page.locator('[data-reader-root] img').evaluateAll(images => images.some(image => image.complete && image.naturalWidth === 720 && image.naturalHeight === 1016))).toBe(true);
    await expect.poll(() => page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const open = indexedDB.open('jm-image-cache', 2); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
        });
        try { return await new Promise<boolean>((resolve, reject) => {
            const request = db.transaction('images').objectStore('images').get('sdk-v1/123/001.png');
            request.onsuccess = () => resolve(request.result?.width === 720); request.onerror = () => reject(request.error);
        }); } finally { db.close(); }
    })).toBe(true);
    expect(paths.has('/search')).toBe(true); expect(paths.has('/batch-album')).toBe(true); expect(paths.has('/images/001.png')).toBe(true);
    expect(errors).toEqual([]);
});
