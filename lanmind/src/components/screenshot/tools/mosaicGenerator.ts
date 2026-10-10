/**
 * Mosaic Canvas Generator — Pure function to create pixelated versions of images.
 *
 * CALLING SPEC:
 *   const mosaicCanvas = createMosaicCanvas(source, blockSize);
 *   // input: source (CanvasImageSource), width (number), height (number), blockSize (number)
 *   // output: HTMLCanvasElement containing pixelated image
 *   // side effects: none
 *   // deterministic: same inputs -> same output
 */

export function createMosaicCanvas(
  source: CanvasImageSource,
  width: number,
  height: number,
  blockSize = 12,
): HTMLCanvasElement {
  const safeBlock = Math.max(2, Math.floor(blockSize));
  const smallW = Math.max(1, Math.ceil(width / safeBlock));
  const smallH = Math.max(1, Math.ceil(height / safeBlock));

  const smallCanvas = document.createElement('canvas');
  smallCanvas.width = smallW;
  smallCanvas.height = smallH;
  const smallCtx = smallCanvas.getContext('2d');
  if (smallCtx) {
    smallCtx.imageSmoothingEnabled = true;
    smallCtx.drawImage(source, 0, 0, smallW, smallH);
  }

  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = width;
  outputCanvas.height = height;
  const outputCtx = outputCanvas.getContext('2d');
  if (outputCtx) {
    outputCtx.imageSmoothingEnabled = false;
    outputCtx.drawImage(smallCanvas, 0, 0, width, height);
  }

  return outputCanvas;
}
