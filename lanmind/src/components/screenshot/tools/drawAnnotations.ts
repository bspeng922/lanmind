/**
 * Draw Annotations — Pure canvas rendering functions for screenshot shapes.
 *
 * CALLING SPEC:
 *   renderAllAnnotations(ctx, annotations, mosaicSourceCanvas);
 *   // input: ctx (CanvasRenderingContext2D), annotations (Annotation[]), mosaicSourceCanvas (HTMLCanvasElement | null)
 *   // output: void (draws directly onto context)
 *   // deterministic: same state -> same rendering output
 */

import type {
  Annotation,
  ArrowAnnotation,
  BrushAnnotation,
  MosaicAnnotation,
  RectAnnotation,
  TextAnnotation,
} from '../types';

export function drawRect(ctx: CanvasRenderingContext2D, item: RectAnnotation): void {
  const x = Math.min(item.x1, item.x2);
  const y = Math.min(item.y1, item.y2);
  const w = Math.abs(item.x2 - item.x1);
  const h = Math.abs(item.y2 - item.y1);
  if (w === 0 || h === 0) return;

  ctx.save();
  ctx.strokeStyle = item.color;
  ctx.lineWidth = item.strokeWidth;
  ctx.lineJoin = 'round';
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

export function drawArrow(ctx: CanvasRenderingContext2D, item: ArrowAnnotation): void {
  const dx = item.x2 - item.x1;
  const dy = item.y2 - item.y1;
  const length = Math.hypot(dx, dy);
  if (length < 2) return;

  const angle = Math.atan2(dy, dx);
  const headLength = Math.max(12, item.strokeWidth * 3.5);
  const arrowSpread = Math.PI / 6.5;

  ctx.save();
  ctx.strokeStyle = item.color;
  ctx.fillStyle = item.color;
  ctx.lineWidth = item.strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Shaft
  ctx.beginPath();
  ctx.moveTo(item.x1, item.y1);
  ctx.lineTo(
    item.x2 - (headLength * 0.7) * Math.cos(angle),
    item.y2 - (headLength * 0.7) * Math.sin(angle),
  );
  ctx.stroke();

  // Head
  ctx.beginPath();
  ctx.moveTo(item.x2, item.y2);
  ctx.lineTo(
    item.x2 - headLength * Math.cos(angle - arrowSpread),
    item.y2 - headLength * Math.sin(angle - arrowSpread),
  );
  ctx.lineTo(
    item.x2 - (headLength * 0.5) * Math.cos(angle),
    item.y2 - (headLength * 0.5) * Math.sin(angle),
  );
  ctx.lineTo(
    item.x2 - headLength * Math.cos(angle + arrowSpread),
    item.y2 - headLength * Math.sin(angle + arrowSpread),
  );
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawBrush(ctx: CanvasRenderingContext2D, item: BrushAnnotation): void {
  if (item.points.length === 0) return;

  ctx.save();
  ctx.strokeStyle = item.color;
  ctx.lineWidth = item.strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(item.points[0].x, item.points[0].y);
  for (let i = 1; i < item.points.length; i++) {
    ctx.lineTo(item.points[i].x, item.points[i].y);
  }
  ctx.stroke();
  ctx.restore();
}

export function drawText(ctx: CanvasRenderingContext2D, item: TextAnnotation): void {
  if (!item.text.trim()) return;

  ctx.save();
  ctx.font = `600 ${item.fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.textBaseline = 'top';

  const lines = item.text.split('\n');
  const lineHeight = item.fontSize * 1.35;

  lines.forEach((line, index) => {
    const lineY = item.y + index * lineHeight;
    // Outline for contrast on any background
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.lineWidth = Math.max(2, item.fontSize / 6);
    ctx.lineJoin = 'round';
    ctx.strokeText(line, item.x, lineY);

    ctx.fillStyle = item.color;
    ctx.fillText(line, item.x, lineY);
  });

  ctx.restore();
}

export function drawMosaic(
  ctx: CanvasRenderingContext2D,
  item: MosaicAnnotation,
  mosaicCanvas: HTMLCanvasElement | null,
): void {
  if (!mosaicCanvas || item.points.length === 0) return;

  ctx.save();
  ctx.beginPath();
  if (item.points.length === 1) {
    ctx.arc(item.points[0].x, item.points[0].y, item.radius, 0, Math.PI * 2);
  } else {
    ctx.lineWidth = item.radius * 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.moveTo(item.points[0].x, item.points[0].y);
    for (let i = 1; i < item.points.length; i++) {
      ctx.lineTo(item.points[i].x, item.points[i].y);
    }
  }
  ctx.clip();
  ctx.drawImage(mosaicCanvas, 0, 0);
  ctx.restore();
}

export function renderAllAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: Annotation[],
  mosaicCanvas: HTMLCanvasElement | null,
): void {
  for (const item of annotations) {
    switch (item.type) {
      case 'rect':
        drawRect(ctx, item);
        break;
      case 'arrow':
        drawArrow(ctx, item);
        break;
      case 'brush':
        drawBrush(ctx, item);
        break;
      case 'text':
        drawText(ctx, item);
        break;
      case 'mosaic':
        drawMosaic(ctx, item, mosaicCanvas);
        break;
    }
  }
}
