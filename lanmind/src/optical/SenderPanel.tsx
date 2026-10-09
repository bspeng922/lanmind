import { localizeMessage } from '../i18n/messages';
import { tr, useLocale } from "../i18n";
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
import { preflightTransferCapacity } from './core/capacity';
import { OpticalSessionController } from './core/sessionController';
import { QUICK_TRANSFER_SIZE, RECOMMENDED_TRANSFER_SIZE, type PreparedTransfer } from './core/types';

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

export function SenderPanel({ active = true }: { active?: boolean }) {
  useLocale();
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
  const [preparePhase, setPreparePhase] = useState(tr("optical:senderPanel.readingAndCompressingFile"));
  const [error, setError] = useState('');
  const canvasRef = useRef<HTMLDivElement>(null);
  const sessionController = useRef(new OpticalSessionController());

  useEffect(() => () => sessionController.current.dispose(), []);
  useEffect(() => {
    if (!active) sessionController.current.cancel();
  }, [active]);

  useEffect(() => {
    let cancelled = false;
    if (!packet || !canvasRef.current) return undefined;
    renderQrMatrix(packet, 40, 1)
      .then((matrix) => {
        if (cancelled || !canvasRef.current) return;
        const canvas = matrixToCanvas(matrix, 4, 4);
        canvas.className = 'optical-qr-canvas';
        canvasRef.current.replaceChildren(canvas);
        if (active && playing && packetCount > 0) {
          window.setTimeout(() => {
            if (!cancelled) setPacketIndex((index) => (index + 1) % packetCount);
          }, 120);
        }
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    return () => {
      cancelled = true;
    };
  }, [active, packet, packetCount, playing]);

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

  const prepare = async () => {
    if (!file) return;
    const request = sessionController.current.begin();
    setPreparing(true);
    setError('');
    setPrepareProgress(0);
    setPreparePhase(tr("optical:senderPanel.readingAndCompressingFile"));
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
        signal: request.signal,
        onProgress: (current, total) => {
          if (!sessionController.current.isCurrent(request.epoch)) return;
          setPrepareProgress(percent(current, total));
          setPreparePhase(tr("optical:senderPanel.compressingBlock", { value0: current, value1: total }));
        },
      });
      if (!sessionController.current.isCurrent(request.epoch)) return;
      setPreparePhase(tr("optical:senderPanel.generatingQrData"));
      const source = createTransferPacketSource(next);
      setTransfer(next);
      setPacketSource(source);
      setPacketCount(source.length);
      setPacketIndex(0);
      setPlaying(true);
    } catch (cause) {
      if (!sessionController.current.isCurrent(request.epoch) || (cause instanceof DOMException && cause.name === 'AbortError')) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (sessionController.current.isCurrent(request.epoch)) setPreparing(false);
    }
  };

  return (
    <section className="optical-workspace">
      {/* Left Column: Send Config & Actions */}
      <div className="optical-panel optical-send-controls">
        <div className="optical-panel-heading">
          <div>
            <span className="optical-eyebrow">{tr("optical:senderPanel.sender")}</span>
            <h2>{tr("optical:senderPanel.chooseAndPrepareFiles")}</h2>
          </div>
          <ShieldCheck className="text-info" size={20} />
        </div>

        <label className="optical-dropzone">
          <FileUp size={24} className="text-accent" />
          <span>{file ? file.name : tr("optical:senderPanel.chooseAFileToSend")}</span>
          <small>
            {file
              ? `${formatBytes(file.size)} · ${file.type || 'application/octet-stream'}`
              : tr("optical:senderPanel.qrCodesAreGeneratedLocallyFilesAre")}
          </small>
          <input
            type="file"
            onChange={(event) => {
              const next = event.target.files?.[0] ?? null;
              const capacity = next ? preflightTransferCapacity(next.size) : undefined;
              if (next && capacity && !capacity.canContinue) {
                setFile(null);
                setError(tr("optical:senderPanel.thisFileExceedsTheLmft1Block"));
                return;
              }
              setFile(next);
              setError(
                next && next.size > RECOMMENDED_TRANSFER_SIZE
                  ? tr("optical:senderPanel.filesOver1GibTakeConsiderablyLonger")
                  : next && next.size > QUICK_TRANSFER_SIZE
                    ? tr("optical:senderPanel.largeFilesTakeLongerToTransmit")
                  : '',
              );
            }}
          />
        </label>
        <p className="optical-hint optical-file-limit">
          {tr("optical:senderPanel.recommendedSizeUpTo1GibActual")}</p>

        <label className="optical-field">
          <span>{tr("optical:senderPanel.transferPasswordOptional")}</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={tr("optical:senderPanel.protectWithAes256GcmEncryption")}
            autoComplete="new-password"
          />
        </label>

        <button
          className="optical-primary"
          disabled={!file || preparing}
          onClick={() => void prepare()}
        >
          {preparing ? `${preparePhase} ${prepareProgress}%` : tr("optical:senderPanel.prepareQrCodes")}
        </button>

        {error && <p className="optical-error">{localizeMessage(error)}</p>}

        {transfer && (
          <div className="optical-summary">
            <div>
              <span>{tr("optical:senderPanel.filename")}</span>
              <strong>{transfer.manifest.fileName}</strong>
            </div>
            <div>
              <span>{tr("optical:senderPanel.originalSize")}</span>
              <strong>{formatBytes(Number(transfer.descriptor.originalSize))}</strong>
            </div>
            <div>
              <span>{tr("optical:senderPanel.totalBlocks")}</span>
              <strong>{tr("optical:senderPanel.blocksBlock", { value0: transfer.blocks.length, value1: formatBytes(transfer.descriptor.rawBlockSize) })}</strong>
            </div>
            <div>
              <span>{tr("optical:senderPanel.security")}</span>
              <strong>{transfer.descriptor.cryptoSuite ? tr("optical:senderPanel.aes256Encrypted") : tr("optical:senderPanel.unencrypted")}</strong>
            </div>
          </div>
        )}
      </div>

      {/* Right Column: QR Code Display & Player Controls */}
      <div className="optical-panel optical-player">
        <div className="optical-panel-heading">
          <div>
            <span className="optical-eyebrow">{tr("optical:senderPanel.qrDisplay")}</span>
            <h2>{packetCount ? tr("optical:senderPanel.frameOf", { value0: packetIndex + 1, value1: packetCount }) : tr("optical:senderPanel.notPrepared")}</h2>
          </div>
          <span className={playing ? 'optical-live' : 'optical-idle'}>
            {playing ? tr("optical:senderPanel.playing") : tr("optical:senderPanel.paused")}
          </span>
        </div>

        <div className="optical-qr-stage" ref={canvasRef}>
          {!packetCount && (
            <div className="optical-qr-placeholder">
              <ScanLine size={40} className="text-sub/60" />
              <span>{tr("optical:senderPanel.qrFramesAppearHereAfterPreparation")}</span>
            </div>
          )}
        </div>

        <div className="optical-player-actions">
          <button
            title={tr("optical:senderPanel.previousFrame")}
            disabled={!packetCount}
            onClick={() => setPacketIndex((index) => (index - 1 + packetCount) % packetCount)}
          >
            <RotateCcw size={15} />
            <span>{tr("optical:senderPanel.previousFrame")}</span>
          </button>
          <button
            className="optical-primary optical-play"
            disabled={!packetCount}
            onClick={() => setPlaying((value) => !value)}
          >
            {playing ? <Pause size={15} /> : <Play size={15} />}
            <span>{playing ? tr("optical:senderPanel.pause") : tr("optical:senderPanel.play")}</span>
          </button>
          <button
            title={tr("optical:senderPanel.resetToFirstFrame")}
            disabled={!packetCount}
            onClick={() => {
              setPlaying(false);
              setPacketIndex(0);
            }}
          >
            <Square size={15} />
            <span>{tr("optical:senderPanel.stop")}</span>
          </button>
        </div>

        <p className="optical-hint">
          {tr("optical:senderPanel.keepTheFullQrCodeVisibleReception")}</p>
      </div>
    </section>
  );
}
