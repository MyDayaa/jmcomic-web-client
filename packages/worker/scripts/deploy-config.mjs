// KV is opt-in; browser, memory and edge caches do not require a KV binding.
import { readFileSync, writeFileSync } from 'node:fs';

const source = new URL('../wrangler.jsonc', import.meta.url);
const target = new URL('../wrangler.deploy.json', import.meta.url);
const config = JSON.parse(readFileSync(source, 'utf8'));
const kvId = process.env.ALBUM_CACHE_KV_ID?.trim();
// Cache writes are opt-in so free accounts do not exhaust their daily KV quota.
config.vars = { ...config.vars, ALBUM_CACHE_KV_WRITES: process.env.ALBUM_CACHE_KV_WRITES === 'true' ? 'true' : 'false' };

if (kvId && process.env.ALBUM_CACHE_KV_ENABLED === 'true') {
	config.kv_namespaces = [{ binding: 'ALBUM_CACHE_KV', id: kvId }];
	console.log('已显式启用可选 KV，部署时绑定 ALBUM_CACHE_KV。');
} else {
	delete config.kv_namespaces;
	console.log('部署使用内存和边缘缓存，不绑定或访问 KV。');
}

writeFileSync(target, JSON.stringify(config, null, '\t') + '\n');
