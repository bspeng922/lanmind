import { tr, useLocale } from "../i18n";
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
  useLocale();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <nav aria-label={tr("common:recordPagination.recordPagination")} className="flex flex-wrap items-center justify-between gap-2 text-xs text-sub">
    <span>{tr("common:recordPagination.recordsPerPage", { value0: total, value1: pageSize })}</span>
    <div className="flex items-center gap-2">
      <button type="button" aria-label={tr("common:recordPagination.previousPage")} title={tr("common:recordPagination.previousPage")} disabled={loading || page <= 1} onClick={() => onPageChange(page - 1)} className="ui-cancel-button flex h-7 w-7 items-center justify-center rounded-md disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" /></button>
      <span role="status" aria-live="polite" className="tabular-nums">{tr("common:recordPagination.pageOf", { value0: page, value1: pages })}</span>
      <button type="button" aria-label={tr("common:recordPagination.nextPage")} title={tr("common:recordPagination.nextPage")} disabled={loading || page >= pages} onClick={() => onPageChange(page + 1)} className="ui-cancel-button flex h-7 w-7 items-center justify-center rounded-md disabled:opacity-40"><ChevronRight className="h-3.5 w-3.5" /></button>
    </div>
  </nav>;
};
