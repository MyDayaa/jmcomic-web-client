import test from 'node:test';
import assert from 'node:assert/strict';
import { ImageWorkerClient } from '../src/image-bridge';

class Transport {
    onmessage?: (event: { data: unknown }) => void;
    onerror?: () => void;
    sent: { id: number }[] = [];
    terminated = false;
    postMessage(message: { id: number }) { this.sent.push(message); }
    terminate() { this.terminated = true; }
    finish(index: number) {
        this.onmessage?.({ data: { id: this.sent[index].id, result: { data: new Uint8Array([1]), width: 1, height: 1, mime: 'image/png' } } });
    }
}

test('preparation reuses the worker, preserves processing order and resets after disposal', async () => {
    const transports: Transport[] = [];
    const client = new ImageWorkerClient(() => {
        const transport = new Transport(); transports.push(transport); return transport as unknown as Worker;
    });
    client.prepare('webp');
    client.prepare('webp');
    assert.deepEqual(transports[0].sent, [{ type: 'prepare', input: 'webp' }]);
    const first = client.process(new ArrayBuffer(1), 0);
    client.prepare('png');
    const second = client.process(new ArrayBuffer(1), 0);
    assert.equal(transports.length, 1);
    assert.equal(transports[0].sent.length, 3);
    transports[0].finish(1);
    transports[0].finish(3);
    await Promise.all([first, second]);
    client.dispose();
    client.prepare('webp');
    assert.equal(transports.length, 2);
    assert.deepEqual(transports[1].sent, [{ type: 'prepare', input: 'webp' }]);
    client.dispose();
});

test('failed speculative startup does not prevent a later image from being processed', async () => {
    const transport = new Transport();
    let calls = 0;
    const client = new ImageWorkerClient(() => {
        if (calls++ === 0) throw new Error('temporary startup failure');
        return transport as unknown as Worker;
    });
    client.prepare('jpeg');
    const result = client.process(new ArrayBuffer(1), 0);
    transport.finish(0);
    assert.equal((await result).width, 1);
    client.dispose();
});

test('image bridge cancels queued and active consumers without misrouting the next result', async () => {
    const transport = new Transport();
    const client = new ImageWorkerClient(() => transport as unknown as Worker);
    const active = new AbortController(), queued = new AbortController();
    const first = client.process(new ArrayBuffer(1), 0, { signal: active.signal });
    const second = client.process(new ArrayBuffer(1), 0, { signal: queued.signal });
    const third = client.process(new ArrayBuffer(1), 0);
    const rejected = Promise.all([assert.rejects(first, { name: 'AbortError' }), assert.rejects(second, { name: 'AbortError' })]);
    queued.abort(); active.abort(); await rejected;
    assert.equal(transport.sent.length, 1);
    transport.finish(0);
    assert.equal(transport.sent.length, 2);
    transport.finish(1);
    assert.equal((await third).width, 1);
    client.dispose(); assert.equal(transport.terminated, true);
});

test('image bridge bounds its queue and recovers after worker startup failure', async () => {
    const transports: Transport[] = [];
    const client = new ImageWorkerClient(() => {
        const transport = new Transport(); transports.push(transport); return transport as unknown as Worker;
    });
    const jobs = Array.from({ length: 17 }, () => client.process(new ArrayBuffer(1), 0));
    await assert.rejects(client.process(new ArrayBuffer(1), 0), { code: 'BUSY' });
    const rejected = Promise.all(jobs.map(job => assert.rejects(job, /failed to start/)));
    transports[0].onerror?.(); await rejected;
    const next = client.process(new ArrayBuffer(1), 0);
    transports[1].finish(0); assert.equal((await next).height, 1);
    client.dispose();
});
