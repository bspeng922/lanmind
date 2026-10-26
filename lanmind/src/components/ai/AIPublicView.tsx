import React, { useEffect, useState } from 'react';
import { AlertCircle, Copy, Check, Globe, Loader2, MessageSquare, Clock, User, Sparkles } from 'lucide-react';
import { AssistantMarkdown } from './AssistantMarkdown';
import { LanMindLogo } from '../LanMindLogo';
import { LanguageSelect } from '../LanguageSelect';
import { ThemeQuickSwitcher } from '../ThemeQuickSwitcher';
import { copyText } from '../../utils/clipboard';
import { tr, useLocale } from '../../i18n';

interface SharedConversation {
  id: string;
  title: string;
  sharedAt: string;
  messages: { id: string; role: 'user' | 'assistant'; content: string; createdAt: string }[];
}

/** Read-only conversation snapshot, without model or task mutation controls. */
export function AIPublicView({ conversationId }: { conversationId: string }) {
  useLocale();
  const [snapshot, setSnapshot] = useState<SharedConversation | null>(null);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);
  const params = new URLSearchParams(location.search);
  const shareId = params.get('share');
  const workspace = params.get('workspace');

  useEffect(() => {
    const controller = new AbortController();
    setSnapshot(null);
    setError(false);
    if (!shareId) {
      setError(true);
      return;
    }
    void fetch(`/api/public/ai/${encodeURIComponent(shareId)}${workspace ? `?workspace=${encodeURIComponent(workspace)}` : ''}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unavailable share');
        const data = await response.json() as SharedConversation;
        if (data.id !== conversationId) throw new Error('Invalid conversation');
        setSnapshot(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [shareId, workspace, conversationId]);

  const handleCopyLink = async () => {
    try {
      await copyText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex h-dvh flex-col bg-canvas text-main">
      {/* 顶部导航栏 */}
      <header className="flex min-h-14 shrink-0 flex-nowrap items-center justify-between gap-3 border-b border-edge bg-surface px-4 py-2 sm:px-6">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <div className="shrink-0">
            <LanMindLogo size="sm" showText />
          </div>

          <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-sky-600 dark:text-sky-400 whitespace-nowrap shrink-0">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-500 animate-pulse shrink-0" />
            <Globe className="h-3 w-3 shrink-0" />
            <span className="whitespace-nowrap">{tr('ai:share.readOnly')}</span>
          </span>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0 flex-nowrap">
          {/* 复制链接按钮：强制 whitespace-nowrap 绝不换行；移动端仅显示图标，桌面端显示图文 */}
          <button
            type="button"
            onClick={handleCopyLink}
            title={tr(copied ? 'ai:share.copied' : 'ai:share.copyLink')}
            aria-label={tr(copied ? 'ai:share.copied' : 'ai:share.copyLink')}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-all ${
              copied
                ? 'bg-success text-white shadow-soft'
                : 'border border-edge bg-canvas hover:bg-hover text-main shadow-xs'
            }`}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 shrink-0 text-white" />
            ) : (
              <Copy className="h-3.5 w-3.5 shrink-0 text-sub" />
            )}
            <span className="hidden sm:inline whitespace-nowrap">
              {tr(copied ? 'ai:share.copied' : 'ai:share.copyLink')}
            </span>
          </button>

          <ThemeQuickSwitcher />

          <LanguageSelect />
        </div>
      </header>

      {/* 主对话内容区域 */}
      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
        {error ? (
          <div
            role="alert"
            className="mx-auto flex max-w-md flex-col items-center justify-center rounded-2xl border border-danger/30 bg-danger/5 p-8 text-center text-danger shadow-xs my-12 animate-in fade-in"
          >
            <AlertCircle className="h-10 w-10 mb-3 text-danger/80" />
            <h2 className="text-base font-bold mb-1.5">{tr('ai:share.unavailable')}</h2>
            <p className="text-xs text-sub mt-1">当前分享链接可能已被撤销、失效或不存在</p>
          </div>
        ) : !snapshot ? (
          <div role="status" className="flex flex-col items-center justify-center py-24 gap-3 text-quiet animate-in fade-in">
            <Loader2 className="h-7 w-7 animate-spin text-accent" />
            <p className="text-xs">{tr('ai:share.preparing')}</p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-5 sm:space-y-6">
            {/* 对话概览卡片 */}
            <div className="rounded-2xl border border-edge bg-surface/70 p-5 sm:p-6 backdrop-blur-sm shadow-xs transition-all">
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-accent mb-2.5">
                <div className="flex items-center gap-1.5 rounded-md bg-accent/10 px-2 py-0.5 text-accent font-semibold">
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span>{tr('ai:share.shareTitle')}</span>
                </div>
                <span className="text-edge select-none">·</span>
                <span className="text-quiet">
                  {tr('ai:share.messageCount', { count: snapshot.messages.length })}
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-main leading-tight tracking-tight">
                {snapshot.title || tr('ai:conversation.untitled')}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-quiet border-t border-edge/60 pt-3">
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-3 w-3 opacity-70" />
                  <span>{new Date(snapshot.sharedAt).toLocaleString()}</span>
                </span>
                <span className="text-edge select-none">·</span>
                <span>{tr('ai:share.snapshotNotice')}</span>
              </div>
            </div>

            {/* 消息对话气泡列表 */}
            <div className="space-y-4 sm:space-y-5">
              {snapshot.messages.map((message) => {
                const isUser = message.role === 'user';
                return (
                  <article
                    key={message.id}
                    className={`rounded-2xl p-4 sm:p-5 transition-all shadow-xs ${
                      isUser
                        ? 'border border-edge/70 bg-surface/40 hover:bg-surface/60'
                        : 'border border-accent/20 bg-surface shadow-soft ring-1 ring-accent/5'
                    }`}
                  >
                    <header className="mb-3 flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${
                            isUser
                              ? 'bg-subtle text-sub'
                              : 'bg-accent text-on-accent shadow-2xs font-bold'
                          }`}
                        >
                          {isUser ? <User className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                        </span>
                        <span className={`font-semibold ${isUser ? 'text-sub' : 'text-main font-bold'}`}>
                          {tr(isUser ? 'ai:share.user' : 'ai:share.assistant')}
                        </span>
                      </div>
                      {message.createdAt && (
                        <span className="text-[11px] text-quiet opacity-75">
                          {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </header>

                    <div className="text-sm leading-7 text-main select-text pl-8 sm:pl-8">
                      {isUser ? (
                        <p className="whitespace-pre-wrap break-words">{message.content}</p>
                      ) : (
                        <AssistantMarkdown value={message.content} />
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
