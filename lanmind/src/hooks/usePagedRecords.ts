import { useEffect, useState } from 'react';
import { PageRequest, RecordPage } from '../types';

export const LOG_PAGE_SIZE = 20;

export function usePagedRecords<T, R extends RecordPage<T> = RecordPage<T>>(loadPage: (request: PageRequest) => Promise<R>) {
  const [request, setRequest] = useState({ page: 1, snapshot: undefined as number | undefined, revision: 0 });
  const [data, setData] = useState<R | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError('');
    loadPage({ page: request.page, pageSize: LOG_PAGE_SIZE, snapshot: request.snapshot })
      .then((result) => { if (!disposed) setData(result); })
      .catch((reason) => { if (!disposed) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [loadPage, request]);

  const page = !loading && !error && data ? data.page : request.page;
  const goToPage = (next: number) => {
    if (loading || !data) return;
    setLoading(true);
    setRequest((previous) => ({ ...previous, page: next, snapshot: data.snapshot }));
  };
  const refresh = () => {
    setLoading(true);
    setRequest((previous) => ({ page: 1, snapshot: undefined, revision: previous.revision + 1 }));
  };
  const retry = () => {
    setLoading(true);
    setRequest((previous) => ({ ...previous, revision: previous.revision + 1 }));
  };
  return { data, page, loading, error, goToPage, refresh, retry };
}
