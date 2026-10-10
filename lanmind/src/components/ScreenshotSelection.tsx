/**
 * ScreenshotSelection — Fullscreen interactive screenshot region selector and editor.
 *
 * CALLING SPEC:
 *   <ScreenshotSelection
 *     src={frameDataUrl}
 *     onReady={() => ...}
 *     onCopy={(region, imageData) => ...}
 *     onSave={(region, imageData) => ...}
 *     onCancel={() => ...}
 *   />
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { tr, useLocale } from '../i18n';
import {
  type Annotation,
  type FontSize,
  type MosaicBlockSize,
  type Point,
  type ScreenshotRegion,
  type ScreenshotTool,
  type StrokeWidth,
} from './screenshot/types';
import { renderAllAnnotations } from './screenshot/tools/drawAnnotations';
import { createMosaicCanvas } from './screenshot/tools/mosaicGenerator';
import { isPointNearAnnotation } from './screenshot/tools/hitTest';
import { exportCroppedScreenshot } from './screenshot/tools/exportScreenshot';
import { ScreenshotToolbar } from './screenshot/ScreenshotToolbar';
import { SelectionBox, type ResizeHandle } from './screenshot/SelectionBox';

export type { ScreenshotRegion };

interface Props {
  src: string;
  onReady?: () => void;
  onCopy: (region: ScreenshotRegion, imageData?: string) => Promise<unknown>;
  onSave: (region: ScreenshotRegion, imageData?: string) => Promise<unknown>;
  onCancel: () => void;
}

const ERASER_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cdefs%3E%3Cfilter id='s' x='-20%25' y='-20%25' width='140%25' height='140%25'%3E%3CfeDropShadow dx='0.5' dy='1' stdDeviation='0.8' flood-color='%23000000' flood-opacity='0.6'/%3E%3C/filter%3E%3C/defs%3E%3Cg filter='url(%23s)'%3E%3Cpath d='m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21Z' fill='%23ec4899' stroke='%23ffffff' stroke-width='1.5' stroke-linejoin='round'/%3E%3Cpath d='M5 11l9 9' stroke='%23ffffff' stroke-width='1.2'/%3E%3Cpath d='M22 21H7' stroke='%23ffffff' stroke-width='1.5' stroke-linecap='round'/%3E%3Ccircle cx='4' cy='20' r='1.5' fill='%23f43f5e' stroke='%23ffffff' stroke-width='0.8'/%3E%3C/g%3E%3C/svg%3E") 4 20, crosshair`;

export const ScreenshotSelection: React.FC<Props> = ({
  src,
  onReady,
  onCopy,
  onSave,
  onCancel,
}) => {
  useLocale();
  const imageRef = useRef<HTMLImageElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mosaicCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const startRef = useRef<Point | null>(null);
  const movingRef = useRef<Point | null>(null);
  const resizingRef = useRef<{ handle: ResizeHandle; initial: ScreenshotRegion; start: Point } | null>(null);
  const submittingRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [selection, setSelection] = useState<ScreenshotRegion | null>(null);
  const [submitting, setSubmitting] = useState<'copy' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Annotation states
  const [activeTool, setActiveTool] = useState<ScreenshotTool>('select');
  const [strokeWidth, setStrokeWidth] = useState<StrokeWidth>(4);
  const [color, setColor] = useState<string>('#ef4444');
  const [fontSize, setFontSize] = useState<FontSize>(18);
  const [mosaicBlockSize, setMosaicBlockSize] = useState<MosaicBlockSize>(14);

  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [undoStack, setUndoStack] = useState<Annotation[][]>([]);
  const [redoStack, setRedoStack] = useState<Annotation[][]>([]);

  // Current in-progress annotation while dragging
  const [currentAnnotation, setCurrentAnnotation] = useState<Annotation | null>(null);

  // Text input popover state
  const [activeTextInput, setActiveTextInput] = useState<{ x: number; y: number; text: string } | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);

  // Surface bounds
  const [bounds, setBounds] = useState({ width: window.innerWidth, height: window.innerHeight });

  // Update bounds on resize
  useEffect(() => {
    const handleResize = () => {
      if (surfaceRef.current) {
        const rect = surfaceRef.current.getBoundingClientRect();
        setBounds({ width: rect.width, height: rect.height });
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Prepare mosaic offscreen canvas when image loads
  const handleImageLoaded = useCallback(() => {
    setReady(true);
    onReady?.();
    if (imageRef.current) {
      const img = imageRef.current;
      mosaicCanvasRef.current = createMosaicCanvas(img, img.naturalWidth, img.naturalHeight, 14);
    }
  }, [onReady]);

  // Redraw annotations on canvas whenever annotations or current in-progress change
  useEffect(() => {
    const canvas = canvasRef.current;
    const surface = surfaceRef.current;
    if (!canvas || !surface) return;

    if (canvas.width !== surface.clientWidth) {
      canvas.width = surface.clientWidth;
    }
    if (canvas.height !== surface.clientHeight) {
      canvas.height = surface.clientHeight;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (selection && (annotations.length > 0 || currentAnnotation)) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(selection.x, selection.y, selection.width, selection.height);
      ctx.clip();

      const all = currentAnnotation ? [...annotations, currentAnnotation] : annotations;
      renderAllAnnotations(ctx, all, mosaicCanvasRef.current);
      ctx.restore();
    }
  }, [annotations, currentAnnotation, selection, bounds]);

  // Helper to commit an annotation into history
  const pushAnnotation = useCallback((newAnnotation: Annotation) => {
    setUndoStack((prev) => [...prev, annotations]);
    setRedoStack([]);
    setAnnotations((prev) => [...prev, newAnnotation]);
  }, [annotations]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setRedoStack((prev) => [...prev, annotations]);
    setUndoStack((prev) => prev.slice(0, -1));
    setAnnotations(previous);
  }, [annotations, undoStack]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((prev) => [...prev, annotations]);
    setRedoStack((prev) => prev.slice(0, -1));
    setAnnotations(next);
  }, [annotations, redoStack]);

  const handleClear = useCallback(() => {
    if (annotations.length === 0) return;
    setUndoStack((prev) => [...prev, annotations]);
    setRedoStack([]);
    setAnnotations([]);
  }, [annotations]);

  // Commit text input
  const commitTextInput = useCallback(() => {
    if (activeTextInput && activeTextInput.text.trim()) {
      pushAnnotation({
        id: `text-${Date.now()}`,
        type: 'text',
        x: activeTextInput.x,
        y: activeTextInput.y,
        text: activeTextInput.text,
        color,
        fontSize,
      });
    }
    setActiveTextInput(null);
  }, [activeTextInput, color, fontSize, pushAnnotation]);

  // Complete screenshot (copy or save)
  const complete = useCallback(async (action: 'copy' | 'save') => {
    const image = imageRef.current;
    const surface = surfaceRef.current;
    if (!selection || !image || !surface || submittingRef.current || dragging) return;

    commitTextInput();

    const currentBounds = surface.getBoundingClientRect();
    const scaleX = image.naturalWidth / currentBounds.width;
    const scaleY = image.naturalHeight / currentBounds.height;
    const x = Math.max(0, Math.floor(selection.x * scaleX));
    const y = Math.max(0, Math.floor(selection.y * scaleY));
    const right = Math.min(image.naturalWidth, Math.ceil((selection.x + selection.width) * scaleX));
    const bottom = Math.min(image.naturalHeight, Math.ceil((selection.y + selection.height) * scaleY));

    submittingRef.current = true;
    setSubmitting(action);
    setError(null);

    try {
      let imageDataUrl: string | undefined;
      if (annotations.length > 0) {
        imageDataUrl = exportCroppedScreenshot(image, selection, currentBounds, annotations);
      }
      await (action === 'copy' ? onCopy : onSave)(
        { x, y, width: right - x, height: bottom - y },
        imageDataUrl,
      );
    } catch {
      setError(action === 'copy' ? tr('chat:screenshot.copyFailed') : tr('chat:screenshot.saveFailed'));
    } finally {
      submittingRef.current = false;
      setSubmitting(null);
    }
  }, [selection, dragging, annotations, commitTextInput, onCopy, onSave]);

  // Keyboard navigation & shortcuts
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (submittingRef.current) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        if (activeTextInput) {
          setActiveTextInput(null);
        } else if (activeTool !== 'select') {
          setActiveTool('select');
        } else {
          onCancel();
        }
        return;
      }

      if (event.key === 'Enter') {
        if (activeTextInput) {
          if (!event.shiftKey) {
            event.preventDefault();
            commitTextInput();
          }
          return;
        }
        event.preventDefault();
        void complete('copy');
        return;
      }

      // Undo: Ctrl+Z / Cmd+Z
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        handleUndo();
        return;
      }

      // Redo: Ctrl+Y or Ctrl+Shift+Z
      if (
        (event.ctrlKey || event.metaKey) &&
        (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))
      ) {
        event.preventDefault();
        handleRedo();
        return;
      }
    };

    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [activeTextInput, activeTool, commitTextInput, complete, handleRedo, handleUndo, onCancel]);

  const point = (event: React.PointerEvent): Point => {
    const surfaceBounds = surfaceRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(surfaceBounds.width, event.clientX - surfaceBounds.left)),
      y: Math.max(0, Math.min(surfaceBounds.height, event.clientY - surfaceBounds.top)),
    };
  };

  const isInsideSelection = (pt: Point) => {
    if (!selection) return false;
    return (
      pt.x >= selection.x &&
      pt.x <= selection.x + selection.width &&
      pt.y >= selection.y &&
      pt.y <= selection.y + selection.height
    );
  };

  // Resize handle pointer down
  const handleResizeHandleDown = (handle: ResizeHandle, event: React.PointerEvent) => {
    if (!selection || submittingRef.current) return;
    event.stopPropagation();
    const startPt = point(event);
    resizingRef.current = { handle, initial: { ...selection }, start: startPt };
    setDragging(true);
    if (surfaceRef.current) {
      try {
        surfaceRef.current.setPointerCapture(event.pointerId);
      } catch {}
    }
  };

  // Cursor style calculation
  const getCursor = () => {
    if (submitting) return 'wait';
    if (!selection) return 'crosshair';
    if (activeTool === 'eraser') return ERASER_CURSOR;
    if (activeTool === 'text') return 'text';
    if (activeTool === 'select') return 'crosshair';
    return 'crosshair';
  };

  return (
    <div
      ref={surfaceRef}
      className="fixed inset-0 overflow-hidden bg-black select-none"
      style={{ cursor: getCursor(), touchAction: 'none' }}
      aria-label={tr('chat:screenshot.selectRegion')}
      onPointerDown={(event) => {
        if (event.button !== 0 || !ready || submittingRef.current) return;
        const pt = point(event);

        if (activeTextInput) {
          commitTextInput();
        }

        // Inside selection and active tool is a drawing tool
        if (selection && isInsideSelection(pt) && activeTool !== 'select') {
          if (activeTool === 'eraser') {
            const hit = annotations.find((ann) => isPointNearAnnotation(pt, ann, 12));
            if (hit) {
              setUndoStack((prev) => [...prev, annotations]);
              setRedoStack([]);
              setAnnotations((prev) => prev.filter((a) => a.id !== hit.id));
            }
            return;
          }

          if (activeTool === 'text') {
            setActiveTextInput({ x: pt.x, y: pt.y, text: '' });
            setTimeout(() => textInputRef.current?.focus(), 10);
            return;
          }

          // Start drawing rect, arrow, brush, mosaic
          startRef.current = pt;
          setDragging(true);

          if (activeTool === 'rect') {
            setCurrentAnnotation({
              id: 'temp',
              type: 'rect',
              x1: pt.x,
              y1: pt.y,
              x2: pt.x,
              y2: pt.y,
              color,
              strokeWidth,
            });
          } else if (activeTool === 'arrow') {
            setCurrentAnnotation({
              id: 'temp',
              type: 'arrow',
              x1: pt.x,
              y1: pt.y,
              x2: pt.x,
              y2: pt.y,
              color,
              strokeWidth,
            });
          } else if (activeTool === 'brush') {
            setCurrentAnnotation({
              id: 'temp',
              type: 'brush',
              points: [pt],
              color,
              strokeWidth,
            });
          } else if (activeTool === 'mosaic') {
            setCurrentAnnotation({
              id: 'temp',
              type: 'mosaic',
              points: [pt],
              radius: mosaicBlockSize,
              blockSize: mosaicBlockSize,
            });
          }
          event.currentTarget.setPointerCapture(event.pointerId);
          return;
        }

        // Moving existing selection
        if (selection && isInsideSelection(pt) && activeTool === 'select') {
          movingRef.current = pt;
          setDragging(true);
          if (surfaceRef.current) {
            try {
              surfaceRef.current.setPointerCapture(event.pointerId);
            } catch {}
          }
          return;
        }

        // Outside or starting new selection
        startRef.current = pt;
        setSelection(null);
        setAnnotations([]);
        setUndoStack([]);
        setRedoStack([]);
        setActiveTool('select');
        setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const pt = point(event);

        // Resizing with handle
        if (resizingRef.current) {
          const { handle, initial, start } = resizingRef.current;
          const dx = pt.x - start.x;
          const dy = pt.y - start.y;
          let nx = initial.x;
          let ny = initial.y;
          let nw = initial.width;
          let nh = initial.height;

          if (handle.includes('w')) {
            nx = Math.min(initial.x + initial.width - 10, initial.x + dx);
            nw = initial.width - (nx - initial.x);
          }
          if (handle.includes('e')) {
            nw = Math.max(10, initial.width + dx);
          }
          if (handle.includes('n')) {
            ny = Math.min(initial.y + initial.height - 10, initial.y + dy);
            nh = initial.height - (ny - initial.y);
          }
          if (handle.includes('s')) {
            nh = Math.max(10, initial.height + dy);
          }

          setSelection({
            x: Math.max(0, nx),
            y: Math.max(0, ny),
            width: nw,
            height: nh,
          });
          return;
        }

        // Moving selection
        if (movingRef.current && selection) {
          const dx = pt.x - movingRef.current.x;
          const dy = pt.y - movingRef.current.y;
          const currentBounds = surfaceRef.current!.getBoundingClientRect();
          setSelection({
            x: Math.max(0, Math.min(currentBounds.width - selection.width, selection.x + dx)),
            y: Math.max(0, Math.min(currentBounds.height - selection.height, selection.y + dy)),
            width: selection.width,
            height: selection.height,
          });
          movingRef.current = pt;
          return;
        }

        // In-progress annotation drawing
        if (startRef.current && currentAnnotation) {
          if (currentAnnotation.type === 'rect' || currentAnnotation.type === 'arrow') {
            setCurrentAnnotation({
              ...currentAnnotation,
              x2: pt.x,
              y2: pt.y,
            });
          } else if (currentAnnotation.type === 'brush' || currentAnnotation.type === 'mosaic') {
            setCurrentAnnotation({
              ...currentAnnotation,
              points: [...currentAnnotation.points, pt],
            });
          }
          return;
        }

        // New selection dragging: continuously updates region to follow mouse!
        if (startRef.current && !currentAnnotation && !movingRef.current && !resizingRef.current) {
          const start = startRef.current;
          const width = Math.abs(pt.x - start.x);
          const height = Math.abs(pt.y - start.y);
          setSelection(
            width >= 2 && height >= 2
              ? {
                  x: Math.min(start.x, pt.x),
                  y: Math.min(start.y, pt.y),
                  width,
                  height,
                }
              : null,
          );
        }
      }}
      onPointerUp={(event) => {
        if (resizingRef.current) {
          resizingRef.current = null;
          setDragging(false);
          try {
            surfaceRef.current?.releasePointerCapture(event.pointerId);
          } catch {}
          return;
        }

        if (movingRef.current) {
          movingRef.current = null;
          setDragging(false);
          try {
            surfaceRef.current?.releasePointerCapture(event.pointerId);
          } catch {}
          return;
        }

        if (currentAnnotation) {
          pushAnnotation({
            ...currentAnnotation,
            id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          });
          setCurrentAnnotation(null);
          startRef.current = null;
          setDragging(false);
          event.currentTarget.releasePointerCapture(event.pointerId);
          return;
        }

        if (startRef.current) {
          const pt = point(event);
          const start = startRef.current;
          const width = Math.abs(pt.x - start.x);
          const height = Math.abs(pt.y - start.y);
          setSelection(
            width >= 2 && height >= 2
              ? { x: Math.min(start.x, pt.x), y: Math.min(start.y, pt.y), width, height }
              : null,
          );
          startRef.current = null;
          setDragging(false);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={() => {
        startRef.current = null;
        movingRef.current = null;
        resizingRef.current = null;
        setCurrentAnnotation(null);
        setDragging(false);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        if (!submittingRef.current) onCancel();
      }}
      onDoubleClick={() => void complete('copy')}
    >
      {/* Captured screen image */}
      <img
        ref={imageRef}
        src={src}
        draggable={false}
        alt=""
        className="absolute inset-0 w-full h-full pointer-events-none"
        onLoad={handleImageLoaded}
        onError={onCancel}
      />

      {/* Dimming overlay & selection boundary */}
      {selection ? (
        <SelectionBox
          selection={selection}
          naturalDimensions={{
            width: imageRef.current?.naturalWidth || bounds.width,
            height: imageRef.current?.naturalHeight || bounds.height,
          }}
          surfaceDimensions={bounds}
          onHandlePointerDown={handleResizeHandleDown}
        />
      ) : (
        <div className="absolute inset-0 bg-black/45 pointer-events-none" />
      )}

      {/* Annotations overlay canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />

      {/* Active text input popover */}
      {activeTextInput && (
        <div
          className="absolute z-40"
          style={{ left: activeTextInput.x, top: activeTextInput.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <textarea
            ref={textInputRef}
            value={activeTextInput.text}
            onChange={(e) => setActiveTextInput({ ...activeTextInput, text: e.target.value })}
            onBlur={commitTextInput}
            placeholder={tr('chat:screenshot.textPlaceholder')}
            className="rounded border border-sky-400 bg-slate-900/90 p-1.5 shadow-lg outline-none resize-none font-semibold text-white"
            style={{
              color,
              fontSize: `${fontSize}px`,
              lineHeight: 1.35,
              minWidth: 120,
              minHeight: fontSize * 2,
            }}
            rows={Math.max(1, activeTextInput.text.split('\n').length)}
          />
        </div>
      )}

      {/* Top hint notification */}
      <div className="absolute top-5 left-1/2 -translate-x-1/2 rounded-lg bg-black/80 px-4 py-2 text-sm text-white pointer-events-none shadow-md">
        {error || tr('chat:screenshot.selectionHint')}
      </div>

      {/* Floating Toolbar */}
      <ScreenshotToolbar
        selection={selection}
        dragging={dragging || !!resizingRef.current || !!movingRef.current}
        activeTool={activeTool}
        onSelectTool={setActiveTool}
        strokeWidth={strokeWidth}
        onChangeStrokeWidth={setStrokeWidth}
        color={color}
        onChangeColor={setColor}
        fontSize={fontSize}
        onChangeFontSize={setFontSize}
        mosaicBlockSize={mosaicBlockSize}
        onChangeMosaicBlockSize={setMosaicBlockSize}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        canClear={annotations.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onClear={handleClear}
        onCancel={onCancel}
        onSave={() => void complete('save')}
        onCopy={() => void complete('copy')}
        submitting={submitting}
        surfaceDimensions={bounds}
      />
    </div>
  );
};
