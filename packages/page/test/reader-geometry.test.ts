import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  PageOffsetCache,
  computeVisiblePageIndexes,
  findCenterPage,
  findPageAtCenter,
  measurePageOffset,
  normalizePageOffset,
  findNearestPageStart,
} from '../src/reader/page-geometry';

type FakePage = {
  offsetTop: number;
  offsetLeft: number;
  offsetWidth: number;
  offsetHeight: number;
};

function fakePage(start: number, size: number): FakePage {
  return { offsetTop: start, offsetLeft: start, offsetWidth: size, offsetHeight: size };
}

describe('page geometry helpers', () => {
  it('normalizes RTL geometry and selects the requested page edge rather than a later center', () => {
    assert.deepEqual(normalizePageOffset({ start: -600, size: 300 }, 300, true), { start: 600, size: 300 });
    assert.deepEqual(normalizePageOffset({ start: 600, size: 300 }, 300, false), { start: 600, size: 300 });
    const offset = (i: number) => ({ start: i * 300, size: 300 });
    assert.equal(findNearestPageStart(5, 300, offset), 1);
    assert.equal(findNearestPageStart(5, 0, offset), 0);
    assert.equal(findNearestPageStart(5, 650, offset, { pageStep: 2 }), 2);
    assert.equal(findNearestPageStart(5, 650, offset, { maxPosition: 650, preferredPage: 4 }), 4);
    assert.equal(findNearestPageStart(5, 650, offset, { maxPosition: 650 }), 3);
    assert.equal(findNearestPageStart(0, 0, offset), null);
  });
  it('measures the horizontal or vertical axis on demand', () => {
    const el = fakePage(40, 20);
    assert.deepEqual(measurePageOffset(el as HTMLElement, false), { start: 40, size: 20 });
    assert.deepEqual(measurePageOffset(el as HTMLElement, true), { start: 40, size: 20 });
  });

  it('finds pages intersecting the viewport', () => {
    const pages = [fakePage(0, 100), fakePage(100, 100), fakePage(200, 100)];
    const visible = computeVisiblePageIndexes(3, 50, 150, (i) => measurePageOffset(pages[i] as HTMLElement, false));
    assert.deepEqual([...visible], [0, 1]);
  });

  it('returns an empty set when nothing intersects', () => {
    const pages = [fakePage(0, 100), fakePage(100, 100)];
    const visible = computeVisiblePageIndexes(2, 1000, 1100, (i) => measurePageOffset(pages[i] as HTMLElement, false));
    assert.equal(visible.size, 0);
  });

  it('finds the page whose center is nearest to the scroll center', () => {
    const pages = [fakePage(0, 100), fakePage(100, 100), fakePage(200, 100)];
    const result = findCenterPage(3, 240, (i) => measurePageOffset(pages[i] as HTMLElement, false));
    assert.equal(result, 2);
  });

  it('returns no center page when the collection is empty', () => {
    assert.equal(findCenterPage(0, 50, () => ({ start: 0, size: 100 })), null);
    assert.equal(findPageAtCenter(0, 50, () => ({ start: 0, size: 100 })), null);
  });

  it('finds the page overlapping a position', () => {
    const pages = [fakePage(0, 100), fakePage(100, 100), fakePage(200, 100)];
    const result = findPageAtCenter(3, 150, (i) => measurePageOffset(pages[i] as HTMLElement, false));
    assert.equal(result, 1);
  });
});

describe('PageOffsetCache', () => {
  it('caches the offset for an element and returns it on subsequent reads', () => {
    const cache = new PageOffsetCache();
    const page = fakePage(10, 50);
    assert.deepEqual(cache.get(0, page as HTMLElement, false), { start: 10, size: 50 });
    page.offsetTop = 999; // mutate after cache
    assert.deepEqual(cache.get(0, page as HTMLElement, false), { start: 10, size: 50 });
  });

  it('re-measures when the element at an index changes', () => {
    const cache = new PageOffsetCache();
    const first = fakePage(10, 50);
    const second = fakePage(200, 30);
    cache.get(0, first as HTMLElement, false);
    const result = cache.get(0, second as HTMLElement, false);
    assert.deepEqual(result, { start: 200, size: 30 });
  });

  it('re-measures the new axis after invalidation', () => {
    const cache = new PageOffsetCache();
    const page = fakePage(10, 50);
    assert.deepEqual(cache.get(0, page as HTMLElement, false), { start: 10, size: 50 });
    cache.invalidate();
    page.offsetLeft = 77;
    assert.deepEqual(cache.get(0, page as HTMLElement, true), { start: 77, size: 50 });
  });

  it('reports its entry count and invalidation generation', () => {
    const cache = new PageOffsetCache();
    assert.equal(cache.count, 0);
    assert.equal(cache.getGeneration(), 0);
    cache.get(0, fakePage(10, 50) as HTMLElement, false);
    assert.equal(cache.count, 1);
    cache.invalidate();
    assert.equal(cache.count, 0);
    assert.equal(cache.getGeneration(), 1);
  });
});
