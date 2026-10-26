/**
 * AIShareModal — AI 对话局域网分享弹窗（与知识库分享保持一致体验）。
 *
 * CALLING SPEC:
 *   <AIShareModal
 *     conversation={conversation}
 *     workspaceId={workspaceId}
 *     isOpen={isOpen}
 *     onClose={() => setIsOpen(false)}
 *   />
 */

import React, { useEffect, useState } from 'react';
import { Share2, Copy, Check, Globe, Link2, X, AlertTriangle } from 'lucide-react';
import { ApiService, WebStatus } from '../../services/api';
import { getWorkspaceContext } from '../../utils/workspaceContext';
import { tr, useLocale } from '../../i18n';
import type { Conversation } from './aiClient';
import { AI } from './aiClient';
import { copyText } from '../../utils/clipboard';

export interface AIShareModalProps {
  conversation: Conversation | null;
  workspaceId?: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export const AIShareModal: React.FC<AIShareModalProps> = ({
  conversation,
  workspaceId,
  isOpen,
  onClose,
}) => {
  useLocale();
  const [copiedType, setCopiedType] = useState<'web' | 'app' | null>(null);
  const [webEndpoint, setWebEndpoint] = useState<string>('');
  const [serverRunning, setServerRunning] = useState(false);
  const [shareId, setShareId] = useState('');
  const [shareError, setShareError] = useState(false);

  useEffect(() => {
    if (!isOpen || !conversation) return;
    let cancelled = false;
    setShareId(''); setShareError(false); setServerRunning(false); setCopiedType(null);
    ApiService.getWebStatus()
      .then(async (status: WebStatus) => {
        if (cancelled) return;
        if (status.endpoint) {
          setWebEndpoint(status.endpoint);
        }
        setServerRunning(status.running);
        if (status.running) {
          const result = await AI.call<{ shareId: string }>('conversation.share', { id: conversation.id });
          if (!cancelled) setShareId(result.shareId);
        }
      })
      .catch(() => {
        if (!cancelled) setShareError(true);
      });
    return () => { cancelled = true; };
  }, [isOpen, conversation?.id, conversation?.revision, workspaceId]);

  if (!isOpen || !conversation) return null;

  const displayTitle = conversation.title.trim() || tr('ai:conversation.untitled') || '未命名对话';
  const wsId = workspaceId ?? getWorkspaceContext()?.workspaceId ?? '';
  const query = `?workspace=${encodeURIComponent(wsId)}`;
  const webShareUrl = shareId ? `${(webEndpoint || 'http://localhost:3000').replace(/\/+$/, '')}/${query}&share=${encodeURIComponent(shareId)}#/ai/${encodeURIComponent(conversation.id)}` : '';
  const appDeepLink = `lanmind://ai/${encodeURIComponent(conversation.id)}${query}`;

  const handleCopy = async (text: string, type: 'web' | 'app') => {
    try {
      await copyText(text);
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 2000);
    } catch {
      setShareError(true);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tr('ai:share.shareTitle')}
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-edge bg-surface shadow-popover"
      >
        {/* 头部 */}
        <div className="flex shrink-0 items-center justify-between border-b border-edge px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Share2 className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-bold text-main">{tr('ai:share.shareTitle')}</h3>
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

        {/* 内容 */}
        <div className="space-y-4 p-5">
          <div className="rounded-xl border border-edge/60 bg-canvas/60 p-3">
            <div className="text-xs font-semibold text-main truncate">{displayTitle}</div>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-quiet">
              <span>{tr('ai:share.shareHint')}</span>
              {serverRunning ? (
                <span className="flex items-center gap-1 text-success font-medium">
                  <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                  {tr('ai:share.serverRunning')}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-amber-500 font-medium">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  {tr('ai:share.serverStopped')}
                </span>
              )}
            </div>
          </div>

          {/* 选项 1: 网页链接 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-sub gap-2">
              <label className="flex items-center gap-1.5 min-w-0">
                <Globe className="h-3.5 w-3.5 text-info shrink-0" />
                <span className="truncate">{tr('ai:share.webLink')}</span>
              </label>
              {!serverRunning && (
                <span className="shrink-0 text-[11px] font-normal text-amber-500 whitespace-nowrap">
                  {tr('ai:share.needWebAccess')}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={webShareUrl}
                aria-label={tr('ai:share.webLink')}
                className="flex-1 rounded-xl border border-subtle bg-input/70 px-3 py-2 font-mono text-xs text-main outline-none select-all"
              />
              <button
                type="button"
                onClick={() => handleCopy(webShareUrl, 'web')}
                disabled={!serverRunning || !shareId}
                className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all disabled:opacity-50 ${
                  copiedType === 'web'
                    ? 'bg-success text-white shadow-soft'
                    : 'bg-accent text-accent-fg hover:brightness-110 shadow-soft'
                }`}
              >
                {copiedType === 'web' ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    <span>{tr('ai:share.copied')}</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>{tr('ai:share.copyLink')}</span>
                  </>
                )}
              </button>
            </div>
            {!serverRunning && (
              <div className="flex items-center gap-1.5 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>{tr('ai:share.webLinkWarning')}</span>
              </div>
            )}
          </div>

          {serverRunning && !shareId && !shareError && <p role="status" className="text-xs text-sub">{tr('ai:share.preparing')}</p>}
          {shareError && <p role="alert" className="text-xs text-danger">{tr('ai:share.failed')}</p>}

          {/* 选项 2: 客户端 Deep Link */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-sub">
              <Link2 className="h-3.5 w-3.5 text-accent shrink-0" />
              <span>{tr('ai:share.appLink')}</span>
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
                className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all ${
                  copiedType === 'app'
                    ? 'bg-success text-white shadow-soft'
                    : 'border border-edge bg-surface text-main hover:bg-hover'
                }`}
              >
                {copiedType === 'app' ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    <span>{tr('ai:share.copied')}</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>{tr('ai:share.copyLink')}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
