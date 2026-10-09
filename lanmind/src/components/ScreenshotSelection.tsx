import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Download, X, Loader2 } from 'lucide-react';
import { tr, useLocale } from '../i18n';

export interface ScreenshotRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  src: string;
  onReady?: () => void;
  onCopy: (region: ScreenshotRegion) => Promise<unknown>;
  onSave: (region: ScreenshotRegion) => Promise<unknown>;
  onCancel: () => void;
}

type Point = { x: number; y: number };

export const ScreenshotSelection: React.FC<Props> = ({ src, onReady, onCopy, onSave, onCancel }) => {
  useLocale();
  const imageRef = useRef<HTMLImageElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<Point | null>(null);
  const submittingRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [selection, setSelection] = useState<ScreenshotRegion | null>(null);
  const [submitting, setSubmitting] = useState<'copy' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const complete = useCallback(async (action: 'copy' | 'save') => {
    const image = imageRef.current;
    const surface = surfaceRef.current;
    if (!selection || !image || !surface || submittingRef.current || dragging) return;
    const bounds = surface.getBoundingClientRect();
    const scaleX = image.naturalWidth / bounds.width;
    const scaleY = image.naturalHeight / bounds.height;
    const x = Math.max(0, Math.floor(selection.x * scaleX));
    const y = Math.max(0, Math.floor(selection.y * scaleY));
    const right = Math.min(image.naturalWidth, Math.ceil((selection.x + selection.width) * scaleX));
    const bottom = Math.min(image.naturalHeight, Math.ceil((selection.y + selection.height) * scaleY));
    submittingRef.current = true;
    setSubmitting(action);
    setError(null);
    try {
      await (action === 'copy' ? onCopy : onSave)({ x, y, width: right - x, height: bottom - y });
    } catch {
      setError(action === 'copy' ? tr('chat:screenshot.copyFailed') : tr('chat:screenshot.saveFailed'));
    } finally {
      submittingRef.current = false;
      setSubmitting(null);
    }
  }, [selection, dragging, onCopy, onSave]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submittingRef.current) { event.preventDefault(); onCancel(); }
      if (event.key === 'Enter') { event.preventDefault(); void complete('copy'); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [complete, onCancel]);

  const point = (event: React.PointerEvent): Point => {
    const bounds = surfaceRef.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)), y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)) };
  };

  const updateSelection = (end: Point) => {
    const start = startRef.current!;
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);
    setSelection(width >= 2 && height >= 2 ? { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width, height } : null);
  };

  return (
    <div
      ref={surfaceRef}
      className="fixed inset-0 overflow-hidden bg-black select-none"
      style={{ cursor: submitting ? 'wait' : 'crosshair', touchAction: 'none' }}
      aria-label={tr('chat:screenshot.selectRegion')}
      onPointerDown={(event) => {
        if (event.button !== 0 || !ready || submittingRef.current) return;
        const start = point(event);
        if (selection && start.x >= selection.x && start.x <= selection.x + selection.width
          && start.y >= selection.y && start.y <= selection.y + selection.height) return;
        startRef.current = start;
        setSelection(null);
        setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => { if (startRef.current) updateSelection(point(event)); }}
      onPointerUp={(event) => {
        if (!startRef.current) return;
        updateSelection(point(event));
        startRef.current = null;
        setDragging(false);
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { startRef.current = null; setDragging(false); setSelection(null); }}
      onContextMenu={(event) => { event.preventDefault(); if (!submittingRef.current) onCancel(); }}
      onDoubleClick={() => void complete('copy')}
    >
      <img
        ref={imageRef} src={src} draggable={false} alt=""
        className="absolute inset-0 w-full h-full pointer-events-none"
        onLoad={() => { setReady(true); onReady?.(); }}
        onError={onCancel}
      />
      {selection ? (
        <div
          data-testid="screenshot-region"
          className="absolute border-2 border-sky-400 pointer-events-none"
          style={{ left: selection.x, top: selection.y, width: selection.width, height: selection.height, boxShadow: '0 0 0 10000px rgba(0,0,0,0.48)' }}
        />
      ) : <div className="absolute inset-0 bg-black/45 pointer-events-none" />}
      <div className="absolute top-5 left-1/2 -translate-x-1/2 rounded-lg bg-black/80 px-4 py-2 text-sm text-white pointer-events-none">
        {error || tr('chat:screenshot.selectionHint')}
      </div>
      <div
        className="absolute flex items-center gap-2 rounded-lg border border-white/20 bg-slate-900 px-3 py-2 text-white shadow-lg"
        style={selection ? {
          left: Math.max(8, Math.min(selection.x + selection.width - 210, window.innerWidth - 230)),
          top: Math.max(8, Math.min(selection.y + selection.height + 10, window.innerHeight - 60)),
        } : { right: 20, bottom: 20 }}
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {selection && <span className="text-xs tabular-nums mr-2">{Math.round(selection.width * (imageRef.current?.naturalWidth || 1) / window.innerWidth)} × {Math.round(selection.height * (imageRef.current?.naturalHeight || 1) / window.innerHeight)}</span>}
        <button type="button" onClick={onCancel} disabled={!!submitting} className="rounded p-1.5 hover:bg-white/15 disabled:opacity-40" title={tr('chat:screenshot.cancel')} aria-label={tr('chat:screenshot.cancel')}><X className="w-4 h-4" /></button>
        <button type="button" onClick={() => void complete('save')} disabled={!selection || dragging || !!submitting} className="rounded p-1.5 hover:bg-white/15 disabled:opacity-40" title={tr('chat:screenshot.saveAs')} aria-label={tr('chat:screenshot.saveAs')}>
          {submitting === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        </button>
        <button type="button" onClick={() => void complete('copy')} disabled={!selection || dragging || !!submitting} className="rounded p-1.5 text-sky-300 hover:bg-white/15 disabled:opacity-40" title={tr('chat:screenshot.copy')} aria-label={tr('chat:screenshot.copy')}>
          {submitting === 'copy' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
};
