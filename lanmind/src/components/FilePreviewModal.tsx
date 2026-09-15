/**
 * FilePreviewModal — Universal file preview modal orchestrator.
 *
 * CALLING SPEC:
 *   <FilePreviewModal
 *     name="report.docx"
 *     type="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
 *     dataUrl={dataUrl}
 *     httpUrl={httpUrl}
 *     projectId={projectId}
 *     fileId={fileId}
 *     onDownload={() => ...}
 *     onClose={() => ...}
 *   />
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileText,
  FileSpreadsheet,
  FileCode,
  Image as ImageIcon,
  Film,
  Music,
  Maximize2,
  Minimize2,
  RefreshCw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ApiService } from '../services/api';
import { downloadFile } from '../utils/fileTransfer';
import { DocxPreview } from './preview/DocxPreview';
import { ExcelPreview } from './preview/ExcelPreview';
import { MarkdownPreview } from './preview/MarkdownPreview';
import { ImagePreview, ImagePreviewHandle } from './preview/ImagePreview';
import { VideoPreview } from './preview/VideoPreview';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

interface Props {
  name: string;
  type?: string;
  dataUrl?: string;
  httpUrl?: string;
  projectId?: string;
  fileId?: string;
  onDownload?: () => void;
  onClose: () => void;
}

const textExt = /\.(txt|text|json|json5|csv|tsv|xml|yaml|yml|log|ini|conf|env|js|jsx|ts|tsx|css|scss|less|html|htm|vue|svelte|rs|py|java|kt|go|rb|php|c|cc|cpp|h|hpp|sql|sh|bash|ps1|bat|toml|properties|gitignore|dockerfile)$/i;
const markdownExt = /\.(md|markdown|mdown|mkdn)$/i;
const sheetExt = /\.(xlsx|xls|csv|tsv)$/i;
const wordExt = /\.(docx)$/i;

const isMarkdown = (n: string) => markdownExt.test(n);
const isWord = (n: string, t: string) => /wordprocessingml|msword/.test(t) || wordExt.test(n);
const isSheet = (n: string, t: string) => /spreadsheet|excel/.test(t) || sheetExt.test(n);
const isPdf = (n: string, t: string) => t === 'application/pdf' || /\.pdf$/i.test(n);
const isImage = (n: string, t: string) => t.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/i.test(n);
const isVideo = (n: string, t: string) => t.startsWith('video/') || /\.(mp4|webm|ogg|mov|m4v|avi|mkv)$/i.test(n);
const isAudio = (n: string, t: string) => t.startsWith('audio/') || /\.(mp3|wav|ogg|flac|aac|m4a)$/i.test(n);
const isText = (n: string, t: string) => t.startsWith('text/') || /json|javascript|xml|yaml/.test(t) || textExt.test(n);

export const FilePreviewModal: React.FC<Props> = ({
  name,
  type = '',
  dataUrl,
  httpUrl,
  projectId,
  fileId,
  onDownload,
  onClose,
}) => {
  const source = httpUrl || dataUrl;
  const isMd = isMarkdown(name);
  const isDocx = isWord(name, type);
  const isXlsx = isSheet(name, type);
  const isPdfFile = isPdf(name, type);
  const isImg = isImage(name, type);
  const isVid = isVideo(name, type);
  const isAud = isAudio(name, type);
  const isTxt = isText(name, type) && !isMd && !isXlsx;

  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfScale, setPdfScale] = useState(1.15);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [imageScale, setImageScale] = useState(1);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imagePreviewRef = useRef<ImagePreviewHandle>(null);

  // Read ArrayBuffer
  const readBuffer = async (): Promise<ArrayBuffer> => {
    if (!source) throw new Error('文件没有可读取的数据源');

    // Fast and reliable decode for base64 data URLs
    if (source.startsWith('data:')) {
      const commaIdx = source.indexOf(',');
      const b64 = commaIdx !== -1 ? source.slice(commaIdx + 1) : source;
      const binaryStr = atob(b64);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      return bytes.buffer;
    }

    // HTTP fetch with 10s timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(source, { signal: controller.signal });
      if (!res.ok) throw new Error(`文件读取失败（HTTP ${res.status}）`);
      return await res.arrayBuffer();
    } catch (e: any) {
      if (e.name === 'AbortError') {
        throw new Error('网络文件读取超时，请重试或直接下载');
      }
      throw e;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  // Load content
  const loadData = async () => {
    setLoading(true);
    setError(null);
    setBuffer(null);
    setTextContent(null);
    setPdfDoc(null);
    setImageScale(1);

    try {
      if (isMd || isTxt) {
        let text: string | null = null;
        if (projectId && fileId) {
          try {
            text = await ApiService.readProjectFileContent(projectId, fileId);
          } catch {
            /* fallback to URL fetch */
          }
        }
        if (!text) {
          const buf = await readBuffer();
          text = new TextDecoder().decode(buf);
        }
        setTextContent(text);
      } else if (isDocx || isXlsx) {
        const buf = await readBuffer();
        setBuffer(buf);
      } else if (isPdfFile) {
        const buf = await readBuffer();
        const doc = await pdfjsLib.getDocument({ data: buf }).promise;
        setPdfDoc(doc);
      }
    } catch (err: any) {
      console.error('File preview loading failed', err);
      setError(err?.message || '文件解析失败，请下载后查看');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    return () => {
      pdfDoc?.destroy();
    };
  }, [name, type, dataUrl, httpUrl, projectId, fileId]);

  // PDF Page rendering
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    let cancelled = false;
    pdfDoc.getPage(pdfPage).then((page) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale: pdfScale });
      const canvas = canvasRef.current!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      void page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
    });
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, pdfPage, pdfScale]);

  // Keyboard shortcut Esc
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleDownload = () => {
    if (onDownload) {
      onDownload();
    } else {
      void downloadFile(source, name);
    }
  };

  const handleCopyText = () => {
    if (!textContent) return;
    navigator.clipboard.writeText(textContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const fileFormatInfo = useMemo(() => {
    if (isDocx) return { label: 'Word 文档预览', icon: <FileText className="h-4 w-4 text-info" /> };
    if (isXlsx) return { label: 'Excel 工作簿预览', icon: <FileSpreadsheet className="h-4 w-4 text-success" /> };
    if (isMd) return { label: 'Markdown 文档预览', icon: <FileCode className="h-4 w-4 text-feature" /> };
    if (isPdfFile) return { label: 'PDF 文档预览', icon: <FileText className="h-4 w-4 text-danger" /> };
    if (isImg) return { label: '图片预览', icon: <ImageIcon className="h-4 w-4 text-warning" /> };
    if (isVid) return { label: '视频播放', icon: <Film className="h-4 w-4 text-feature" /> };
    if (isAud) return { label: '音频播放', icon: <Music className="h-4 w-4 text-success" /> };
    return { label: '纯文本预览', icon: <FileText className="h-4 w-4 text-info" /> };
  }, [isDocx, isXlsx, isMd, isPdfFile, isImg, isVid, isAud]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-overlay p-3 sm:p-6 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`预览文件: ${name}`}
    >
      <div
        className={`flex w-full flex-col overflow-hidden rounded-2xl border border-edge bg-surface shadow-popover transition-all ${
          isFullscreen ? 'h-full max-h-full max-w-full rounded-none' : 'max-h-[92vh] max-w-6xl h-[88vh]'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
          <div className="flex items-center justify-between gap-3 border-b border-edge/80 bg-surface px-5 py-3">
          {/* File Title & Tag */}
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-card/60 border border-subtle/60">
              {fileFormatInfo.icon}
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-xs font-bold text-main font-mono tracking-tight" title={name}>
                {name}
              </h2>
              <p className="text-[10px] text-sub">{fileFormatInfo.label}</p>
            </div>
          </div>

          {/* Controls & Action Buttons */}
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            {/* Copy button for plain text */}
            {isTxt && textContent && (
              <button
                onClick={handleCopyText}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-subtle bg-card/80 px-2.5 text-xs text-sub hover:text-main transition-colors"
                title="复制文本内容"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copied ? '已复制' : '复制'}</span>
              </button>
            )}

            {/* PDF Zoom & Page Nav */}
            {pdfDoc && (
              <div className="flex items-center gap-1 rounded-lg border border-edge bg-surface/90 px-2 py-1 text-xs text-sub">
                <button
                  disabled={pdfPage <= 1}
                  onClick={() => setPdfPage((p) => Math.max(1, p - 1))}
                  className="p-1 hover:text-main disabled:opacity-30"
                  title="上一页"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="px-1 text-[11px] font-mono text-sub">
                  {pdfPage} / {pdfDoc.numPages}
                </span>
                <button
                  disabled={pdfPage >= pdfDoc.numPages}
                  onClick={() => setPdfPage((p) => Math.min(pdfDoc.numPages, p + 1))}
                  className="p-1 hover:text-main disabled:opacity-30"
                  title="下一页"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <div className="mx-1 h-3 w-[1px] bg-card" />
                <button
                  onClick={() => setPdfScale((s) => Math.max(0.6, s - 0.15))}
                  className="p-1 hover:text-main"
                  title="缩小"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setPdfScale((s) => Math.min(2.5, s + 0.15))}
                  className="p-1 hover:text-main"
                  title="放大"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Image Zoom */}
            {isImg && source && (
              <div className="flex items-center gap-1 rounded-lg border border-edge bg-surface/90 px-2 py-1 text-xs text-sub">
                <button
                  disabled={imageScale <= 0.15}
                  onClick={() => imagePreviewRef.current?.zoomOut()}
                  className="p-1 hover:text-main disabled:opacity-30"
                  title="缩小图片"
                  aria-label="缩小图片"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
                <span className="min-w-10 px-1 text-center text-[11px] font-mono text-sub">
                  {Math.round(imageScale * 100)}%
                </span>
                <button
                  disabled={imageScale >= 8}
                  onClick={() => imagePreviewRef.current?.zoomIn()}
                  className="p-1 hover:text-main disabled:opacity-30"
                  title="放大图片"
                  aria-label="放大图片"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => imagePreviewRef.current?.reset()}
                  className="p-1 hover:text-main disabled:opacity-30"
                  title="重置图片缩放"
                  aria-label="重置图片缩放"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Download Button */}
            <button
              onClick={handleDownload}
              className="theme-btn-primary flex h-8 items-center gap-1.5 px-3 text-xs font-semibold rounded-lg"
              title="下载此文件"
            >
              <Download className="h-3.5 w-3.5" />
              <span>下载</span>
            </button>

            {/* Fullscreen Toggle */}
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-subtle/80 bg-card/80 text-sub hover:text-main transition-colors"
              title={isFullscreen ? '退出全屏' : '全屏预览'}
            >
              {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>

            {/* Close Button */}
            <button
              onClick={onClose}
              className="ui-modal-close-btn"
              title="关闭预览 (Esc)"
              aria-label="关闭预览"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content Body Area */}
        <div className="min-h-0 flex-1 overflow-hidden bg-canvas">
          {loading ? (
            <div className="flex h-full flex-col items-center justify-center py-24 text-center">
              <RefreshCw className="h-8 w-8 animate-spin text-info mb-3" />
              <p className="text-xs text-sub">正在准备文件预览数据...</p>
            </div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center py-24 text-center">
              <AlertCircle className="h-10 w-10 text-warning mb-3" />
              <p className="text-xs text-sub">{error}</p>
              <button onClick={handleDownload} className="theme-btn-primary mt-4 px-4 py-2 text-xs font-semibold">
                直接下载查看
              </button>
            </div>
          ) : isDocx && buffer ? (
            <DocxPreview arrayBuffer={buffer} fileName={name} />
          ) : isXlsx && buffer ? (
            <ExcelPreview arrayBuffer={buffer} fileName={name} />
          ) : isMd && textContent !== null ? (
            <MarkdownPreview content={textContent} fileName={name} />
          ) : isPdfFile && pdfDoc ? (
            <div className="h-full overflow-auto p-6 flex justify-center bg-canvas">
              <canvas ref={canvasRef} className="rounded-lg shadow-popover bg-white" />
            </div>
          ) : isImg && source ? (
            <ImagePreview
              ref={imagePreviewRef}
              src={source}
              alt={name}
              scale={imageScale}
              onScaleChange={setImageScale}
            />
          ) : isVid ? (
            <VideoPreview
              name={name}
              type={type}
              source={source}
              onDownload={handleDownload}
            />
          ) : isAud && source ? (
            <div className="flex h-full flex-col items-center justify-center p-6 bg-canvas">
              <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-3xl bg-teal-500/10 text-success border border-teal-500/20">
                <Music className="h-12 w-12" />
              </div>
              <audio src={source} controls className="w-full max-w-md" />
            </div>
          ) : isTxt && textContent !== null ? (
            <div className="h-full overflow-auto p-6 bg-canvas">
              <pre className="mx-auto max-w-4xl whitespace-pre-wrap break-words rounded-2xl border border-edge bg-surface/90 p-6 font-mono text-xs leading-6 text-main select-text">
                {textContent}
              </pre>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center py-24 text-center text-quiet">
              <FileText className="h-12 w-12 mb-3 opacity-40" />
              <p className="text-xs">该文件格式暂不支持直接在线解析</p>
              <button onClick={handleDownload} className="theme-btn-primary mt-4 px-4 py-2 text-xs font-semibold">
                下载到本地查看
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
