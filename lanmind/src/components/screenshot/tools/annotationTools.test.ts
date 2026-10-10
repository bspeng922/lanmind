import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isPointNearAnnotation } from './hitTest';
import type {
  ArrowAnnotation,
  BrushAnnotation,
  MosaicAnnotation,
  RectAnnotation,
  TextAnnotation,
} from '../types';

describe('Screenshot Annotation Hit Testing', () => {
  it('detects hits on rect borders and ignores distant points', () => {
    const rect: RectAnnotation = {
      id: 'r1',
      type: 'rect',
      x1: 100,
      y1: 100,
      x2: 300,
      y2: 200,
      color: '#ef4444',
      strokeWidth: 4,
    };

    // Exactly on top edge
    assert.equal(isPointNearAnnotation({ x: 200, y: 100 }, rect), true);
    // Slightly off bottom edge within tolerance (8px)
    assert.equal(isPointNearAnnotation({ x: 250, y: 205 }, rect), true);
    // Far inside the center
    assert.equal(isPointNearAnnotation({ x: 200, y: 150 }, rect), false);
    // Far outside
    assert.equal(isPointNearAnnotation({ x: 50, y: 50 }, rect), false);
  });

  it('detects hits on arrow line and ignores distant points', () => {
    const arrow: ArrowAnnotation = {
      id: 'a1',
      type: 'arrow',
      x1: 50,
      y1: 50,
      x2: 150,
      y2: 50,
      color: '#3b82f6',
      strokeWidth: 4,
    };

    // On line
    assert.equal(isPointNearAnnotation({ x: 100, y: 50 }, arrow), true);
    // Near line within tolerance
    assert.equal(isPointNearAnnotation({ x: 80, y: 55 }, arrow), true);
    // Far from line
    assert.equal(isPointNearAnnotation({ x: 100, y: 90 }, arrow), false);
  });

  it('detects hits on brush strokes', () => {
    const brush: BrushAnnotation = {
      id: 'b1',
      type: 'brush',
      points: [
        { x: 10, y: 10 },
        { x: 50, y: 10 },
        { x: 50, y: 80 },
      ],
      color: '#22c55e',
      strokeWidth: 4,
    };

    assert.equal(isPointNearAnnotation({ x: 30, y: 10 }, brush), true);
    assert.equal(isPointNearAnnotation({ x: 50, y: 40 }, brush), true);
    assert.equal(isPointNearAnnotation({ x: 20, y: 50 }, brush), false);
  });

  it('detects hits within text bounding box', () => {
    const text: TextAnnotation = {
      id: 't1',
      type: 'text',
      x: 100,
      y: 100,
      text: 'Notice',
      color: '#ffffff',
      fontSize: 18,
    };

    assert.equal(isPointNearAnnotation({ x: 110, y: 110 }, text), true);
    assert.equal(isPointNearAnnotation({ x: 80, y: 100 }, text), false);
    assert.equal(isPointNearAnnotation({ x: 110, y: 150 }, text), false);
  });

  it('detects hits on mosaic points within radius', () => {
    const mosaic: MosaicAnnotation = {
      id: 'm1',
      type: 'mosaic',
      points: [{ x: 100, y: 100 }],
      radius: 14,
      blockSize: 14,
    };

    assert.equal(isPointNearAnnotation({ x: 105, y: 105 }, mosaic), true);
    assert.equal(isPointNearAnnotation({ x: 140, y: 140 }, mosaic), false);
  });
});
