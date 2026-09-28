import initQr, { QrRenderer } from '@raptorqr/fast-qr-wasm';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import readerWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import type { ReaderOptions } from 'zxing-wasm/reader';

let qrReady: Promise<{ wasm: Awaited<ReturnType<typeof initQr>>; renderer: QrRenderer }> | undefined;
let readerReady: Promise<void> | undefined;

async function ensureQr(): Promise<{ wasm: Awaited<ReturnType<typeof initQr>>; renderer: QrRenderer }> {
  qrReady ??= initQr().then((wasm) => ({ wasm, renderer: new QrRenderer() }));
  return qrReady;
}

async function ensureReader(): Promise<void> {
  readerReady ??= (prepareZXingModule({
    overrides: { locateFile: () => readerWasmUrl },
    fireImmediately: true,
  }) as Promise<unknown>).then(() => undefined);
  await readerReady;
}

export interface QrMatrix {
  modules: Uint8Array;
  size: number;
}

export async function renderQrMatrix(bytes: Uint8Array, version: number, ecc: 0 | 1 | 2 | 3 = 1): Promise<QrMatrix> {
  const { wasm, renderer } = await ensureQr();
  const size = renderer.render_matrix(bytes, version, ecc);
  const matrix = new Uint8Array(wasm.memory.buffer, renderer.matrix_ptr(), size * size).slice();
  return { modules: matrix, size };
}

export function matrixToCanvas(matrix: QrMatrix, scale = 4, quietZone = 4): HTMLCanvasElement {
  if (!Number.isInteger(scale) || scale < 1 || scale > 8) throw new RangeError('scale must be 1..8');
  const size = (matrix.size + quietZone * 2) * scale;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('canvas unavailable');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, size, size);
  context.fillStyle = '#000';
  for (let row = 0; row < matrix.size; row += 1) {
    for (let column = 0; column < matrix.size; column += 1) {
      if (matrix.modules[row * matrix.size + column]) context.fillRect((column + quietZone) * scale, (row + quietZone) * scale, scale, scale);
    }
  }
  return canvas;
}

const READER_OPTIONS: ReaderOptions = {
  formats: ['QRCode'],
  tryHarder: false,
  tryRotate: true,
  tryInvert: false,
  tryDownscale: false,
  maxNumberOfSymbols: 4,
  returnErrors: false,
  textMode: 'Plain',
};

export async function readQrBytes(input: ImageData | Uint8Array | ArrayBuffer | Blob): Promise<Uint8Array[]> {
  await ensureReader();
  const results = await readBarcodes(input, READER_OPTIONS);
  return results.filter((result) => result.isValid && result.format === 'QRCode' && result.bytes.length > 0).map((result) => new Uint8Array(result.bytes));
}
