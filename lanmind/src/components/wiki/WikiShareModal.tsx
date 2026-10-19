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
import { Share2, Copy, Check, Globe, Link2, X, QrCode, Shield, AlertTriangle } from 'lucide-react';
import { ApiService, WebStatus } from '../../services/api';
import type { WikiDocument } from './wikiTypes';

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
  const [copiedType, setCopiedType] = useState<'web' | 'app' | null>(null);
  const [webEndpoint, setWebEndpoint] = useState<string>('');
  const [serverRunning, setServerRunning] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    ApiService.getWebStatus()
      .then((status: WebStatus) => {
        if (status.endpoint) {
          setWebEndpoint(status.endpoint);
        }
        setServerRunning(status.running);
      })
      .catch(() => {
        const host = window.location.hostname || '127.0.0.1';
        const port = window.location.port || '3000';
        setWebEndpoint(`http://${host}:${port}`);
      });
  }, [isOpen]);

  if (!isOpen) return null;

  const displayTitle = doc.title.trim() || '未命名页面';
  const query=`?workspace=${encodeURIComponent(doc.workspaceId ?? getWorkspaceContext()?.workspaceId ?? "")}`;
  const webShareUrl = `${webEndpoint || 'http://localhost:3000'}/${query}#/wiki/${encodeURIComponent(doc.id)}`;
  const appDeepLink = `lanmind://wiki/${encodeURIComponent(doc.id)}${query}`;

  const handleCopy = async (text: string, type: 'web' | 'app') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="分享知识库页面"
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-edge bg-surface shadow-popover"
      >
        {/* 头部 */}
        <div className="flex shrink-0 items-center justify-between border-b border-edge px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Share2 className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-bold text-main">局域网分享文档</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-sub hover:bg-hover hover:text-main transition-colors"
            title="关闭"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 主体内容 */}
        <div className="space-y-4 p-5">
          <div className="rounded-xl border border-edge/60 bg-canvas/60 p-3">
            <div className="text-xs font-semibold text-main truncate">{displayTitle}</div>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-quiet">
              <span>局域网内用户打开链接即可直接查阅</span>
              {serverRunning ? (
                <span className="flex items-center gap-1 text-success font-medium">
                  <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                  局域网服务运行中
                </span>
              ) : (
                <span className="flex items-center gap-1 text-amber-500 font-medium">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  网页访问未开启
                </span>
              )}
            </div>
          </div>

          {/* 选项 1: 网页链接 (无需客户端，局域网浏览器可直接访问) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-sub">
              <label className="flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5 text-info" />
                <span>局域网 Web 浏览链接（局域网用户/手机浏览器直接看）</span>
              </label>
              {!serverRunning && (
                <span className="text-[11px] font-normal text-amber-500">
                  需先在设置中开启「网页访问」
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={webShareUrl}
                className="flex-1 rounded-xl border border-subtle bg-input/70 px-3 py-2 font-mono text-xs text-main outline-none select-all"
              />
              <button
                type="button"
                onClick={() => handleCopy(webShareUrl, 'web')}
                className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all ${
                  copiedType === 'web'
                    ? 'bg-success text-white shadow-soft'
                    : 'bg-accent text-accent-fg hover:brightness-110 shadow-soft'
                }`}
              >
                {copiedType === 'web' ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    <span>已复制</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>复制链接</span>
                  </>
                )}
              </button>
            </div>
            {!serverRunning && (
              <div className="flex items-center gap-1.5 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>提示：当前未开启网页访问服务。局域网用户在浏览器中打开此链接前，需先在【系统设置 → 网页访问】中开启。</span>
              </div>
            )}
          </div>

          {/* 选项 2: 客户端直达协议链接 */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-sub">
              <Link2 className="h-3.5 w-3.5 text-accent" />
              <span>客户端直达链接（已安装 LanMind 桌面端直接唤起）</span>
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
                    <span>已复制</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>复制协议</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* 底部说明 */}
          <div className="flex items-center gap-1.5 border-t border-edge/60 pt-3 text-xs text-quiet text-[11px]">
            <Shield className="h-3.5 w-3.5 text-info" />
            <span>默认全工作区公开协作；重要文档可开启只读保护</span>
          </div>
        </div>
      </div>
    </div>
  );
};
