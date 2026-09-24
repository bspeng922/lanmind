import { readQrBytes } from '../core/qr';
import type { OpticalReceiverSession } from '../core/receive';

export interface ImageScanOptions {
  signal?: AbortSignal;
  onFrame?: (index: number, total: number, frameCanvas?: HTMLCanvasElement | OffscreenCanvas) => void;
  onPacket?: (count: number) => void;
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

export async function scanImageFile(file: Blob, session: OpticalReceiverSession, options: ImageScanOptions = {}): Promise<void> {
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
        const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas((decoded.image as VideoFrame).displayWidth ?? (decoded.image as ImageBitmap).width, (decoded.image as VideoFrame).displayHeight ?? (decoded.image as ImageBitmap).height) : document.createElement('canvas');
        if (canvas instanceof HTMLCanvasElement) {
          canvas.width = (decoded.image as ImageBitmap).width;
          canvas.height = (decoded.image as ImageBitmap).height;
        }
        const context = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
        if (!context) continue;
        context.drawImage(decoded.image, 0, 0, canvas.width, canvas.height);
        const packets = await readQrBytes(context.getImageData(0, 0, canvas.width, canvas.height));
        for (const packet of packets) { await session.pushPacketBytes(packet); count += 1; options.onPacket?.(count); }
        options.onFrame?.(index, total, canvas);
        (decoded.image as VideoFrame | ImageBitmap).close?.();
      }
    } finally { decoder.close(); }
    return;
  }
  checkAbort(options.signal);
  const packets = await readQrBytes(file);
  let count = 0;
  for (const packet of packets) { await session.pushPacketBytes(packet); count += 1; options.onPacket?.(count); }
  options.onFrame?.(0, 1);
}
