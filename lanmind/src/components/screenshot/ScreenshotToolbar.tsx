/**
 * ScreenshotToolbar — Floating controls for annotation tools and screenshot actions.
 *
 * CALLING SPEC:
 *   <ScreenshotToolbar
 *     selection={selection}
 *     dragging={dragging}
 *     activeTool={activeTool}
 *     onSelectTool={setActiveTool}
 *     strokeWidth={strokeWidth}
 *     onChangeStrokeWidth={setStrokeWidth}
 *     color={color}
 *     onChangeColor={setColor}
 *     fontSize={fontSize}
 *     onChangeFontSize={setFontSize}
 *     mosaicBlockSize={mosaicBlockSize}
 *     onChangeMosaicBlockSize={setMosaicBlockSize}
 *     canUndo={undoStack.length > 0}
 *     canRedo={redoStack.length > 0}
 *     canClear={annotations.length > 0}
 *     onUndo={handleUndo}
 *     onRedo={handleRedo}
 *     onClear={handleClear}
 *     onCancel={onCancel}
 *     onSave={handleSave}
 *     onCopy={handleCopy}
 *     submitting={submitting}
 *     surfaceDimensions={bounds}
 *   />
 */

import React, { useLayoutEffect, useRef, useState } from 'react';
import {
  Square,
  ArrowUpRight,
  Pencil,
  Type,
  Grid,
  Eraser,
  Undo2,
  Redo2,
  Trash2,
  X,
  Download,
  Copy,
  Loader2,
} from 'lucide-react';
import { tr } from '../../i18n';
import {
  DEFAULT_PALETTE,
  type FontSize,
  type MosaicBlockSize,
  type ScreenshotRegion,
  type ScreenshotTool,
  type StrokeWidth,
} from './types';

interface Props {
  selection: ScreenshotRegion | null;
  dragging: boolean;
  activeTool: ScreenshotTool;
  onSelectTool: (tool: ScreenshotTool) => void;
  strokeWidth: StrokeWidth;
  onChangeStrokeWidth: (width: StrokeWidth) => void;
  color: string;
  onChangeColor: (color: string) => void;
  fontSize: FontSize;
  onChangeFontSize: (size: FontSize) => void;
  mosaicBlockSize: MosaicBlockSize;
  onChangeMosaicBlockSize: (size: MosaicBlockSize) => void;
  canUndo: boolean;
  canRedo: boolean;
  canClear: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onCancel: () => void;
  onSave: () => void;
  onCopy: () => void;
  submitting: 'copy' | 'save' | null;
  surfaceDimensions: { width: number; height: number };
}

export const ScreenshotToolbar: React.FC<Props> = ({
  selection,
  dragging,
  activeTool,
  onSelectTool,
  strokeWidth,
  onChangeStrokeWidth,
  color,
  onChangeColor,
  fontSize,
  onChangeFontSize,
  mosaicBlockSize,
  onChangeMosaicBlockSize,
  canUndo,
  canRedo,
  canClear,
  onUndo,
  onRedo,
  onClear,
  onCancel,
  onSave,
  onCopy,
  submitting,
  surfaceDimensions,
}) => {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState(360);
  const [measuredHeight, setMeasuredHeight] = useState(44);

  const hasSettings = selection && ['rect', 'arrow', 'brush', 'text', 'mosaic'].includes(activeTool);

  useLayoutEffect(() => {
    if (toolbarRef.current) {
      const rect = toolbarRef.current.getBoundingClientRect();
      if (rect.width > 0 && Math.abs(rect.width - measuredWidth) > 2) {
        setMeasuredWidth(rect.width);
      }
      if (rect.height > 0 && Math.abs(rect.height - measuredHeight) > 2) {
        setMeasuredHeight(rect.height);
      }
    }
  }, [activeTool, hasSettings, measuredWidth, measuredHeight]);

  let style: React.CSSProperties = { right: 20, bottom: 20 };

  if (selection) {
    const targetLeft = selection.x + selection.width - measuredWidth;
    let left = Math.max(
      12,
      Math.min(targetLeft, surfaceDimensions.width - measuredWidth - 12),
    );

    let top = selection.y + selection.height + 8;
    if (top + measuredHeight > surfaceDimensions.height - 12) {
      top = selection.y - measuredHeight - 8;
    }
    if (top < 10) {
      top = Math.max(
        10,
        Math.min(
          selection.y + selection.height - measuredHeight - 12,
          surfaceDimensions.height - measuredHeight - 12,
        ),
      );
    }
    style = { left, top };
  }

  return (
    <div
      ref={toolbarRef}
      className={`absolute z-50 flex flex-col gap-1 rounded-xl border border-white/20 bg-slate-900/95 p-1 text-white shadow-2xl backdrop-blur-md select-none w-max ${
        dragging ? 'pointer-events-none opacity-85' : 'opacity-100'
      } transition-opacity duration-150`}
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {/* Top action row */}
      <div className="flex items-center gap-0.5">
        {/* Drawing Tools (only active when selection exists) */}
        {selection && (
          <>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => onSelectTool(activeTool === 'rect' ? 'select' : 'rect')}
                disabled={dragging || !!submitting}
                className={`rounded p-1.5 transition-colors disabled:opacity-40 ${
                  activeTool === 'rect'
                    ? 'bg-sky-500/30 text-sky-300 ring-1 ring-sky-400'
                    : 'hover:bg-white/15 text-slate-200'
                }`}
                title={tr('chat:screenshot.rect')}
                aria-label={tr('chat:screenshot.rect')}
              >
                <Square className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => onSelectTool(activeTool === 'arrow' ? 'select' : 'arrow')}
                disabled={dragging || !!submitting}
                className={`rounded p-1.5 transition-colors disabled:opacity-40 ${
                  activeTool === 'arrow'
                    ? 'bg-sky-500/30 text-sky-300 ring-1 ring-sky-400'
                    : 'hover:bg-white/15 text-slate-200'
                }`}
                title={tr('chat:screenshot.arrow')}
                aria-label={tr('chat:screenshot.arrow')}
              >
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => onSelectTool(activeTool === 'brush' ? 'select' : 'brush')}
                disabled={dragging || !!submitting}
                className={`rounded p-1.5 transition-colors disabled:opacity-40 ${
                  activeTool === 'brush'
                    ? 'bg-sky-500/30 text-sky-300 ring-1 ring-sky-400'
                    : 'hover:bg-white/15 text-slate-200'
                }`}
                title={tr('chat:screenshot.brush')}
                aria-label={tr('chat:screenshot.brush')}
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => onSelectTool(activeTool === 'text' ? 'select' : 'text')}
                disabled={dragging || !!submitting}
                className={`rounded p-1.5 transition-colors disabled:opacity-40 ${
                  activeTool === 'text'
                    ? 'bg-sky-500/30 text-sky-300 ring-1 ring-sky-400'
                    : 'hover:bg-white/15 text-slate-200'
                }`}
                title={tr('chat:screenshot.text')}
                aria-label={tr('chat:screenshot.text')}
              >
                <Type className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => onSelectTool(activeTool === 'mosaic' ? 'select' : 'mosaic')}
                disabled={dragging || !!submitting}
                className={`rounded p-1.5 transition-colors disabled:opacity-40 ${
                  activeTool === 'mosaic'
                    ? 'bg-sky-500/30 text-sky-300 ring-1 ring-sky-400'
                    : 'hover:bg-white/15 text-slate-200'
                }`}
                title={tr('chat:screenshot.mosaic')}
                aria-label={tr('chat:screenshot.mosaic')}
              >
                <Grid className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => onSelectTool(activeTool === 'eraser' ? 'select' : 'eraser')}
                disabled={dragging || !!submitting}
                className={`rounded p-1.5 transition-colors disabled:opacity-40 ${
                  activeTool === 'eraser'
                    ? 'bg-sky-500/30 text-sky-300 ring-1 ring-sky-400'
                    : 'hover:bg-white/15 text-slate-200'
                }`}
                title={tr('chat:screenshot.eraser')}
                aria-label={tr('chat:screenshot.eraser')}
              >
                <Eraser className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="h-3.5 w-px bg-white/20 mx-1" />

            {/* Undo / Redo / Clear */}
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={onUndo}
                disabled={!canUndo || dragging || !!submitting}
                className="rounded p-1.5 text-slate-200 hover:bg-white/15 disabled:opacity-30"
                title={tr('chat:screenshot.undo')}
                aria-label={tr('chat:screenshot.undo')}
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={onRedo}
                disabled={!canRedo || dragging || !!submitting}
                className="rounded p-1.5 text-slate-200 hover:bg-white/15 disabled:opacity-30"
                title={tr('chat:screenshot.redo')}
                aria-label={tr('chat:screenshot.redo')}
              >
                <Redo2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={onClear}
                disabled={!canClear || dragging || !!submitting}
                className="rounded p-1.5 text-slate-200 hover:bg-white/15 disabled:opacity-30"
                title={tr('chat:screenshot.clear')}
                aria-label={tr('chat:screenshot.clear')}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="h-3.5 w-px bg-white/20 mx-1" />
          </>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-0.5 ml-auto">
          <button
            type="button"
            onClick={onCancel}
            disabled={!!submitting}
            className="rounded p-1.5 hover:bg-white/15 text-slate-200 disabled:opacity-40"
            title={tr('chat:screenshot.cancel')}
            aria-label={tr('chat:screenshot.cancel')}
          >
            <X className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!selection || dragging || !!submitting}
            className="rounded p-1.5 hover:bg-white/15 text-slate-200 disabled:opacity-40"
            title={tr('chat:screenshot.saveAs')}
            aria-label={tr('chat:screenshot.saveAs')}
          >
            {submitting === 'save' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={onCopy}
            disabled={!selection || dragging || !!submitting}
            className="rounded p-1.5 text-sky-300 hover:bg-white/15 disabled:opacity-40 font-medium"
            title={tr('chat:screenshot.copy')}
            aria-label={tr('chat:screenshot.copy')}
          >
            {submitting === 'copy' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Secondary tool settings panel */}
      {hasSettings && (
        <div className="flex items-center gap-2 pt-1 border-t border-white/10 px-0.5">
          {/* Size picker */}
          {['rect', 'arrow', 'brush'].includes(activeTool) && (
            <div className="flex items-center gap-1">
              {[2, 4, 6].map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => onChangeStrokeWidth(w as StrokeWidth)}
                  className={`flex h-4.5 w-4.5 items-center justify-center rounded transition-colors ${
                    strokeWidth === w ? 'bg-sky-500/30 ring-1 ring-sky-400' : 'hover:bg-white/10'
                  }`}
                  title={`${w}px`}
                >
                  <span
                    className="rounded-full bg-white"
                    style={{ width: w + 2, height: w + 2 }}
                  />
                </button>
              ))}
            </div>
          )}

          {activeTool === 'text' && (
            <div className="flex items-center gap-1">
              {[
                { size: 14 as FontSize, label: tr('chat:screenshot.small') },
                { size: 18 as FontSize, label: tr('chat:screenshot.medium') },
                { size: 24 as FontSize, label: tr('chat:screenshot.large') },
              ].map(({ size, label }) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => onChangeFontSize(size)}
                  className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                    fontSize === size
                      ? 'bg-sky-500/30 text-sky-300 ring-1 ring-sky-400'
                      : 'text-slate-300 hover:bg-white/10'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {activeTool === 'mosaic' && (
            <div className="flex items-center gap-1">
              {[
                { size: 8 as MosaicBlockSize, label: tr('chat:screenshot.small') },
                { size: 14 as MosaicBlockSize, label: tr('chat:screenshot.medium') },
                { size: 20 as MosaicBlockSize, label: tr('chat:screenshot.large') },
              ].map(({ size, label }) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => onChangeMosaicBlockSize(size)}
                  className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                    mosaicBlockSize === size
                      ? 'bg-sky-500/30 text-sky-300 ring-1 ring-sky-400'
                      : 'text-slate-300 hover:bg-white/10'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Color palette (for tools other than mosaic) */}
          {activeTool !== 'mosaic' && (
            <>
              <div className="h-3 w-px bg-white/15 mx-0.5" />
              <div className="flex items-center gap-1">
                {DEFAULT_PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => onChangeColor(c)}
                    className={`h-3.5 w-3.5 rounded-full border border-black/40 transition-transform ${
                      color === c ? 'scale-125 ring-2 ring-sky-400 ring-offset-1 ring-offset-slate-900' : 'hover:scale-110'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
