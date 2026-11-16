import { createImageProcessor, imageInfo, type WasmName } from 'jmcomic-sdk-pwa/image';
import type { ImageOptions } from 'jmcomic-sdk-pwa';
import type { ImageCodecHint } from './image-bridge';
import jpegDec from 'jmcomic-sdk-pwa/wasm/mozjpeg_dec.wasm?url';
import jpegEnc from 'jmcomic-sdk-pwa/wasm/mozjpeg_enc.wasm?url';
import png from 'jmcomic-sdk-pwa/wasm/squoosh_png_bg.wasm?url';
import webpDec from 'jmcomic-sdk-pwa/wasm/webp_dec.wasm?url';

const assets = { 'jpeg-dec': jpegDec, 'jpeg-enc': jpegEnc, png, 'webp-dec': webpDec };
const modules = new Map<WasmName, Promise<WebAssembly.Module>>();
function loadWasm(name: WasmName): Promise<WebAssembly.Module> {
    let pending = modules.get(name);
    if (!pending) {
        pending = (async () => {
            const response = await fetch(assets[name]);
            if (!response.ok) throw new Error(`Image codec download failed: HTTP ${response.status}`);
            return WebAssembly.compile(await response.arrayBuffer());
        })();
        modules.set(name, pending);
        void pending.catch(() => modules.delete(name));
    }
    return pending;
}
const processor = createImageProcessor({ loadWasm });
const context = globalThis as unknown as {
    onmessage: (event: MessageEvent<
        { type: 'prepare'; input: ImageCodecHint }
        | { type?: never; id: number; data: ArrayBuffer; slices: number; options: ImageOptions }
    >) => void;
    postMessage: (message: unknown, transfer?: Transferable[]) => void;
};
context.onmessage = async ({ data: job }) => {
    if (job.type === 'prepare') {
        const decoder = job.input === 'jpeg' ? 'jpeg-dec' : job.input === 'webp' ? 'webp-dec' : 'png';
        // A filename is only a hint. Normal processing sniffs the actual bytes
        // and retries failed downloads through the same module cache.
        void Promise.all([loadWasm(decoder), loadWasm('jpeg-enc')]).catch(() => {});
        return;
    }
    try {
        const bytes = new Uint8Array(job.data);
        // Download only this image's decoder and output encoder, in parallel.
        // The SDK still validates limits, serializes codec use and restores rows.
        if (bytes.byteLength <= processor.maxInputBytes && job.options.format !== 'original') {
            const info = imageInfo(bytes);
            if (info.mime !== 'image/gif' && info.width * info.height <= 8_000_000) {
                const decoder = info.mime === 'image/png' ? 'png' : info.mime === 'image/jpeg' ? 'jpeg-dec' : 'webp-dec';
                const encoder = job.options.format === 'png' ? 'png' : 'jpeg-enc';
                await Promise.all([loadWasm(decoder), loadWasm(encoder)]);
            }
        }
        let result = await processor.process(bytes, job.slices, job.options);
        // Application exports require JPEG. The portable SDK intentionally passes GIF through.
        if (result.mime === 'image/gif' && job.options.format === 'jpeg') {
            const bitmap = await createImageBitmap(new Blob([result.data as Uint8Array<ArrayBuffer>]));
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            try {
                const drawing = canvas.getContext('2d');
                if (!drawing) throw new Error('Cannot create GIF conversion canvas');
                drawing.drawImage(bitmap, 0, 0);
                result = { ...result, mime: 'image/jpeg', data: new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: .9 })).arrayBuffer()) };
            } finally { bitmap.close(); canvas.width = 1; canvas.height = 1; }
        }
        context.postMessage({ id: job.id, result }, [result.data.buffer as ArrayBuffer]);
    } catch (error) {
        context.postMessage({ id: job.id, error: { code: (error as { code?: string }).code ?? 'INTERNAL', message: error instanceof Error ? error.message : 'Image processing failed' } });
    }
};
