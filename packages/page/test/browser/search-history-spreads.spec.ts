import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.use({ serviceWorkers: 'block' });

async function compositionDraft(page: Page, value: string) {
    // Firefox's Playwright fill() commits its own native composition. A draft
    // must instead stay between compositionstart and our explicit compositionend.
    await page.getByRole('combobox', { name: '搜索内容', exact: true }).evaluate((input: HTMLInputElement, text) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: text, isComposing: true }));
    }, value);
}

async function mockReader(page: Page) {
    const image = await readFile('../sdk/test/fixtures/720x1016-2.png');
    const album = { id: '123', name: 'History and spread fixture', images: [], description: null, totalViews: '1', likes: '1', series: [], seriesID: '0', author: ['Fixture'], tags: [], works: [], actors: [] };
    const photo = { id: '123', name: album.name, scrambleId: 1, images: Array.from({ length: 5 }, (_, i) => ({ name: `${i}.png`, url: `http://backend.test/images/${i}.png` })) };
    const queries: string[] = [];
    await page.route('http://backend.test/**', async route => {
        const url = new URL(route.request().url());
        const headers = { 'Access-Control-Allow-Origin': '*' };
        if (url.pathname.startsWith('/images/')) return route.fulfill({ contentType: 'image/png', body: image, headers });
        if (url.pathname === '/search') { queries.push(url.searchParams.get('query')!); return route.fulfill({ headers, json: { search_query: 'test', total: '0', content: [] } }); }
        const value = url.pathname === '/album/123' ? album : url.pathname === '/photo/123' ? photo : null;
        return route.fulfill({ status: value ? 200 : 404, headers, json: value });
    });
    return queries;
}

test('pinyin composition does not create tags or searches until the candidate is committed', async ({ page }) => {
    const queries = await mockReader(page);
    await page.goto('/');
    const input = page.getByRole('combobox', { name: '搜索内容', exact: true });
    await input.focus();
    await input.dispatchEvent('compositionstart');
    await compositionDraft(page, 'shuang pin shu ru');
    await input.press('Enter');
    await expect(page.getByRole('list', { name: '搜索标签' })).toHaveCount(0);
    expect(queries).toEqual([]);
    await compositionDraft(page, '双拼输入');
    await input.dispatchEvent('compositionend', { data: '双拼输入' });
    await input.press('Enter');
    await expect.poll(() => queries).toEqual(['双拼输入']);
    await expect(page).toHaveURL(/q=%E5%8F%8C%E6%8B%BC%E8%BE%93%E5%85%A5/);
    await page.goto('/');
    await page.getByRole('button', { name: '双拼输入', exact: true }).click();
    await expect(page).toHaveURL(/q=%E5%8F%8C%E6%8B%BC%E8%BE%93%E5%85%A5/);
});

test('reading history survives reload, uses distinct work IDs and resumes the saved page', async ({ page }) => {
    await mockReader(page);
    await page.goto('/reader/123');
    const container = page.locator('[data-reader-container]');
    await expect.poll(() => page.locator('[data-reader-root] img').evaluateAll(images => images.some(img => img.complete && img.naturalWidth === 720))).toBe(true);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => container.evaluate(el => Math.round(el.scrollLeft / el.clientWidth))).toBe(1);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('jm-reading-history:v1') || '[]')[0]?.page)).toBe(1);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('jm-reading-history:v1')!)[0].albumId)).toBe('123');
    await page.goto('/history');
    await expect(page.getByText('History and spread fixture', { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole('link', { name: /History and spread fixture/ }).click();
    await expect.poll(() => page.locator('[data-reader-container]').evaluate(el => Math.round(el.scrollLeft / el.clientWidth))).toBe(1);
    await page.goto('/history');
    await page.getByRole('button', { name: '删除阅读记录 History and spread fixture' }).click();
    await expect(page.getByText(/暂无阅读记录/)).toBeVisible();
    await page.reload();
    await expect(page.getByText(/暂无阅读记录/)).toBeVisible();
});

test('wide readers show paired pages, turn complete spreads and keep an odd last page visible', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 820 });
    await mockReader(page);
    await page.goto('/reader/123');
    await expect.poll(() => page.locator('[data-reader-page="0"] img').evaluateAll(images => images.some(img => img.complete && img.naturalWidth === 720))).toBe(true);
    await page.mouse.move(500, 350);
    await page.getByRole('button', { name: '打开阅读设置' }).click();
    await page.getByRole('switch', { name: '双页阅读' }).click();
    await page.getByRole('button', { name: '关闭阅读设置' }).click();
    await expect(page.getByRole('button', { name: '打开阅读设置' })).toBeFocused();
    const container = page.locator('[data-reader-container]');
    await expect(container).toHaveAttribute('data-reader-layout', 'double');
    await expect.poll(() => container.evaluate(el => {
        const pages = el.querySelectorAll('[data-reader-page]');
        return [pages[0].getBoundingClientRect().width, pages[1].getBoundingClientRect().width].map(w => Math.round(w / el.clientWidth * 100));
    })).toEqual([50, 50]);
    await container.click({ position: { x: 590, y: 410 } });
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => container.evaluate(el => Math.round(el.scrollLeft / el.clientWidth))).toBe(1);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => container.evaluate(el => Math.round(el.scrollLeft / el.clientWidth))).toBe(2);
    await expect.poll(() => container.evaluate(el => {
        const last = el.querySelector('[data-reader-page="4"]')!.getBoundingClientRect();
        const viewport = el.getBoundingClientRect();
        return last.left >= viewport.left - 1 && last.right <= viewport.right + 1;
    })).toBe(true);
    await page.setViewportSize({ width: 500, height: 820 });
    await expect(container).toHaveAttribute('data-reader-layout', 'single');
    await page.setViewportSize({ width: 1180, height: 820 });
    await expect(container).toHaveAttribute('data-reader-layout', 'double');
    await page.reload();
    await expect(page.locator('[data-reader-container]')).toHaveAttribute('data-reader-layout', 'double');
});
