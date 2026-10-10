/**
 * Screenshot Annotation Types and Calling Specifications
 *
 * CALLING SPEC:
 *   import type {
 *     Annotation,
 *     ScreenshotRegion,
 *     ScreenshotTool,
 *     Point,
 *     StrokeWidth,
 *     FontSize,
 *   } from './types';
 */

export type ScreenshotTool =
  | 'select'
  | 'rect'
  | 'arrow'
  | 'brush'
  | 'text'
  | 'mosaic'
  | 'eraser';

export type Point = {
  x: number;
  y: number;
};

export interface ScreenshotRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type StrokeWidth = 2 | 4 | 6;
export type FontSize = 14 | 18 | 24;
export type MosaicBlockSize = 8 | 14 | 20;

export interface BaseAnnotation {
  id: string;
}

export interface RectAnnotation extends BaseAnnotation {
  type: 'rect';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  strokeWidth: StrokeWidth;
}

export interface ArrowAnnotation extends BaseAnnotation {
  type: 'arrow';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  strokeWidth: StrokeWidth;
}

export interface BrushAnnotation extends BaseAnnotation {
  type: 'brush';
  points: Point[];
  color: string;
  strokeWidth: StrokeWidth;
}

export interface TextAnnotation extends BaseAnnotation {
  type: 'text';
  x: number;
  y: number;
  text: string;
  color: string;
  fontSize: FontSize;
}

export interface MosaicAnnotation extends BaseAnnotation {
  type: 'mosaic';
  points: Point[];
  radius: number;
  blockSize: MosaicBlockSize;
}

export type Annotation =
  | RectAnnotation
  | ArrowAnnotation
  | BrushAnnotation
  | TextAnnotation
  | MosaicAnnotation;

export const DEFAULT_PALETTE = [
  '#ef4444', // Red
  '#f97316', // Orange
  '#eab308', // Yellow
  '#22c55e', // Green
  '#06b6d4', // Cyan
  '#3b82f6', // Blue
  '#a855f7', // Purple
  '#ffffff', // White
  '#000000', // Black
] as const;
