/**
 * Export Screenshot Tool — Composites native pixels and annotations into a high-res cropped PNG.
 *
 * CALLING SPEC:
 *   const dataUrl = exportCroppedScreenshot(image, selection, bounds, annotations);
 *   // input:
 *   //   image: HTMLImageElement (source desktop frame)
 *   //   selection: ScreenshotRegion (in surface screen coordinates)
 *   //   bounds: { width: number; height: number } (surface dimensions)
 *   //   annotations: Annotation[] (in surface screen coordinates)
 *   // output:
 *   //   string: data:image/png;base64,... data URL
 *   // side effects: temporary offscreen canvas
 *   // deterministic: same inputs -> identical PNG output
 */

import type { Annotation, ScreenshotRegion } from '../types';
import { renderAllAnnotations } from './drawAnnotations';
import { createMosaicCanvas } from './mosaicGenerator';

export function exportCroppedScreenshot(
  image: HTMLImageElement,
  selection: ScreenshotRegion,
  bounds: { width: number; height: number },
  annotations: Annotation[],
): string {
  const scaleX = image.naturalWidth / bounds.width;
  const scaleY = image.naturalHeight / bounds.height;

  const cropX = Math.max(0, Math.floor(selection.x * scaleX));
  const cropY = Math.max(0, Math.floor(selection.y * scaleY));
  const cropRight = Math.min(
    image.naturalWidth,
    Math.ceil((selection.x + selection.width) * scaleX),
  );
  const cropBottom = Math.min(
    image.naturalHeight,
    Math.ceil((selection.y + selection.height) * scaleY),
  );
  const cropW = Math.max(1, cropRight - cropX);
  const cropH = Math.max(1, cropBottom - cropY);

  const canvas = document.createElement('canvas');
  canvas.width = cropW;
  canvas.height = cropH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // 1. Draw base cropped image
  ctx.drawImage(image, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

  // If there are annotations, render them transformed to native pixels
  if (annotations.length > 0) {
    // Generate mosaic source from the base crop
    const mosaicCanvas = createMosaicCanvas(canvas, cropW, cropH, Math.round(12 * scaleX));

    // Transform coordinate system from screen surface to crop canvas
    ctx.save();
    // Clip drawing strictly to the crop boundaries
    ctx.beginPath();
    ctx.rect(0, 0, cropW, cropH);
    ctx.clip();

    ctx.scale(scaleX, scaleY);
    ctx.translate(-selection.x, -selection.y);

    renderAllAnnotations(ctx, annotations, mosaicCanvas);
    ctx.restore();
  }

  return canvas.toDataURL('image/png');
}
