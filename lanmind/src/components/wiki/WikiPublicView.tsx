/**
 * WikiPublicView — Public read-only viewer for shared Wiki documents on LAN.
 *
 * CALLING SPEC:
 *   <WikiPublicView
 *     docId={docId}
 *     onEnterTaskApp={() => void}
 *     onSelectDoc={(id) => void}
 *   />
 */

import React, { useEffect, useState, useMemo } from 'react';
import {
  Globe,
  Copy,
  Check,
  ArrowRight,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  FileText,
  Clock,
  User as UserIcon,
  Tag,
  AlertCircle,
  Loader2,
  FolderOpen,
} from 'lucide-react';
import { LanMindLogo } from '../LanMindLogo';
import { LanguageSelect } from '../LanguageSelect';
import { ThemeQuickSwitcher } from '../ThemeQuickSwitcher';
import { WikiPagePreview } from './WikiPagePreview';
import { tr, useLocale } from '../../i18n';
import type { WikiDocument } from './wikiTypes';
import { copyText } from '../../utils/clipboard';

export interface WikiPublicViewProps {
  docId: string;
  onEnterTaskApp?: () => void;
  onSelectDoc?: (docId: string) => void;
}

export const WikiPublicView: React.FC<WikiPublicViewProps> = ({
  docId,
  onEnterTaskApp,
  onSelectDoc,
}) => {
  useLocale();
  const [currentDoc, setCurrentDoc] = useState<WikiDocument | null>(null);
  const [documents, setDocuments] = useState<WikiDocument[]>([]);
  const [workspaceName, setWorkspaceName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const workspace = new URLSearchParams(window.location.search).get('workspace');
  const shareQuery = workspace ? `?workspace=${encodeURIComponent(workspace)}` : '';

  // Fetch document details
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    setCurrentDoc(null);
    fetch(`/api/public/wiki/${encodeURIComponent(docId)}${shareQuery}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || tr('wiki:wikiPublic.notFound'));
        }
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setCurrentDoc(data);
        if (data.workspaceName) setWorkspaceName(data.workspaceName);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [docId, shareQuery]);

  // Fetch document list for directory navigation
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/public/wiki${shareQuery}`)
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (cancelled || !data) return;
        if (Array.isArray(data.documents)) {
          setDocuments(data.documents);
        }
        if (data.workspaceName && !workspaceName) {
          setWorkspaceName(data.workspaceName);
        }
      })
      .catch(() => {
        /* ignore directory load failures */
      });

    return () => {
      cancelled = true;
    };
  }, [shareQuery]);

  const handleCopyLink = async () => {
    try {
      await copyText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  // Ancestor chain for breadcrumbs
  const breadcrumbs = useMemo(() => {
    if (!currentDoc || !documents.length) return [];
    const chain: WikiDocument[] = [];
    const docMap = new Map<string, WikiDocument>(documents.map((d) => [d.id, d]));
    let cursor = currentDoc.parentId;
    let guard = 0;
    while (cursor && guard++ < 50) {
      const parent = docMap.get(cursor);
      if (!parent) break;
      chain.unshift(parent);
      cursor = parent.parentId;
    }
    return chain;
  }, [currentDoc, documents]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas text-main">
      {/* Top Header */}
      <header className="flex min-h-14 shrink-0 flex-nowrap items-center justify-between gap-3 border-b border-edge bg-surface px-4 py-2 sm:px-6">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {documents.length > 1 && (
            <button
              type="button"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-sub hover:bg-hover hover:text-main transition-colors shrink-0"
              title={sidebarOpen ? '收起目录' : '展开目录'}
              aria-label={sidebarOpen ? '收起目录' : '展开目录'}
            >
              {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
            </button>
          )}

          <div className="shrink-0">
            <LanMindLogo size="sm" showText />
          </div>

          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 whitespace-nowrap shrink-0">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            <Globe className="h-3 w-3 shrink-0" />
            <span className="whitespace-nowrap">{tr('wiki:wikiPublic.readOnlyBadge')}</span>
          </span>

          {workspaceName && (
            <span className="hidden text-xs text-sub md:inline whitespace-nowrap truncate max-w-[160px]">
              · {workspaceName}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0 flex-nowrap">
          <button
            type="button"
            onClick={handleCopyLink}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-all ${
              copied
                ? 'bg-success text-white shadow-soft'
                : 'border border-edge bg-canvas hover:bg-hover text-main shadow-xs'
            }`}
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 shrink-0" />
                <span className="whitespace-nowrap">{tr('wiki:wikiPublic.copied')}</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5 text-sub shrink-0" />
                <span className="whitespace-nowrap">{tr('wiki:wikiPublic.copyLink')}</span>
              </>
            )}
          </button>

          <ThemeQuickSwitcher />

          <LanguageSelect />

          {onEnterTaskApp && (
            <button
              type="button"
              onClick={onEnterTaskApp}
              className="theme-btn-primary flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 shadow-soft"
            >
              <span className="whitespace-nowrap">{tr('wiki:wikiPublic.taskManagement')}</span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0" />
            </button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Collapsible Directory Sidebar */}
        {documents.length > 1 && sidebarOpen && (
          <aside className="w-64 shrink-0 border-r border-edge bg-surface/50 p-3 overflow-y-auto">
            <div className="mb-2 flex items-center gap-1.5 px-2 py-1 text-xs font-bold text-sub">
              <FolderOpen className="h-3.5 w-3.5 text-accent" />
              <span>{tr('wiki:wikiPublic.documents')}</span>
            </div>
            <nav className="space-y-0.5">
              {documents.map((item) => {
                const isSelected = item.id === docId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectDoc?.(item.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                      isSelected
                        ? 'bg-info/10 font-semibold text-info'
                        : 'text-sub hover:bg-hover hover:text-main'
                    }`}
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 opacity-70" />
                    <span className="truncate">{item.title || tr('wiki:wikiView.untitledPage')}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        )}

        {/* Document Body */}
        <main className="flex-1 overflow-y-auto px-4 py-8 sm:px-8 lg:px-12">
          {loading && (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-sub">
              <Loader2 className="h-6 w-6 animate-spin text-accent" />
              <p className="text-xs">{tr('wiki:wikiPublic.reading')}</p>
            </div>
          )}

          {error && !loading && (
            <div className="mx-auto max-w-lg rounded-2xl border border-danger/30 bg-danger/10 p-6 text-center">
              <AlertCircle className="mx-auto h-8 w-8 text-danger" />
              <h3 className="mt-3 text-sm font-bold text-danger">{error}</h3>
              <p className="mt-1 text-xs text-sub">请检查链接是否完整或工作区局域网服务是否正常运行。</p>
              {onEnterTaskApp && (
                <button
                  type="button"
                  onClick={onEnterTaskApp}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-accent-fg hover:brightness-110"
                >
                  <span>{tr('wiki:wikiPublic.taskManagement')}</span>
                </button>
              )}
            </div>
          )}

          {currentDoc && !loading && !error && (
            <article className="mx-auto max-w-4xl space-y-6">
              {/* Breadcrumbs */}
              {breadcrumbs.length > 0 && (
                <nav className="flex flex-wrap items-center gap-1.5 text-xs text-quiet">
                  {breadcrumbs.map((parent) => (
                    <React.Fragment key={parent.id}>
                      <button
                        type="button"
                        onClick={() => onSelectDoc?.(parent.id)}
                        className="hover:text-main hover:underline transition-colors truncate max-w-[150px]"
                      >
                        {parent.title || tr('wiki:wikiView.untitledPage')}
                      </button>
                      <ChevronRight className="h-3 w-3 shrink-0" />
                    </React.Fragment>
                  ))}
                  <span className="text-sub font-medium truncate max-w-[200px]">
                    {currentDoc.title || tr('wiki:wikiView.untitledPage')}
                  </span>
                </nav>
              )}

              {/* Title & Metadata */}
              <div className="border-b border-edge/80 pb-5">
                <h1 className="text-2xl font-bold tracking-tight text-main sm:text-3xl">
                  {currentDoc.title || tr('wiki:wikiView.untitledPage')}
                </h1>

                <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-sub">
                  {(currentDoc.updatedByName || currentDoc.createdByName) && (
                    <span className="flex items-center gap-1.5">
                      <UserIcon className="h-3.5 w-3.5 text-quiet" />
                      <span>{currentDoc.updatedByName || currentDoc.createdByName}</span>
                    </span>
                  )}

                  {currentDoc.updatedAt && (
                    <span className="flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5 text-quiet" />
                      <span>{new Date(currentDoc.updatedAt).toLocaleDateString()}</span>
                    </span>
                  )}

                  {currentDoc.tags && currentDoc.tags.length > 0 && (
                    <div className="flex items-center gap-1.5">
                      <Tag className="h-3.5 w-3.5 text-quiet" />
                      <div className="flex flex-wrap gap-1">
                        {currentDoc.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-md border border-edge bg-canvas/80 px-2 py-0.5 text-[10px] font-medium text-sub"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Markdown Content */}
              <div className="pt-2">
                <WikiPagePreview content={currentDoc.content} />
              </div>
            </article>
          )}
        </main>
      </div>
    </div>
  );
};
