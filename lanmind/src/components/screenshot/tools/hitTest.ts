/**
 * Hit Test Tool — Pure function to check if a point hits an annotation for the eraser tool.
 *
 * CALLING SPEC:
 *   const hit = isPointNearAnnotation(point, annotation, tolerance);
 *   // input: point (Point), annotation (Annotation), tolerance (number, default 8)
 *   // output: boolean
 *   // side effects: none
 *   // deterministic: same point and annotation -> same result
 */

import type { Annotation, Point } from '../types';

function distSqToSegment(p: Point, v: Point, w: Point): number {
  const l2 = (w.x - v.x) ** 2 + (w.y - v.y) ** 2;
  if (l2 === 0) return (p.x - v.x) ** 2 + (p.y - v.y) ** 2;
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return (p.x - (v.x + t * (w.x - v.x))) ** 2 + (p.y - (v.y + t * (w.y - v.y))) ** 2;
}

export function isPointNearAnnotation(
  point: Point,
  annotation: Annotation,
  tolerance = 8,
): boolean {
  const tolSq = (tolerance + 4) ** 2;

  switch (annotation.type) {
    case 'rect': {
      const minX = Math.min(annotation.x1, annotation.x2);
      const maxX = Math.max(annotation.x1, annotation.x2);
      const minY = Math.min(annotation.y1, annotation.y2);
      const maxY = Math.max(annotation.y1, annotation.y2);

      const p1 = { x: minX, y: minY };
      const p2 = { x: maxX, y: minY };
      const p3 = { x: maxX, y: maxY };
      const p4 = { x: minX, y: maxY };

      return (
        distSqToSegment(point, p1, p2) <= tolSq ||
        distSqToSegment(point, p2, p3) <= tolSq ||
        distSqToSegment(point, p3, p4) <= tolSq ||
        distSqToSegment(point, p4, p1) <= tolSq
      );
    }

    case 'arrow': {
      const p1 = { x: annotation.x1, y: annotation.y1 };
      const p2 = { x: annotation.x2, y: annotation.y2 };
      return distSqToSegment(point, p1, p2) <= tolSq;
    }

    case 'brush': {
      const pts = annotation.points;
      for (let i = 0; i < pts.length - 1; i++) {
        if (distSqToSegment(point, pts[i], pts[i + 1]) <= tolSq) {
          return true;
        }
      }
      return false;
    }

    case 'text': {
      // Rough bounding box estimation based on characters and font size
      const lines = annotation.text.split('\n');
      const maxLineLen = Math.max(...lines.map((l) => l.length), 1);
      const width = maxLineLen * (annotation.fontSize * 0.65);
      const height = lines.length * (annotation.fontSize * 1.35);

      return (
        point.x >= annotation.x - tolerance &&
        point.x <= annotation.x + width + tolerance &&
        point.y >= annotation.y - tolerance &&
        point.y <= annotation.y + height + tolerance
      );
    }

    case 'mosaic': {
      const effRadiusSq = (annotation.radius + tolerance) ** 2;
      for (const pt of annotation.points) {
        if ((point.x - pt.x) ** 2 + (point.y - pt.y) ** 2 <= effRadiusSq) {
          return true;
        }
      }
      return false;
    }
  }
}
