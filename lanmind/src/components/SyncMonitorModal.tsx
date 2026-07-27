import React, { useState, useEffect } from 'react';
import { ChangeLog } from '../types';
import { ApiService } from '../services/api';
import { X, RefreshCw, History } from 'lucide-react';

const ACTION_PRESENTATION: Record<string, { label: string; tone: string }> = {
  create: { label: '创建', tone: 'text-emerald-400' },
  update: { label: '更新', tone: 'text-blue-400' },
  delete: { label: '删除', tone: 'text-rose-400' },
  start: { label: '开始任务', tone: 'text-blue-400' },
  complete: { label: '完成任务', tone: 'text-emerald-400' },
  reopen: { label: '重新开启', tone: 'text-amber-400' },
  block: { label: '标记阻塞', tone: 'text-rose-400' },
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
  project: '协作项目',
  user_profile: '用户资料',
  chat_message: '聊天消息',
  chat_group: '聊天群组',
};

interface SyncMonitorModalProps {
  isOpen: boolean;
  onClose: () => void;
  syncVersion: number;
}

export const SyncMonitorModal: React.FC<SyncMonitorModalProps> = ({
  isOpen,
  onClose,
  syncVersion,
}) => {
  const [logs, setLogs] = useState<ChangeLog[]>([]);
  const [latestVer, setLatestVer] = useState(syncVersion);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadLogs();
    }
  }, [isOpen]);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const res = await ApiService.getSyncLogs(0);
      setLogs(res.logs.reverse());
      setLatestVer(res.latestVersion);
    } catch (e) {
      console.error('Failed to load sync logs', e);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="max-h-[85vh] w-full max-w-4xl space-y-4 overflow-y-auto rounded-lg border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center space-x-2">
            <History className="w-5 h-5 text-blue-400" />
            <h2 className="text-sm font-bold text-white">增量同步日志</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-800 text-slate-400 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Sync Change Logs */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
              <History className="w-4 h-4 text-blue-400" />
              变更记录 (当前版本: v{latestVer})
            </h3>
            <button
              onClick={loadLogs}
              className="p-1 hover:bg-slate-800 text-slate-400 hover:text-white rounded"
              title="刷新同步日志"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="max-h-[52vh] space-y-2 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs">
            {logs.length === 0 ? (
              <div className="text-slate-500 text-center py-4">暂无同步变动日志</div>
            ) : (
              <>
                <div className="hidden grid-cols-[minmax(0,1fr)_8rem_10rem_5.5rem] gap-3 px-2 text-center text-[10px] text-slate-500 md:grid">
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
                      className="grid gap-2 rounded-md border border-slate-800/80 bg-slate-900 p-2 md:grid-cols-[minmax(0,1fr)_8rem_10rem_5.5rem] md:items-start md:gap-3"
                    >
                      <div className="min-w-0">
                        <span className={`font-bold ${action.tone}`}>[{action.label}]</span>{' '}
                        <span className="text-slate-200">{ENTITY_LABELS[log.entityType] || log.entityType}</span>{' '}
                        <span className="block truncate text-slate-500 md:inline" title={log.entityId}>
                          ({log.entityId})
                        </span>
                      </div>
                      <span className="min-w-0 truncate text-[10px] text-slate-400" title={timestamp}>
                        {timestamp}
                      </span>
                      <span className="min-w-0 truncate text-[10px] text-slate-400" title={log.nodeId}>
                        来源: {log.nodeId}
                      </span>
                      <span className="w-fit max-w-full justify-self-end whitespace-nowrap rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-emerald-400">
                        v{log.version}
                      </span>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-lg"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};
