import { localizeMessage } from '../i18n/messages';
import { currentLocale } from "../i18n/core";
import { tr, useLocale } from "../i18n";
import React, { useCallback, useEffect, useRef } from 'react';
import { ChangeLog, PageRequest, SyncLogPage } from '../types';
import { ApiService } from '../services/api';
import { X, RefreshCw, History, LoaderCircle } from 'lucide-react';
import { LOG_PAGE_SIZE, usePagedRecords } from '../hooks/usePagedRecords';
import { RecordPagination } from './RecordPagination';

const ACTION_PRESENTATION: Record<string, { label: string; tone: string }> = {
  transfer: { get label() { return tr("common:syncMonitorModal.transferProject"); }, tone: 'text-warning' },
  create: { get label() { return tr("common:syncMonitorModal.create"); }, tone: 'text-success' },
  update: { get label() { return tr("common:syncMonitorModal.update"); }, tone: 'text-info' },
  delete: { get label() { return tr("common:syncMonitorModal.delete"); }, tone: 'text-danger' },
  start: { get label() { return tr("common:syncMonitorModal.startTask"); }, tone: 'text-info' },
  complete: { get label() { return tr("common:syncMonitorModal.completeTask"); }, tone: 'text-success' },
  reopen: { get label() { return tr("common:syncMonitorModal.reopen"); }, tone: 'text-warning' },
  block: { get label() { return tr("common:syncMonitorModal.markBlocked"); }, tone: 'text-danger' },
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
  get task() { return tr("common:syncMonitorModal.task"); },
  get task_assignment() { return tr("common:syncMonitorModal.taskAssignment"); },
  get task_comment() { return tr("common:syncMonitorModal.taskComment"); },
  get project() { return tr("common:syncMonitorModal.sharedProject"); },
  get project_file() { return tr("common:syncMonitorModal.projectFiles"); },
  get project_folder() { return tr("common:syncMonitorModal.projectFolder"); },
  get user_profile() { return tr("common:syncMonitorModal.userProfile"); },
  get chat_message() { return tr("common:syncMonitorModal.chatMessage"); },
  get chat_group() { return tr("common:syncMonitorModal.chatGroup"); },
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
  useLocale();
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
    <div role="dialog" aria-modal="true" aria-label={tr("common:syncMonitorModal.syncLog")} className="fixed inset-0 bg-overlay backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <section className="record-history-dialog flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-edge bg-surface text-main shadow-popover">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-edge px-5 py-4">
          <div className="flex items-center space-x-2">
            <History className="w-5 h-5 text-info" />
            <h2 className="text-sm font-bold text-main">{tr("common:syncMonitorModal.syncLog")}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ui-modal-close-btn"
            title={tr("common:syncMonitorModal.closeEsc")}
            aria-label={tr("common:syncMonitorModal.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Sync Change Logs */}
          <div className="flex shrink-0 items-center justify-between px-5 py-3">
            <h3 className="text-xs font-bold text-sub flex items-center gap-1.5">
              <History className="w-4 h-4 text-info" />
              {tr("common:syncMonitorModal.changesVersionV")}{data?.latestVersion ?? syncVersion})
            </h3>
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              className="project-toolbar-icon"
              title={tr("common:syncMonitorModal.refreshSyncLog")}
              aria-label={tr("common:syncMonitorModal.refreshSyncLog")}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div ref={bodyRef} aria-busy={loading} className="mx-5 mb-4 min-h-0 flex-1 space-y-2 overflow-y-auto rounded-md border border-edge bg-canvas p-3 font-mono text-xs">
            {loading ? <div role="status" aria-label={tr("common:syncMonitorModal.loadSyncLog")} className="flex justify-center py-10"><LoaderCircle className="h-5 w-5 animate-spin text-sub" /></div>
              : error ? <div role="alert" className="py-8 text-center text-danger"><p>{localizeMessage(error)}</p><button type="button" onClick={retry} className="ui-cancel-button mx-auto mt-3 flex items-center gap-1 rounded-md px-3 py-2"><RefreshCw className="h-3.5 w-3.5" />{tr("common:syncMonitorModal.retry")}</button></div>
              : logs.length === 0 ? (
              <div className="text-quiet text-center py-4">{tr("common:syncMonitorModal.noSyncChanges")}</div>
            ) : (
              <>
                <div className="hidden grid-cols-[minmax(0,1fr)_8rem_10rem_5.5rem] gap-3 px-2 text-center text-[10px] text-quiet md:grid">
                  <span>{tr("common:syncMonitorModal.changes")}</span>
                  <span>{tr("common:syncMonitorModal.time")}</span>
                  <span>{tr("common:syncMonitorModal.source")}</span>
                  <span>{tr("common:syncMonitorModal.version")}</span>
                </div>
                {logs.map((log) => {
                  const action = actionPresentation(log);
                  const timestamp = new Date(log.timestamp).toLocaleString(currentLocale(), { hour12: false });
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
                      <span className="min-w-0 truncate text-[10px] text-sub" title={log.nodeId}>{tr("common:syncMonitorModal.source2", { value0: log.nodeId })}</span>
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
