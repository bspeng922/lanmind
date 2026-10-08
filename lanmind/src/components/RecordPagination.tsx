import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface RecordPaginationProps {
  page: number;
  pageSize: number;
  total: number;
  loading: boolean;
  onPageChange: (page: number) => void;
}

export const RecordPagination: React.FC<RecordPaginationProps> = ({ page, pageSize, total, loading, onPageChange }) => {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <nav aria-label="记录分页" className="flex flex-wrap items-center justify-between gap-2 text-xs text-sub">
    <span>共 {total} 条 · 每页 {pageSize} 条</span>
    <div className="flex items-center gap-2">
      <button type="button" aria-label="上一页" title="上一页" disabled={loading || page <= 1} onClick={() => onPageChange(page - 1)} className="ui-cancel-button flex h-7 w-7 items-center justify-center rounded-md disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" /></button>
      <span role="status" aria-live="polite" className="tabular-nums">第 {page} / {pages} 页</span>
      <button type="button" aria-label="下一页" title="下一页" disabled={loading || page >= pages} onClick={() => onPageChange(page + 1)} className="ui-cancel-button flex h-7 w-7 items-center justify-center rounded-md disabled:opacity-40"><ChevronRight className="h-3.5 w-3.5" /></button>
    </div>
  </nav>;
};
