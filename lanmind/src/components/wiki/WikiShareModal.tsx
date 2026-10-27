import { getWorkspaceContext } from "../../utils/workspaceContext";
/**
 * 知识库页面局域网分享弹窗。
 *
 * CALLING SPEC:
 *   <WikiShareModal
 *     document={doc}
 *     isOpen={isOpen}
 *     onClose={() => setIsOpen(false)}
 *   />
 */

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Share2, Copy, Check, Globe, Link2, X, Shield, AlertTriangle } from 'lucide-react';
import { ApiService, WebStatus } from '../../services/api';
import { tr, useLocale } from '../../i18n';
import type { WikiDocument } from './wikiTypes';
import { syncWikiDocumentAssets } from './wikiAssetStore';
import { copyText } from '../../utils/clipboard';

export interface WikiShareModalProps {
  document: WikiDocument;
  isOpen: boolean;
  onClose: () => void;
}

export const WikiShareModal: React.FC<WikiShareModalProps> = ({
  document: doc,
  isOpen,
  onClose,
}) => {
  useLocale();
  const [copiedType, setCopiedType] = useState<'web' | 'app' | null>(null);
  const [webEndpoint, setWebEndpoint] = useState<string>('');
  const [serverRunning, setServerRunning] = useState(false);
  const [assetsReady, setAssetsReady] = useState(false);
  const [shareError, setShareError] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setAssetsReady(false); setShareError(false); setServerRunning(false); setCopiedType(null);
    ApiService.getWebStatus()
      .then(async (status: WebStatus) => {
        if (cancelled) return;
        if (status.endpoint) {
          setWebEndpoint(status.endpoint);
        }
        setServerRunning(status.running);
        if (status.running) {
          await syncWikiDocumentAssets(doc.content);
          if (!cancelled) setAssetsReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) setShareError(true);
      });
    return () => { cancelled = true; };
  }, [isOpen, doc.id, doc.content]);

  if (!isOpen) return null;

  const displayTitle = doc.title.trim() || tr('wiki:wikiView.untitledPage') || '未命名页面';
  const baseEndpoint = (webEndpoint || 'http://localhost:3000').replace(/\/+$/, '');
  const workspaceId = doc.workspaceId ?? getWorkspaceContext()?.workspaceId ?? '';
  const webShareUrl = `${baseEndpoint}/?workspace=${encodeURIComponent(workspaceId)}&wiki=${encodeURIComponent(doc.id)}#/wiki/${encodeURIComponent(doc.id)}`;
  const appDeepLink = `lanmind://wiki/${encodeURIComponent(doc.id)}?workspace=${encodeURIComponent(workspaceId)}`;

  const handleCopy = async (text: string, type: 'web' | 'app') => {
    try {
      await copyText(text);
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 2000);
    } catch {
      setShareError(true);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tr('wiki:wikiShare.ariaLabel')}
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-edge bg-surface shadow-popover"
      >
        {/* 头部 */}
        <div className="flex shrink-0 items-center justify-between border-b border-edge px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Share2 className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-bold text-main">{tr('wiki:wikiShare.title')}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-sub hover:bg-hover hover:text-main transition-colors"
            title={tr('common:header.close') || '关闭'}
            aria-label={tr('common:header.close') || '关闭'}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 主体内容 */}
        <div className="space-y-4 p-5">
          <div className="rounded-xl border border-edge/60 bg-canvas/60 p-3">
            <div className="text-xs font-semibold text-main truncate">{displayTitle}</div>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-quiet">
              <span>{tr('wiki:wikiShare.subtitle')}</span>
              {serverRunning ? (
                <span className="flex items-center gap-1 text-success font-medium">
                  <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                  {tr('wiki:wikiShare.serviceRunning')}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-amber-500 font-medium">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  {tr('wiki:wikiShare.webDisabled')}
                </span>
              )}
            </div>
          </div>

          {/* 选项 1: 网页链接 (无需客户端，局域网浏览器可直接访问) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-sub gap-2">
              <label className="flex items-center gap-1.5 min-w-0">
                <Globe className="h-3.5 w-3.5 text-info shrink-0" />
                <span className="truncate">{tr('wiki:wikiShare.webLinkTitle')}</span>
              </label>
              {!serverRunning && (
                <span className="shrink-0 text-[11px] font-normal text-amber-500 whitespace-nowrap">
                  {tr('wiki:wikiShare.enableInSettings')}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                readOnly
                aria-label={tr('wiki:wikiShare.webLinkTitle')}
                value={serverRunning && assetsReady ? webShareUrl : ''}
                className="flex-1 rounded-xl border border-subtle bg-input/70 px-3 py-2 font-mono text-xs text-main outline-none select-all"
              />
              <button
                type="button"
                disabled={!serverRunning || !assetsReady}
                onClick={() => handleCopy(webShareUrl, 'web')}
                className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all disabled:opacity-50 ${
                  copiedType === 'web'
                    ? 'bg-success text-white shadow-soft'
                    : 'bg-accent text-accent-fg hover:brightness-110 shadow-soft'
                }`}
              >
                {copiedType === 'web' ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    <span>{tr('wiki:wikiShare.copied')}</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>{tr('wiki:wikiShare.copyLink')}</span>
                  </>
                )}
              </button>
            </div>
            {!serverRunning && (
              <div className="flex items-center gap-1.5 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>{tr('wiki:wikiShare.webDisabledTip')}</span>
              </div>
            )}
          </div>

          {serverRunning && !assetsReady && !shareError && <p role="status" className="text-xs text-sub">{tr('wiki:wikiShare.preparingAssets')}</p>}
          {shareError && <p role="alert" className="text-xs text-danger">{tr('wiki:wikiShare.prepareFailed')}</p>}

          {/* 选项 2: 客户端直达协议链接 */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-sub">
              <Link2 className="h-3.5 w-3.5 text-accent shrink-0" />
              <span>{tr('wiki:wikiShare.deepLinkTitle')}</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={appDeepLink}
                className="flex-1 rounded-xl border border-subtle bg-input/70 px-3 py-2 font-mono text-xs text-main outline-none select-all"
              />
              <button
                type="button"
                onClick={() => handleCopy(appDeepLink, 'app')}
                className={`flex shrink-0 items-center gap-1.5 rounded-xl border border-edge bg-surface px-3.5 py-2 text-xs font-medium text-main hover:bg-hover transition-colors ${
                  copiedType === 'app' ? 'border-success text-success' : ''
                }`}
              >
                {copiedType === 'app' ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-success" />
                    <span>{tr('wiki:wikiShare.copied')}</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>{tr('wiki:wikiShare.copyProtocol')}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* 底部说明 */}
          <div className="flex items-center gap-1.5 border-t border-edge/60 pt-3 text-xs text-quiet text-[11px]">
            <Shield className="h-3.5 w-3.5 text-info shrink-0" />
            <span>{tr('wiki:wikiShare.bottomNotice')}</span>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
