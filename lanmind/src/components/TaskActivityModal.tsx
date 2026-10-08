import React, { useCallback, useEffect, useRef } from 'react';
import { History, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { Task, TaskActivity, User } from '../types';
import { ApiService } from '../services/api';
import { LOG_PAGE_SIZE, usePagedRecords } from '../hooks/usePagedRecords';
import { PageRequest } from '../types';
import { RecordPagination } from './RecordPagination';

const FIELD_LABELS: Record<string, string> = {
  title: '名称', description: '内容', priority: '优先级', status: '状态', progress: '进度',
  startDate: '开始日期', dueDate: '到期日期', assigneeId: '负责人', projectId: '项目',
  parentTaskId: '主任务', tags: '标签', subtasks: '检查事项', recurrence: '循环', reminderTime: '提醒', isShared: '共享',
};
const ACTION_LABELS: Record<string, string> = { create: '创建', update: '更新', delete: '删除' };

interface TaskActivityModalProps { task: Task; currentUser: User; users: User[]; onClose: () => void }

export const TaskActivityModal: React.FC<TaskActivityModalProps> = (props) => <TaskActivityDialog key={`${props.task.id}:${props.currentUser.id}`} {...props} />;

const TaskActivityDialog: React.FC<TaskActivityModalProps> = ({ task, currentUser, users, onClose }) => {
  const loadPage = useCallback((request: PageRequest) => ApiService.getTaskActivityPage(task.id, currentUser.id, request), [task.id, currentUser.id]);
  const { data, page, loading, error, goToPage, refresh, retry } = usePagedRecords<TaskActivity>(loadPage);
  const items = data?.items || [];
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [data]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);

  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="任务动态">
    <section className="record-history-dialog flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-edge bg-surface text-main shadow-popover">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-edge px-5 py-4">
        <div className="min-w-0"><h2 className="flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4 text-info" />任务动态</h2><p className="mt-1 truncate text-xs text-sub" title={task.title}>{task.title}</p></div>
        <div className="flex shrink-0 items-center gap-1"><button type="button" onClick={refresh} disabled={loading} className="project-toolbar-icon" title="刷新任务动态" aria-label="刷新任务动态"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /></button><button type="button" onClick={onClose} className="ui-modal-close-btn" title="关闭任务动态" aria-label="关闭任务动态"><X className="h-4 w-4" /></button></div>
      </header>
      <div ref={bodyRef} aria-busy={loading} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {loading ? <div role="status" aria-label="读取任务动态" className="flex justify-center py-10"><LoaderCircle className="h-5 w-5 animate-spin text-sub" /></div>
          : error ? <div role="alert" className="py-8 text-center text-xs text-danger"><p>{error}</p><button type="button" onClick={retry} className="ui-cancel-button mx-auto mt-3 flex items-center gap-1 rounded-md px-3 py-2"><RefreshCw className="h-3.5 w-3.5" />重试</button></div>
            : items.length === 0 ? <p className="py-10 text-center text-xs text-quiet">暂无动态</p>
              : <ol className="divide-y divide-edge">{items.map((item) => {
                const isComment = 'taskId' in item.payload && 'content' in item.payload;
                const actor = users.find((user) => user.id === item.actorId)?.nickname || item.actorId;
                const fields = Object.keys(item.payload).filter((key) => key in FIELD_LABELS).map((key) => FIELD_LABELS[key]);
                return <li key={item.id} className="py-3 first:pt-0"><div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-medium">{actor} · {ACTION_LABELS[item.action] || item.action}{isComment ? '评论' : '任务'}</span><time className="text-[11px] text-quiet">{new Date(item.timestamp).toLocaleString()}</time></div>
                  {item.action === 'update' && fields.length > 0 && <p className="mt-1.5 text-xs text-sub">{fields.join('、')}</p>}
                  {isComment && typeof item.payload.content === 'string' && <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-sub">{item.payload.content}</p>}
                </li>;
              })}</ol>}
      </div>
      <footer className="shrink-0 border-t border-edge px-5 py-3"><RecordPagination page={page} pageSize={data?.pageSize || LOG_PAGE_SIZE} total={data?.total || 0} loading={loading} onPageChange={goToPage} /></footer>
    </section>
  </div>;
};
