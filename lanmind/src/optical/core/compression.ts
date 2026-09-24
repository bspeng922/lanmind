import { compress, decompress, init } from '@bokuweb/zstd-wasm';

let ready: Promise<void> | undefined;

function resolveWasmUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return new URL('/assets/zstd.wasm', window.location.href).href;
  } catch {
    return '/assets/zstd.wasm';
  }
}

async function ensureReady(): Promise<void> {
  ready ??= (async () => {
    const isBrowser = typeof window !== 'undefined';
    const initFn = init as (path?: string) => Promise<void>;
    const wasmUrl = isBrowser ? resolveWasmUrl() : undefined;
    const initialization = wasmUrl ? initFn(wasmUrl) : initFn();
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
    try {
      await Promise.race([
        initialization,
        new Promise<never>((_, reject) => {
          timer = globalThis.setTimeout(() => reject(new Error('ZSTD_INIT_TIMEOUT')), 15_000);
        }),
      ]);
    } finally {
      if (timer !== undefined) globalThis.clearTimeout(timer);
    }
  })().catch((error) => {
    ready = undefined;
    throw error;
  });
  await ready;
}

export async function zstdCompress(bytes: Uint8Array): Promise<Uint8Array> {
  await ensureReady();
  return new Uint8Array(compress(bytes, 3));
}

export async function zstdDecompress(bytes: Uint8Array, expectedLength: number): Promise<Uint8Array> {
  await ensureReady();
  const result = new Uint8Array(decompress(bytes));
  if (result.length !== expectedLength) throw new Error('DECOMPRESS_FAILED');
  return result;
}

export async function chooseCompression(raw: Uint8Array): Promise<{ compression: 0 | 1; bytes: Uint8Array }> {
  try {
    const compressed = await zstdCompress(raw);
    const minimumSavings = Math.max(64, Math.ceil(raw.length * 0.01));
    if (compressed.length <= raw.length - minimumSavings) return { compression: 1, bytes: compressed };
  } catch (cause) {
    console.warn('zstd compression unavailable, falling back to raw uncompressed block:', cause);
  }
  return { compression: 0, bytes: raw.slice() };
}
