/**
 * SelectionBox — Border overlay with dimension badge and 8 resize handles.
 *
 * CALLING SPEC:
 *   <SelectionBox
 *     selection={selection}
 *     naturalDimensions={{ width, height }}
 *     surfaceDimensions={{ width, height }}
 *     onHandlePointerDown={(handle, event) => ...}
 *   />
 */

import React from 'react';
import type { ScreenshotRegion } from './types';

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

interface Props {
  selection: ScreenshotRegion;
  naturalDimensions?: { width: number; height: number };
  surfaceDimensions?: { width: number; height: number };
  onHandlePointerDown: (handle: ResizeHandle, event: React.PointerEvent) => void;
}

export const SelectionBox: React.FC<Props> = ({
  selection,
  naturalDimensions,
  surfaceDimensions,
  onHandlePointerDown,
}) => {
  const naturalW =
    naturalDimensions && surfaceDimensions
      ? Math.round((selection.width * naturalDimensions.width) / surfaceDimensions.width)
      : Math.round(selection.width);
  const naturalH =
    naturalDimensions && surfaceDimensions
      ? Math.round((selection.height * naturalDimensions.height) / surfaceDimensions.height)
      : Math.round(selection.height);

  const badgeInside = selection.y < 28;

  return (
    <div
      data-testid="screenshot-region"
      className="absolute border-2 border-sky-400 pointer-events-none"
      style={{
        left: selection.x,
        top: selection.y,
        width: selection.width,
        height: selection.height,
        boxShadow: '0 0 0 10000px rgba(0,0,0,0.48)',
      }}
    >
      {/* Dimension Badge (Pinned to top-left, floating outside or inside if near screen edge) */}
      <div
        className={`absolute rounded bg-slate-900/90 border border-white/20 px-1.5 py-0.5 text-[10px] font-mono tabular-nums text-slate-200 pointer-events-none shadow backdrop-blur-xs select-none ${
          badgeInside ? 'top-1.5 left-1.5' : '-top-6 left-0'
        }`}
      >
        {naturalW} × {naturalH}
      </div>

      {/* 8 Resize Handles */}
      <div
        className="absolute -left-1.5 -top-1.5 w-2.5 h-2.5 bg-white border border-sky-500 rounded-xs shadow pointer-events-auto cursor-nwse-resize"
        onPointerDown={(e) => onHandlePointerDown('nw', e)}
      />
      <div
        className="absolute left-1/2 -top-1.5 -translate-x-1/2 w-2.5 h-2.5 bg-white border border-sky-500 rounded-xs shadow pointer-events-auto cursor-ns-resize"
        onPointerDown={(e) => onHandlePointerDown('n', e)}
      />
      <div
        className="absolute -right-1.5 -top-1.5 w-2.5 h-2.5 bg-white border border-sky-500 rounded-xs shadow pointer-events-auto cursor-nesw-resize"
        onPointerDown={(e) => onHandlePointerDown('ne', e)}
      />
      <div
        className="absolute -right-1.5 top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white border border-sky-500 rounded-xs shadow pointer-events-auto cursor-ew-resize"
        onPointerDown={(e) => onHandlePointerDown('e', e)}
      />
      <div
        className="absolute -right-1.5 -bottom-1.5 w-2.5 h-2.5 bg-white border border-sky-500 rounded-xs shadow pointer-events-auto cursor-nwse-resize"
        onPointerDown={(e) => onHandlePointerDown('se', e)}
      />
      <div
        className="absolute left-1/2 -bottom-1.5 -translate-x-1/2 w-2.5 h-2.5 bg-white border border-sky-500 rounded-xs shadow pointer-events-auto cursor-ns-resize"
        onPointerDown={(e) => onHandlePointerDown('s', e)}
      />
      <div
        className="absolute -left-1.5 -bottom-1.5 w-2.5 h-2.5 bg-white border border-sky-500 rounded-xs shadow pointer-events-auto cursor-nesw-resize"
        onPointerDown={(e) => onHandlePointerDown('sw', e)}
      />
      <div
        className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white border border-sky-500 rounded-xs shadow pointer-events-auto cursor-ew-resize"
        onPointerDown={(e) => onHandlePointerDown('w', e)}
      />
    </div>
  );
};
