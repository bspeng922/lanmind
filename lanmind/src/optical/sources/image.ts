import { readQrBytes } from '../core/qr';
import type { OpticalReceiverSession } from '../core/receive';

export interface ImageScanOptions {
  signal?: AbortSignal;
  onFrame?: (index: number, total: number, frameCanvas?: HTMLCanvasElement | OffscreenCanvas) => void;
  onPacket?: (count: number) => void;
}

const MAX_IMAGE_BYTES = 256 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 64 * 1024 * 1024;

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

export async function scanImageFile(file: Blob, session: OpticalReceiverSession, options: ImageScanOptions = {}): Promise<void> {
  if (file.size > MAX_IMAGE_BYTES) throw new Error('IMAGE_INPUT_LIMIT');
  checkAbort(options.signal);
  const Decoder = (globalThis as unknown as { ImageDecoder?: new (init: { data: ArrayBuffer; type: string }) => {
    tracks: { ready: Promise<void>; selectedTrack?: { frameCount?: number } };
    decode(options?: { frameIndex?: number }): Promise<{ image: VideoFrame | ImageBitmap | CanvasImageSource }>;
    close(): void;
  } }).ImageDecoder;
  if (Decoder && /^image\/(apng|gif|webp)$/i.test(file.type)) {
    const decoder = new Decoder({ data: await file.arrayBuffer(), type: file.type });
    try {
      await decoder.tracks.ready;
      const total = decoder.tracks.selectedTrack?.frameCount ?? 1;
      let count = 0;
      for (let index = 0; index < total; index += 1) {
        checkAbort(options.signal);
        const decoded = await decoder.decode({ frameIndex: index });
        try {
          const width = (decoded.image as VideoFrame).displayWidth ?? (decoded.image as ImageBitmap).width;
          const height = (decoded.image as VideoFrame).displayHeight ?? (decoded.image as ImageBitmap).height;
          if (width <= 0 || height <= 0 || width * height > MAX_IMAGE_PIXELS) throw new Error('IMAGE_PIXEL_LIMIT');
          const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : document.createElement('canvas');
          if (canvas instanceof HTMLCanvasElement) {
            canvas.width = width;
            canvas.height = height;
          }
          const context = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
          if (!context) continue;
          context.drawImage(decoded.image, 0, 0, canvas.width, canvas.height);
          const packets = await readQrBytes(context.getImageData(0, 0, canvas.width, canvas.height));
          for (const packet of packets) { checkAbort(options.signal); await session.pushPacketBytes(packet); count += 1; options.onPacket?.(count); }
          options.onFrame?.(index, total, canvas);
        } finally {
          (decoded.image as VideoFrame | ImageBitmap).close?.();
        }
      }
    } finally { decoder.close(); }
    return;
  }
  checkAbort(options.signal);
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    try {
      if (bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) throw new Error('IMAGE_PIXEL_LIMIT');
    } finally {
      bitmap.close();
    }
  }
  checkAbort(options.signal);
  const packets = await readQrBytes(file);
  let count = 0;
  for (const packet of packets) { checkAbort(options.signal); await session.pushPacketBytes(packet); count += 1; options.onPacket?.(count); }
  options.onFrame?.(0, 1);
}
