/**
 * 知识库空状态（整块画布）。
 *
 * 调用约定：受控组件，只在没有任何页面时渲染。
 * 首次启动会生成一篇空白起始页，因此该状态出现在页面被全部删除之后，
 * 主操作按钮负责把知识库恢复到可书写状态。
 */

import React from 'react';
import { BookOpen, Plus } from 'lucide-react';
import { tr, useLocale } from '../../i18n';

export const WikiEmptyState: React.FC<{ onCreate: () => void }> = ({ onCreate }) => {
  useLocale();

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-canvas px-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-edge bg-surface text-info">
        <BookOpen className="h-5 w-5" aria-hidden="true" />
      </span>
      <h2 className="text-sm font-semibold text-main">{tr('wiki:wikiEmpty.title')}</h2>
      <p className="max-w-sm text-xs leading-5 text-sub">{tr('wiki:wikiEmpty.description')}</p>
      <button
        type="button"
        onClick={onCreate}
        className="mt-1 flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent transition-opacity hover:opacity-90"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        {tr('wiki:wikiEmpty.createFirstPage')}
      </button>
    </div>
  );
};
