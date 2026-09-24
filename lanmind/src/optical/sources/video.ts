import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { readQrBytes } from '../core/qr';
import type { OpticalReceiverSession } from '../core/receive';

export interface VideoScanOptions {
  signal?: AbortSignal;
  startSeconds?: number;
  endSeconds?: number;
  onFrame?: (timestamp: number, progress: number, frameCanvas: HTMLCanvasElement | OffscreenCanvas) => void;
  onPacket?: (count: number) => void;
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

export async function scanVideoFile(file: Blob, session: OpticalReceiverSession, options: VideoScanOptions = {}): Promise<void> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    if (!(await input.canRead())) throw new Error('UNSUPPORTED_MEDIA_CONTAINER');
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('NO_VIDEO_TRACK');
    if (!(await track.canDecode())) throw new Error('UNSUPPORTED_MEDIA_CODEC');
    const duration = await input.computeDuration();
    const start = options.startSeconds ?? 0;
    const end = options.endSeconds ?? duration;
    const sink = new CanvasSink(track, { poolSize: 2, fit: 'contain' });
    let count = 0;
    for await (const wrapped of sink.canvases(start, end)) {
      checkAbort(options.signal);
      const canvas = wrapped.canvas;
      const context = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!context) continue;
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const packets = await readQrBytes(image);
      for (const packet of packets) {
        await session.pushPacketBytes(packet);
        count += 1;
        options.onPacket?.(count);
      }
      options.onFrame?.(wrapped.timestamp, duration > 0 ? wrapped.timestamp / duration : 0, canvas);
    }
  } finally {
    input.dispose();
  }
}
