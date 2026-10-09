import { localizeMessage } from '../../i18n/messages';
import { tr, useLocale } from "../../i18n";
/**
 * DocxPreview — Word (.docx) document preview component.
 *
 * CALLING SPEC:
 *   <DocxPreview
 *     arrayBuffer={buffer}
 *     fileName={fileName}
 *   />
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  ZoomIn,
  ZoomOut,
  BookOpen,
  FileText,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { renderAsync } from 'docx-preview';
import mammoth from 'mammoth/mammoth.browser';
import DOMPurify from 'dompurify';

interface Props {
  arrayBuffer: ArrayBuffer;
  fileName: string;
}

export const DocxPreview: React.FC<Props> = ({ arrayBuffer, fileName }) => {
  useLocale();
  const [viewMode, setViewMode] = useState<'page' | 'flow'>('page');
  const [zoom, setZoom] = useState<number>(100);
  const [pageCount, setPageCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [flowHtml, setFlowHtml] = useState<string | null>(null);
  const [isFallback, setIsFallback] = useState<boolean>(false);

  const docxContainerRef = useRef<HTMLDivElement>(null);
  const isRenderingRef = useRef<boolean>(false);

  // Render docx using docx-preview
  const renderDocx = async (targetEl: HTMLDivElement) => {
    if (isRenderingRef.current) return;
    isRenderingRef.current = true;
    setLoading(true);
    setError(null);
    setIsFallback(false);

    try {
      targetEl.innerHTML = '';
      
      const renderPromise = renderAsync(arrayBuffer.slice(0), targetEl, undefined, {
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false,
        experimental: false,
        breakPages: true,
        useBase64URL: true,
        renderChanges: true,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
      });

      // 8-second safety timeout
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(tr("common:docxPreview.docxRenderingTimedOut"))), 8000)
      );

      await Promise.race([renderPromise, timeoutPromise]);

      // Count pages
      const pages = targetEl.querySelectorAll('.docx');
      setPageCount(pages.length || 1);
      setLoading(false);
    } catch (err: any) {
      console.warn('docx-preview failed or timed out, falling back to mammoth', err);
      // Fallback to mammoth
      try {
        const result = await mammoth.convertToHtml({ arrayBuffer: arrayBuffer.slice(0) });
        setFlowHtml(DOMPurify.sanitize(result.value));
        setIsFallback(true);
        setViewMode('flow');
        setLoading(false);
      } catch (fallbackErr: any) {
        setError(fallbackErr?.message || tr("common:docxPreview.couldNotPreviewWordDocument"));
        setLoading(false);
      }
    } finally {
      isRenderingRef.current = false;
    }
  };

  // Convert to flow HTML for reading mode
  const ensureFlowHtml = async () => {
    if (flowHtml) return;
    try {
      const result = await mammoth.convertToHtml({ arrayBuffer: arrayBuffer.slice(0) });
      setFlowHtml(DOMPurify.sanitize(result.value));
    } catch (err) {
      console.error('Failed to convert docx to flow html', err);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const execute = async () => {
      if (viewMode === 'page') {
        // Ensure DOM container is attached
        if (!docxContainerRef.current) {
          // Micro-tick retry if ref has not attached yet
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (cancelled) return;

        if (docxContainerRef.current) {
          await renderDocx(docxContainerRef.current);
        } else {
          // Fallback to flow mode if ref is still missing
          setViewMode('flow');
        }
      } else {
        setLoading(true);
        try {
          await ensureFlowHtml();
        } finally {
          if (!cancelled) setLoading(false);
        }
      }
    };

    void execute();

    return () => {
      cancelled = true;
    };
  }, [arrayBuffer, viewMode]);

  const handleZoomIn = () => setZoom((z) => Math.min(200, z + 15));
  const handleZoomOut = () => setZoom((z) => Math.max(50, z - 15));
  const handleZoomReset = () => setZoom(100);


  return (
    <div className="flex h-full flex-col bg-surface text-main">
      {/* Docx Control Toolbar */}
      <div className="flex flex-wrap items-center justify-between border-b border-edge bg-surface px-4 py-2.5 text-xs">
        {/* Left: View Mode Toggle */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setViewMode('page')}
            disabled={isFallback}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition-all ${
              viewMode === 'page'
                ? 'bg-sky-500/20 text-info border border-sky-500/40 shadow-soft'
                : 'text-sub hover:text-main hover:bg-hover/60'
            } ${isFallback ? 'opacity-50 cursor-not-allowed' : ''}`}
            title={tr("common:docxPreview.a4PageLayout")}
          >
            <FileText className="h-3.5 w-3.5" />
            <span>{tr("common:docxPreview.pageView")}</span>
          </button>

          <button
            onClick={() => setViewMode('flow')}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition-all ${
              viewMode === 'flow'
                ? 'bg-sky-500/20 text-info border border-sky-500/40 shadow-soft'
                : 'text-sub hover:text-main hover:bg-hover/60'
            }`}
            title={tr("common:docxPreview.responsiveDocumentLayout")}
          >
            <BookOpen className="h-3.5 w-3.5" />
            <span>{tr("common:docxPreview.readingView")}</span>
          </button>

          {isFallback && (
            <span className="ml-2 inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] text-warning border border-amber-500/20">
              <AlertCircle className="h-3 w-3" />
              {tr("common:docxPreview.compatibilityMode")}</span>
          )}
        </div>

        {/* Center: Page Info & Zoom Controls */}
        <div className="flex items-center gap-3">
          {viewMode === 'page' && pageCount > 0 && (
            <span className="text-[11px] text-sub font-mono">
              {tr("common:docxPreview.total")}<strong className="text-main">{pageCount}</strong> {tr("common:docxPreview.page")}</span>
          )}

          {viewMode === 'page' && (
            <div className="flex items-center gap-1 rounded-lg border border-edge bg-surface/80 px-1 py-0.5">
              <button
                onClick={handleZoomOut}
                disabled={zoom <= 50}
                className="p-1 text-sub hover:text-main disabled:opacity-30 transition-colors"
                title={tr("common:docxPreview.zoomOut")}
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>

              <button
                onClick={handleZoomReset}
                className="px-1.5 py-0.5 text-[11px] font-mono text-sub hover:text-info transition-colors"
                title={tr("common:docxPreview.resetZoomTo100")}
              >
                {zoom}%
              </button>

              <button
                onClick={handleZoomIn}
                disabled={zoom >= 200}
                className="p-1 text-sub hover:text-main disabled:opacity-30 transition-colors"
                title={tr("common:docxPreview.zoomIn")}
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

        </div>
      </div>

      {/* Main Content Area */}
      <div className="relative flex-1 overflow-auto bg-canvas p-4 md:p-8">
        {/* Loading Overlay */}
        {loading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-canvas/90 backdrop-blur-xs py-24 text-center">
            <RefreshCw className="h-8 w-8 animate-spin text-info mb-3" />
            <p className="text-xs text-sub">{tr("common:docxPreview.preparingWordPreview")}</p>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="flex h-full flex-col items-center justify-center py-24 text-center">
            <AlertCircle className="h-10 w-10 text-danger mb-3" />
            <p className="text-sm font-medium text-sub">{localizeMessage(error)}</p>
            <p className="mt-1 text-xs text-quiet">{tr("common:docxPreview.thisDocumentMayBeEncryptedOrIncomplete")}</p>
          </div>
        )}

        {/* Page View: Container is ALWAYS rendered in DOM when viewMode === 'page' */}
        {!error && viewMode === 'page' && (
          <div
            className={`docx-page-scaler flex flex-col items-center transition-transform duration-150 ${
              loading ? 'opacity-0' : 'opacity-100'
            }`}
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: 'top center',
            }}
          >
            <div
              ref={docxContainerRef}
              className="docx-render-wrapper shadow-popover"
            />
          </div>
        )}

        {/* Flow View: Clean Reading Mode */}
        {!error && viewMode === 'flow' && (
          <div className="mx-auto max-w-3xl rounded-2xl border border-edge/80 bg-surface/90 p-8 shadow-popover backdrop-blur-sm">
            <h1 className="mb-6 border-b border-edge pb-3 text-lg font-bold text-main font-mono">
              {fileName}
            </h1>
            <article
              className="prose prose-invert max-w-none text-xs leading-relaxed text-sub font-sans space-y-3 [&_p]:my-2 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-xs [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-subtle [&_td]:p-2 [&_th]:border [&_th]:border-subtle [&_th]:bg-card [&_th]:p-2"
              dangerouslySetInnerHTML={{ __html: flowHtml || tr("common:docxPreview.pLoadingContentP") }}
            />
          </div>
        )}
      </div>
    </div>
  );
};
