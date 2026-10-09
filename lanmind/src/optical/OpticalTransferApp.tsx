import { localizeMessage } from '../i18n/messages';
import { tr, useLocale } from "../i18n";
/**
 * OpticalTransferApp — Screen/Camera Optical File Transfer Interface.
 *
 * CALLING SPEC:
 *   Mounted by optical-transfer-main.tsx within ThemeProvider.
 *   Provides offline file encoding/QR display (sender) and camera/video decode (receiver).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { save as saveNative } from '@tauri-apps/plugin-dialog';
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
import { OpticalSessionStore } from './storage/sessionStore';
import { opticalApi } from '../services/opticalApi';
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
  status: 'waiting-control',
  persistent: false,
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
  if (name === 'NotAllowedError' || name === 'SecurityError') return tr("optical:opticalTransferApp.cameraAccessDeniedAllowAccessInYour");
  if (name === 'NotFoundError') return tr("optical:opticalTransferApp.noCameraFound");
  if (name === 'NotReadableError' || name === 'TrackStartError' || /timeout starting video source|could not start video source/i.test(cause instanceof Error ? cause.message : '')) return tr("optical:opticalTransferApp.theCameraTimedOutOrIsIn");
  if (name === 'OverconstrainedError') return tr("optical:opticalTransferApp.unsupportedResolutionUsingCompatibilityMode");
  if (name === 'OpticalCameraTimeout') return tr("optical:opticalTransferApp.cameraTimedOutCheckIfItIs");
  return cause instanceof Error ? cause.message : tr("optical:opticalTransferApp.couldNotOpenCameraOrAccessWas");
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
  useLocale();
  const receiverOnly = typeof window !== 'undefined' && window.location.pathname.includes('/receiver');
  const [tab, setTab] = useState<Tab>(() => (receiverOnly ? 'receive' : 'send'));

  return (
    <main className="optical-shell">
      <OpticalTitleBar tab={tab} onTabChange={setTab} receiverOnly={receiverOnly} />
      {!receiverOnly && (
        <div className="optical-view" hidden={tab !== 'send'}>
          <SenderPanel active={tab === 'send'} />
        </div>
      )}
      <div className="optical-view" hidden={tab !== 'receive'}>
        <ReceiverPanel active={tab === 'receive'} />
      </div>
    </main>
  );
}

function ReceiverPanel({ active }: { active: boolean }) {
  useLocale();
  const [progress, setProgress] = useState<ReceiverProgress>(EMPTY_PROGRESS);
  const [password, setPassword] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ blob: Blob; name: string; mime: string } | null>(null);
  const [stageSource, setStageSource] = useState<'none' | 'camera' | 'video' | 'image'>('none');
  const [stageStatus, setStageStatus] = useState('');
  const [stageProgress, setStageProgress] = useState(0);
  const [storageReady, setStorageReady] = useState(false);
  const [hasRecovery, setHasRecovery] = useState(false);
  const sessionRef = useRef<OpticalReceiverSession | null>(null);
  const importAbortRef = useRef<AbortController | null>(null);
  const cameraRequestRef = useRef(0);
  const previewEpochRef = useRef(0);
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
    previewEpochRef.current += 1;
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
    void createOpticalObjectStore().then(async (store) => {
      if (!active) return;
      sessionRef.current = new OpticalReceiverSession(store);
      setHasRecovery(Boolean(await new OpticalSessionStore(store).latest()));
      setStorageReady(true);
    });
    return () => {
      active = false;
      importAbortRef.current?.abort();
      sessionRef.current?.dispose();
    };
  }, []);

  const videoRef = useRef<HTMLVideoElement>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);

  const consume = useCallback(async (bytes: Uint8Array[]) => {
    const session = sessionRef.current;
    if (!session) return;
    for (const packet of bytes) {
      try {
        const next = await session.pushPacketBytes(packet);
        setProgress(next);
        if (next.descriptor && next.persistent) setHasRecovery(true);
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
    cameraRequestRef.current += 1;
    if (timerRef.current) window.clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
    setStageSource('none');
    setStageStatus('');
  }, []);

  useEffect(() => {
    if (active) return;
    stopCamera();
    importAbortRef.current?.abort();
  }, [active, stopCamera]);

  const startCamera = async () => {
    const requestId = ++cameraRequestRef.current;
    setError('');
    clearPreviewStage();
    setStageSource('camera');
    setStageStatus(tr("optical:opticalTransferApp.connectingToCamera"));
    try {
      if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        throw new Error(tr("optical:opticalTransferApp.cameraAccessRequiresHttpsOrLocalhostUse"));
      }
      if (!navigator.mediaDevices?.getUserMedia) throw new Error(tr("optical:opticalTransferApp.cameraUnavailableInThisEnvironmentUseHttps"));

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
          const stream = await requestCamera(constraints);
          if (requestId !== cameraRequestRef.current) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          streamRef.current = stream;
          break;
        } catch (cause) {
          lastError = cause;
          streamRef.current?.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
          const name = cause instanceof DOMException ? cause.name : '';
          if (name === 'NotAllowedError' || name === 'SecurityError') break;
        }
      }
      if (requestId !== cameraRequestRef.current) return;
      if (!streamRef.current) throw lastError ?? new Error(tr("optical:opticalTransferApp.couldNotOpenCamera"));
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
      if (requestId !== cameraRequestRef.current) return;
      stopCamera();
      setError(cameraErrorMessage(cause));
    }
  };

  useEffect(() => () => stopCamera(), [stopCamera]);

  const applyPassword = async () => {
    try {
      if (!sessionRef.current) return;
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
    setStageStatus(tr("optical:opticalTransferApp.readingRecording", { value0: file.name }));
    let packetsFound = 0;
    importAbortRef.current?.abort();
    const controller = new AbortController();
    importAbortRef.current = controller;
    try {
      if (!sessionRef.current) throw new Error(tr("optical:opticalTransferApp.receiverStorageIsNotReady"));
      await scanVideoFile(file, sessionRef.current, {
        signal: controller.signal,
        onFrame: (timestamp, ratio, frameCanvas) => {
          if (controller.signal.aborted) return;
          drawPreview(frameCanvas);
          const percent = Math.min(100, Math.round(ratio * 100));
          setStageProgress(percent);
          const m = Math.floor(timestamp / 60);
          const s = Math.floor(timestamp % 60);
          const timeStr = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
          setStageStatus(tr("optical:opticalTransferApp.readingRecording2", { value0: percent, value1: timeStr }));
        },
        onPacket: (count) => {
          if (controller.signal.aborted) return;
          packetsFound = count;
          if (sessionRef.current) setProgress(sessionRef.current.getProgress());
        },
      });
      if (sessionRef.current) setProgress(sessionRef.current.getProgress());
      setStageProgress(100);
      setStageStatus(packetsFound > 0 ? tr("optical:opticalTransferApp.recordingProcessedPackets", { value0: packetsFound }) : tr("optical:opticalTransferApp.recordingProcessedNoQrCodesFound"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStageStatus(tr("optical:opticalTransferApp.couldNotProcessRecording"));
    } finally {
      if (importAbortRef.current === controller) importAbortRef.current = null;
      setScanning(false);
    }
  };

  const importImage = async (file: File) => {
    stopCamera();
    clearPreviewStage();
    setStageSource('image');
    setError('');
    setStageProgress(0);
    setStageStatus(tr("optical:opticalTransferApp.readingImage", { value0: file.name }));

    try {
      const img = new Image();
      const url = URL.createObjectURL(file);
      const previewEpoch = previewEpochRef.current;
      img.onload = () => {
        if (previewEpoch === previewEpochRef.current) drawPreview(img);
        URL.revokeObjectURL(url);
      };
      img.onerror = () => URL.revokeObjectURL(url);
      img.src = url;
    } catch {
      // preview best effort
    }

    let packetsFound = 0;
    importAbortRef.current?.abort();
    const controller = new AbortController();
    importAbortRef.current = controller;
    try {
      if (!sessionRef.current) throw new Error(tr("optical:opticalTransferApp.receiverStorageIsNotReady"));
      await scanImageFile(file, sessionRef.current, {
        signal: controller.signal,
        onFrame: (index, total, frameCanvas) => {
          if (controller.signal.aborted) return;
          if (frameCanvas) drawPreview(frameCanvas);
          const percent = total > 1 ? Math.min(100, Math.round(((index + 1) / total) * 100)) : 100;
          setStageProgress(percent);
          if (total > 1) {
            setStageStatus(tr("optical:opticalTransferApp.readingAnimation", { value0: index + 1, value1: total, value2: percent }));
          }
        },
        onPacket: (count) => {
          if (controller.signal.aborted) return;
          packetsFound = count;
          if (sessionRef.current) setProgress(sessionRef.current.getProgress());
        },
      });
      if (sessionRef.current) setProgress(sessionRef.current.getProgress());
      setStageProgress(100);
      setStageStatus(packetsFound > 0 ? tr("optical:opticalTransferApp.imageProcessedPackets", { value0: packetsFound }) : tr("optical:opticalTransferApp.imageProcessedNoQrCodesFound"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStageStatus(tr("optical:opticalTransferApp.couldNotProcessImage"));
    } finally {
      if (importAbortRef.current === controller) importAbortRef.current = null;
    }
  };

  const saveFile = async () => {
    try {
      const session = sessionRef.current;
      if (!session) return;
      const suggestedName = session.getFileName() || progress.fileName || 'received-file';
      if (opticalApi.available()) {
        const target = await saveNative({ defaultPath: suggestedName });
        if (!target) return;
        const outputId = await opticalApi.beginOutput(target);
        try {
          const output = await session.writeFile({
            write: (data) => opticalApi.writeOutput(outputId, data),
            close: async () => { await opticalApi.finalizeOutput(outputId); },
            abort: () => opticalApi.abortOutput(outputId),
          });
          setResult({ blob: new Blob(), name: output.name || suggestedName, mime: output.mime });
        } catch (error) {
          await opticalApi.abortOutput(outputId);
          throw error;
        }
        return;
      }
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
        const output = await session.writeFile(await handle.createWritable());
        setResult({ blob: new Blob(), name: output.name || suggestedName, mime: output.mime });
      } else {
        const output = await session.buildFile();
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

  const restoreSession = async () => {
    try {
      if (!sessionRef.current) return;
      setProgress(await sessionRef.current.restoreLatest(password || undefined));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const abandonSession = async () => {
    try {
      await sessionRef.current?.abandon();
      setProgress(EMPTY_PROGRESS);
      setHasRecovery(false);
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
            <span className="optical-eyebrow">{tr("optical:opticalTransferApp.receiver")}</span>
            <h2>{tr("optical:opticalTransferApp.scanQrFrames")}</h2>
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
              <span>{tr("optical:opticalTransferApp.cameraIsOff")}</span>
              <small>{tr("optical:opticalTransferApp.startScanningOrImportARecordingOr")}</small>
            </div>
          )}

          {stageSource !== 'none' && (
            <div className={`optical-camera-mark ${stageSource === 'camera' && !cameraOn ? 'is-connecting' : 'is-on'}`}>
              {stageSource === 'camera' && (cameraOn ? tr("optical:opticalTransferApp.scanning") : tr("optical:opticalTransferApp.connectingToCamera2"))}
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
            disabled={!storageReady}
            onClick={cameraOn ? stopCamera : () => void startCamera()}
          >
            {cameraOn ? (
              <>
                <Pause size={15} />
                <span>{tr("optical:opticalTransferApp.pauseCamera")}</span>
              </>
            ) : (
              <>
                <Camera size={15} />
                <span>{tr("optical:opticalTransferApp.startScanning")}</span>
              </>
            )}
          </button>

          <label className="optical-secondary">
            <Upload size={15} />
            <span>{tr("optical:opticalTransferApp.importImage")}</span>
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
            <span>{tr("optical:opticalTransferApp.importRecording")}</span>
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
          <p className="optical-hint">{tr("optical:opticalTransferApp.scanningTheRecordingFrameByFramePackets")}</p>
        )}

        {progress.needsPassword && (
          <div className="optical-password">
            <label className="optical-field">
              <span>{tr("optical:opticalTransferApp.thisTransferIsPasswordProtectedEnterIts")}</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
            </label>
            <button className="optical-secondary" onClick={() => void applyPassword()}>
              {tr("optical:opticalTransferApp.verifyPassword")}</button>
          </div>
        )}

        {error && <p className="optical-error">{localizeMessage(error)}</p>}
      </div>

      {/* Right Column: Session Progress & Verification */}
      <div className="optical-panel optical-progress-panel">
        <div className="optical-panel-heading">
          <div>
            <span className="optical-eyebrow">{tr("optical:opticalTransferApp.localSession")}</span>
            <h2>{progress.fileName || (progress.transferId ? tr("optical:opticalTransferApp.transfer", { value0: progress.transferId.slice(0, 10) }) : tr("optical:opticalTransferApp.waitingForControlFrame"))}</h2>
          </div>
          {progress.complete && <CheckCircle2 className="optical-success" size={22} />}
        </div>

        <div className="optical-progress-list">
          {progress.fileName && <ProgressRow label={tr("optical:opticalTransferApp.targetFile")} value={progress.fileName} />}
          <ProgressRow label={tr("optical:opticalTransferApp.description")} value={progress.descriptor ? tr("optical:opticalTransferApp.verified") : tr("optical:opticalTransferApp.waiting")} />
          <ProgressRow label={tr("optical:opticalTransferApp.fileList")} value={progress.manifest ? tr("optical:opticalTransferApp.verified") : tr("optical:opticalTransferApp.waiting")} />
          <ProgressRow label={tr("optical:opticalTransferApp.dataBlocks")} value={`${progress.blocks} / ${progress.totalBlocks || '-'}`} />
          <ProgressRow
            label={tr("optical:opticalTransferApp.verifiedBytes")}
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
            disabled={!storageReady || !hasRecovery}
            onClick={() => void restoreSession()}
          >
            {tr("optical:opticalTransferApp.resumeLastReception")}</button>
          <button className="optical-secondary" disabled={!progress.descriptor && !hasRecovery} onClick={() => void abandonSession()}>
            {tr("optical:opticalTransferApp.discardAndClear")}</button>
        </div>

        <div className="mt-auto pt-3">
          {result && (
            <div className="optical-saved">
              <CheckCircle2 size={18} />
              <span>{tr("optical:opticalTransferApp.verifiedAndSaved", { value0: result.name })}</span>
            </div>
          )}
          <button
            className="optical-primary w-full"
            disabled={!progress.complete}
            onClick={() => void saveFile()}
          >
            <Download size={15} />
            <span>{tr("optical:opticalTransferApp.verifyAndSave")}</span>
          </button>
          <p className="optical-hint">
            {tr("optical:opticalTransferApp.finalFilesAreCreatedOnlyAfterIntegrity")}</p>
        </div>
      </div>
    </section>
  );
}

function ProgressRow({ label, value }: { label: string; value: string }) {
  useLocale();
  return (
    <div className="optical-progress-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
