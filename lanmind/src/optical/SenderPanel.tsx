/**
 * SenderPanel — Optical QR Code Sender Component.
 *
 * CALLING SPEC:
 *   <SenderPanel />
 *   Renders file selector, offline preparation pipeline, and high-speed QR player.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  FileUp,
  Pause,
  Play,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  Square,
} from 'lucide-react';
import { matrixToCanvas, renderQrMatrix } from './core/qr';
import { prepareOpticalTransfer, createTransferPacketSource, type TransferPacketSource } from './sender';
import { MAX_FILE_SIZE, RECOMMENDED_FILE_SIZE, type PreparedTransfer } from './core/types';

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

export function SenderPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [transfer, setTransfer] = useState<PreparedTransfer | null>(null);
  const [packetSource, setPacketSource] = useState<TransferPacketSource | null>(null);
  const [packet, setPacket] = useState<Uint8Array | null>(null);
  const [packetCount, setPacketCount] = useState(0);
  const [packetIndex, setPacketIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [prepareProgress, setPrepareProgress] = useState(0);
  const [preparePhase, setPreparePhase] = useState('读取并压缩文件');
  const [error, setError] = useState('');
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    if (!packet || !canvasRef.current) return undefined;
    renderQrMatrix(packet, 40, 1)
      .then((matrix) => {
        if (cancelled || !canvasRef.current) return;
        const canvas = matrixToCanvas(matrix, 4, 4);
        canvas.className = 'optical-qr-canvas';
        canvasRef.current.replaceChildren(canvas);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    return () => {
      cancelled = true;
    };
  }, [packet]);

  useEffect(() => {
    let cancelled = false;
    if (!packetSource || packetCount === 0) {
      setPacket(null);
      return undefined;
    }
    packetSource
      .get(packetIndex)
      .then((value) => {
        if (!cancelled) setPacket(value);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [packetIndex, packetCount, packetSource]);

  useEffect(() => {
    if (!playing || packetCount === 0) return undefined;
    const timer = window.setInterval(
      () => setPacketIndex((index) => (index + 1) % packetCount),
      120,
    );
    return () => window.clearInterval(timer);
  }, [playing, packetCount]);

  const prepare = async () => {
    if (!file) return;
    setPreparing(true);
    setError('');
    setPrepareProgress(0);
    setPreparePhase('读取并压缩文件');
    setTransfer(null);
    setPacketSource(null);
    setPacket(null);
    setPacketCount(0);
    setPlaying(false);
    try {
      const next = await prepareOpticalTransfer(file, {
        password: password || undefined,
        fileName: file.name,
        mime: file.type,
        onProgress: (current, total) => {
          setPrepareProgress(percent(current, total));
          setPreparePhase(`压缩第 ${current}/${total} 块`);
        },
      });
      setPreparePhase('生成二维码数据');
      const source = createTransferPacketSource(next);
      setTransfer(next);
      setPacketSource(source);
      setPacketCount(source.length);
      setPacketIndex(0);
      setPlaying(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPreparing(false);
    }
  };

  return (
    <section className="optical-workspace">
      {/* Left Column: Send Config & Actions */}
      <div className="optical-panel optical-send-controls">
        <div className="optical-panel-heading">
          <div>
            <span className="optical-eyebrow">发送端</span>
            <h2>准备一份冻结传输</h2>
          </div>
          <ShieldCheck className="text-info" size={20} />
        </div>

        <label className="optical-dropzone">
          <FileUp size={24} className="text-accent" />
          <span>{file ? file.name : '选择要发送的文件'}</span>
          <small>
            {file
              ? `${formatBytes(file.size)} · ${file.type || 'application/octet-stream'}`
              : '文件内容不会上传到网络，纯本地生成二维码'}
          </small>
          <input
            type="file"
            onChange={(event) => {
              const next = event.target.files?.[0] ?? null;
              if (next && next.size > MAX_FILE_SIZE) {
                setFile(null);
                setError('文件超过 1 GiB 硬上限，无法通过光学传输。');
                return;
              }
              setFile(next);
              setError(
                next && next.size > RECOMMENDED_FILE_SIZE
                  ? '文件超过建议大小 10 MiB，仍可传输但二维码播放时间会明显增加。'
                  : '',
              );
            }}
          />
        </label>
        <p className="optical-hint optical-file-limit">
          建议文件不超过 10 MiB，最大支持 1 GiB；光学传输速度取决于屏幕、摄像头和拍摄距离。
        </p>

        <label className="optical-field">
          <span>传输密码（可选）</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="启用 AES-256-GCM 加密保护"
            autoComplete="new-password"
          />
        </label>

        <button
          className="optical-primary"
          disabled={!file || preparing}
          onClick={() => void prepare()}
        >
          {preparing ? `${preparePhase} ${prepareProgress}%` : '准备并生成二维码'}
        </button>

        {error && <p className="optical-error">{error}</p>}

        {transfer && (
          <div className="optical-summary">
            <div>
              <span>文件名称</span>
              <strong>{transfer.manifest.fileName}</strong>
            </div>
            <div>
              <span>原始大小</span>
              <strong>{formatBytes(Number(transfer.descriptor.originalSize))}</strong>
            </div>
            <div>
              <span>分块总数</span>
              <strong>{transfer.blocks.length} 块</strong>
            </div>
            <div>
              <span>安全模式</span>
              <strong>{transfer.descriptor.cryptoSuite ? 'AES-256 加密' : '明文传输'}</strong>
            </div>
          </div>
        )}
      </div>

      {/* Right Column: QR Code Display & Player Controls */}
      <div className="optical-panel optical-player">
        <div className="optical-panel-heading">
          <div>
            <span className="optical-eyebrow">屏幕载体</span>
            <h2>{packetCount ? `第 ${packetIndex + 1} / ${packetCount} 帧` : '等待准备'}</h2>
          </div>
          <span className={playing ? 'optical-live' : 'optical-idle'}>
            {playing ? '● 播放中' : '已暂停'}
          </span>
        </div>

        <div className="optical-qr-stage" ref={canvasRef}>
          {!packetCount && (
            <div className="optical-qr-placeholder">
              <ScanLine size={40} className="text-sub/60" />
              <span>准备完成后，高速动态二维码会在此处连续播放</span>
            </div>
          )}
        </div>

        <div className="optical-player-actions">
          <button
            title="上一帧"
            disabled={!packetCount}
            onClick={() => setPacketIndex((index) => (index - 1 + packetCount) % packetCount)}
          >
            <RotateCcw size={15} />
            <span>上一帧</span>
          </button>
          <button
            className="optical-primary optical-play"
            disabled={!packetCount}
            onClick={() => setPlaying((value) => !value)}
          >
            {playing ? <Pause size={15} /> : <Play size={15} />}
            <span>{playing ? '暂停' : '连续播放'}</span>
          </button>
          <button
            title="重置到第一帧"
            disabled={!packetCount}
            onClick={() => {
              setPlaying(false);
              setPacketIndex(0);
            }}
          >
            <Square size={15} />
            <span>停止</span>
          </button>
        </div>

        <p className="optical-hint">
          请保持二维码完整显示。接收端支持从中途任意帧切入并自动补齐丢包，全程单向离线传输。
        </p>
      </div>
    </section>
  );
}
