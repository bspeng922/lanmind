/**
 * OpticalTransferApp — Screen/Camera Optical File Transfer Interface.
 *
 * CALLING SPEC:
 *   Mounted by optical-transfer-main.tsx within ThemeProvider.
 *   Provides offline file encoding/QR display (sender) and camera/video decode (receiver).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  Download,
  FileUp,
  Pause,
  Upload,
} from 'lucide-react';
import { readQrBytes } from './core/qr';
import { OpticalReceiverSession, type ReceiverProgress } from './core/receive';
import { scanVideoFile } from './sources/video';
import { scanImageFile } from './sources/image';
import { createOpticalObjectStore } from './storage/objectStore';
import { OpticalTitleBar } from './OpticalTitleBar';
import { SenderPanel } from './SenderPanel';
import './optical.css';

type Tab = 'send' | 'receive';

const EMPTY_PROGRESS: ReceiverProgress = {
  descriptor: false,
  manifest: false,
  blocks: 0,
  totalBlocks: 0,
  verifiedBytes: 0,
  totalBytes: 0,
  complete: false,
  needsPassword: false,
  fileName: undefined,
};

function formatBytes(value: number): string {
  if (!Number.isFinite(value)) return '-';
  if (value < 1024) return value.toFixed(0) + ' B';
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KiB';
  if (value < 1024 * 1024 * 1024) return (value / 1024 / 1024).toFixed(1) + ' MiB';
  return (value / 1024 / 1024 / 1024).toFixed(2) + ' GiB';
}

function percent(current: number, total: number): number {
  return total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
}

const CAMERA_START_TIMEOUT = 15_000;

function cameraErrorMessage(cause: unknown): string {
  const name = cause instanceof DOMException ? cause.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return '摄像头权限被拒绝，请在系统和应用设置中允许摄像头访问。';
  if (name === 'NotFoundError') return '没有检测到可用摄像头设备。';
  if (name === 'NotReadableError' || name === 'TrackStartError' || /timeout starting video source|could not start video source/i.test(cause instanceof Error ? cause.message : '')) return '摄像头启动超时或已被其他应用占用，请关闭占用摄像头的程序后重试。';
  if (name === 'OverconstrainedError') return '摄像头不支持当前分辨率，已切换兼容模式。';
  if (name === 'OpticalCameraTimeout') return '摄像头启动超时。请确认摄像头未被其他程序占用，或改用“导入图片/录像”接收。';
  return cause instanceof Error ? cause.message : '无法打开摄像头或权限被拒绝。';
}

async function requestCamera(constraints: MediaStreamConstraints): Promise<MediaStream> {
  const request = navigator.mediaDevices.getUserMedia(constraints);
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = globalThis.setTimeout(() => {
      void request.then((stream) => stream.getTracks().forEach((track) => track.stop())).catch(() => undefined);
      const error = new DOMException('camera start timeout', 'OpticalCameraTimeout');
      reject(error);
    }, CAMERA_START_TIMEOUT);
  });
  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timer !== undefined) globalThis.clearTimeout(timer);
  }
}

async function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = globalThis.setTimeout(() => reject(new Error(message)), CAMERA_START_TIMEOUT); }),
    ]);
  } finally {
    if (timer !== undefined) globalThis.clearTimeout(timer);
  }
}

export default function OpticalTransferApp() {
  const receiverOnly = typeof window !== 'undefined' && window.location.pathname.includes('/receiver');
  const [tab, setTab] = useState<Tab>(() => (receiverOnly ? 'receive' : 'send'));

  return (
    <main className="optical-shell">
      <OpticalTitleBar tab={tab} onTabChange={setTab} receiverOnly={receiverOnly} />
      {tab === 'send' ? <SenderPanel /> : <ReceiverPanel />}
    </main>
  );
}

function ReceiverPanel() {
  const [progress, setProgress] = useState<ReceiverProgress>(EMPTY_PROGRESS);
  const [password, setPassword] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ blob: Blob; name: string; mime: string } | null>(null);
  const [stageSource, setStageSource] = useState<'none' | 'camera' | 'video' | 'image'>('none');
  const [stageStatus, setStageStatus] = useState('');
  const [stageProgress, setStageProgress] = useState(0);
  const sessionRef = useRef(new OpticalReceiverSession());
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  const drawPreview = useCallback((source: CanvasImageSource) => {
    const preview = previewCanvasRef.current;
    if (!preview) return;
    const w = (source as { width?: number; naturalWidth?: number }).naturalWidth ?? (source as { width?: number }).width ?? 640;
    const h = (source as { height?: number; naturalHeight?: number }).naturalHeight ?? (source as { height?: number }).height ?? 480;
    if (preview.width !== w || preview.height !== h) {
      preview.width = w;
      preview.height = h;
    }
    const context = preview.getContext('2d');
    if (context) {
      context.drawImage(source, 0, 0, w, h);
    }
  }, []);

  const clearPreviewStage = useCallback(() => {
    const preview = previewCanvasRef.current;
    if (preview) {
      const context = preview.getContext('2d');
      if (context) context.clearRect(0, 0, preview.width, preview.height);
    }
    setStageProgress(0);
    setStageStatus('');
  }, []);

  useEffect(() => {
    let active = true;
    void createOpticalObjectStore().then((store) => {
      if (active) sessionRef.current = new OpticalReceiverSession(store);
    });
    return () => {
      active = false;
    };
  }, []);

  const videoRef = useRef<HTMLVideoElement>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);

  const consume = useCallback(async (bytes: Uint8Array[]) => {
    for (const packet of bytes) {
      try {
        setProgress(await sessionRef.current.pushPacketBytes(packet));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    }
  }, []);

  const scanFrame = useCallback(async () => {
    if (!videoRef.current || !frameCanvasRef.current || busyRef.current || videoRef.current.readyState < 2) {
      return;
    }
    busyRef.current = true;
    try {
      const video = videoRef.current;
      const canvas = frameCanvasRef.current;
      canvas.width = Math.min(video.videoWidth, 1600);
      canvas.height = Math.round((canvas.width * video.videoHeight) / Math.max(1, video.videoWidth));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        await consume(await readQrBytes(context.getImageData(0, 0, canvas.width, canvas.height)));
      }
    } finally {
      busyRef.current = false;
    }
  }, [consume]);

  useEffect(() => {
    if (!cameraOn) return undefined;
    timerRef.current = window.setInterval(() => void scanFrame(), 160);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [cameraOn, scanFrame]);

  const stopCamera = useCallback(() => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
    setStageSource('none');
    setStageStatus('');
  }, []);

  const startCamera = async () => {
    setError('');
    clearPreviewStage();
    setStageSource('camera');
    setStageStatus('正在连接摄像头...');
    try {
      if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        throw new Error('浏览器仅允许在 HTTPS 或 localhost 页面使用摄像头，请改用 HTTPS/localhost 或导入录像。');
      }
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前环境不支持摄像头，请使用 HTTPS/localhost 或导入录像。');

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }

      const isMobile = typeof navigator !== 'undefined' && /mobile|android|iphone|ipad/i.test(navigator.userAgent);
      let videoDevices: MediaDeviceInfo[] = [];
      try {
        if (navigator.mediaDevices?.enumerateDevices) {
          const allDevices = await navigator.mediaDevices.enumerateDevices();
          videoDevices = allDevices.filter((d) => d.kind === 'videoinput');
        }
      } catch {
        // ignore device enumeration errors
      }

      const candidates: MediaStreamConstraints[] = [
        ...(isMobile ? [{ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }] : []),
        { video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
        { video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
        { video: true, audio: false },
      ];

      for (const dev of videoDevices) {
        if (!dev.deviceId) continue;
        const label = (dev.label || '').toLowerCase();
        if (label.includes('ir') || label.includes('depth') || label.includes('face')) continue;
        candidates.push({
          video: { deviceId: { exact: dev.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        candidates.push({
          video: { deviceId: { exact: dev.deviceId } },
          audio: false,
        });
      }

      let lastError: unknown;
      for (const constraints of candidates) {
        try {
          streamRef.current = await requestCamera(constraints);
          break;
        } catch (cause) {
          lastError = cause;
          streamRef.current?.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
          const name = cause instanceof DOMException ? cause.name : '';
          if (name === 'NotAllowedError' || name === 'SecurityError') break;
        }
      }
      if (!streamRef.current) throw lastError ?? new Error('无法打开摄像头');
      if (videoRef.current) {
        videoRef.current.srcObject = streamRef.current;
        try {
          await videoRef.current.play();
        } catch (playErr) {
          console.warn('video.play() deferred:', playErr);
        }
      }
      setCameraOn(true);
      setStageStatus('');
      setStageProgress(0);
    } catch (cause) {
      stopCamera();
      setError(cameraErrorMessage(cause));
    }
  };

  useEffect(() => () => stopCamera(), [stopCamera]);

  const applyPassword = async () => {
    try {
      setProgress(await sessionRef.current.setPassword(password));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const importVideo = async (file: File) => {
    stopCamera();
    clearPreviewStage();
    setStageSource('video');
    setScanning(true);
    setError('');
    setStageProgress(0);
    setStageStatus(`正在解析录像: ${file.name}`);
    let packetsFound = 0;
    try {
      await scanVideoFile(file, sessionRef.current, {
        onFrame: (timestamp, ratio, frameCanvas) => {
          drawPreview(frameCanvas);
          const percent = Math.min(100, Math.round(ratio * 100));
          setStageProgress(percent);
          const m = Math.floor(timestamp / 60);
          const s = Math.floor(timestamp % 60);
          const timeStr = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
          setStageStatus(`正在逐帧解析录像: ${percent}% (${timeStr})`);
        },
        onPacket: (count) => {
          packetsFound = count;
          setProgress(sessionRef.current.getProgress());
        },
      });
      setProgress(sessionRef.current.getProgress());
      setStageProgress(100);
      setStageStatus(packetsFound > 0 ? `录像解析完成 (已采集 ${packetsFound} 个包)` : '录像解析完成 (未检测到二维码)');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStageStatus('录像解析失败');
    } finally {
      setScanning(false);
    }
  };

  const importImage = async (file: File) => {
    stopCamera();
    clearPreviewStage();
    setStageSource('image');
    setError('');
    setStageProgress(0);
    setStageStatus(`正在解析图片: ${file.name}`);

    try {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        drawPreview(img);
        URL.revokeObjectURL(url);
      };
      img.src = url;
    } catch {
      // preview best effort
    }

    let packetsFound = 0;
    try {
      await scanImageFile(file, sessionRef.current, {
        onFrame: (index, total, frameCanvas) => {
          if (frameCanvas) drawPreview(frameCanvas);
          const percent = total > 1 ? Math.min(100, Math.round(((index + 1) / total) * 100)) : 100;
          setStageProgress(percent);
          if (total > 1) {
            setStageStatus(`正在逐帧解析动图: ${index + 1}/${total} (${percent}%)`);
          }
        },
        onPacket: (count) => {
          packetsFound = count;
          setProgress(sessionRef.current.getProgress());
        },
      });
      setProgress(sessionRef.current.getProgress());
      setStageProgress(100);
      setStageStatus(packetsFound > 0 ? `图片解析完成 (已采集 ${packetsFound} 个包)` : '图片解析完成 (未检测到二维码)');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStageStatus('图片解析失败');
    }
  };

  const saveFile = async () => {
    try {
      const suggestedName = sessionRef.current.getFileName() || progress.fileName || 'received-file';
      const picker = (window as unknown as {
        showSaveFilePicker?: (options?: unknown) => Promise<{
          createWritable(): Promise<{
            write(data: Uint8Array): Promise<void>;
            close(): Promise<void>;
            abort?(): Promise<void>;
          }>;
        }>;
      }).showSaveFilePicker;

      if (picker) {
        let handle;
        try {
          handle = await picker({
            suggestedName,
          });
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          throw err;
        }
        const output = await sessionRef.current.writeFile(await handle.createWritable());
        setResult({ blob: new Blob(), name: output.name || suggestedName, mime: output.mime });
      } else {
        const output = await sessionRef.current.buildFile();
        setResult(output);
        const url = URL.createObjectURL(output.blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = output.name || suggestedName;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const exportSession = () => {
    try {
      const blob = new Blob([sessionRef.current.exportCheckpoint()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'lanmind-optical-checkpoint.json';
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const importSession = async (file: File) => {
    try {
      setProgress(
        await sessionRef.current.importCheckpoint(
          new Uint8Array(await file.arrayBuffer()),
          password || undefined,
        ),
      );
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <section className="optical-workspace">
      {/* Left Column: Camera Viewfinder & Inputs */}
      <div className="optical-panel optical-receive-controls">
        <div className="optical-panel-heading">
          <div>
            <span className="optical-eyebrow">接收端</span>
            <h2>采集二维码帧</h2>
          </div>
          <Camera className="text-info" size={20} />
        </div>

        <div className="optical-camera-stage">
          <video
            ref={videoRef}
            className={stageSource === 'camera' ? 'is-active' : 'is-hidden'}
            muted
            playsInline
          />
          <canvas
            ref={previewCanvasRef}
            className={`optical-stage-preview ${stageSource === 'video' || stageSource === 'image' ? 'is-active' : 'is-hidden'}`}
          />
          <canvas ref={frameCanvasRef} className="optical-frame-buffer" />

          {stageSource === 'none' && (
            <div className="optical-stage-placeholder">
              <Camera size={34} style={{ opacity: 0.4 }} />
              <span>摄像头未开启</span>
              <small>点击“开始实时扫描”或导入录像/图片解析</small>
            </div>
          )}

          {stageSource !== 'none' && (
            <div className={`optical-camera-mark ${stageSource === 'camera' && !cameraOn ? 'is-connecting' : 'is-on'}`}>
              {stageSource === 'camera' && (cameraOn ? '● 正在实时扫描' : '● 正在连接摄像头...')}
              {stageSource === 'video' && `● ${stageStatus}`}
              {stageSource === 'image' && `● ${stageStatus}`}
            </div>
          )}

          {(stageSource === 'video' || (stageSource === 'image' && stageProgress < 100)) && stageProgress > 0 && (
            <div className="optical-stage-progress-bar">
              <div
                className="optical-stage-progress-fill"
                style={{ width: `${stageProgress}%` }}
              />
            </div>
          )}
        </div>

        <div className="optical-action-row">
          <button
            className="optical-primary"
            onClick={cameraOn ? stopCamera : () => void startCamera()}
          >
            {cameraOn ? (
              <>
                <Pause size={15} />
                <span>暂停摄像头</span>
              </>
            ) : (
              <>
                <Camera size={15} />
                <span>开始实时扫描</span>
              </>
            )}
          </button>

          <label className="optical-secondary">
            <Upload size={15} />
            <span>导入图片</span>
            <input
              type="file"
              accept="image/*"
              onChange={(event) => {
                const value = event.target.files?.[0];
                if (value) void importImage(value);
              }}
            />
          </label>

          <label className="optical-secondary">
            <FileUp size={15} />
            <span>导入录像</span>
            <input
              type="file"
              accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
              onChange={(event) => {
                const value = event.target.files?.[0];
                if (value) void importVideo(value);
              }}
            />
          </label>
        </div>

        {scanning && (
          <p className="optical-hint">正在逐帧解析录像中的二维码，识别出的包将即时装配进会话。</p>
        )}

        {progress.needsPassword && (
          <div className="optical-password">
            <label className="optical-field">
              <span>此传输受密码保护，请输入解密密码</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
            </label>
            <button className="optical-secondary" onClick={() => void applyPassword()}>
              验证密码
            </button>
          </div>
        )}

        {error && <p className="optical-error">{error}</p>}
      </div>

      {/* Right Column: Session Progress & Verification */}
      <div className="optical-panel optical-progress-panel">
        <div className="optical-panel-heading">
          <div>
            <span className="optical-eyebrow">本地会话</span>
            <h2>{progress.fileName || (progress.transferId ? `传输 ${progress.transferId.slice(0, 10)}...` : '等待控制帧')}</h2>
          </div>
          {progress.complete && <CheckCircle2 className="optical-success" size={22} />}
        </div>

        <div className="optical-progress-list">
          {progress.fileName && <ProgressRow label="目标文件" value={progress.fileName} />}
          <ProgressRow label="描述信息" value={progress.descriptor ? '已校验通过' : '等待接收'} />
          <ProgressRow label="文件清单" value={progress.manifest ? '已校验通过' : '等待接收'} />
          <ProgressRow label="数据分块" value={`${progress.blocks} / ${progress.totalBlocks || '-'}`} />
          <ProgressRow
            label="已验字节"
            value={`${formatBytes(progress.verifiedBytes)} / ${formatBytes(progress.totalBytes)}`}
          />
        </div>

        <div className="optical-progress-bar">
          <span
            style={{
              width: `${progress.totalBytes ? percent(progress.verifiedBytes, progress.totalBytes) : 0}%`,
            }}
          />
        </div>

        <div className="optical-action-row">
          <button
            className="optical-secondary"
            disabled={!progress.descriptor}
            onClick={exportSession}
          >
            导出会话 Checkpoint
          </button>
          <label className="optical-secondary">
            <span>导入会话</span>
            <input
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const value = event.target.files?.[0];
                if (value) void importSession(value);
              }}
            />
          </label>
        </div>

        <div className="mt-auto pt-3">
          {result && (
            <div className="optical-saved">
              <CheckCircle2 size={18} />
              <span>已完成全量完整性校验并保存：{result.name}</span>
            </div>
          )}
          <button
            className="optical-primary w-full"
            disabled={!progress.complete}
            onClick={() => void saveFile()}
          >
            <Download size={15} />
            <span>校验并保存文件</span>
          </button>
          <p className="optical-hint">
            数据在通过 SHA-256 和 CRC32C 校验前不会生成最终文件；隔离网络传输全程无需回传确认。
          </p>
        </div>
      </div>
    </section>
  );
}

function ProgressRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="optical-progress-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
