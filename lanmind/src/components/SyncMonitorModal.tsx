import React, { useCallback, useEffect, useRef } from 'react';
import { ChangeLog, PageRequest, SyncLogPage } from '../types';
import { ApiService } from '../services/api';
import { X, RefreshCw, History, LoaderCircle } from 'lucide-react';
import { LOG_PAGE_SIZE, usePagedRecords } from '../hooks/usePagedRecords';
import { RecordPagination } from './RecordPagination';

const ACTION_PRESENTATION: Record<string, { label: string; tone: string }> = {
  transfer: { label: '转让项目', tone: 'text-warning' },
  create: { label: '创建', tone: 'text-success' },
  update: { label: '更新', tone: 'text-info' },
  delete: { label: '删除', tone: 'text-danger' },
  start: { label: '开始任务', tone: 'text-info' },
  complete: { label: '完成任务', tone: 'text-success' },
  reopen: { label: '重新开启', tone: 'text-warning' },
  block: { label: '标记阻塞', tone: 'text-danger' },
};

const actionPresentation = (log: ChangeLog) => {
  if (log.entityType === 'task' && log.action === 'update') {
    const transition = log.payload?._statusTransition;
    const status = transition?.from !== transition?.to ? transition?.to : null;
    if (status === 'in_progress') return ACTION_PRESENTATION.start;
    if (status === 'completed') return ACTION_PRESENTATION.complete;
    if (status === 'todo') return ACTION_PRESENTATION.reopen;
    if (status === 'blocked') return ACTION_PRESENTATION.block;
  }
  return ACTION_PRESENTATION[log.action] || ACTION_PRESENTATION.update;
};

const ENTITY_LABELS: Record<string, string> = {
  task: '任务',
  task_assignment: '任务指派',
  task_comment: '任务评论',
  project: '协作项目',
  project_file: '项目文件',
  project_folder: '项目文件夹',
  user_profile: '用户资料',
  chat_message: '聊天消息',
  chat_group: '聊天群组',
};

interface SyncMonitorModalProps {
  isOpen: boolean;
  onClose: () => void;
  syncVersion: number;
}

export const SyncMonitorModal: React.FC<SyncMonitorModalProps> = (props) => props.isOpen ? <SyncLogsDialog {...props} /> : null;

const SyncLogsDialog: React.FC<SyncMonitorModalProps> = ({
  onClose,
  syncVersion,
}) => {
  const loadPage = useCallback((request: PageRequest) => ApiService.getSyncLogsPage(request), []);
  const { data, page, loading, error, goToPage, refresh, retry } = usePagedRecords<ChangeLog, SyncLogPage>(loadPage);
  const logs = data?.items || [];
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [data]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label="增量同步日志" className="fixed inset-0 bg-overlay backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <section className="record-history-dialog flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-edge bg-surface text-main shadow-popover">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-edge px-5 py-4">
          <div className="flex items-center space-x-2">
            <History className="w-5 h-5 text-info" />
            <h2 className="text-sm font-bold text-main">增量同步日志</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ui-modal-close-btn"
            title="关闭 (Esc)"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Sync Change Logs */}
          <div className="flex shrink-0 items-center justify-between px-5 py-3">
            <h3 className="text-xs font-bold text-sub flex items-center gap-1.5">
              <History className="w-4 h-4 text-info" />
              变更记录 (当前版本: v{data?.latestVersion ?? syncVersion})
            </h3>
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              className="project-toolbar-icon"
              title="刷新同步日志"
              aria-label="刷新同步日志"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div ref={bodyRef} aria-busy={loading} className="mx-5 mb-4 min-h-0 flex-1 space-y-2 overflow-y-auto rounded-md border border-edge bg-canvas p-3 font-mono text-xs">
            {loading ? <div role="status" aria-label="读取同步日志" className="flex justify-center py-10"><LoaderCircle className="h-5 w-5 animate-spin text-sub" /></div>
              : error ? <div role="alert" className="py-8 text-center text-danger"><p>{error}</p><button type="button" onClick={retry} className="ui-cancel-button mx-auto mt-3 flex items-center gap-1 rounded-md px-3 py-2"><RefreshCw className="h-3.5 w-3.5" />重试</button></div>
              : logs.length === 0 ? (
              <div className="text-quiet text-center py-4">暂无同步变动日志</div>
            ) : (
              <>
                <div className="hidden grid-cols-[minmax(0,1fr)_8rem_10rem_5.5rem] gap-3 px-2 text-center text-[10px] text-quiet md:grid">
                  <span>变更内容</span>
                  <span>时间</span>
                  <span>来源</span>
                  <span>版本</span>
                </div>
                {logs.map((log) => {
                  const action = actionPresentation(log);
                  const timestamp = new Date(log.timestamp).toLocaleString('zh-CN', { hour12: false });
                  return (
                    <div
                      key={log.id}
                      data-log-id={log.id}
                      className="grid gap-2 rounded-md border border-edge/80 bg-surface p-2 md:grid-cols-[minmax(0,1fr)_8rem_10rem_5.5rem] md:items-start md:gap-3"
                    >
                      <div className="min-w-0">
                        <span className={`font-bold ${action.tone}`}>[{action.label}]</span>{' '}
                        <span className="text-main">{ENTITY_LABELS[log.entityType] || log.entityType}</span>{' '}
                        <span className="block truncate text-quiet md:inline" title={log.entityId}>
                          ({log.entityId})
                        </span>
                      </div>
                      <span className="min-w-0 truncate text-[10px] text-sub" title={timestamp}>
                        {timestamp}
                      </span>
                      <span className="min-w-0 truncate text-[10px] text-sub" title={log.nodeId}>
                        来源: {log.nodeId}
                      </span>
                      <span className="w-fit max-w-full justify-self-end whitespace-nowrap rounded bg-card px-1.5 py-0.5 text-[10px] text-success">
                        v{log.version}
                      </span>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        <footer className="shrink-0 border-t border-edge px-5 py-3"><RecordPagination page={page} pageSize={data?.pageSize || LOG_PAGE_SIZE} total={data?.total || 0} loading={loading} onPageChange={goToPage} /></footer>
      </section>
    </div>
  );
};
