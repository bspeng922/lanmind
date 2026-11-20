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
import { parseAsync, renderDocument, type Options } from 'docx-preview';
import mammoth from 'mammoth/mammoth.browser';
import DOMPurify from 'dompurify';
import { useIsDarkTheme } from '../../context/ThemeContext';

interface Props {
  arrayBuffer: ArrayBuffer;
  fileName: string;
}

const pageOptions = {
  useBase64URL: true,
  renderChanges: true,
  // Embedded HTML parts are rendered as same-origin iframes by docx-preview.
  renderAltChunks: false,
} satisfies Partial<Options>;

export const DocxPreview: React.FC<Props> = ({ arrayBuffer, fileName }) => {
  useLocale();
  const isDark = useIsDarkTheme();
  const [viewMode, setViewMode] = useState<'page' | 'flow'>('page');
  const [zoom, setZoom] = useState<number>(100);
  const [pageCount, setPageCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [failedPageBuffer, setFailedPageBuffer] = useState<ArrayBuffer | null>(null);
  const [flow, setFlow] = useState<{ buffer: ArrayBuffer; html: string } | null>(null);
  const flowHtml = flow?.buffer === arrayBuffer ? flow.html : null;
  const isFallback = failedPageBuffer === arrayBuffer;

  const docxContainerRef = useRef<HTMLDivElement>(null);
  const flowCache = useRef(flow);
  flowCache.current = flow;

  useEffect(() => {
    const target = docxContainerRef.current;
    let disposed = false;
    let timer: number | undefined;
    setLoading(true);
    setError(null);
    if (viewMode === 'page') setPageCount(0);

    const render = async () => {
      try {
        if (viewMode === 'page' && target) {
          try {
            const pages = parseAsync(arrayBuffer, pageOptions).then((doc) => renderDocument(doc, pageOptions));
            const deadline = new Promise<never>((_, reject) => {
              timer = window.setTimeout(() => reject(new Error(tr("common:docxPreview.docxRenderingTimedOut"))), 8000);
            });
            const nodes = await Promise.race([pages, deadline]);
            if (disposed) return;
            if (typeof target.replaceChildren === 'function') {
              target.replaceChildren(...nodes);
            } else {
              target.textContent = '';
              for (const node of nodes) target.appendChild(node);
            }
            setPageCount(target.querySelectorAll('.docx').length || 1);
            return;
          } catch (error) {
            if (disposed) return;
            console.warn('Could not render the paged Word preview', error);
            setFailedPageBuffer(arrayBuffer);
          } finally {
            window.clearTimeout(timer);
          }
        }
        if (flowCache.current?.buffer !== arrayBuffer) {
          const result = await mammoth.convertToHtml({ arrayBuffer });
          if (disposed) return;
          setFlow({ buffer: arrayBuffer, html: DOMPurify.sanitize(result.value) });
        }
        if (viewMode === 'page') setViewMode('flow');
      } catch (error) {
        if (!disposed) setError(error instanceof Error ? error.message : tr("common:docxPreview.couldNotPreviewWordDocument"));
      } finally {
        if (!disposed) setLoading(false);
      }
    };

    void render();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
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
            <RefreshCw className="h-8 w-8 motion-safe:animate-spin text-info mb-3" />
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
        {viewMode === 'page' && (
          <div className="min-w-fit mx-auto">
            <div
              className={`docx-page-scaler ${error ? 'hidden' : 'flex'} flex-col items-center transition-transform duration-150 ${
                loading ? 'opacity-0' : 'opacity-100'
              }`}
              style={{
                transform: `scale(${zoom / 100})`,
                transformOrigin: zoom > 100 ? 'top left' : 'top center',
              }}
            >
              <div
                ref={docxContainerRef}
                className="docx-render-wrapper shadow-popover"
              />
            </div>
          </div>
        )}

        {/* Flow View: Clean Reading Mode */}
        {!error && viewMode === 'flow' && (
          <div className="mx-auto max-w-3xl rounded-xl border border-edge bg-card p-8 shadow-panel">
            <h1 className="mb-6 border-b border-edge pb-3 text-lg font-bold text-main">
              {fileName}
            </h1>
            <article
              className={`prose ${isDark ? 'prose-invert' : ''} max-w-none text-sm leading-7 text-main font-sans space-y-3 [&_p]:my-2.5 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-subtle [&_td]:p-2 [&_th]:border [&_th]:border-subtle [&_th]:bg-muted [&_th]:p-2`}
              dangerouslySetInnerHTML={{ __html: flowHtml ?? tr("common:docxPreview.pLoadingContentP") }}
            />
          </div>
        )}
      </div>
    </div>
  );
};
