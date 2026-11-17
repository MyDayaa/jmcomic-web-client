import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clearResourceCacheForTest,
	getResourceCacheKey,
	readResources,
	resolveResource,
	type CacheEnvelope,
	type ResourceDescriptor,
} from '../src/resource-cache';

function album(id: string): ResourceDescriptor {
	return { kind: 'album', id };
}

function envelope(
	descriptor: ResourceDescriptor,
	value: unknown,
	fetchedAt = Date.now(),
): CacheEnvelope {
	return { version: 2, ...descriptor, value, fetchedAt };
}

async function putKv(entry: CacheEnvelope) {
	await env.ALBUM_CACHE_KV.put(
		`resource:v2:${entry.kind}:${entry.id}`,
		JSON.stringify(entry),
		{ expirationTtl: 24 * 60 * 60 },
	);
}

describe('resource cache', () => {
	beforeEach(() => {
		clearResourceCacheForTest();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-24T00:00:00Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('bulk reads KV entries and promotes them to L1', async () => {
		const first = album('bulk-a');
		const second = { kind: 'photo', id: 'bulk-b' } satisfies ResourceDescriptor;
		await putKv(envelope(first, { id: first.id, series: [] }));
		await putKv(envelope(second, { id: second.id, images: [] }));

		const initial = await readResources([first, second], 'https://worker.test/batch', env.ALBUM_CACHE_KV);
		expect(initial.get(getResourceCacheKey(first))?.source).toBe('kv');
		expect(initial.get(getResourceCacheKey(second))?.source).toBe('kv');

		const promoted = await readResources([first, second], 'https://worker.test/batch', env.ALBUM_CACHE_KV);
		expect(promoted.get(getResourceCacheKey(first))?.source).toBe('l1');
		expect(promoted.get(getResourceCacheKey(second))?.source).toBe('l1');
	});

	it('uses short series freshness and longer stable freshness', async () => {
		const series = album('series-stale');
		const stable = album('stable-fresh');
		await putKv(envelope(series, { id: series.id, series: [{ id: 'chapter' }] }, Date.now() - 2 * 60_000));
		await putKv(envelope(stable, { id: stable.id, series: [] }, Date.now() - 2 * 60_000));

		const values = await readResources([series, stable], 'https://worker.test/ttl', env.ALBUM_CACHE_KV);
		expect(values.get(getResourceCacheKey(series))?.freshness).toBe('stale');
		expect(values.get(getResourceCacheKey(stable))?.freshness).toBe('fresh');
	});

	it('keeps KV read-only by default while retaining memory and edge caching', async () => {
		const resource = album('read-only-default');
		const put = vi.fn();
		const kv = { put } as unknown as KVNamespace;
		const ctx = createExecutionContext();
		const options = { descriptor: resource, forceRefresh: true, requestUrl: 'https://worker.test/read-only', kv, ctx, fetcher: async () => ({ id: resource.id, series: [] }) };
		expect((await resolveResource(options)).source).toBe('upstream');
		await waitOnExecutionContext(ctx);
		expect(put).not.toHaveBeenCalled();
		expect((await readResources([resource], options.requestUrl)).get(getResourceCacheKey(resource))?.source).toBe('l1');
		clearResourceCacheForTest();
		expect((await readResources([resource], options.requestUrl)).get(getResourceCacheKey(resource))?.source).toBe('edge');
	});

	it('persists to KV only after an explicit opt-in', async () => {
		const resource = album('write-opt-in');
		const ctx = createExecutionContext();
		await resolveResource({ descriptor: resource, forceRefresh: false, requestUrl: 'https://worker.test/opt-in', kv: env.ALBUM_CACHE_KV, kvWriteEnabled: true, ctx, fetcher: async () => ({ id: resource.id, series: [] }) });
		await waitOnExecutionContext(ctx);
		expect(await env.ALBUM_CACHE_KV.get(`resource:v2:album:${resource.id}`, 'json')).toMatchObject({ value: { id: resource.id } });
	});

	it('returns fresh upstream data despite synchronous or asynchronous KV quota errors', async () => {
		for (const synchronous of [true, false]) {
			const resource = album(`quota-${synchronous}`);
			const put = vi.fn(() => {
				const error = new Error('KV PUT failed: 429 daily quota exceeded');
				if (synchronous) throw error;
				return Promise.reject(error);
			});
			const kv = { put } as unknown as KVNamespace;
			const ctx = createExecutionContext();
			const result = await resolveResource({ descriptor: resource, forceRefresh: true, requestUrl: 'https://worker.test/quota', kv, kvWriteEnabled: true, ctx, fetcher: async () => ({ id: resource.id, series: [] }) });
			await waitOnExecutionContext(ctx);
			expect(result).toMatchObject({ freshness: 'fresh', source: 'upstream', value: { id: resource.id } });
			expect(put).toHaveBeenCalledTimes(1);
		}
	});

	it('coalesces concurrent upstream misses and persists through waitUntil', async () => {
		const resource = album('singleflight');
		const ctx = createExecutionContext();
		let resolveFetch!: (value: { id: string; series: never[] }) => void;
		const fetcher = vi.fn(() => new Promise<{ id: string; series: never[] }>((resolve) => {
			resolveFetch = resolve;
		}));
		const options = {
			descriptor: resource,
			forceRefresh: false,
			requestUrl: 'https://worker.test/singleflight',
			kv: env.ALBUM_CACHE_KV,
			ctx,
			fetcher,
		};

		const first = resolveResource(options);
		const second = resolveResource(options);
		expect(fetcher).toHaveBeenCalledTimes(1);
		resolveFetch({ id: resource.id, series: [] });
		expect((await first).source).toBe('upstream');
		expect((await second).source).toBe('upstream');
		await waitOnExecutionContext(ctx);

		clearResourceCacheForTest();
		const persisted = await readResources([resource], options.requestUrl, env.ALBUM_CACHE_KV);
		expect(['edge', 'kv']).toContain(persisted.get(getResourceCacheKey(resource))?.source);
	});

	it('serves stale immediately, refreshes in background, and keeps stale on forced failure', async () => {
		const resource = album('swr-series');
		await putKv(envelope(resource, { id: resource.id, series: [{ id: 'old' }] }, Date.now() - 2 * 60_000));
		const cached = (await readResources([resource], 'https://worker.test/swr', env.ALBUM_CACHE_KV))
			.get(getResourceCacheKey(resource));
		expect(cached?.freshness).toBe('stale');

		const backgroundCtx = createExecutionContext();
		const background = await resolveResource({
			descriptor: resource,
			cached,
			forceRefresh: false,
			requestUrl: 'https://worker.test/swr',
			kv: env.ALBUM_CACHE_KV,
			ctx: backgroundCtx,
			fetcher: async () => ({ id: resource.id, series: [{ id: 'new' }] }),
		});
		expect(background.freshness).toBe('stale');
		await waitOnExecutionContext(backgroundCtx);
		const refreshed = await readResources([resource], 'https://worker.test/swr', env.ALBUM_CACHE_KV);
		expect(refreshed.get(getResourceCacheKey(resource))?.freshness).toBe('fresh');

		vi.advanceTimersByTime(2 * 60_000);
		const staleAgain = (await readResources([resource], 'https://worker.test/swr', env.ALBUM_CACHE_KV))
			.get(getResourceCacheKey(resource));
		const forced = await resolveResource({
			descriptor: resource,
			cached: staleAgain,
			forceRefresh: true,
			requestUrl: 'https://worker.test/swr',
			kv: env.ALBUM_CACHE_KV,
			ctx: createExecutionContext(),
			fetcher: async () => { throw new Error('offline'); },
		});
		expect(forced.freshness).toBe('stale');
	});

	it('does not return entries beyond their stale window', async () => {
		const series = album('series-expired');
		await putKv(envelope(series, { id: series.id, series: [{ id: 'chapter' }] }, Date.now() - 16 * 60_000));
		const result = await readResources([series], 'https://worker.test/expired', env.ALBUM_CACHE_KV);
		expect(result.has(getResourceCacheKey(series))).toBe(false);
	});

	it('serves stale edge data during an outage and returns to upstream after expiry without KV', async () => {
		const resource = album('edge-only-lifecycle');
		const requestUrl = 'https://worker.test/edge-only-lifecycle';
		const ctx = createExecutionContext();
		const value = { id: resource.id, series: [{ id: 'chapter' }] };
		await resolveResource({ descriptor: resource, forceRefresh: false, requestUrl, ctx, fetcher: async () => value });
		await waitOnExecutionContext(ctx);
		clearResourceCacheForTest();
		vi.advanceTimersByTime(2 * 60_000);
		const cached = (await readResources([resource], requestUrl)).get(getResourceCacheKey(resource));
		expect(cached).toMatchObject({ source: 'edge', freshness: 'stale' });
		const outage = createExecutionContext();
		const result = await resolveResource({ descriptor: resource, cached, forceRefresh: false, requestUrl, ctx: outage, fetcher: async () => { throw new Error('upstream offline'); } });
		expect(result.value).toEqual(value);
		await waitOnExecutionContext(outage);
		vi.advanceTimersByTime(14 * 60_000);
		clearResourceCacheForTest();
		expect((await readResources([resource], requestUrl)).size).toBe(0);
		const recovery = createExecutionContext();
		const refreshed = await resolveResource({ descriptor: resource, forceRefresh: false, requestUrl, ctx: recovery, fetcher: async () => ({ ...value, name: 'updated' }) });
		expect(refreshed).toMatchObject({ source: 'upstream', freshness: 'fresh', value: { name: 'updated' } });
		await waitOnExecutionContext(recovery);
	});
});
