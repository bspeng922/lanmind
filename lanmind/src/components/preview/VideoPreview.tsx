/**
 * VideoPreview — Resilient HTML5 video preview component with automatic
 * Base64-to-Blob conversion, CORS range fallback, and unsupported format detection.
 *
 * CALLING SPEC:
 *   <VideoPreview
 *     name="demo.mp4"
 *     type="video/mp4"
 *     source={httpUrl || dataUrl}
 *     onDownload={handleDownload}
 *   />
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Download, Film, Loader2, RefreshCw } from 'lucide-react';

interface VideoPreviewProps {
  name: string;
  type?: string;
  source?: string;
  onDownload?: () => void;
  className?: string;
}

// Containers known to require external players
const NON_WEB_VIDEO_REGEX = /\.(avi|mkv|wmv|flv|f4v|rmvb|rm|vob|ts|m2ts|asf)$/i;

export const VideoPreview: React.FC<VideoPreviewProps> = ({
  name,
  type = '',
  source,
  onDownload,
  className = '',
}) => {
  const [playableSrc, setPlayableSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [videoInfo, setVideoInfo] = useState<{ width: number; height: number; duration: number } | null>(null);
  const [isBlobUrl, setIsBlobUrl] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const createdBlobUrlRef = useRef<string | null>(null);

  const isNonWebContainer = useMemo(() => NON_WEB_VIDEO_REGEX.test(name), [name]);
  const extension = useMemo(() => {
    const parts = name.split('.');
    return parts.length > 1 ? parts.pop()!.toUpperCase() : 'VIDEO';
  }, [name]);

  // Clean up any generated blob URL
  const cleanupBlobUrl = () => {
    if (createdBlobUrlRef.current) {
      URL.revokeObjectURL(createdBlobUrlRef.current);
      createdBlobUrlRef.current = null;
    }
  };

  useEffect(() => {
    return cleanupBlobUrl;
  }, []);

  // Prepare playable video source
  useEffect(() => {
    cleanupBlobUrl();
    setPlayableSrc(null);
    setError(null);
    setVideoInfo(null);
    setIsBlobUrl(false);

    if (!source) {
      setError('未找到视频源数据');
      setLoading(false);
      return;
    }

    if (isNonWebContainer) {
      setError(`当前视频为 ${extension} 封装格式，浏览器内置内核暂不支持直接硬件解码，建议下载到本地使用系统播放器观看。`);
      setLoading(false);
      return;
    }

    setLoading(true);

    // Case 1: Data URL (Base64) — Convert to Blob URL
    // Chromium cannot stream or seek directly from data: URIs in <video>
    if (source.startsWith('data:')) {
      try {
        const commaIdx = source.indexOf(',');
        const header = source.slice(0, commaIdx);
        const b64 = source.slice(commaIdx + 1);
        const mime = header.match(/:(.*?);/)?.[1] || type || 'video/mp4';

        const binaryStr = atob(b64);
        const len = binaryStr.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }

        const blob = new Blob([bytes], { type: mime });
        const blobUrl = URL.createObjectURL(blob);
        createdBlobUrlRef.current = blobUrl;
        setPlayableSrc(blobUrl);
        setIsBlobUrl(true);
        setLoading(false);
      } catch (err: any) {
        console.error('Failed to parse base64 video data', err);
        setError('视频数据解析失败，请尝试下载后查看');
        setLoading(false);
      }
      return;
    }

    // Case 2: HTTP(S) URL or local file server stream
    setPlayableSrc(source);
    setLoading(false);
  }, [source, name, type, isNonWebContainer, extension]);

  // Fallback: If direct streaming fails on HTTP URL, attempt to fetch as Blob
  const handleStreamingError = async () => {
    if (!source || isBlobUrl || isNonWebContainer) {
      const code = videoRef.current?.error?.code;
      if (code === 4 || code === 3) {
        setError(`该视频文件的编码（如 H.265/HEVC、ProRes 等）无法在当前浏览器内核中直接播放，建议下载后使用本地播放器观看。`);
      } else {
        setError('视频加载播放失败，请直接下载后查看');
      }
      return;
    }

    // Attempt blob fetch fallback
    try {
      setLoading(true);
      const res = await fetch(source);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      cleanupBlobUrl();
      createdBlobUrlRef.current = blobUrl;
      setPlayableSrc(blobUrl);
      setIsBlobUrl(true);
      setError(null);
    } catch (err: any) {
      console.warn('Video fallback fetch also failed', err);
      setError(`视频流加载异常或编码不兼容，建议直接下载到本地观看。`);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadedMetadata = () => {
    const el = videoRef.current;
    if (el) {
      setVideoInfo({
        width: el.videoWidth,
        height: el.videoHeight,
        duration: Math.round(el.duration),
      });
    }
  };

  const formatDuration = (seconds: number) => {
    if (isNaN(seconds) || seconds <= 0) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className={`relative flex h-full w-full flex-col items-center justify-center p-4 sm:p-6 bg-canvas ${className}`}>
      {loading && (
        <div className="flex flex-col items-center justify-center text-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-feature mb-3" />
          <p className="text-xs text-sub">正在准备视频流播放缓冲...</p>
        </div>
      )}

      {error ? (
        <div className="flex max-w-md flex-col items-center justify-center text-center p-6 rounded-2xl border border-edge bg-surface/90 shadow-popover animate-in zoom-in-95 duration-150">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 text-warning border border-amber-500/20">
            <Film className="h-7 w-7" />
          </div>

          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-subtle/80 bg-card/80 px-2.5 py-0.5 text-[10px] font-mono font-semibold text-sub">
            <span>{extension} 格式</span>
          </div>

          <h3 className="text-sm font-bold text-main mb-1.5">{name}</h3>
          <p className="text-xs text-sub leading-relaxed mb-5">{error}</p>

          <div className="flex items-center gap-3">
            {onDownload && (
              <button
                type="button"
                onClick={onDownload}
                className="theme-btn-primary flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold"
              >
                <Download className="h-3.5 w-3.5" />
                <span>下载到本地播放</span>
              </button>
            )}

            {!isNonWebContainer && (
              <button
                type="button"
                onClick={handleStreamingError}
                className="flex items-center gap-1.5 rounded-xl border border-subtle bg-card/80 px-3.5 py-2 text-xs font-semibold text-sub hover:text-main hover:border-edge transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>重试</span>
              </button>
            )}
          </div>
        </div>
      ) : playableSrc ? (
        <div className="relative flex max-h-full max-w-full flex-col items-center justify-center">
          <video
            ref={videoRef}
            src={playableSrc}
            controls
            playsInline
            crossOrigin="anonymous"
            onLoadedMetadata={handleLoadedMetadata}
            onError={handleStreamingError}
            className="max-h-[75vh] max-w-full rounded-2xl shadow-popover bg-black/80"
          />

          {videoInfo && videoInfo.width > 0 && (
            <div className="mt-2.5 flex items-center gap-3 text-[11px] font-mono text-quiet">
              <span>分辨率: {videoInfo.width} × {videoInfo.height}</span>
              <span>·</span>
              <span>时长: {formatDuration(videoInfo.duration)}</span>
              {isBlobUrl && (
                <>
                  <span>·</span>
                  <span className="text-success/90">内存缓冲加速</span>
                </>
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
};
