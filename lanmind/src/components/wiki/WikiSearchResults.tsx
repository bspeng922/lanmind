/**
 * 知识库检索结果面板（主栏）。
 *
 * 调用约定：受控组件，接收已经算好的命中列表（见 wikiStore.searchWiki）。
 * 命中标题与正文片段在展示层做高亮，不生成 HTML 片段，
 * 因此无需再次净化，也不存在把用户内容当标记渲染的风险。
 * 片段内的路径逐段可点击，跳转行为与文档树一致。
 */

import React from 'react';
import { FileText, SearchX } from 'lucide-react';
import { tr, useLocale } from '../../i18n';
import type { WikiDocument } from './wikiTypes';
import type { WikiSearchHit } from './wikiStore';

interface WikiSearchResultsProps {
  query: string;
  hits: WikiSearchHit[];
  /** 依据页面 id 取出祖先链，用于展示路径。 */
  pathOf: (id: string) => WikiDocument[];
  onOpen: (id: string) => void;
  onOpenAncestor: (id: string) => void;
}

/** 把命中片段按关键词切成高亮与普通文本两类。 */
const highlight = (text: string, query: string): React.ReactNode => {
  const needle = query.trim().toLowerCase();
  if (!needle) return text;
  const parts: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  let cursor = 0;
  let index = lower.indexOf(needle);
  let guard = 0;
  while (index !== -1 && guard++ < 40) {
    if (index > cursor) parts.push(text.slice(cursor, index));
    parts.push(
      <mark key={`${index}-${cursor}`} className="rounded-sm bg-accent/25 text-main">
        {text.slice(index, index + needle.length)}
      </mark>,
    );
    cursor = index + needle.length;
    index = lower.indexOf(needle, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
};

const displayTitle = (doc: WikiDocument) => doc.title.trim() || tr('wiki:wikiView.untitledPage');

export const WikiSearchResults: React.FC<WikiSearchResultsProps> = ({
  query,
  hits,
  pathOf,
  onOpen,
  onOpenAncestor,
}) => {
  useLocale();

  return (
    <section
      aria-label={tr('wiki:wikiSearch.title')}
      className="flex min-w-0 flex-1 flex-col overflow-hidden bg-canvas"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-edge bg-surface px-4 py-2">
        <h2 className="truncate text-xs font-semibold text-main">{tr('wiki:wikiSearch.title')}</h2>
        <span className="shrink-0 text-[10px] text-quiet">
          {tr('wiki:wikiSearch.resultCount', { value0: hits.length })}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {hits.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
            <SearchX className="h-6 w-6 text-quiet" aria-hidden="true" />
            <p className="text-xs font-medium text-main">{tr('wiki:wikiTree.noMatches')}</p>
            <p className="max-w-xs text-[11px] leading-5 text-sub">{tr('wiki:wikiTree.noMatchesHint')}</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {hits.map((hit) => {
              const path = pathOf(hit.document.id);
              return (
                <li key={hit.document.id}>
                  <div className="rounded-lg border border-subtle bg-surface px-3 py-2 transition-colors hover:border-edge">
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => onOpen(hit.document.id)}
                        aria-label={tr('wiki:wikiSearch.openResult', { value0: displayTitle(hit.document) })}
                        className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-medium text-main hover:text-info"
                      >
                        <FileText className="h-3.5 w-3.5 shrink-0 text-quiet" aria-hidden="true" />
                        <span className="min-w-0 truncate">{highlight(displayTitle(hit.document), query)}</span>
                      </button>
                      <span className="shrink-0 rounded border border-subtle px-1.5 py-0.5 text-[10px] text-quiet">
                        {hit.titleMatched ? tr('wiki:wikiSearch.titleMatch') : tr('wiki:wikiSearch.bodyMatch')}
                      </span>
                    </div>

                    {path.length > 0 && (
                      <div className="mt-1 flex flex-wrap items-center gap-1 pl-5 text-[10px] text-quiet">
                        {path.map((ancestor) => (
                          <React.Fragment key={ancestor.id}>
                            <button
                              type="button"
                              onClick={() => onOpenAncestor(ancestor.id)}
                              className="max-w-32 truncate rounded px-0.5 transition-colors hover:bg-hover hover:text-main"
                            >
                              {displayTitle(ancestor)}
                            </button>
                            <span aria-hidden="true">/</span>
                          </React.Fragment>
                        ))}
                      </div>
                    )}

                    {!hit.titleMatched && hit.snippet && (
                      <button
                        type="button"
                        onClick={() => onOpen(hit.document.id)}
                        className="mt-1 block w-full pl-5 text-left text-[11px] leading-5 text-sub transition-colors hover:text-main"
                      >
                        {highlight(hit.snippet, query)}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
};
